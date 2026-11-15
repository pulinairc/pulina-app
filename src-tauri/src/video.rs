//! Linux: NVIDIA's GL turns WebKit's video frames solid green; drawn without the GL sink they are right.
//! WebKit reads the choice once at start, so it lives in a file read before the window opens.

#[cfg(target_os = "linux")]
mod imp {
    use crate::config;
    use std::path::{Path, PathBuf};

    const NVIDIA: &str = "/proc/driver/nvidia";
    const GL_SINK: &str = "WEBKIT_GST_DISABLE_GL_SINK";
    const ON: &str = "on";
    const OFF: &str = "off";

    fn file() -> PathBuf {
        config::dir().join("video-without-gpu")
    }

    /// The saved choice, or on by default with an NVIDIA driver loaded.
    pub fn safe() -> bool {
        match std::fs::read_to_string(file()).map(|s| s.trim().to_owned()).as_deref() {
            Ok(ON) => true,
            Ok(OFF) => false,
            _ => Path::new(NVIDIA).exists(),
        }
    }

    pub fn set_safe(on: bool) -> Result<(), String> {
        std::fs::create_dir_all(config::dir()).map_err(|e| e.to_string())?;
        std::fs::write(file(), if on { ON } else { OFF }).map_err(|e| e.to_string())
    }

    /// Before any thread or window exists.
    pub fn apply() {
        if safe() && std::env::var_os(GL_SINK).is_none() {
            // SAFETY: called first thing in run(), with no other threads yet.
            unsafe { std::env::set_var(GL_SINK, "1") };
        }
    }
}

#[cfg(target_os = "linux")]
pub use imp::apply;

#[cfg(not(target_os = "linux"))]
const NOT_HERE: &str = "only on Linux";

#[tauri::command]
pub fn video_safe() -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    return Ok(imp::safe());
    #[cfg(not(target_os = "linux"))]
    Err(NOT_HERE.into())
}

#[tauri::command]
pub fn set_video_safe(on: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return imp::set_safe(on);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = on;
        Err(NOT_HERE.into())
    }
}
