//! The hub keeps every IRC connection running, stores what arrives and hands it on as events.
//! The app uses it directly, lobby-server serves it to apps over WebSocket.

use crate::backlog::Backlog;
use crate::net::{BufferInfo, DEFAULT_MODES_PER_LINE, Out, Session, Whois};
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
/// Lines on each side of a line opened from the inbox or the shelf.
const AROUND_LINES: i64 = 60;
const FOUND_PAGE: i64 = 200;
const RECENT_BUFFER_DAYS: i64 = 30;
const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Line(Line),
    Buffer(BufferInfo),
    Me {
        net: String,
        nick: String,
        /// user@host as others see it, once a join has shown it; sets how long a message may be.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        mask: String,
    },
    Conn {
        net: String,
        state: String,
    },
    People {
        people: Vec<Person>,
    },
    Setting {
        key: String,
        value: String,
    },
    Whois(Whois),
    /// The list of networks changed; clients fetch a fresh snapshot.
    Networks,
}

/// A network as the setup screen shows it: no password, only whether there is one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkView {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub has_password: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetStatus {
    pub name: String,
    pub state: String,
    pub nick: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub mask: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Snapshot {
    pub networks: Vec<NetStatus>,
    pub channels: Vec<BufferInfo>,
    #[serde(default)]
    pub people: Vec<Person>,
    #[serde(default)]
    pub settings: HashMap<String, String>,
    /// lobby-server has a place for attachments (its `[upload]`); older servers leave it out.
    #[serde(default)]
    pub uploads: bool,
}

pub struct Hub {
    store: Store,
    networks: Mutex<Vec<Network>>,
    nick: String,
    writers: Mutex<HashMap<String, mpsc::UnboundedSender<String>>>,
    me: Mutex<HashMap<String, String>>,
    conn: Mutex<HashMap<String, String>>,
    channels: Mutex<HashMap<(String, String), BufferInfo>>,
    modes_per_line: Mutex<HashMap<String, usize>>,
    events: broadcast::Sender<Event>,
    tasks: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
    backlog: Mutex<Option<Backlog>>,
    masks: Mutex<HashMap<String, String>>,
}

/// The channels each network was in, kept so a restart or a reconnect joins them again.
const REJOIN_PREFIX: &str = "rejoin.";
const REALNAME: &str = "Lobby";

fn remember(list: &mut Vec<String>, channel: &str, joined: bool) {
    let known = list.iter().any(|c| c.eq_ignore_ascii_case(channel));
    if joined && !known {
        list.push(channel.to_string());
    } else if !joined {
        list.retain(|c| !c.eq_ignore_ascii_case(channel));
    }
}

fn to_rejoin(remembered: &[String], joined: &[String]) -> Vec<String> {
    remembered.iter().filter(|c| !joined.iter().any(|j| j.eq_ignore_ascii_case(c))).cloned().collect()
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Hub {
    pub fn new(store: Store, networks: Vec<Network>, nick: String) -> Arc<Self> {
        let (events, _) = broadcast::channel(EVENT_BUFFER);
        Arc::new(Self {
            store,
            networks: Mutex::new(networks),
            nick,
            writers: Mutex::default(),
            me: Mutex::default(),
            conn: Mutex::default(),
            channels: Mutex::default(),
            modes_per_line: Mutex::default(),
            events,
            tasks: Mutex::default(),
            backlog: Mutex::default(),
            masks: Mutex::default(),
        })
    }

    /// A public log to fill each connection's gap from before it connects.
    pub fn set_backlog(&self, backlog: Backlog) {
        *lock(&self.backlog) = Some(backlog);
    }

    /// Say goodbye on every network, with the user's quit message.
    pub fn quit_all(&self, reason: &str) {
        for tx in lock(&self.writers).values() {
            let _ = tx.send(format!("QUIT :{reason}"));
        }
    }

    /// Close every connection, for when the setup changes.
    pub fn stop(&self) {
        for (_, task) in lock(&self.tasks).drain() {
            task.abort();
        }
        lock(&self.writers).clear();
    }

    pub fn networks(&self) -> Vec<Network> {
        lock(&self.networks).clone()
    }

    pub fn network_views(&self) -> Vec<NetworkView> {
        lock(&self.networks)
            .iter()
            .map(|n| NetworkView {
                name: n.name.clone(),
                host: n.host.clone(),
                port: n.port,
                has_password: n.password.is_some() || n.password_file.is_some(),
            })
            .collect()
    }

    /// Add a network, or change one with the same name. Without a new password the old one stays.
    pub fn save_network(self: &Arc<Self>, mut net: Network) -> Result<(), String> {
        if net.name.trim().is_empty() || net.host.trim().is_empty() {
            return Err("A network needs a name and a host".into());
        }
        if let Some(old) = lock(&self.networks).iter().find(|n| n.name == net.name)
            && net.password.is_none()
            && net.password_file.is_none()
        {
            net.password = old.password.clone();
            net.password_file = old.password_file.clone();
        }
        self.drop_network(&net.name);
        lock(&self.networks).push(net.clone());
        self.spawn_network(net);
        self.emit(Event::Networks);
        Ok(())
    }

    /// Disconnect a network and forget it. Its history stays.
    pub fn delete_network(&self, name: &str) -> Result<(), String> {
        if !lock(&self.networks).iter().any(|n| n.name == name) {
            return Err(format!("No network called {name}"));
        }
        self.drop_network(name);
        self.emit(Event::Networks);
        Ok(())
    }

    fn drop_network(&self, name: &str) {
        if let Some(task) = lock(&self.tasks).remove(name) {
            task.abort();
        }
        lock(&self.networks).retain(|n| n.name != name);
        lock(&self.writers).remove(name);
        lock(&self.conn).remove(name);
        lock(&self.me).remove(name);
        lock(&self.channels).retain(|(net, _), _| net != name);
    }

    /// Connect every network. Must be called from inside a Tokio runtime.
    pub fn start(self: &Arc<Self>) {
        for net in self.networks() {
            self.spawn_network(net);
        }
    }

    fn spawn_network(self: &Arc<Self>, net: Network) {
        let hub = Arc::clone(self);
        let name = net.name.clone();
        let task = tokio::spawn(async move {
            loop {
                hub.set_conn(&net.name, "connecting");
                let backlog = lock(&hub.backlog).clone();
                if let Some(backlog) = backlog {
                    match backlog.fill(&hub.store, &net.name, &hub.nick).await {
                        // Windows already open fetch their history again.
                        Ok(added) if added > 0 => {
                            let _ = hub.events.send(Event::Networks);
                        }
                        Ok(_) => {}
                        Err(e) => eprintln!("backlog: {e}"),
                    }
                }
                let state = match hub.run(&net).await {
                    Ok(()) => "disconnected".to_string(),
                    Err(e) => format!("disconnected: {e}"),
                };
                hub.set_conn(&net.name, &state);
                tokio::time::sleep(RECONNECT_DELAY).await;
            }
        });
        lock(&self.tasks).insert(name, task);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.events.subscribe()
    }

    pub fn snapshot(&self) -> Snapshot {
        let conn = lock(&self.conn);
        let me = lock(&self.me);
        let masks = lock(&self.masks);
        let networks = lock(&self.networks)
            .iter()
            .map(|n| NetStatus {
                name: n.name.clone(),
                state: conn.get(&n.name).cloned().unwrap_or_default(),
                nick: me.get(&n.name).cloned().unwrap_or_default(),
                mask: masks.get(&n.name).cloned().unwrap_or_default(),
            })
            .collect();
        let channels = lock(&self.channels).values().cloned().collect();
        let people = self.store.people().unwrap_or_default();
        let settings = self.store.settings().unwrap_or_default();
        Snapshot { networks, channels, people, settings, uploads: false }
    }

    pub fn history(&self, net: &str, buffer: &str, before: Option<i64>) -> Result<Vec<Line>, String> {
        self.store.history(net, buffer, before.unwrap_or(i64::MAX), HISTORY_PAGE).map_err(|e| e.to_string())
    }

    pub fn talkers(&self, net: &str, buffer: &str, since: i64, until: i64) -> Result<Vec<crate::store::Talker>, String> {
        self.store.talkers(net, buffer, since, until).map_err(|e| e.to_string())
    }

    pub fn last_spoke(&self, net: &str, buffer: &str) -> Result<std::collections::HashMap<String, i64>, String> {
        self.store.last_spoke(net, buffer).map_err(|e| e.to_string())
    }

    pub fn count_unread(&self, net: &str, buffer: &str, after: i64, before: i64) -> Result<i64, String> {
        self.store.count_unread(net, buffer, after, before).map_err(|e| e.to_string())
    }

    pub fn around(&self, net: &str, buffer: &str, line: i64) -> Result<Vec<Line>, String> {
        self.store.around(net, buffer, line, AROUND_LINES).map_err(|e| e.to_string())
    }

    pub fn mentions(&self, words: &[String], before: Option<i64>) -> Result<Vec<Line>, String> {
        self.store.containing(words, before.unwrap_or(i64::MAX), FOUND_PAGE).map_err(|e| e.to_string())
    }

    pub fn links(&self, net: &str, buffer: &str, before: Option<i64>) -> Result<Vec<Line>, String> {
        self.store.with_links(net, buffer, before.unwrap_or(i64::MAX), FOUND_PAGE).map_err(|e| e.to_string())
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
        let per_line = lock(&self.modes_per_line).get(net).copied().unwrap_or(DEFAULT_MODES_PER_LINE);

        let prefix = match lock(&self.masks).get(net) {
            Some(mask) => format!("{me}!{mask}"),
            None => me.clone(),
        };
        for (raw, echo) in irc::outgoing(buffer, text, per_line, &prefix)? {
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
        let stream =
            tokio::time::timeout(CONNECT_TIMEOUT, connect).await.map_err(|_| "timed out".to_string())?.map_err(|e| e.to_string())?;
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
        let _ = tx.send(format!("USER {} 0 * :{}", self.nick, REALNAME));
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

    fn remembered(&self, net: &str) -> Vec<String> {
        let key = format!("{REJOIN_PREFIX}{net}");
        self.store.settings().ok().and_then(|s| s.get(&key).and_then(|v| serde_json::from_str(v).ok())).unwrap_or_default()
    }

    fn remember_channel(&self, net: &str, channel: &str, joined: bool) {
        let mut list = self.remembered(net);
        let before = list.clone();
        remember(&mut list, channel, joined);
        if list != before
            && let Ok(json) = serde_json::to_string(&list)
        {
            let _ = self.store.set_setting(&format!("{REJOIN_PREFIX}{net}"), &json);
        }
    }

    /// Keep the snapshot's member lists current between NAMES replies.
    fn track_members(&self, line: &Line) {
        let mut channels = lock(&self.channels);
        let Some(chan) = channels.get_mut(&(line.net.clone(), line.buffer.to_lowercase())) else { return };
        let members = &mut chan.members;
        match line.kind.as_str() {
            "join" => members.push(line.nick.clone()),
            "part" | "quit" | "kick" => {
                members.retain(|m| !m.eq_ignore_ascii_case(&line.nick));
                chan.modes.retain(|m, _| !m.eq_ignore_ascii_case(&line.nick));
            }
            "nick" => {
                members.retain(|m| !m.eq_ignore_ascii_case(&line.nick));
                members.push(line.text.clone());
                let old = chan.modes.keys().find(|m| m.eq_ignore_ascii_case(&line.nick)).cloned();
                if let Some(held) = old.and_then(|m| chan.modes.remove(&m)) {
                    chan.modes.insert(line.text.clone(), held);
                }
            }
            _ => {}
        }
    }

    fn apply(&self, net: &str, out: Out, tx: &mpsc::UnboundedSender<String>) {
        match out {
            Out::Line(line) => {
                self.track_members(&line);
                // Your own join is news only the first time. Coming back, as through irssiproxy after
                // a restart, IRC saw nothing, so no "you joined" line either.
                if line.kind == "join" && line.own && self.store.has_nick(&line.net, &line.buffer, &line.nick).unwrap_or(false) {
                    return;
                }
                self.deliver(line);
            }
            Out::Buffer(info) => {
                let key = (info.net.clone(), info.name.to_lowercase());
                self.remember_channel(net, &info.name, info.joined);
                if info.joined {
                    lock(&self.channels).insert(key, info.clone());
                } else {
                    lock(&self.channels).remove(&key);
                }
                self.emit(Event::Buffer(info));
            }
            Out::Me(nick) => {
                // Welcomed, or a new nick: either way, back into the channels left behind.
                let joined: Vec<String> = lock(&self.channels).keys().filter(|(n, _)| n == net).map(|(_, c)| c.clone()).collect();
                let missing = to_rejoin(&self.remembered(net), &joined);
                if !missing.is_empty() {
                    let _ = tx.send(format!("JOIN {}", missing.join(",")));
                }
                lock(&self.me).insert(net.into(), nick.clone());
                let mask = lock(&self.masks).get(net).cloned().unwrap_or_default();
                self.emit(Event::Me { net: net.into(), nick, mask });
            }
            Out::Mask(mask) => {
                if mask.is_empty() || lock(&self.masks).get(net) == Some(&mask) {
                    return;
                }
                lock(&self.masks).insert(net.into(), mask.clone());
                let nick = lock(&self.me).get(net).cloned().unwrap_or_else(|| self.nick.clone());
                self.emit(Event::Me { net: net.into(), nick, mask });
            }
            Out::Send(line) => {
                let _ = tx.send(line);
            }
            Out::Whois(whois) => self.emit(Event::Whois(whois)),
            Out::ModesPerLine(n) => {
                lock(&self.modes_per_line).insert(net.into(), n);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejoins_what_was_joined_and_not_parted() {
        let remembered = vec!["#pulina".to_string(), "#kahvi".to_string()];
        assert_eq!(to_rejoin(&remembered, &["#Pulina".to_string()]), vec!["#kahvi".to_string()]);
        let mut list = remembered.clone();
        remember(&mut list, "#retro", true);
        remember(&mut list, "#PULINA", false);
        assert_eq!(list, vec!["#kahvi".to_string(), "#retro".to_string()]);
    }
}
