//! Reach lobby-server through SSH, so nothing on the server needs opening up.
//! Runs the system `ssh` with your usual keys and config.

use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};

const READY_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_EVERY: Duration = Duration::from_millis(200);
/// Runs ssh and kills it once our end of stdin closes, so ssh never outlives Lobby,
/// even when Lobby is killed. Exits when ssh exits.
const WATCHDOG: &str = r#"exec 3<&0; ssh "$@" </dev/null & c=$!; (read -r _ <&3; kill $c 2>/dev/null) & wait $c"#;

/// A running `ssh -L`. Dropping it closes the watchdog's stdin, which ends ssh.
pub struct Tunnel {
    _child: Child,
    pub port: u16,
}

async fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

impl Tunnel {
    pub async fn open(host: &str, remote_port: u16) -> Result<Self, String> {
        let port = free_port().await?;
        let mut child = Command::new("sh")
            .args(["-c", WATCHDOG, "sh"])
            .args(["-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"])
            .arg("-L")
            .arg(format!("127.0.0.1:{port}:127.0.0.1:{remote_port}"))
            .arg(host)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("ssh: {e}"))?;

        let started = Instant::now();
        while started.elapsed() < READY_TIMEOUT {
            if let Ok(Some(_)) = child.try_wait() {
                let mut err = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    let _ = stderr.read_to_string(&mut err).await;
                }
                return Err(format!("ssh {host}: {}", err.trim()));
            }
            if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
                return Ok(Self { _child: child, port });
            }
            tokio::time::sleep(POLL_EVERY).await;
        }
        Err(format!("ssh {host}: tunnel did not come up"))
    }
}
