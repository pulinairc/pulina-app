//! Attachments over SFTP to your own server, signed in with the same keys as the SSH tunnel,
//! or a password.

use crate::tunnel::{self, Target};
use lobby_core::upload::{File, stored_name};
use russh_sftp::client::SftpSession;
use serde::Deserialize;
use std::path::Path;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Deserialize)]
pub struct Sftp {
    /// `user@host` or `user@host:port`.
    pub server: String,
    #[serde(default)]
    pub password: String,
    /// The folder the web server serves, like `/var/www/files`.
    pub dir: String,
    pub public_url: String,
}

pub async fn send(sftp: &Sftp, ssh_dir: &Path, file: File) -> Result<String, String> {
    let name = stored_name(&file.name, &file.mime)?;
    let target = Target::parse(&sftp.server, None)?;
    let session = tunnel::connect(&target, ssh_dir, Some(&sftp.password)).await?;
    let channel = session.channel_open_session().await.map_err(|e| e.to_string())?;
    channel.request_subsystem(true, "sftp").await.map_err(|e| e.to_string())?;
    let remote = SftpSession::new(channel.into_stream()).await.map_err(|e| format!("SFTP: {e}"))?;

    let (folder, _) = name.split_once('/').unwrap_or_default();
    let base = sftp.dir.trim_end_matches('/');
    remote.create_dir(format!("{base}/{folder}")).await.map_err(|e| format!("SFTP {base}: {e}"))?;
    let mut out = remote.create(format!("{base}/{name}")).await.map_err(|e| format!("SFTP: {e}"))?;
    out.write_all(&file.bytes).await.map_err(|e| format!("SFTP: {e}"))?;
    out.shutdown().await.map_err(|e| format!("SFTP: {e}"))?;
    let _ = remote.close().await;
    Ok(format!("{}/{name}", sftp.public_url.trim_end_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs an SSH server: `LOBBY_SFTP_TEST="user@host:port|/folder|/dir with id_ed25519"`.
    #[tokio::test]
    #[ignore]
    async fn sends_over_sftp() {
        let spec = std::env::var("LOBBY_SFTP_TEST").unwrap();
        let mut parts = spec.split('|');
        let (server, dir, keys) = (parts.next().unwrap(), parts.next().unwrap(), parts.next().unwrap());
        let sftp = Sftp { server: server.into(), password: String::new(), dir: dir.into(), public_url: "https://f.example.org".into() };
        let ssh = Path::new(keys);
        let url = send(&sftp, ssh, File { name: "hello.txt".into(), mime: "text/plain".into(), bytes: b"hi".to_vec() }).await.unwrap();
        let name = url.strip_prefix("https://f.example.org/").unwrap();
        assert_eq!(std::fs::read(Path::new(dir).join(name)).unwrap(), b"hi");
    }
}
