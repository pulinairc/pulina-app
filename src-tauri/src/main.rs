#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod irc;
mod net;
mod preview;
mod store;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use store::{BufferRef, Line, Store};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc::UnboundedSender;

const HISTORY_PAGE: i64 = 300;
const RECENT_BUFFER_DAYS: i64 = 30;
const DAY_MS: i64 = 86_400_000;

pub struct AppState {
    pub store: Store,
    pub writers: Mutex<HashMap<String, UnboundedSender<String>>>,
    pub me: Mutex<HashMap<String, String>>,
    pub conn: Mutex<HashMap<String, String>>,
    /// Joined channels by (network, lowercase name), for a window that loads after the joins.
    pub channels: Mutex<HashMap<(String, String), net::BufferInfo>>,
    networks: Vec<String>,
    error: Option<String>,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Save a line to history and hand it to the window.
pub fn deliver(app: &AppHandle, mut line: Line) {
    match app.state::<AppState>().store.insert(&line) {
        Ok(id) => line.id = id,
        Err(e) => eprintln!("history write failed: {e}"),
    }
    let _ = app.emit("line", &line);
}

#[derive(Serialize)]
struct NetStatus {
    name: String,
    state: String,
    nick: String,
}

#[derive(Serialize)]
struct Status {
    networks: Vec<NetStatus>,
    channels: Vec<net::BufferInfo>,
    error: Option<String>,
}

#[tauri::command]
fn status(state: State<AppState>) -> Status {
    let conn = state.conn.lock().unwrap();
    let me = state.me.lock().unwrap();
    let networks = state
        .networks
        .iter()
        .map(|n| NetStatus {
            name: n.clone(),
            state: conn.get(n).cloned().unwrap_or_default(),
            nick: me.get(n).cloned().unwrap_or_default(),
        })
        .collect();
    let channels = state.channels.lock().unwrap().values().cloned().collect();
    Status { networks, channels, error: state.error.clone() }
}

#[tauri::command]
fn recent_buffers(state: State<AppState>) -> Result<Vec<BufferRef>, String> {
    let since = now_ms() - RECENT_BUFFER_DAYS * DAY_MS;
    state.store.recent_buffers(since).map_err(|e| e.to_string())
}

#[tauri::command]
fn history(state: State<AppState>, net: String, buffer: String, before: Option<i64>) -> Result<Vec<Line>, String> {
    state.store.history(&net, &buffer, before.unwrap_or(i64::MAX), HISTORY_PAGE).map_err(|e| e.to_string())
}

#[tauri::command]
fn send(app: AppHandle, state: State<AppState>, net: String, buffer: String, text: String) -> Result<(), String> {
    let tx = state.writers.lock().unwrap().get(&net).cloned().ok_or("Not connected")?;
    let me = state.me.lock().unwrap().get(&net).cloned().unwrap_or_default();

    for (raw, echo) in irc::outgoing(&buffer, &text)? {
        tx.send(raw).map_err(|_| "Not connected")?;
        let Some(echo) = echo else { continue };
        let line = Line {
            net: net.clone(),
            buffer: echo.buffer,
            ts: now_ms(),
            kind: echo.kind.into(),
            nick: me.clone(),
            text: echo.text,
            own: true,
            ..Default::default()
        };
        deliver(&app, line);
    }
    Ok(())
}

#[tauri::command]
async fn preview(state: State<'_, AppState>, url: String) -> Result<Option<preview::Preview>, ()> {
    if let Some(json) = state.store.preview_get(&url) {
        return Ok(serde_json::from_str(&json).ok());
    }
    let result = preview::fetch(&url).await;
    let json = serde_json::to_string(&result).unwrap_or_else(|_| "null".into());
    state.store.preview_put(&url, &json, now_ms());
    Ok(result)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let store = Store::open(&data.join("history.db"))?;

            let (networks, error, nick) = match config::load() {
                Ok(c) => (c.networks, None, c.nick),
                Err(e) => (vec![], Some(e), String::new()),
            };

            app.manage(AppState {
                store,
                writers: Mutex::default(),
                me: Mutex::default(),
                conn: Mutex::default(),
                channels: Mutex::default(),
                networks: networks.iter().map(|n| n.name.clone()).collect(),
                error,
            });

            for network in networks {
                net::spawn(app.handle().clone(), network, nick.clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![status, recent_buffers, history, send, preview])
        .run(tauri::generate_context!())
        .expect("failed to start Lobby");
}
