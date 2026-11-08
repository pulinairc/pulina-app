//! `config.toml`: either a lobby-server to use, or networks to connect to directly.

use lobby_core::{Network, read_secret};
use serde::Deserialize;
use std::path::PathBuf;

const TEMPLATE: &str = r#"# Lobby config.
#
# With a lobby-server (keeps history while Lobby is closed), through SSH:
# [server]
# ssh = "you@shell.example.org"
# token_file = "~/.config/lobby/server.token"
#
# or at an address of its own, behind a TLS reverse proxy:
# url = "wss://lobby.example.org"
#
# Or straight to IRC or irssiproxy (history only while Lobby runs):
nick = "yournick"

[[network]]
name = "IRCnet"
host = "irc.example.org"
port = 6667
# password = "secret"
# password_file = "~/.config/lobby/ircnet.pass"
"#;

#[derive(Deserialize)]
pub struct Config {
    #[serde(default)]
    pub nick: String,
    #[serde(rename = "network", default)]
    pub networks: Vec<Network>,
    pub server: Option<ServerLink>,
}

const DEFAULT_SERVER_PORT: u16 = 7667;

#[derive(Deserialize, Clone)]
pub struct ServerLink {
    /// `ws://` or `wss://` address, when the server is reachable directly.
    pub url: Option<String>,
    /// SSH destination like `you@shell.example.org`: Lobby opens a tunnel itself.
    pub ssh: Option<String>,
    /// SSH port when it is not 22.
    pub ssh_port: Option<u16>,
    /// The server's port on that host, for the tunnel.
    pub port: Option<u16>,
    pub token: Option<String>,
    pub token_file: Option<String>,
}

impl ServerLink {
    pub fn remote_port(&self) -> u16 {
        self.port.unwrap_or(DEFAULT_SERVER_PORT)
    }

    pub fn token(&self) -> String {
        self.token.clone().or_else(|| read_secret(self.token_file.as_deref()?)).unwrap_or_default()
    }
}

pub fn dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("lobby")
}

/// Lobby's SSH key and the hosts it has learned.
pub fn ssh_dir() -> PathBuf {
    dir().join("ssh")
}

pub fn path() -> PathBuf {
    dir().join("config.toml")
}

/// Load the config, writing a template on first run.
pub fn load() -> Result<Config, String> {
    let path = path();
    if !path.exists() {
        let _ = std::fs::create_dir_all(dir());
        let _ = std::fs::write(&path, TEMPLATE);
        return Err(format!("Add your networks or server to {}", path.display()));
    }

    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let config: Config = toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    if config.server.is_none() && config.networks.is_empty() {
        return Err(format!("No server or networks in {}", path.display()));
    }
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_parses() {
        let config: Config = toml::from_str(TEMPLATE).unwrap();
        assert_eq!(config.networks.len(), 1);
        assert!(config.server.is_none());

        let config: Config = toml::from_str("[server]\nssh = \"me@host\"\ntoken = \"t\"").unwrap();
        let link = config.server.unwrap();
        assert_eq!(link.token(), "t");
        assert_eq!(link.remote_port(), DEFAULT_SERVER_PORT);
    }
}
