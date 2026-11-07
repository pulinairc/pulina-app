#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod preview;
mod remote;
mod tunnel;

use lobby_core::hub::{Event, Hub, Snapshot};
use lobby_core::protocol::ClientMsg;
use lobby_core::store::{BufferRef, Line, Person, Store};
use lobby_core::now_ms;
use remote::Remote;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::broadcast::error::RecvError;

/// Where chat comes from: our own IRC connections, or a lobby-server.
enum Source {
    Local(Arc<Hub>),
    Remote(Arc<Remote>),
    Unconfigured,
}

struct AppState {
    source: Source,
    /// Local file for link previews, and for history in local mode.
    store: Store,
    error: Option<String>,
}

#[derive(Serialize)]
struct Status {
    #[serde(flatten)]
    snapshot: Snapshot,
    error: Option<String>,
    config_path: String,
}

/// Hand an event to the window under the name the frontend listens for.
pub fn emit_event(app: &AppHandle, event: Event) {
    let _ = match event {
        Event::Line(line) => app.emit("line", line),
        Event::Buffer(info) => app.emit("buffer", info),
        Event::Me { net, nick } => app.emit("me", serde_json::json!({ "net": net, "nick": nick })),
        Event::Conn { net, state } => app.emit("conn", serde_json::json!({ "net": net, "state": state })),
        Event::People { people } => app.emit("people", people),
        Event::Setting { key, value } => app.emit("setting", serde_json::json!({ "key": key, "value": value })),
    };
}

fn from_value<T: serde::de::DeserializeOwned>(v: serde_json::Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| e.to_string())
}

#[tauri::command]
fn status(state: State<AppState>) -> Status {
    let snapshot = match &state.source {
        Source::Local(hub) => hub.snapshot(),
        Source::Remote(remote) => remote.snapshot(),
        Source::Unconfigured => Snapshot::default(),
    };
    Status { snapshot, error: state.error.clone(), config_path: config::path().display().to_string() }
}

#[tauri::command]
async fn recent_buffers(state: State<'_, AppState>) -> Result<Vec<BufferRef>, String> {
    match &state.source {
        Source::Local(hub) => hub.recent_buffers(),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::Recent { id }).await?),
        Source::Unconfigured => Ok(vec![]),
    }
}

#[tauri::command]
async fn history(state: State<'_, AppState>, net: String, buffer: String, before: Option<i64>) -> Result<Vec<Line>, String> {
    match &state.source {
        Source::Local(hub) => hub.history(&net, &buffer, before),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::History { id, net, buffer, before }).await?),
        Source::Unconfigured => Ok(vec![]),
    }
}

#[tauri::command]
async fn send(state: State<'_, AppState>, net: String, buffer: String, text: String) -> Result<(), String> {
    match &state.source {
        Source::Local(hub) => hub.send(&net, &buffer, &text),
        Source::Remote(remote) => remote.request(|id| ClientMsg::Send { id, net, buffer, text }).await.map(|_| ()),
        Source::Unconfigured => Err("Nothing configured".into()),
    }
}

#[tauri::command]
async fn save_person(state: State<'_, AppState>, person: Person) -> Result<i64, String> {
    match &state.source {
        Source::Local(hub) => hub.save_person(&person),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::SavePerson { id, person }).await?),
        Source::Unconfigured => Err("Nothing configured".into()),
    }
}

#[tauri::command]
async fn delete_person(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    match &state.source {
        Source::Local(hub) => hub.delete_person(id),
        Source::Remote(remote) => remote.request(|req| ClientMsg::DeletePerson { id: req, person: id }).await.map(|_| ()),
        Source::Unconfigured => Err("Nothing configured".into()),
    }
}

#[tauri::command]
async fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    match &state.source {
        Source::Local(hub) => hub.set_setting(&key, &value),
        Source::Remote(remote) => remote.request(|id| ClientMsg::SetSetting { id, key, value }).await.map(|_| ()),
        Source::Unconfigured => Err("Nothing configured".into()),
    }
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

/// Pass hub events to the window. A lagging window reloads instead of missing lines.
fn forward(app: AppHandle, hub: Arc<Hub>) {
    let mut rx = hub.subscribe();
    hub.start();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => emit_event(&app, event),
                Err(RecvError::Lagged(_)) => {
                    let _ = app.emit("resync", ());
                }
                Err(RecvError::Closed) => break,
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;

            let (source, error) = match config::load() {
                Ok(c) => match c.server {
                    Some(link) => (Source::Remote(Remote::new(link)), None),
                    None => (Source::Local(Hub::new(Store::open(&data.join("history.db"))?, c.networks, c.nick)), None),
                },
                Err(e) => (Source::Unconfigured, Some(e)),
            };

            let handle = app.handle().clone();
            match &source {
                Source::Local(hub) => {
                    let hub = Arc::clone(hub);
                    tauri::async_runtime::spawn(async move { forward(handle, hub) });
                }
                Source::Remote(remote) => remote.start(handle),
                Source::Unconfigured => {}
            }

            let store = Store::open(&data.join("previews.db"))?;
            app.manage(AppState { source, store, error });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![status, recent_buffers, history, send, preview, save_person, delete_person, set_setting])
        .run(tauri::generate_context!())
        .expect("failed to start Lobby");
}
