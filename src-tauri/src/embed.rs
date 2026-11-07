//! YouTube refuses to play without a Referer, and a page on Lobby's own `tauri://` origin
//! sends none. A one-page server on 127.0.0.1 gives the player an http origin to come from.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::OnceLock;

const PAGE: &str = r#"<!doctype html><meta charset="utf-8"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}</style><iframe allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe><script>const q=new URLSearchParams(location.search);const id=q.get("v")||"";q.delete("v");if(/^[\w-]{11}$/.test(id))document.querySelector("iframe").src="https://www.youtube-nocookie.com/embed/"+id+"?"+q;</script>"#;

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
