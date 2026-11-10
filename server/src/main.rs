//! lobby-server: runs next to irssi on your shell host. It connects to irssiproxy like any
//! client, keeps every line in SQLite, and serves history and live chat to Lobby apps.

use futures_util::{SinkExt, StreamExt};
use lobby_core::hub::{Event, Hub};
use lobby_core::protocol::{ClientMsg, ServerMsg};
use lobby_core::store::Store;
use lobby_core::upload;
use lobby_core::{Network, expand, read_secret};
use serde::Deserialize;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast::error::RecvError;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;

const DEFAULT_LISTEN: &str = "127.0.0.1:7667";
const DEFAULT_TOKEN_FILE: &str = "~/.config/lobby-server/token";
const MIN_TOKEN_LEN: usize = 16;
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
/// Reverse proxies drop quiet WebSockets, so ping well inside their usual 60 s.
const PING_EVERY: Duration = Duration::from_secs(30);
/// An attachment arrives in one frame, in base64, so frames may be as big as the largest file.
const MAX_FRAME: usize = upload::MAX_BYTES * 2;

#[derive(Deserialize)]
struct Config {
    #[serde(default = "default_listen")]
    listen: String,
    nick: String,
    token: Option<String>,
    token_file: Option<String>,
    #[serde(default)]
    allow_insecure: bool,
    #[serde(rename = "network", default)]
    networks: Vec<Network>,
    /// Where attachments sent through lobby-server go. Without it the app uses its own choice.
    upload: Option<upload::Target>,
}

fn default_listen() -> String {
    DEFAULT_LISTEN.into()
}

fn config_path() -> PathBuf {
    match std::env::args().nth(1) {
        Some(path) => expand(&path),
        None => dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("lobby-server/config.toml"),
    }
}

fn load(path: &PathBuf) -> Result<Config, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Write the networks back to the config, keeping its other settings.
fn save_networks(path: &Path, networks: &[Network]) -> Result<(), String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut table: toml::Table = text.parse().map_err(|e: toml::de::Error| e.to_string())?;
    table.insert("network".into(), toml::Value::try_from(networks).map_err(|e| e.to_string())?);
    let body = toml::to_string(&table).map_err(|e| e.to_string())?;
    std::fs::write(path, format!("# lobby-server config. Networks can also be changed from Lobby's connection setup.\n{body}"))
        .map_err(|e| e.to_string())
}

/// Compare without stopping at the first difference, so timing says nothing about the token.
fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("lobby-server: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let path = config_path();
    let config = load(&path)?;

    let token_file = config.token_file.as_deref().unwrap_or(DEFAULT_TOKEN_FILE);
    let token = config.token.clone().or_else(|| read_secret(token_file)).ok_or(format!("no token in {token_file}"))?;
    if token.len() < MIN_TOKEN_LEN {
        return Err(format!("token must be at least {MIN_TOKEN_LEN} characters"));
    }

    let addr: SocketAddr = config.listen.parse().map_err(|e| format!("listen = {:?}: {e}", config.listen))?;
    if !addr.ip().is_loopback() && !config.allow_insecure {
        return Err(format!(
            "{addr} is reachable from the network without TLS. Listen on 127.0.0.1 and put a TLS reverse proxy in front (see the README), or set allow_insecure = true"
        ));
    }

    let data = dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("lobby-server");
    std::fs::create_dir_all(&data).map_err(|e| format!("{}: {e}", data.display()))?;
    // Shell hosts are often shared: keep the history readable by this user only.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700));
    }
    let store = Store::open(&data.join("history.db")).map_err(|e| e.to_string())?;

    let names: Vec<String> = config.networks.iter().map(|n| n.name.clone()).collect();
    let uploads = Arc::new(config.upload);
    let hub = Hub::new(store, config.networks, config.nick);
    hub.start();

    let listener = TcpListener::bind(addr).await.map_err(|e| format!("{addr}: {e}"))?;
    eprintln!("lobby-server listening on {addr}, networks: {}", names.join(", "));

    let token = Arc::new(token);
    let path = Arc::new(path);
    loop {
        let (stream, peer) = listener.accept().await.map_err(|e| e.to_string())?;
        let hub = Arc::clone(&hub);
        let token = Arc::clone(&token);
        let path = Arc::clone(&path);
        let uploads = Arc::clone(&uploads);
        tokio::spawn(async move {
            if let Err(e) = serve(stream, hub, &token, &path, uploads).await {
                eprintln!("{peer}: {e}");
            }
        });
    }
}

fn reply(id: u64, result: Result<serde_json::Value, String>) -> ServerMsg {
    match result {
        Ok(data) => ServerMsg::Reply { id, data: Some(data), error: None },
        Err(error) => ServerMsg::Reply { id, data: None, error: Some(error) },
    }
}

fn to_json<T: serde::Serialize>(r: Result<T, String>) -> Result<serde_json::Value, String> {
    r.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

fn answer(hub: &Arc<Hub>, path: &Path, msg: ClientMsg) -> Option<ServerMsg> {
    Some(match msg {
        ClientMsg::Hello { .. } | ClientMsg::Upload { .. } => return None,
        ClientMsg::History { id, net, buffer, before } => reply(id, to_json(hub.history(&net, &buffer, before))),
        ClientMsg::Recent { id } => reply(id, to_json(hub.recent_buffers())),
        ClientMsg::Around { id, net, buffer, line } => reply(id, to_json(hub.around(&net, &buffer, line))),
        ClientMsg::CountUnread { id, net, buffer, after, before } => reply(id, to_json(hub.count_unread(&net, &buffer, after, before))),
        ClientMsg::Mentions { id, words, before } => reply(id, to_json(hub.mentions(&words, before))),
        ClientMsg::Links { id, net, buffer, before } => reply(id, to_json(hub.links(&net, &buffer, before))),
        ClientMsg::Send { id, net, buffer, text } => reply(id, to_json(hub.send(&net, &buffer, &text))),
        ClientMsg::SavePerson { id, person } => reply(id, to_json(hub.save_person(&person))),
        ClientMsg::DeletePerson { id, person } => reply(id, to_json(hub.delete_person(person))),
        ClientMsg::SetSetting { id, key, value } => reply(id, to_json(hub.set_setting(&key, &value))),
        ClientMsg::Networks { id } => reply(id, to_json(Ok(hub.network_views()))),
        ClientMsg::SaveNetwork { id, network } => {
            reply(id, to_json(hub.save_network(network).and_then(|_| save_networks(path, &hub.networks()))))
        }
        ClientMsg::DeleteNetwork { id, name } => {
            reply(id, to_json(hub.delete_network(&name).and_then(|_| save_networks(path, &hub.networks()))))
        }
    })
}

/// Put a file where the config says, off the connection's loop so events keep flowing meanwhile.
async fn store_upload(target: &Option<upload::Target>, name: String, mime: String, data: &str) -> Result<String, String> {
    use base64::Engine;
    let target = target.as_ref().ok_or("lobby-server has no place for files set up")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    upload::send(target, upload::File { name, mime, bytes }).await
}

async fn serve(stream: TcpStream, hub: Arc<Hub>, token: &str, path: &Path, uploads: Arc<Option<upload::Target>>) -> Result<(), String> {
    let limits = WebSocketConfig::default().max_frame_size(Some(MAX_FRAME)).max_message_size(Some(MAX_FRAME));
    let ws = tokio_tungstenite::accept_async_with_config(stream, Some(limits)).await.map_err(|e| e.to_string())?;
    let (mut sink, mut incoming) = ws.split();
    let send = |msg: ServerMsg| Message::text(serde_json::to_string(&msg).unwrap_or_default());

    let first = tokio::time::timeout(HELLO_TIMEOUT, incoming.next()).await.map_err(|_| "no hello")?;
    let hello = match first {
        Some(Ok(Message::Text(text))) => serde_json::from_str::<ClientMsg>(text.as_str()).ok(),
        _ => None,
    };
    let authorized = matches!(&hello, Some(ClientMsg::Hello { token: t }) if same_secret(t, token));
    if !authorized {
        let _ = sink.send(Message::Close(None)).await;
        return Err("wrong token".into());
    }

    // Subscribe before the snapshot, so nothing falls between them.
    let mut events = hub.subscribe();
    sink.send(send(ServerMsg::Welcome { snapshot: hub.snapshot() })).await.map_err(|e| e.to_string())?;
    let mut ping = tokio::time::interval(PING_EVERY);
    let (stored, mut stored_rx) = tokio::sync::mpsc::unbounded_channel::<ServerMsg>();

    loop {
        tokio::select! {
            event = events.recv() => match event {
                // A changed network list goes out as a fresh snapshot, which the app takes in whole.
                Ok(Event::Networks) => sink.send(send(ServerMsg::Welcome { snapshot: hub.snapshot() })).await.map_err(|e| e.to_string())?,
                Ok(event) => sink.send(send(ServerMsg::Event { event })).await.map_err(|e| e.to_string())?,
                Err(RecvError::Lagged(_)) => return Err("client fell behind, it will reconnect".into()),
                Err(RecvError::Closed) => return Ok(()),
            },
            frame = incoming.next() => match frame {
                None | Some(Ok(Message::Close(_))) => return Ok(()),
                Some(Err(e)) => return Err(e.to_string()),
                Some(Ok(Message::Text(text))) => {
                    let Ok(msg) = serde_json::from_str::<ClientMsg>(text.as_str()) else { continue };
                    if let ClientMsg::Upload { id, name, mime, data } = msg {
                        let (stored, uploads) = (stored.clone(), Arc::clone(&uploads));
                        tokio::spawn(async move {
                            let result = store_upload(&uploads, name, mime, &data).await;
                            let _ = stored.send(reply(id, to_json(result)));
                        });
                        continue;
                    }
                    if let Some(out) = answer(&hub, path, msg) {
                        sink.send(send(out)).await.map_err(|e| e.to_string())?;
                    }
                }
                Some(Ok(_)) => {}
            },
            Some(out) = stored_rx.recv() => sink.send(send(out)).await.map_err(|e| e.to_string())?,
            _ = ping.tick() => sink.send(Message::Ping(Default::default())).await.map_err(|e| e.to_string())?,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_secrets() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }

    #[test]
    fn config_defaults_to_localhost() {
        let config: Config =
            toml::from_str("nick = \"rolle\"\n[[network]]\nname = \"IRCnet\"\nhost = \"127.0.0.1\"\nport = 45000").unwrap();
        assert_eq!(config.listen, DEFAULT_LISTEN);
        assert_eq!(config.networks.len(), 1);
        assert!(!config.allow_insecure);
        assert!(config.upload.is_none());
    }

    #[test]
    fn reads_the_upload_target() {
        let config: Config = toml::from_str(
            "nick = \"rolle\"\n[upload]\nkind = \"folder\"\ndir = \"/var/www/files\"\npublic_url = \"https://files.example.org\"",
        )
        .unwrap();
        assert_eq!(
            config.upload,
            Some(upload::Target::Folder { dir: "/var/www/files".into(), public_url: "https://files.example.org".into() })
        );
    }
}
