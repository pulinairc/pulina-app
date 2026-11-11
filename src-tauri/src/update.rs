//! New releases: installed in place where the updater can (macOS, Windows, the AppImage);
//! elsewhere only announced, with a link to the release. iPhone gets its updates from the App Store.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct Available {
    version: String,
    installable: bool,
}

/// Whether this copy can replace itself: a .deb or an Android APK is updated by hand.
#[tauri::command]
pub fn can_install_updates() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows")) || (cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_some())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<Available>, String> {
    use tauri_plugin_updater::{Error, UpdaterExt};
    let update = match app.updater().map_err(|e| e.to_string())?.check().await {
        Ok(update) => update,
        // A release without update files says nothing about updates.
        Err(Error::ReleaseNotFound) => None,
        Err(e) => return Err(e.to_string()),
    };
    Ok(update.map(|u| Available { version: u.version, installable: can_install_updates() }))
}

#[cfg(mobile)]
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<Available>, String> {
    if cfg!(target_os = "ios") {
        return Ok(None);
    }
    let url = app.config().plugins.0.get("updater").and_then(|u| u["endpoints"][0].as_str()).ok_or("No update address")?.to_string();
    let latest: serde_json::Value = reqwest::get(url).await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let version = latest["version"].as_str().unwrap_or_default().trim_start_matches('v').to_string();
    Ok(newer(&version, env!("CARGO_PKG_VERSION")).then_some(Available { version, installable: false }))
}

/// Download and put the new version in place; it runs after a restart.
#[cfg(desktop)]
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else { return Ok(()) };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let _ = app;
    Err("Updates come from the app store here".into())
}

#[tauri::command]
pub fn restart(app: AppHandle) {
    app.restart();
}

/// Dotted version numbers, compared part by part.
#[cfg_attr(desktop, allow(dead_code))]
fn newer(candidate: &str, current: &str) -> bool {
    let parts = |v: &str| v.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parts(candidate) > parts(current)
}

#[cfg(test)]
mod tests {
    use super::newer;

    #[test]
    fn compares_versions_by_number() {
        assert!(newer("1.10.0", "1.9.3"));
        assert!(newer("2.0.0", "1.99.99"));
        assert!(!newer("1.7.0", "1.7.0"));
        assert!(!newer("1.6.9", "1.7.0"));
    }
}
