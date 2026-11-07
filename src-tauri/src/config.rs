//! `config.toml`: either a lobby-server to use, or networks to connect to directly.

use lobby_core::{Network, read_secret};
use serde::Deserialize;
use std::path::PathBuf;

const TEMPLATE: &str = r#"# Lobby config.
#
# With a lobby-server (keeps history while Lobby is closed):
# [server]
# url = "wss://lobby.example.org"
# token_file = "~/.config/lobby/server.token"
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

#[derive(Deserialize, Clone)]
pub struct ServerLink {
    pub url: String,
    pub token: Option<String>,
    pub token_file: Option<String>,
}

impl ServerLink {
    pub fn token(&self) -> String {
        self.token.clone().or_else(|| read_secret(self.token_file.as_deref()?)).unwrap_or_default()
    }
}

pub fn dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("lobby")
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

        let config: Config = toml::from_str("[server]\nurl = \"ws://127.0.0.1:7667\"\ntoken = \"t\"").unwrap();
        assert_eq!(config.server.unwrap().token(), "t");
    }
}
