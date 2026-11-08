//! Shared by the Lobby app and lobby-server: the IRC side, history and the events both pass on.

pub mod hub;
pub mod irc;
pub mod net;
pub mod protocol;
pub mod store;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// `~/` at the start of a path means the home directory.
pub fn expand(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

/// Read a secret from a file, trimmed.
pub fn read_secret(path: &str) -> Option<String> {
    let text = std::fs::read_to_string(expand(path)).ok()?;
    Some(text.trim().to_string()).filter(|s| !s.is_empty())
}

/// One IRC server or irssiproxy port.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Network {
    pub name: String,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_file: Option<String>,
}

impl Network {
    pub fn password(&self) -> Option<String> {
        self.password.clone().or_else(|| read_secret(self.password_file.as_deref()?))
    }
}
