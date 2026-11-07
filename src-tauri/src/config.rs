//! `config.toml`: your nick and the networks (irssiproxy ports) to connect to.

use serde::Deserialize;
use std::path::PathBuf;

const TEMPLATE: &str = r#"# Lobby config. One [[network]] per irssiproxy port or IRC server.
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
    pub nick: String,
    #[serde(rename = "network", default)]
    pub networks: Vec<Network>,
}

#[derive(Deserialize, Clone)]
pub struct Network {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub password_file: Option<String>,
}

impl Network {
    pub fn password(&self) -> Option<String> {
        if let Some(p) = &self.password {
            return Some(p.clone());
        }
        let file = expand(self.password_file.as_deref()?);
        let text = std::fs::read_to_string(file).ok()?;
        Some(text.trim().to_string())
    }
}

fn expand(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
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
        return Err(format!("Add your networks to {}", path.display()));
    }

    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let config: Config = toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    if config.networks.is_empty() {
        return Err(format!("No networks in {}", path.display()));
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
        assert_eq!(config.networks[0].port, 6667);
    }
}
