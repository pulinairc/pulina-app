#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod embed;
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
        Event::Whois(whois) => app.emit("whois", whois),
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

const UPLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Send a file to the file host set in Settings and return its address. The file comes as
/// raw bytes; the host address, the file name (URI-encoded) and its type come as the
/// `x-host`, `x-name` and `x-type` headers.
#[tauri::command]
async fn upload(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the file's bytes".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let url = header("x-host");
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Set a file host address in Settings first".into());
    }
    let name = header("x-name");
    let mime = header("x-type");

    let res = reqwest::Client::builder()
        .timeout(UPLOAD_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, if mime.is_empty() { "application/octet-stream" } else { &mime })
        .header(reqwest::header::CONTENT_DISPOSITION, format!("attachment; filename*=UTF-8''{name}"))
        .body(bytes.clone())
        .send()
        .await
        .map_err(|e| format!("Upload failed: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            413 => "The file is too big for the file host".into(),
            415 => "The file host does not take this type of file".into(),
            code => format!("The file host answered {code}"),
        });
    }
    res.headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(String::from)
        .ok_or("The file host did not say where the file went".into())
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

/// Desktop notifications take an icon as a file, so a person's photo is written to the cache once.
#[tauri::command]
fn notify_icon(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the photo's bytes".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let key = header("x-key");
    let ext = header("x-ext");
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_hexdigit()) || !matches!(ext.as_str(), "png" | "jpg" | "webp") {
        return Err("Bad photo".into());
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("avatars");
    let path = dir.join(format!("{key}.{ext}"));
    if !path.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Swap the app icon for one of the icons in `ui/icons`: the Dock icon on macOS, the window icon elsewhere.
#[tauri::command]
fn set_app_icon(app: AppHandle, window: tauri::WebviewWindow, name: String) -> Result<(), String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
        return Err("Unknown icon".into());
    }
    #[cfg(target_os = "macos")]
    {
        // macOS draws the artwork inside a margin with a shadow; these versions carry it.
        let _ = &window;
        let asset = app.asset_resolver().get(format!("icons/mac/{name}.png")).ok_or("Unknown icon")?;
        let png = asset.bytes.clone();
        app.run_on_main_thread(move || dock_icon(&png)).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let asset = app.asset_resolver().get(format!("icons/{name}.png")).ok_or("Unknown icon")?;
        let image = tauri::image::Image::from_bytes(&asset.bytes).map_err(|e| e.to_string())?;
        window.set_icon(image).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn dock_icon(png: &[u8]) {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;
    let Some(mtm) = MainThreadMarker::new() else { return };
    let data = NSData::with_bytes(png);
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else { return };
    unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image)) };
}

#[tauri::command]
fn player() -> String {
    embed::base()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
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
        .invoke_handler(tauri::generate_handler![status, recent_buffers, history, send, preview, save_person, delete_person, set_setting, upload, player, notify_icon, set_app_icon])
        .run(tauri::generate_context!())
        .expect("failed to start Lobby");
}
