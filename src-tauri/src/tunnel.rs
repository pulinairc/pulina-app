//! Reach lobby-server through SSH, so nothing on the server needs opening up.
//! The SSH client is built in, so it works where there is no `ssh` program, like the iPhone.

use russh::client::{self, Handle};
use russh::keys::ssh_key::LineEnding;
use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::{self, HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

const KEEPALIVE: Duration = Duration::from_secs(30);
const KEEPALIVE_MISSES: usize = 3;
const DEFAULT_SSH_PORT: u16 = 22;
/// Keys in `~/.ssh` that are tried after Lobby's own, as the `ssh` program would.
const HOME_KEYS: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];

/// `user@host` or `user@host:port`.
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    pub user: String,
    pub host: String,
    pub port: u16,
}

impl Target {
    pub fn parse(text: &str, port: Option<u16>) -> Result<Self, String> {
        let (user, rest) = text.split_once('@').ok_or("SSH needs user@host")?;
        let (host, from_text) = match rest.rsplit_once(':') {
            Some((h, p)) => (h, p.parse().ok()),
            None => (rest, None),
        };
        if user.is_empty() || host.is_empty() {
            return Err("SSH needs user@host".into());
        }
        Ok(Self { user: user.into(), host: host.into(), port: port.or(from_text).unwrap_or(DEFAULT_SSH_PORT) })
    }
}

/// Lobby's own key, made on first use. Its public half goes into `authorized_keys` on the server.
pub fn own_key(dir: &Path) -> Result<PrivateKey, String> {
    let path = dir.join("id_ed25519");
    if let Ok(text) = std::fs::read_to_string(&path) {
        return keys::decode_secret_key(&text, None).map_err(|e| e.to_string());
    }
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).map_err(|e| e.to_string())?;
    let mut key = PrivateKey::from(Ed25519Keypair::from_seed(&seed));
    key.set_comment("lobby");
    let text = key.to_openssh(LineEnding::LF).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    write_private(&path, text.as_bytes())?;
    Ok(key)
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .and_then(|mut f| f.write_all(bytes))
        .map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// The line to add to `~/.ssh/authorized_keys` on the server: it can only reach lobby-server.
pub fn authorized_line(dir: &Path, remote_port: u16) -> Result<String, String> {
    let key = own_key(dir)?;
    let public = key.public_key().to_openssh().map_err(|e| e.to_string())?;
    Ok(format!(r#"restrict,port-forwarding,permitopen="127.0.0.1:{remote_port}" {public}"#))
}

fn home_keys() -> Vec<PrivateKey> {
    let Some(ssh) = dirs::home_dir().map(|h| h.join(".ssh")) else { return vec![] };
    HOME_KEYS
        .iter()
        .filter_map(|name| std::fs::read_to_string(ssh.join(name)).ok())
        .filter_map(|text| keys::decode_secret_key(&text, None).ok())
        .collect()
}

struct Client {
    host: String,
    port: u16,
    known_hosts: PathBuf,
}

impl client::Handler for Client {
    type Error = russh::Error;

    /// The usual `~/.ssh/known_hosts` first, then Lobby's own list, which learns a host on first sight.
    async fn check_server_key(&mut self, server: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let PublicKeyOrCertificate::PublicKey { key, .. } = server else { return Ok(false) };
        if let Some(home) = dirs::home_dir() {
            match keys::check_known_hosts_path(&self.host, self.port, key, home.join(".ssh/known_hosts")) {
                Ok(true) => return Ok(true),
                Err(keys::Error::KeyChanged { .. }) => return Ok(false),
                _ => {}
            }
        }
        match keys::check_known_hosts_path(&self.host, self.port, key, &self.known_hosts) {
            Ok(true) => Ok(true),
            Ok(false) => Ok(keys::known_hosts::learn_known_hosts_path(&self.host, self.port, key, &self.known_hosts).is_ok()),
            Err(_) => Ok(false),
        }
    }
}

/// An SSH connection forwarding a local port to lobby-server. Dropping it closes both.
pub struct Tunnel {
    _session: Arc<Handle<Client>>,
    forward: JoinHandle<()>,
    pub port: u16,
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.forward.abort();
    }
}

impl Tunnel {
    pub async fn open(target: &Target, remote_port: u16, dir: &Path) -> Result<Self, String> {
        let config = Arc::new(client::Config {
            keepalive_interval: Some(KEEPALIVE),
            keepalive_max: KEEPALIVE_MISSES,
            nodelay: true,
            ..Default::default()
        });
        let handler = Client { host: target.host.clone(), port: target.port, known_hosts: dir.join("known_hosts") };
        let mut session = client::connect(config, (target.host.as_str(), target.port), handler).await.map_err(|e| match e {
            russh::Error::UnknownKey => format!("{}: the server's host key changed or is not trusted", target.host),
            e => format!("ssh {}: {e}", target.host),
        })?;

        if !authenticate(&mut session, target, dir).await? {
            return Err(format!("ssh {}@{}: no key was accepted. Add Lobby's key on the server, see Settings.", target.user, target.host));
        }

        let session = Arc::new(session);
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let handle = Arc::clone(&session);
        let forward = tokio::spawn(async move {
            while let Ok((mut socket, from)) = listener.accept().await {
                let handle = Arc::clone(&handle);
                tokio::spawn(async move {
                    let Ok(channel) =
                        handle.channel_open_direct_tcpip("127.0.0.1", remote_port.into(), from.ip().to_string(), from.port().into()).await
                    else {
                        return;
                    };
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
                });
            }
        });
        Ok(Self { _session: session, forward, port })
    }
}

async fn authenticate(session: &mut Handle<Client>, target: &Target, dir: &Path) -> Result<bool, String> {
    let rsa_hash: Option<HashAlg> = session.best_supported_rsa_hash().await.ok().flatten().flatten();

    #[cfg(all(unix, not(target_os = "ios")))]
    if let Ok(mut agent) = keys::agent::client::AgentClient::connect_env().await {
        for identity in agent.request_identities().await.unwrap_or_default() {
            let key = identity.public_key().into_owned();
            if let Ok(result) = session.authenticate_publickey_with(target.user.clone(), key, rsa_hash, &mut agent).await
                && result.success()
            {
                return Ok(true);
            }
        }
    }

    let mut keys = vec![own_key(dir)?];
    keys.extend(home_keys());
    for key in keys {
        let key = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
        let result = session.authenticate_publickey(target.user.clone(), key).await.map_err(|e| e.to_string())?;
        if result.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_targets() {
        assert_eq!(Target::parse("me@example.org", None).unwrap(), Target { user: "me".into(), host: "example.org".into(), port: 22 });
        assert_eq!(Target::parse("me@example.org:2222", None).unwrap().port, 2222);
        assert_eq!(Target::parse("me@example.org", Some(23)).unwrap().port, 23);
        assert!(Target::parse("example.org", None).is_err());
    }

    #[test]
    fn makes_and_keeps_its_own_key() {
        let dir = std::env::temp_dir().join(format!("lobby-key-test-{}", std::process::id()));
        let line = authorized_line(&dir, 7667).unwrap();
        assert!(line.starts_with(r#"restrict,port-forwarding,permitopen="127.0.0.1:7667" ssh-ed25519 "#));
        assert_eq!(authorized_line(&dir, 7667).unwrap(), line);
        let _ = std::fs::remove_file(dir.join("id_ed25519"));
        let _ = std::fs::remove_dir(&dir);
    }
}
