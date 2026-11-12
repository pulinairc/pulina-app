//! The GTK an AppImage carries draws its own pointer on Wayland, at the size GSettings gives it.
//! KDE keeps its cursor size elsewhere, so an enlarged pointer shrank to the default over the
//! window. Newer GTK lets the compositor draw it instead; this only matters for the older one.

use std::path::PathBuf;

/// Gives GTK the cursor theme and size the desktop uses, when it is Wayland and they are known.
pub fn follow_desktop() {
    let Some((theme, size)) = desktop_cursor() else {
        return;
    };
    let Some(display) = gdk::Display::default() else {
        return;
    };
    let Ok(theme) = std::ffi::CString::new(theme) else {
        return;
    };
    use glib::translate::ToGlibPtr;
    let raw: *mut gdk::ffi::GdkDisplay = display.to_glib_none().0;
    // SAFETY: the display outlives this call, and its type is checked before the cast.
    unsafe {
        let wayland = gdk_wayland_sys::gdk_wayland_display_get_type();
        if glib::gobject_ffi::g_type_check_instance_is_a(raw.cast(), wayland) == 0 {
            return;
        }
        gdk_wayland_sys::gdk_wayland_display_set_cursor_theme(raw.cast(), theme.as_ptr(), size);
    }
}

fn desktop_cursor() -> Option<(String, i32)> {
    let (kde_theme, kde_size) = std::fs::read_to_string(kde_input_file()?).map(|text| kde_mouse(&text)).unwrap_or_default();
    let size = kde_size.or_else(|| std::env::var("XCURSOR_SIZE").ok()?.trim().parse().ok())?;
    let theme = kde_theme.or_else(|| std::env::var("XCURSOR_THEME").ok()).unwrap_or_else(|| "default".into());
    Some((theme, size))
}

fn kde_input_file() -> Option<PathBuf> {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| Some(PathBuf::from(std::env::var_os("HOME")?).join(".config")))?;
    Some(config.join("kcminputrc"))
}

/// The cursor theme and size in KDE's kcminputrc, from its [Mouse] group.
fn kde_mouse(text: &str) -> (Option<String>, Option<i32>) {
    let mut in_mouse = false;
    let (mut theme, mut size) = (None, None);
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_mouse = line == "[Mouse]";
            continue;
        }
        if !in_mouse {
            continue;
        }
        if let Some(v) = line.strip_prefix("cursorTheme=") {
            theme = Some(v.trim().to_string()).filter(|v| !v.is_empty());
        } else if let Some(v) = line.strip_prefix("cursorSize=") {
            size = v.trim().parse().ok().filter(|n: &i32| *n > 0);
        }
    }
    (theme, size)
}

#[cfg(test)]
mod tests {
    use super::kde_mouse;

    #[test]
    fn reads_the_mouse_group_only() {
        let text = "[Keyboard]\ncursorSize=12\n\n[Mouse]\ncursorTheme=breeze_cursors\ncursorSize=72\n\n[Other]\ncursorTheme=nope\n";
        assert_eq!(kde_mouse(text), (Some("breeze_cursors".into()), Some(72)));
    }

    #[test]
    fn missing_or_bad_values_are_none() {
        assert_eq!(kde_mouse("[Mouse]\ncursorSize=big\n"), (None, None));
        assert_eq!(kde_mouse(""), (None, None));
    }
}
