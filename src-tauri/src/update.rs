//! New releases: installed in place where the updater can (macOS, Windows, the AppImage);
//! elsewhere only announced, with a link to the release. iPhone gets its updates from the App Store.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct Available {
    version: String,
    installable: bool,
    notes: Option<String>,
}

/// A downloaded update waits here until the restart: installing it on Windows closes the app.
#[cfg(desktop)]
static PENDING: std::sync::Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>> = std::sync::Mutex::new(None);

/// Whether this copy can replace itself: a .deb or an Android APK is updated by hand.
#[tauri::command]
pub fn can_install_updates() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows")) || (cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_some())
}

#[cfg(desktop)]
const NO_UPDATE_FILES: &str = "The newest release has no update files yet";

#[cfg(desktop)]
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<Available>, String> {
    use tauri_plugin_updater::{Error, UpdaterExt};
    let update = match app.updater().map_err(|e| e.to_string())?.check().await {
        Ok(update) => update,
        // The newest release is there but its update files are not (yet): saying "up to date" would be wrong.
        Err(Error::ReleaseNotFound) => return Err(NO_UPDATE_FILES.into()),
        Err(e) => return Err(e.to_string()),
    };
    Ok(update.map(|u| Available { version: u.version, installable: can_install_updates(), notes: u.body }))
}

#[cfg(mobile)]
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<Available>, String> {
    if cfg!(target_os = "ios") {
        return Ok(None);
    }
    let url = app.config().plugins.0.get("updater").and_then(|u| u["endpoints"][0].as_str()).ok_or("No update address")?.to_string();
    let client = lobby_core::http().build().map_err(|e| e.to_string())?;
    let latest: serde_json::Value = client.get(url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let version = latest["version"].as_str().unwrap_or_default().trim_start_matches('v').to_string();
    let notes = latest["notes"].as_str().map(String::from);
    Ok(newer(&version, env!("CARGO_PKG_VERSION")).then_some(Available { version, installable: false, notes }))
}

/// Download and check the new version in the background; the restart puts it in place.
#[cfg(desktop)]
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else { return Ok(()) };
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some((update, bytes));
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let _ = app;
    Err("Updates come from the app store here".into())
}

#[tauri::command]
pub fn restart(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    install_pending()?;
    app.restart();
}

/// Put a downloaded update in place; also on quit, so the next start runs it.
#[cfg(desktop)]
pub fn install_pending() -> Result<(), String> {
    let Some((update, bytes)) = PENDING.lock().unwrap_or_else(|e| e.into_inner()).take() else { return Ok(()) };
    #[cfg(target_os = "macos")]
    match in_bundle::install(&update, &bytes) {
        Ok(()) => return Ok(()),
        Err(e) => eprintln!("updating inside the bundle failed, replacing it instead: {e}"),
    }
    update.install(bytes).map_err(|e| e.to_string())
}

/// Swaps only Contents, so the .app folder stays: the Dock keeps its icon and a bundle
/// the user owns needs no admin password. Replacing the whole bundle broke both.
#[cfg(target_os = "macos")]
mod in_bundle {
    use std::ffi::CString;
    use std::io;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::path::{Component, Path, PathBuf};

    pub fn install(update: &tauri_plugin_updater::Update, bytes: &[u8]) -> io::Result<()> {
        update.verify(bytes).map_err(io::Error::other)?;
        replace_contents(&bundle_path()?, bytes)
    }

    fn replace_contents(bundle: &Path, bytes: &[u8]) -> io::Result<()> {
        let staging = std::env::temp_dir().join(format!("lobby-update-{}", std::process::id()));
        if staging.parent().map(|p| p.metadata()).transpose()?.map(|m| m.dev()) != Some(bundle.metadata()?.dev()) {
            return Err(io::Error::other("temp dir is on another volume"));
        }
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir(&staging)?;
        let gid = bundle.metadata()?.gid();
        let result = unpack(bytes, &staging)
            .and_then(|()| share_with_group(&staging.join("Contents"), gid))
            .and_then(|()| swap(&staging.join("Contents"), &bundle.join("Contents")));
        let _ = std::fs::remove_dir_all(&staging);
        result?;
        let _ = std::process::Command::new("touch").arg(bundle).status();
        Ok(())
    }

    /// The bundle's group may update it too, so another account on the Mac needs no password.
    fn share_with_group(path: &Path, gid: u32) -> io::Result<()> {
        let meta = std::fs::symlink_metadata(path)?;
        std::os::unix::fs::lchown(path, None, Some(gid))?;
        if meta.file_type().is_symlink() {
            return Ok(());
        }
        let mut perms = meta.permissions();
        perms.set_mode(perms.mode() | 0o020);
        std::fs::set_permissions(path, perms)?;
        if meta.is_dir() {
            for entry in std::fs::read_dir(path)? {
                share_with_group(&entry?.path(), gid)?;
            }
        }
        Ok(())
    }

    fn bundle_path() -> io::Result<PathBuf> {
        let exe = std::env::current_exe()?;
        let bundle = exe.ancestors().nth(3).ok_or_else(|| io::Error::other("no bundle"))?;
        if bundle.extension().is_none_or(|e| e != "app") {
            return Err(io::Error::other("not run from an .app bundle"));
        }
        Ok(bundle.to_path_buf())
    }

    /// The archive holds Name.app/Contents/...; it lands as dir/Contents/...
    fn unpack(bytes: &[u8], dir: &Path) -> io::Result<()> {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
        for entry in archive.entries()? {
            let mut entry = entry?;
            let inner: PathBuf = entry.path()?.components().skip(1).collect();
            if inner.as_os_str().is_empty() {
                continue;
            }
            if inner.components().any(|c| !matches!(c, Component::Normal(_))) {
                return Err(io::Error::other("unexpected path in the update"));
            }
            let target = dir.join(&inner);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            entry.unpack(&target)?;
        }
        if !dir.join("Contents/MacOS").is_dir() {
            return Err(io::Error::other("the update has no app inside"));
        }
        Ok(())
    }

    fn swap(a: &Path, b: &Path) -> io::Result<()> {
        let (a, b) = (CString::new(a.as_os_str().as_bytes())?, CString::new(b.as_os_str().as_bytes())?);
        if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_SWAP) } == 0 {
            return Ok(());
        }
        Err(io::Error::last_os_error())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn archive(version: &str) -> Vec<u8> {
            let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
            let mut header = tar::Header::new_gnu();
            header.set_size(version.len() as u64);
            header.set_mode(0o755);
            tar.append_data(&mut header, "Lobby.app/Contents/MacOS/lobby", version.as_bytes()).unwrap();
            tar.into_inner().unwrap().finish().unwrap()
        }

        #[test]
        fn keeps_the_bundle_folder_and_swaps_its_contents() {
            let root = std::env::temp_dir().join(format!("lobby-bundle-test-{}", std::process::id()));
            let bundle = root.join("Lobby.app");
            std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
            std::fs::write(bundle.join("Contents/MacOS/lobby"), "old").unwrap();
            std::fs::write(bundle.join("Contents/MacOS/stale"), "gone after").unwrap();
            let inode = bundle.metadata().unwrap().ino();

            replace_contents(&bundle, &archive("new")).unwrap();

            assert_eq!(bundle.metadata().unwrap().ino(), inode);
            assert_eq!(bundle.join("Contents/MacOS/lobby").metadata().unwrap().mode() & 0o020, 0o020);
            assert_eq!(std::fs::read_to_string(bundle.join("Contents/MacOS/lobby")).unwrap(), "new");
            assert!(!bundle.join("Contents/MacOS/stale").exists());
            assert!(replace_contents(&bundle, b"not an archive").is_err());
            assert_eq!(std::fs::read_to_string(bundle.join("Contents/MacOS/lobby")).unwrap(), "new");
            std::fs::remove_dir_all(root).unwrap();
        }
    }
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
