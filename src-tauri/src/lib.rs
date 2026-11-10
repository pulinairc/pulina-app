mod config;
mod embed;
#[cfg(target_os = "macos")]
mod macos;
mod preview;
mod remote;
mod sftp;
mod tunnel;

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
        Event::Me { net, nick } => app.emit("me", serde_json::json!({ "net": net, "nick": nick })),
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

/// Pendant lamp is the bundle's own icon on iPhone; the others are alternates in its asset catalog.
#[cfg(any(target_os = "ios", test))]
const DEFAULT_ICON: &str = "pendant-lamp";

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

/// The highlight count on the app icon: the Dock on macOS, the home screen on iPhone.
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
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
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
    config::save(&config::Config { nick: connection.nick.trim().to_string(), server, networks: connection.networks })?;

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

/// The version and the commit it was built from, for the About section in Settings.
#[derive(Serialize)]
struct AppInfo {
    version: &'static str,
    commit: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo { version: env!("CARGO_PKG_VERSION"), commit: env!("LOBBY_COMMIT") }
}

#[cfg(desktop)]
const ABOUT_MENU_ID: &str = "about";

/// macOS: the standard menu bar, with Help > About Lobby opening the About section in Settings.
#[cfg(target_os = "macos")]
fn mac_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{HELP_SUBMENU_ID, Menu, MenuItem};
    let menu = Menu::default(app)?;
    if let Some(help) = menu.get(HELP_SUBMENU_ID).and_then(|m| m.as_submenu().cloned()) {
        help.append(&MenuItem::with_id(app, ABOUT_MENU_ID, "About Lobby", true, None::<&str>)?)?;
    }
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_notification::init());
    // Phones have no menu bar and one window size.
    #[cfg(desktop)]
    let builder = builder
        .on_menu_event(|app, event| {
            if event.id().0 == ABOUT_MENU_ID {
                let _ = app.emit("show-about", ());
            }
        })
        .plugin({
            use tauri_plugin_window_state::StateFlags;
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build()
        });
    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_menu(mac_menu(app.handle())?)?;

            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            #[cfg(target_os = "android")]
            config::use_app_dir(app.path().app_config_dir()?);

            let (source, error) = start_source(app.handle(), &data);

            let store = Store::open(&data.join("previews.db"))?;
            app.manage(AppState { source: source.into(), error: error.into(), store, data });

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            status,
            recent_buffers,
            history,
            around,
            mentions,
            count_unread,
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
            notify_mac,
            allow_notifications,
            notify_permission,
            open_notify_settings,
            get_connection,
            save_connection,
            server_networks,
            save_server_network,
            delete_server_network,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Lobby");
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
        assert!(script.contains(&format!("[ \"$name\" = {DEFAULT_ICON} ]")), "tools/ios-icons.sh must make {DEFAULT_ICON} the app icon");
    }
}
