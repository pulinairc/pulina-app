mod config;
mod embed;
#[cfg(target_os = "ios")]
mod ios_volume;
mod lastfm;
#[cfg(target_os = "macos")]
mod macos;
mod preview;
mod remote;
mod sftp;
mod tunnel;
mod update;

use lobby_core::hub::{Event, Hub, Snapshot};
use lobby_core::now_ms;
use lobby_core::protocol::ClientMsg;
use lobby_core::store::{BufferRef, Line, Person, Store};
use remote::Remote;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::broadcast::error::RecvError;

/// Where chat comes from: our own IRC connections, or a lobby-server.
#[derive(Clone)]
enum Source {
    Local(Arc<Hub>),
    Remote(Arc<Remote>),
    Unconfigured,
}

struct AppState {
    source: std::sync::Mutex<Source>,
    error: std::sync::Mutex<Option<String>>,
    /// Local file for link previews.
    store: Store,
    data: std::path::PathBuf,
    /// Sent as QUIT when the app closes; the window keeps it current.
    quit: std::sync::Mutex<String>,
}

impl AppState {
    fn source(&self) -> Source {
        self.source.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// Connect as the config says. Returns what to talk to, or why nothing is set up.
fn start_source(app: &AppHandle, data: &std::path::Path) -> (Source, Option<String>) {
    let (source, error) = match config::load() {
        Ok(c) => match c.server {
            Some(link) => (Source::Remote(Remote::new(link)), None),
            None => match Store::open(&data.join("history.db")) {
                Ok(store) => (Source::Local(Hub::new(store, c.networks, c.nick)), None),
                Err(e) => (Source::Unconfigured, Some(e.to_string())),
            },
        },
        Err(e) => (Source::Unconfigured, Some(e)),
    };
    match &source {
        Source::Local(hub) => {
            let hub = Arc::clone(hub);
            let handle = app.clone();
            tauri::async_runtime::spawn(async move { forward(handle, hub) });
        }
        Source::Remote(remote) => remote.start(app.clone()),
        Source::Unconfigured => {}
    }
    (source, error)
}

#[derive(Serialize)]
struct Status {
    #[serde(flatten)]
    snapshot: Snapshot,
    error: Option<String>,
    config_path: String,
    /// "linux", "macos", "ios"…, for what differs per system.
    platform: &'static str,
}

/// Hand an event to the window under the name the frontend listens for.
pub fn emit_event(app: &AppHandle, event: Event) {
    let _ = match event {
        Event::Line(line) => app.emit("line", line),
        Event::Buffer(info) => app.emit("buffer", info),
        Event::Me { net, nick, mask } => app.emit("me", serde_json::json!({ "net": net, "nick": nick, "mask": mask })),
        Event::Conn { net, state } => app.emit("conn", serde_json::json!({ "net": net, "state": state })),
        Event::People { people } => app.emit("people", people),
        Event::Setting { key, value } => app.emit("setting", serde_json::json!({ "key": key, "value": value })),
        Event::Whois(whois) => app.emit("whois", whois),
        Event::Networks => app.emit("resync", ()),
    };
}

fn from_value<T: serde::de::DeserializeOwned>(v: serde_json::Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| e.to_string())
}

#[tauri::command]
fn status(state: State<AppState>) -> Status {
    let snapshot = match state.source() {
        Source::Local(hub) => hub.snapshot(),
        Source::Remote(remote) => remote.snapshot(),
        Source::Unconfigured => Snapshot::default(),
    };
    Status {
        snapshot,
        error: state.error.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        config_path: config::path().display().to_string(),
        platform: std::env::consts::OS,
    }
}

#[tauri::command]
async fn recent_buffers(state: State<'_, AppState>) -> Result<Vec<BufferRef>, String> {
    match state.source() {
        Source::Local(hub) => hub.recent_buffers(),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::Recent { id }).await?),
        Source::Unconfigured => Ok(vec![]),
    }
}

#[tauri::command]
async fn history(state: State<'_, AppState>, net: String, buffer: String, before: Option<i64>) -> Result<Vec<Line>, String> {
    match state.source() {
        Source::Local(hub) => hub.history(&net, &buffer, before),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::History { id, net, buffer, before }).await?),
        Source::Unconfigured => Ok(vec![]),
    }
}

#[tauri::command]
async fn around(state: State<'_, AppState>, net: String, buffer: String, line: i64) -> Result<Vec<Line>, String> {
    match state.source() {
        Source::Local(hub) => hub.around(&net, &buffer, line),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::Around { id, net, buffer, line }).await?),
        Source::Unconfigured => Ok(vec![]),
    }
}

#[tauri::command]
async fn talkers(
    state: State<'_, AppState>,
    net: String,
    buffer: String,
    since: i64,
    until: i64,
) -> Result<Vec<lobby_core::store::Talker>, String> {
    match state.source() {
        Source::Local(hub) => hub.talkers(&net, &buffer, since, until),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::Talkers { id, net, buffer, since, until }).await?),
        Source::Unconfigured => Ok(vec![]),
    }
}

#[tauri::command]
async fn count_unread(state: State<'_, AppState>, net: String, buffer: String, after: i64, before: i64) -> Result<i64, String> {
    match state.source() {
        Source::Local(hub) => hub.count_unread(&net, &buffer, after, before),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::CountUnread { id, net, buffer, after, before }).await?),
        Source::Unconfigured => Ok(0),
    }
}

#[tauri::command]
async fn mentions(state: State<'_, AppState>, words: Vec<String>, before: Option<i64>) -> Result<Vec<Line>, String> {
    match state.source() {
        Source::Local(hub) => hub.mentions(&words, before),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::Mentions { id, words, before }).await?),
        Source::Unconfigured => Ok(vec![]),
    }
}

#[tauri::command]
async fn links(state: State<'_, AppState>, net: String, buffer: String, before: Option<i64>) -> Result<Vec<Line>, String> {
    match state.source() {
        Source::Local(hub) => hub.links(&net, &buffer, before),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::Links { id, net, buffer, before }).await?),
        Source::Unconfigured => Ok(vec![]),
    }
}

#[tauri::command]
async fn send(state: State<'_, AppState>, net: String, buffer: String, text: String) -> Result<(), String> {
    match state.source() {
        Source::Local(hub) => hub.send(&net, &buffer, &text),
        Source::Remote(remote) => remote.request(|id| ClientMsg::Send { id, net, buffer, text }).await.map(|_| ()),
        Source::Unconfigured => Err("Nothing configured".into()),
    }
}

#[tauri::command]
async fn save_person(state: State<'_, AppState>, person: Person) -> Result<i64, String> {
    match state.source() {
        Source::Local(hub) => hub.save_person(&person),
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::SavePerson { id, person }).await?),
        Source::Unconfigured => Err("Nothing configured".into()),
    }
}

#[tauri::command]
async fn delete_person(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    match state.source() {
        Source::Local(hub) => hub.delete_person(id),
        Source::Remote(remote) => remote.request(|req| ClientMsg::DeletePerson { id: req, person: id }).await.map(|_| ()),
        Source::Unconfigured => Err("Nothing configured".into()),
    }
}

#[tauri::command]
async fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    match state.source() {
        Source::Local(hub) => hub.set_setting(&key, &value),
        Source::Remote(remote) => remote.request(|id| ClientMsg::SetSetting { id, key, value }).await.map(|_| ()),
        Source::Unconfigured => Err("Nothing configured".into()),
    }
}

/// lobby-server gets longer than other requests, as it passes the file on before answering.
const SERVER_UPLOAD_WAIT: std::time::Duration = std::time::Duration::from_secs(150);

/// Send a file where `x-target` says (JSON with a `kind`) and return its address. The file comes
/// as raw bytes; its name (URI-encoded) and type come as the `x-name` and `x-type` headers.
#[tauri::command]
async fn upload(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    use base64::Engine;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the file's bytes".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let name = header("x-name");
    let name = percent_decode(&name);
    let mime = header("x-type");
    let target: serde_json::Value = serde_json::from_str(&header("x-target")).map_err(|e| e.to_string())?;
    let file = lobby_core::upload::File { name, mime, bytes: bytes.clone() };

    match target["kind"].as_str() {
        Some("server") => {
            let Source::Remote(remote) = state.source() else {
                return Err("Not connected to a lobby-server".into());
            };
            let data = base64::engine::general_purpose::STANDARD.encode(&file.bytes);
            let (name, mime) = (file.name, file.mime);
            from_value(remote.request_within(SERVER_UPLOAD_WAIT, |id| ClientMsg::Upload { id, name, mime, data }).await?)
        }
        Some("sftp") => {
            let sftp: sftp::Sftp = serde_json::from_value(target).map_err(|e| format!("SFTP settings: {e}"))?;
            sftp::send(&sftp, &config::ssh_dir(), file).await
        }
        _ => {
            let target: lobby_core::upload::Target = serde_json::from_value(target).map_err(|e| format!("Upload settings: {e}"))?;
            lobby_core::upload::send(&target, file).await
        }
    }
}

/// `x-name` arrives URI-encoded, as headers carry only ASCII.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], hex) {
            (b'%', Some(b)) => {
                out.push(b);
                i += 3;
            }
            (b, _) => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
async fn now_playing(user: String, key: String) -> Result<Option<lastfm::Playing>, String> {
    lastfm::now_playing(&user, &key).await
}

#[tauri::command]
async fn preview(state: State<'_, AppState>, url: String) -> Result<Option<preview::Preview>, ()> {
    if let Some(json) = state.store.preview_get(&url) {
        return Ok(serde_json::from_str(&json).ok());
    }
    let result = preview::fetch(&url).await;
    // A miss is tried again next start: the site may be down, or a later version may read it.
    if let Some(found) = &result
        && let Ok(json) = serde_json::to_string(found)
    {
        state.store.preview_put(&url, &json, now_ms());
    }
    Ok(result)
}

/// What a fork such as Pulina adds on the native side, from its own brand.json.
#[derive(serde::Deserialize, Default)]
struct Brand {
    backlog: Option<lobby_core::backlog::Backlog>,
    /// A fork's account service: apply, check and sign in for an always-on connection.
    accounts: Option<String>,
}

fn brand() -> Brand {
    serde_json::from_str(include_str!("../brand.json")).unwrap_or_default()
}

const PEEK_LINES: usize = 40;
const ACCOUNT_ACTIONS: [&str; 6] = ["apply", "status", "cancel", "forgot", "shell", "shell/check"];

/// One call to the fork's account service. The answer comes back as JSON, errors included.
#[tauri::command]
async fn account_call(action: String, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let base = brand().accounts.ok_or("No accounts here")?;
    if !ACCOUNT_ACTIONS.contains(&action.as_str()) {
        return Err("Unknown action".into());
    }
    let client = lobby_core::http().build().map_err(|e| e.to_string())?;
    let res = client.post(format!("{base}/{action}")).json(&body).send().await.map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

/// The newest lines of the fork's public log, for the welcome to show behind its form.
#[tauri::command]
async fn backlog_peek() -> Result<Vec<lobby_core::backlog::LogLine>, String> {
    match brand().backlog {
        Some(backlog) => backlog.peek(PEEK_LINES).await,
        None => Ok(Vec::new()),
    }
}

/// Pass hub events to the window. A lagging window reloads instead of missing lines.
fn forward(app: AppHandle, hub: Arc<Hub>) {
    let mut rx = hub.subscribe();
    if let Some(backlog) = brand().backlog {
        hub.set_backlog(backlog);
    }
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

/// Your photo, put where every Lobby and Pulina can fetch it; the link goes in your IRC real name.
#[tauri::command]
async fn share_avatar(photo: String) -> Result<String, String> {
    use base64::Engine;
    let (_, data) = photo.split_once(";base64,").ok_or("Expected a picture")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    let client = lobby_core::http().build().map_err(|e| e.to_string())?;
    let res = client.post(AVATAR_UPLOAD).body(bytes).send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let answer: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let url = answer["url"].as_str().filter(|_| status.is_success());
    url.and_then(lobby_core::net::avatar_in).ok_or_else(|| answer["error"].as_str().unwrap_or("Upload failed").to_string())
}

const AVATAR_UPLOAD: &str = "https://chat.pulina.fi/avatar";

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

/// Swap the app icon for one of the icons in `ui/icons`: the Dock icon on macOS, the home screen icon on iPhone, the window icon elsewhere.
#[tauri::command]
fn set_app_icon(app: AppHandle, window: tauri::WebviewWindow, name: String) -> Result<(), String> {
    if !icon_name_ok(&name) {
        return Err("Unknown icon".into());
    }
    #[cfg(target_os = "macos")]
    {
        // macOS draws the artwork inside a margin with a shadow; these versions carry it.
        let _ = &window;
        let asset = app.asset_resolver().get(format!("icons/mac/{name}.png")).ok_or("Unknown icon")?;
        let png = asset.bytes.clone();
        app.run_on_main_thread(move || macos::dock_icon(&png)).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "ios")]
    {
        let _ = &window;
        let wanted = ios_alternate_icon(&name);
        app.run_on_main_thread(move || ios_icon(wanted.as_deref())).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "android")]
    let _ = (&app, &window);
    #[cfg(all(desktop, not(target_os = "macos")))]
    {
        let asset = app.asset_resolver().get(format!("icons/{name}.png")).ok_or("Unknown icon")?;
        let image = tauri::image::Image::from_bytes(&asset.bytes).map_err(|e| e.to_string())?;
        window.set_icon(image).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Icon names are file names: lower-case letters and dashes, nothing that can leave the icon folder.
fn icon_name_ok(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c == '-')
}

/// The bundle's own icon on iPhone, from icons/default.txt; the others are alternates in its asset catalog.
#[cfg(any(target_os = "ios", test))]
const DEFAULT_ICON: &str = env!("APP_DEFAULT_ICON");

/// The alternate icon set iPhone switches to, as `tools/ios-icons.sh` names it; None is the bundle's own.
#[cfg(any(target_os = "ios", test))]
fn ios_alternate_icon(name: &str) -> Option<String> {
    (name != DEFAULT_ICON).then(|| format!("AppIcon-{name}"))
}

#[cfg(target_os = "ios")]
fn ios_icon(wanted: Option<&str>) {
    use objc2_foundation::NSString;
    let Some(mtm) = objc2::MainThreadMarker::new() else { return };
    let ui = objc2_ui_kit::UIApplication::sharedApplication(mtm);
    // iPhone confirms every change with an alert, so only ask when it differs.
    if ui.alternateIconName().map(|n| n.to_string()).as_deref() == wanted {
        return;
    }
    let name = wanted.map(NSString::from_str);
    ui.setAlternateIconName_completionHandler(name.as_deref(), None);
}

/// The unread count on the app icon: the Dock on macOS, the home screen on iPhone, and on Linux
/// docks that read the Unity launcher API. Windows and Android have no number badge.
#[tauri::command]
fn set_badge(app: AppHandle, count: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    app.run_on_main_thread(move || macos::dock_badge(count)).map_err(|e| e.to_string())?;
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        objc2_user_notifications::UNUserNotificationCenter::currentNotificationCenter()
            .setBadgeCount_withCompletionHandler(count as _, None);
    }
    #[cfg(target_os = "linux")]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count((count > 0).then_some(count.into()));
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "linux")))]
    let _ = (app, count);
    Ok(())
}

/// Whether macOS lets Lobby notify; null elsewhere, where the notification plugin answers.
#[cfg(target_os = "macos")]
#[tauri::command]
async fn notify_permission() -> Option<serde_json::Value> {
    serde_json::to_value(macos::permission().await.ok()?).ok()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn notify_permission() -> Option<serde_json::Value> {
    None
}

/// Shows macOS's Allow prompt the first time; true when notifications are allowed.
#[cfg(target_os = "macos")]
#[tauri::command]
async fn allow_notifications() -> Result<bool, String> {
    macos::authorize().await.map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn allow_notifications() -> Result<bool, String> {
    Ok(false)
}

/// System Settings, at its Notifications pane.
#[tauri::command]
fn open_notify_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// macOS notifications go through the system notification centre; the plugin's older route stays silent there.
#[tauri::command]
async fn notify_mac(id: String, title: String, body: String, image: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut refused = macos::notify(&id, &title, &body, image.as_deref()).await.ok().flatten();
        // A photo macOS will not take should not cost the notification itself.
        if refused.is_some() && image.is_some() {
            refused = macos::notify(&id, &title, &body, None).await.ok().flatten();
        }
        if let Some(reason) = refused {
            return Err(reason);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (id, title, body, image);
    Ok(())
}

/// How Lobby connects, as the setup screen shows and edits it.
#[derive(Serialize, serde::Deserialize, Default)]
struct Connection {
    /// "ssh", "url" or "irc".
    mode: String,
    ssh: String,
    ssh_port: Option<u16>,
    port: Option<u16>,
    url: String,
    token: String,
    nick: String,
    networks: Vec<lobby_core::Network>,
    /// What to add to `authorized_keys` on the SSH host. Filled in by Lobby, ignored on save.
    #[serde(default)]
    key_line: String,
}

#[tauri::command]
fn get_connection() -> Connection {
    let c = config::read();
    let link = c.server.clone().unwrap_or_default();
    let mode = match &c.server {
        Some(l) if l.ssh.is_some() => "ssh",
        Some(_) => "url",
        None if !c.networks.is_empty() => "irc",
        None => "ssh",
    };
    Connection {
        mode: mode.into(),
        ssh: link.ssh.clone().unwrap_or_default(),
        ssh_port: link.ssh_port,
        port: link.port,
        url: link.url.clone().unwrap_or_default(),
        token: link.token(),
        nick: c.nick,
        networks: c.networks,
        key_line: tunnel::authorized_line(&config::ssh_dir(), link.remote_port()).unwrap_or_default(),
    }
}

/// Save the setup and reconnect with it.
#[tauri::command]
fn save_connection(app: AppHandle, state: State<AppState>, connection: Connection) -> Result<(), String> {
    let old = config::read();
    let old_link = old.server.unwrap_or_default();
    // A token kept in a file stays there when it did not change.
    let (token, token_file) = if old_link.token_file.is_some() && old_link.token() == connection.token {
        (None, old_link.token_file)
    } else {
        (Some(connection.token.clone()).filter(|t| !t.is_empty()), None)
    };
    let server = match connection.mode.as_str() {
        "ssh" => Some(config::ServerLink {
            ssh: Some(connection.ssh.trim().to_string()),
            ssh_port: connection.ssh_port,
            port: connection.port,
            token,
            token_file,
            ..Default::default()
        }),
        "url" => Some(config::ServerLink { url: Some(connection.url.trim().to_string()), token, token_file, ..Default::default() }),
        _ => None,
    };
    // Only a file the config already names may stay: the page must never point the app at another file.
    let networks = connection
        .networks
        .into_iter()
        .map(|mut net| {
            let kept = old.networks.iter().find(|o| o.name == net.name).and_then(|o| o.password_file.clone());
            if net.password_file != kept {
                net.password_file = None;
            }
            net
        })
        .collect();
    config::save(&config::Config { nick: connection.nick.trim().to_string(), server, networks })?;

    let mut source = state.source.lock().unwrap_or_else(|e| e.into_inner());
    match &*source {
        Source::Local(hub) => hub.stop(),
        Source::Remote(remote) => remote.stop(),
        Source::Unconfigured => {}
    }
    let (fresh, error) = start_source(&app, &state.data);
    *source = fresh;
    *state.error.lock().unwrap_or_else(|e| e.into_inner()) = error;
    Ok(())
}

/// lobby-server's networks, for the setup screen. Only a server keeps its own list.
#[tauri::command]
async fn server_networks(state: State<'_, AppState>) -> Result<Vec<lobby_core::hub::NetworkView>, String> {
    match state.source() {
        Source::Remote(remote) => from_value(remote.request(|id| ClientMsg::Networks { id }).await?),
        _ => Err(NOT_A_SERVER.into()),
    }
}

#[tauri::command]
async fn save_server_network(state: State<'_, AppState>, network: lobby_core::Network) -> Result<(), String> {
    match state.source() {
        Source::Remote(remote) => remote.request(|id| ClientMsg::SaveNetwork { id, network }).await.map(|_| ()),
        _ => Err(NOT_A_SERVER.into()),
    }
}

#[tauri::command]
async fn delete_server_network(state: State<'_, AppState>, name: String) -> Result<(), String> {
    match state.source() {
        Source::Remote(remote) => remote.request(|id| ClientMsg::DeleteNetwork { id, name }).await.map(|_| ()),
        _ => Err(NOT_A_SERVER.into()),
    }
}

const NOT_A_SERVER: &str = "Not connected to lobby-server";

#[tauri::command]
fn player() -> String {
    embed::base()
}

#[tauri::command]
fn set_quit_message(state: State<'_, AppState>, text: String) {
    *state.quit.lock().unwrap_or_else(|e| e.into_inner()) = text;
}

/// How long the QUIT gets to reach the server before the app is gone.
const QUIT_FLUSH: std::time::Duration = std::time::Duration::from_millis(400);

static SAID_GOODBYE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// A direct connection says goodbye with the quit message; lobby-server stays on IRC without the app.
fn say_goodbye(app: &AppHandle) {
    if SAID_GOODBYE.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Some(state) = app.try_state::<AppState>() else { return };
    let Source::Local(hub) = state.source() else { return };
    let reason = state.quit.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if !reason.is_empty() {
        hub.quit_all(&reason);
        std::thread::sleep(QUIT_FLUSH);
    }
}

/// Everything this app keeps on the device goes: the connection, history and previews. The SSH key
/// stays, since servers may already trust it. The page clears its own storage first; then a restart.
#[tauri::command]
fn reset_app(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    match &*state.source.lock().unwrap_or_else(|e| e.into_inner()) {
        Source::Local(hub) => hub.stop(),
        Source::Remote(remote) => remote.stop(),
        Source::Unconfigured => {}
    }
    let _ = std::fs::remove_file(config::path());
    for name in ["history.db", "history.db-wal", "history.db-shm", "previews.db", "previews.db-wal", "previews.db-shm"] {
        let _ = std::fs::remove_file(state.data.join(name));
    }
    app.restart();
}

/// The version, the commit it was built from and that commit's date, for the About section in Settings.
#[derive(Serialize)]
struct AppInfo {
    version: &'static str,
    commit: &'static str,
    date: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo { version: env!("CARGO_PKG_VERSION"), commit: env!("LOBBY_COMMIT"), date: env!("LOBBY_COMMIT_DATE") }
}

#[cfg(desktop)]
const ABOUT_MENU_ID: &str = "about";
#[cfg(desktop)]
const SETTINGS_MENU_ID: &str = "settings";
#[cfg(target_os = "macos")]
const QUIT_MENU_ID: &str = "quit";

/// macOS: the standard menu bar, with Help > About Lobby opening the About section in Settings.
#[cfg(target_os = "macos")]
fn mac_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, HELP_SUBMENU_ID, Menu, MenuItem, PredefinedMenuItem};
    let menu = Menu::default(app)?;
    let name = &app.package_info().name;
    if let Some(help) = menu.get(HELP_SUBMENU_ID).and_then(|m| m.as_submenu().cloned()) {
        help.append(&MenuItem::with_id(app, ABOUT_MENU_ID, format!("About {name}"), true, None::<&str>)?)?;
    }
    // The app's own menu: About, then Settings… as on every Mac app.
    if let Some(own) = menu.items()?.first().and_then(|m| m.as_submenu().cloned()) {
        // The standard About shows "Version 1.13.6 (1.13.6)"; this one names the build's date and commit.
        if let Some(about) = own.items()?.into_iter().next() {
            own.remove(&about)?;
        }
        let build = AboutMetadata {
            short_version: Some(env!("CARGO_PKG_VERSION").into()),
            version: Some(format!("{}, {}", env!("LOBBY_COMMIT_DATE"), env!("LOBBY_COMMIT"))),
            ..Default::default()
        };
        own.prepend(&PredefinedMenuItem::about(app, Some(&format!("About {name}")), Some(build))?)?;
        own.insert(&MenuItem::with_id(app, SETTINGS_MENU_ID, "Settings…", true, Some("CmdOrCtrl+,"))?, 2)?;
        own.insert(&PredefinedMenuItem::separator(app)?, 3)?;
        // The standard Quit ends the app before it can say goodbye on IRC; this one sends the quit message first.
        let quit = own
            .items()?
            .into_iter()
            .rev()
            .find(|i| i.as_predefined_menuitem().and_then(|p| p.text().ok()).is_some_and(|t| t.starts_with("Quit")));
        if let Some(quit) = quit {
            own.remove(&quit)?;
        }
        own.append(&MenuItem::with_id(app, QUIT_MENU_ID, format!("Quit {name}"), true, Some("CmdOrCtrl+Q"))?)?;
    }
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // With two TLS backends compiled in rustls will not choose, and a wss:// lobby-server link panics.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_notification::init());
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_haptics::init());
    // Phones have no menu bar and one window size.
    #[cfg(desktop)]
    let builder = builder
        .on_menu_event(|app, event| {
            if event.id().0 == ABOUT_MENU_ID {
                let _ = app.emit("show-about", ());
            }
            if event.id().0 == SETTINGS_MENU_ID {
                let _ = app.emit("show-settings", ());
            }
            #[cfg(target_os = "macos")]
            if event.id().0 == QUIT_MENU_ID {
                say_goodbye(app);
                app.exit(0);
            }
        })
        .plugin({
            use tauri_plugin_window_state::StateFlags;
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build()
        })
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_menu(mac_menu(app.handle())?)?;

            config::use_name(&app.package_info().name);
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            #[cfg(target_os = "android")]
            config::use_app_dir(app.path().app_config_dir()?);

            let (source, error) = start_source(app.handle(), &data);

            let store = Store::open(&data.join("previews.db"))?;
            app.manage(AppState { source: source.into(), error: error.into(), store, data, quit: String::new().into() });

            // A clicked notification brings Lobby forward and opens the message it was about.
            #[cfg(target_os = "macos")]
            {
                let handle = app.handle().clone();
                macos::on_notification_click(move |id| {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    let _ = handle.emit("notification-click", id);
                });
            }
            #[cfg(target_os = "ios")]
            ios_volume::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            status,
            backlog_peek,
            recent_buffers,
            history,
            around,
            mentions,
            count_unread,
            talkers,
            now_playing,
            links,
            send,
            preview,
            save_person,
            delete_person,
            set_setting,
            upload,
            player,
            notify_icon,
            set_app_icon,
            set_badge,
            update::can_install_updates,
            update::check_update,
            update::install_update,
            update::restart,
            notify_mac,
            allow_notifications,
            notify_permission,
            open_notify_settings,
            get_connection,
            save_connection,
            server_networks,
            save_server_network,
            delete_server_network,
            app_info,
            set_quit_message,
            share_avatar,
            account_call,
            reset_app
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Lobby")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                say_goodbye(app);
            }
            if let tauri::RunEvent::Resumed = event {
                #[cfg(target_os = "ios")]
                ios_volume::resumed(app);
                if let Some(Source::Remote(remote)) = app.try_state::<AppState>().map(|s| s.source()) {
                    remote.wake(app.clone());
                }
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_file_names() {
        assert_eq!(super::percent_decode("Kes%C3%A4%20kuva.png"), "Kesä kuva.png");
        assert_eq!(super::percent_decode("100%"), "100%");
    }

    use super::*;

    #[test]
    fn icon_names_cannot_leave_the_icon_folder() {
        assert!(icon_name_ok("pendant-lamp"));
        assert!(!icon_name_ok(""));
        assert!(!icon_name_ok("../secret"));
        assert!(!icon_name_ok("Sunset"));
        assert!(!icon_name_ok("a/b"));
    }

    #[test]
    fn iphone_switches_to_alternate_sets_except_for_the_default() {
        assert_eq!(ios_alternate_icon(DEFAULT_ICON), None);
        assert_eq!(ios_alternate_icon("coffee-chat").as_deref(), Some("AppIcon-coffee-chat"));
    }

    #[test]
    fn the_iphone_default_has_its_artwork() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("icons/ios/{DEFAULT_ICON}.png"));
        assert!(path.is_file(), "missing {}", path.display());
        let script = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tools/ios-icons.sh")).unwrap();
        assert!(script.contains("icons/default.txt"), "tools/ios-icons.sh must make {DEFAULT_ICON} the app icon");
    }
}
