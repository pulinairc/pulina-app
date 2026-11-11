//! `config.toml`: either a lobby-server to use, or networks to connect to directly.

use lobby_core::{Network, read_secret};
use serde::{Deserialize, Serialize};
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

#[derive(Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub nick: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<ServerLink>,
    #[serde(rename = "network", default, skip_serializing_if = "Vec::is_empty")]
    pub networks: Vec<Network>,
}

pub const DEFAULT_SERVER_PORT: u16 = 7667;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct ServerLink {
    /// `ws://` or `wss://` address, when the server is reachable directly.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// SSH destination like `you@shell.example.org`: Lobby opens a tunnel itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh: Option<String>,
    /// SSH port when it is not 22.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<u16>,
    /// The server's port on that host, for the tunnel.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
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

/// Android has no home or config folder of its own, so the app hands over its private one at start.
#[cfg(target_os = "android")]
static APP_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
pub fn use_app_dir(dir: PathBuf) {
    let _ = APP_DIR.set(dir);
}

/// The app's name in lower case, so a fork such as the Pulina app keeps its own folder.
static NAME: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn use_name(name: &str) {
    let _ = NAME.set(name.to_lowercase());
}

pub fn dir() -> PathBuf {
    #[cfg(target_os = "android")]
    if let Some(dir) = APP_DIR.get() {
        return dir.clone();
    }
    let name = NAME.get().map_or("lobby", String::as_str);
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join(name)
}

/// Lobby's SSH key and the hosts it has learned.
pub fn ssh_dir() -> PathBuf {
    dir().join("ssh")
}

pub fn path() -> PathBuf {
    dir().join("config.toml")
}

/// The config as it is, or an empty one, for the setup screen.
pub fn read() -> Config {
    // The first-run template's example network is not a setup to show.
    std::fs::read_to_string(path()).ok().filter(|t| t != TEMPLATE).and_then(|t| toml::from_str(&t).ok()).unwrap_or_default()
}

/// Write the config from the setup screen. It may hold a token or password, so only the user can read it.
pub fn save(config: &Config) -> Result<(), String> {
    let text = toml::to_string(config).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let path = path();
    std::fs::write(&path, format!("# Lobby config, also editable in Settings.\n{text}")).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
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
    parse(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// The untouched first-run template is nothing set up, so the welcome shows again.
fn parse(text: &str) -> Result<Config, String> {
    if text == TEMPLATE {
        return Err("Nothing set up yet".into());
    }
    let config: Config = toml::from_str(text).map_err(|e| e.to_string())?;
    if config.server.is_none() && config.networks.is_empty() {
        return Err("No server or networks".into());
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

    #[test]
    fn untouched_template_is_not_a_setup() {
        assert!(parse(TEMPLATE).is_err());
        assert!(parse("nick = \"me\"\n[[network]]\nname = \"N\"\nhost = \"irc.example.net\"\nport = 6667").is_ok());
    }
}
