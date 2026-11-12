//! A link to lobby-server: history and live events come from there instead of local connections.

use crate::config::ServerLink;
use crate::tunnel::{Target, Tunnel};
use futures_util::{SinkExt, StreamExt};
use lobby_core::hub::{Event, Snapshot};
use lobby_core::protocol::{ClientMsg, ServerMsg};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

const RECONNECT_DELAY: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PING_EVERY: Duration = Duration::from_secs(10);
// A link that was cut while the phone slept gives no error, only silence.
const SILENCE_LIMIT: Duration = Duration::from_secs(25);
const UNREACHABLE: &str = "lobby-server unreachable";

type Pending = Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>;

pub struct Remote {
    link: ServerLink,
    out: Mutex<Option<mpsc::UnboundedSender<String>>>,
    pending: Pending,
    next_id: AtomicU64,
    snapshot: Mutex<Snapshot>,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// Wall clock, which keeps running while the phone sleeps, unlike the timers.
    heard: Mutex<Option<SystemTime>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Remote {
    pub fn new(link: ServerLink) -> Arc<Self> {
        Arc::new(Self {
            link,
            out: Mutex::default(),
            pending: Mutex::default(),
            next_id: AtomicU64::new(1),
            snapshot: Mutex::default(),
            task: Mutex::default(),
            heard: Mutex::default(),
        })
    }

    pub fn snapshot(&self) -> Snapshot {
        lock(&self.snapshot).clone()
    }

    /// Send a request built around a fresh id and wait for its reply.
    pub async fn request(&self, build: impl FnOnce(u64) -> ClientMsg) -> Result<Value, String> {
        self.request_within(REQUEST_TIMEOUT, build).await
    }

    pub async fn request_within(&self, wait: Duration, build: impl FnOnce(u64) -> ClientMsg) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let json = serde_json::to_string(&build(id)).map_err(|e| e.to_string())?;
        let (tx, rx) = oneshot::channel();
        lock(&self.pending).insert(id, tx);

        let sent = lock(&self.out).as_ref().is_some_and(|out| out.send(json).is_ok());
        if !sent {
            lock(&self.pending).remove(&id);
            return Err(UNREACHABLE.into());
        }
        match tokio::time::timeout(wait, rx).await {
            Ok(Ok(result)) => result,
            _ => {
                lock(&self.pending).remove(&id);
                Err("lobby-server did not answer".into())
            }
        }
    }

    /// Close the link and its tunnel, for when the setup changes.
    pub fn stop(&self) {
        if let Some(task) = lock(&self.task).take() {
            task.abort();
        }
        *lock(&self.out) = None;
    }

    /// Back from the background. A live link hears a pong every few seconds, so one quiet for longer
    /// was cut while the app slept: connect again now instead of waiting for the silence limit.
    pub fn wake(self: &Arc<Self>, app: AppHandle) {
        let quiet = lock(&self.heard).and_then(|t| t.elapsed().ok()).is_some_and(|d| d > SILENCE_LIMIT);
        if !quiet {
            return;
        }
        self.stop();
        *lock(&self.heard) = None;
        for (_, tx) in lock(&self.pending).drain() {
            let _ = tx.send(Err(UNREACHABLE.into()));
        }
        self.start(app);
    }

    pub fn start(self: &Arc<Self>, app: AppHandle) {
        let remote = Arc::clone(self);
        let task = tauri::async_runtime::spawn(async move {
            loop {
                *lock(&remote.heard) = None;
                let began = Instant::now();
                let reason = remote.run(&app).await.err().unwrap_or_else(|| "connection closed".into());
                eprintln!("lobby-server: {reason}");
                *lock(&remote.out) = None;
                for (_, tx) in lock(&remote.pending).drain() {
                    let _ = tx.send(Err(UNREACHABLE.into()));
                }

                // A link that worked for a while and then broke (wifi blip, phone back from the background)
                // usually comes straight back: try once at once, without the warning.
                let worked = lock(&remote.heard).is_some() && began.elapsed() > RECONNECT_DELAY;
                if worked {
                    continue;
                }

                // The reason goes to the window too: before the first snapshot there are no networks to mark.
                let _ = app.emit("server", serde_json::json!({ "down": reason }));
                let names: Vec<String> = remote.snapshot().networks.into_iter().map(|n| n.name).collect();
                for net in names {
                    let _ = app.emit("conn", serde_json::json!({ "net": net, "state": UNREACHABLE }));
                }
                tokio::time::sleep(RECONNECT_DELAY).await;
            }
        });
        *lock(&self.task) = Some(task);
    }

    async fn run(&self, app: &AppHandle) -> Result<(), String> {
        tokio::time::timeout(CONNECT_TIMEOUT, self.connect()).await.map_err(|_| "no answer".to_string())??.serve(self, app).await
    }

    async fn connect(&self) -> Result<Link, String> {
        // Held for the whole connection: dropping it closes the ssh tunnel.
        let mut _tunnel = None;
        let url = match &self.link.ssh {
            Some(host) => {
                let target = Target::parse(host, self.link.ssh_port)?;
                let tunnel = Tunnel::open(&target, self.link.remote_port(), &crate::config::ssh_dir()).await?;
                let url = format!("ws://127.0.0.1:{}", tunnel.port);
                _tunnel = Some(tunnel);
                url
            }
            None => self.link.url.clone().ok_or("set url or ssh under [server]")?,
        };

        let (ws, _) = tokio_tungstenite::connect_async(url.as_str()).await.map_err(|e| e.to_string())?;
        Ok(Link { ws, _tunnel })
    }
}

struct Link {
    ws: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    _tunnel: Option<Tunnel>,
}

impl Link {
    async fn serve(self, remote: &Remote, app: &AppHandle) -> Result<(), String> {
        let (mut sink, mut stream) = self.ws.split();

        let hello = serde_json::to_string(&ClientMsg::Hello { token: remote.link.token() }).map_err(|e| e.to_string())?;
        sink.send(Message::text(hello)).await.map_err(|e| e.to_string())?;

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        *lock(&remote.out) = Some(tx);
        let writer = tauri::async_runtime::spawn(async move {
            let mut ping = tokio::time::interval(PING_EVERY);
            loop {
                let frame = tokio::select! {
                    text = rx.recv() => match text {
                        Some(text) => Message::text(text),
                        None => break,
                    },
                    _ = ping.tick() => Message::Ping(Default::default()),
                };
                if sink.send(frame).await.is_err() {
                    break;
                }
            }
        });

        let result = loop {
            let frame = match tokio::time::timeout(SILENCE_LIMIT, stream.next()).await {
                Err(_) => break Err("no answer".to_string()),
                Ok(None) => break Ok(()),
                Ok(Some(frame)) => frame,
            };
            let frame = match frame {
                Ok(frame) => frame,
                Err(e) => break Err(e.to_string()),
            };
            *lock(&remote.heard) = Some(SystemTime::now());
            let Message::Text(text) = frame else { continue };
            let Ok(msg) = serde_json::from_str::<ServerMsg>(text.as_str()) else { continue };
            remote.handle(app, msg);
        };
        writer.abort();
        result
    }
}

impl Remote {
    fn handle(&self, app: &AppHandle, msg: ServerMsg) {
        match msg {
            ServerMsg::Welcome { snapshot } => {
                *lock(&self.snapshot) = snapshot;
                let _ = app.emit("server", serde_json::json!({ "down": null }));
                let _ = app.emit("resync", ());
            }
            ServerMsg::Event { event } => {
                self.track(&event);
                crate::emit_event(app, event);
            }
            ServerMsg::Reply { id, data, error } => {
                let Some(tx) = lock(&self.pending).remove(&id) else { return };
                let _ = tx.send(match error {
                    Some(e) => Err(e),
                    None => Ok(data.unwrap_or(Value::Null)),
                });
            }
        }
    }

    /// Keep the snapshot current so a reloaded window gets the right state.
    fn track(&self, event: &Event) {
        let mut snap = lock(&self.snapshot);
        match event {
            Event::Conn { net, state } => {
                if let Some(n) = snap.networks.iter_mut().find(|n| &n.name == net) {
                    n.state = state.clone();
                }
            }
            Event::Me { net, nick, .. } => {
                if let Some(n) = snap.networks.iter_mut().find(|n| &n.name == net) {
                    n.nick = nick.clone();
                }
            }
            Event::Buffer(info) => {
                snap.channels.retain(|c| !(c.net == info.net && c.name.eq_ignore_ascii_case(&info.name)));
                if info.joined {
                    snap.channels.push(info.clone());
                }
            }
            Event::People { people } => snap.people = people.clone(),
            Event::Setting { key, value } => {
                snap.settings.insert(key.clone(), value.clone());
            }
            Event::Line(_) | Event::Whois(_) | Event::Networks => {}
        }
    }
}
