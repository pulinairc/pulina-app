//! YouTube refuses to play without a Referer, and a page on Lobby's own `tauri://` origin
//! sends none. A one-page server on 127.0.0.1 gives the player an http origin to come from.
//! The page tells Lobby when the video plays or fails, so YouTube's error screen is never shown.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::OnceLock;

const PAGE: &str = r#"<!doctype html><meta charset="utf-8"><style>html,body,#p{margin:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}</style><div id="p"></div><script>
const q = new URLSearchParams(location.search);
const id = q.get("v") || "";
q.delete("v");
const vars = Object.fromEntries([...q].map(([k, v]) => [k, k !== "playlist" && /^\d+$/.test(v) ? Number(v) : v]));
const tell = (state) => parent.postMessage({ lobbyPlayer: state }, "*");
function onYouTubeIframeAPIReady() {
  if (!/^[\w-]{11}$/.test(id)) return tell("error");
  new YT.Player("p", {
    videoId: id, width: "100%", height: "100%", host: "https://www.youtube-nocookie.com", playerVars: vars,
    events: { onStateChange: (e) => e.data === 1 && tell("playing"), onError: () => tell("error") },
  });
}
</script><script src="https://www.youtube.com/iframe_api"></script>"#;

static BASE: OnceLock<String> = OnceLock::new();

/// The address of the player page, starting the server on first use.
pub fn base() -> String {
    BASE.get_or_init(|| {
        let Ok(listener) = TcpListener::bind("127.0.0.1:0") else { return String::new() };
        let Ok(addr) = listener.local_addr() else { return String::new() };
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    PAGE.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(PAGE.as_bytes());
            }
        });
        format!("http://{addr}/")
    })
    .clone()
}
