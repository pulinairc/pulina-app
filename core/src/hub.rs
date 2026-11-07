//! The hub keeps every IRC connection running, stores what arrives and hands it on as events.
//! The app uses it directly, lobby-server serves it to apps over WebSocket.

use crate::net::{BufferInfo, Out, Session};
use crate::store::{BufferRef, Line, Person, Store};
use crate::{Network, irc, now_ms};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{broadcast, mpsc};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const RECONNECT_DELAY: Duration = Duration::from_secs(10);
const EVENT_BUFFER: usize = 4096;
const HISTORY_PAGE: i64 = 300;
const RECENT_BUFFER_DAYS: i64 = 30;
const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Line(Line),
    Buffer(BufferInfo),
    Me { net: String, nick: String },
    Conn { net: String, state: String },
    People { people: Vec<Person> },
    Setting { key: String, value: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetStatus {
    pub name: String,
    pub state: String,
    pub nick: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Snapshot {
    pub networks: Vec<NetStatus>,
    pub channels: Vec<BufferInfo>,
    #[serde(default)]
    pub people: Vec<Person>,
    #[serde(default)]
    pub settings: HashMap<String, String>,
}

pub struct Hub {
    store: Store,
    networks: Vec<Network>,
    nick: String,
    writers: Mutex<HashMap<String, mpsc::UnboundedSender<String>>>,
    me: Mutex<HashMap<String, String>>,
    conn: Mutex<HashMap<String, String>>,
    channels: Mutex<HashMap<(String, String), BufferInfo>>,
    events: broadcast::Sender<Event>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Hub {
    pub fn new(store: Store, networks: Vec<Network>, nick: String) -> Arc<Self> {
        let (events, _) = broadcast::channel(EVENT_BUFFER);
        Arc::new(Self {
            store,
            networks,
            nick,
            writers: Mutex::default(),
            me: Mutex::default(),
            conn: Mutex::default(),
            channels: Mutex::default(),
            events,
        })
    }

    /// Connect every network. Must be called from inside a Tokio runtime.
    pub fn start(self: &Arc<Self>) {
        for net in self.networks.clone() {
            let hub = Arc::clone(self);
            tokio::spawn(async move {
                loop {
                    hub.set_conn(&net.name, "connecting");
                    let state = match hub.run(&net).await {
                        Ok(()) => "disconnected".to_string(),
                        Err(e) => format!("disconnected: {e}"),
                    };
                    hub.set_conn(&net.name, &state);
                    tokio::time::sleep(RECONNECT_DELAY).await;
                }
            });
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.events.subscribe()
    }

    pub fn snapshot(&self) -> Snapshot {
        let conn = lock(&self.conn);
        let me = lock(&self.me);
        let networks = self
            .networks
            .iter()
            .map(|n| NetStatus {
                name: n.name.clone(),
                state: conn.get(&n.name).cloned().unwrap_or_default(),
                nick: me.get(&n.name).cloned().unwrap_or_default(),
            })
            .collect();
        let channels = lock(&self.channels).values().cloned().collect();
        let people = self.store.people().unwrap_or_default();
        let settings = self.store.settings().unwrap_or_default();
        Snapshot { networks, channels, people, settings }
    }

    pub fn history(&self, net: &str, buffer: &str, before: Option<i64>) -> Result<Vec<Line>, String> {
        self.store.history(net, buffer, before.unwrap_or(i64::MAX), HISTORY_PAGE).map_err(|e| e.to_string())
    }

    pub fn recent_buffers(&self) -> Result<Vec<BufferRef>, String> {
        let since = now_ms() - RECENT_BUFFER_DAYS * DAY_MS;
        self.store.recent_buffers(since).map_err(|e| e.to_string())
    }

    /// Add or update a person; every connected app gets the new list.
    pub fn save_person(&self, person: &Person) -> Result<i64, String> {
        let id = self.store.save_person(person).map_err(|e| e.to_string())?;
        self.emit_people();
        Ok(id)
    }

    pub fn delete_person(&self, id: i64) -> Result<(), String> {
        self.store.delete_person(id).map_err(|e| e.to_string())?;
        self.emit_people();
        Ok(())
    }

    fn emit_people(&self) {
        let people = self.store.people().unwrap_or_default();
        self.emit(Event::People { people });
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.store.set_setting(key, value).map_err(|e| e.to_string())?;
        self.emit(Event::Setting { key: key.into(), value: value.into() });
        Ok(())
    }

    /// Send what was typed: a message or a command.
    pub fn send(&self, net: &str, buffer: &str, text: &str) -> Result<(), String> {
        let tx = lock(&self.writers).get(net).cloned().ok_or("Not connected")?;
        let me = lock(&self.me).get(net).cloned().unwrap_or_else(|| self.nick.clone());

        for (raw, echo) in irc::outgoing(buffer, text)? {
            tx.send(raw).map_err(|_| "Not connected")?;
            let Some(echo) = echo else { continue };
            self.deliver(Line {
                net: net.into(),
                buffer: echo.buffer,
                ts: now_ms(),
                kind: echo.kind.into(),
                nick: me.clone(),
                text: echo.text,
                own: true,
                ..Default::default()
            });
        }
        Ok(())
    }

    fn emit(&self, event: Event) {
        let _ = self.events.send(event);
    }

    fn deliver(&self, mut line: Line) {
        match self.store.insert(&line) {
            Ok(id) => line.id = id,
            Err(e) => eprintln!("history write failed: {e}"),
        }
        self.emit(Event::Line(line));
    }

    fn set_conn(&self, net: &str, state: &str) {
        lock(&self.conn).insert(net.into(), state.into());
        self.emit(Event::Conn { net: net.into(), state: state.into() });
    }

    // ponytail: no keepalive, a silently dead socket is only noticed when the OS drops it.
    async fn run(&self, net: &Network) -> Result<(), String> {
        let connect = TcpStream::connect((net.host.as_str(), net.port));
        let stream = tokio::time::timeout(CONNECT_TIMEOUT, connect)
            .await
            .map_err(|_| "timed out".to_string())?
            .map_err(|e| e.to_string())?;
        let (read, mut write) = stream.into_split();

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let writer = tokio::spawn(async move {
            while let Some(line) = rx.recv().await {
                if write.write_all(format!("{line}\r\n").as_bytes()).await.is_err() {
                    break;
                }
            }
        });
        lock(&self.writers).insert(net.name.clone(), tx.clone());

        if let Some(password) = net.password() {
            let _ = tx.send(format!("PASS {password}"));
        }
        let _ = tx.send(format!("NICK {}", self.nick));
        let _ = tx.send(format!("USER {} 0 * :Lobby", self.nick));
        self.set_conn(&net.name, "connected");

        let mut session = Session::new(&net.name, &self.nick);
        let mut reader = BufReader::new(read);
        let mut buf = Vec::new();
        let result = loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf).await {
                Ok(0) => break Ok(()),
                Ok(_) => {}
                Err(e) => break Err(e.to_string()),
            }
            let Some(msg) = irc::parse(&irc::decode(&buf)) else { continue };
            for out in session.handle(&msg, now_ms()) {
                self.apply(&net.name, out, &tx);
            }
        };

        lock(&self.writers).remove(&net.name);
        lock(&self.channels).retain(|(n, _), _| n != &net.name);
        writer.abort();
        result
    }

    /// Keep the snapshot's member lists current between NAMES replies.
    fn track_members(&self, line: &Line) {
        let mut channels = lock(&self.channels);
        let Some(chan) = channels.get_mut(&(line.net.clone(), line.buffer.to_lowercase())) else { return };
        let members = &mut chan.members;
        match line.kind.as_str() {
            "join" => members.push(line.nick.clone()),
            "part" | "quit" | "kick" => members.retain(|m| !m.eq_ignore_ascii_case(&line.nick)),
            "nick" => {
                members.retain(|m| !m.eq_ignore_ascii_case(&line.nick));
                members.push(line.text.clone());
            }
            _ => {}
        }
    }

    fn apply(&self, net: &str, out: Out, tx: &mpsc::UnboundedSender<String>) {
        match out {
            Out::Line(line) => {
                self.track_members(&line);
                self.deliver(line);
            }
            Out::Buffer(info) => {
                let key = (info.net.clone(), info.name.to_lowercase());
                if info.joined {
                    lock(&self.channels).insert(key, info.clone());
                } else {
                    lock(&self.channels).remove(&key);
                }
                self.emit(Event::Buffer(info));
            }
            Out::Me(nick) => {
                lock(&self.me).insert(net.into(), nick.clone());
                self.emit(Event::Me { net: net.into(), nick });
            }
            Out::Send(line) => {
                let _ = tx.send(line);
            }
        }
    }
}
