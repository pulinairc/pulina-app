//! macOS only: the Dock icon and badge, and notifications through the system's notification centre.

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AllocAnyThread, MainThreadMarker, define_class, msg_send};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::{NSArray, NSData, NSError, NSString, NSURL};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification, UNNotificationAttachment,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse, UNNotificationSetting, UNNotificationSettings,
    UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::{Mutex, OnceLock};
use tokio::sync::oneshot;

/// Gets the id of a notification the user clicked.
static ON_CLICK: OnceLock<Box<dyn Fn(String) + Send + Sync>> = OnceLock::new();

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "LobbyNotificationDelegate"]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        // Without this, macOS silences every notification while Lobby is the front app.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            done: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            done.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound
                | UNNotificationPresentationOptions::Badge,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(&self, _center: &UNUserNotificationCenter, response: &UNNotificationResponse, done: &block2::DynBlock<dyn Fn()>) {
            if let Some(on_click) = ON_CLICK.get() {
                on_click(response.notification().request().identifier().to_string());
            }
            done.call(());
        }
    }
);

/// Report clicked notifications by id. Call once, at start.
pub fn on_notification_click(on_click: impl Fn(String) + Send + Sync + 'static) {
    if ON_CLICK.set(Box::new(on_click)).is_err() {
        return;
    }
    let delegate: Retained<NotificationDelegate> = unsafe { msg_send![NotificationDelegate::alloc(), init] };
    UNUserNotificationCenter::currentNotificationCenter().setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // The centre only holds its delegate weakly; this one lives as long as Lobby.
    std::mem::forget(delegate);
}

/// Must run on the main thread.
pub fn dock_icon(png: &[u8]) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    let data = NSData::with_bytes(png);
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else { return };
    unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image)) };
}

/// The number on the Dock icon; zero clears it. Must run on the main thread.
pub fn dock_badge(count: u32) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    let label = (count > 0).then(|| NSString::from_str(&count.to_string()));
    NSApplication::sharedApplication(mtm).dockTile().setBadgeLabel(label.as_deref());
}

/// What macOS lets Lobby do, as System Settings shows it.
#[derive(serde::Serialize)]
pub struct Permission {
    /// "allowed", "denied" or "ask" when macOS has not asked yet.
    pub state: &'static str,
    pub banners: bool,
    pub badge: bool,
}

/// A completion handler may in principle run more than once; only the first answer counts.
fn once<T: Send + 'static>() -> (impl Fn(T) + Send + Sync + 'static, oneshot::Receiver<T>) {
    let (tx, rx) = oneshot::channel();
    let tx = Mutex::new(Some(tx));
    let send = move |value: T| {
        if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
            let _ = tx.send(value);
        }
    };
    (send, rx)
}

/// The answer as the page reads it: provisional and ephemeral permission still let Lobby notify.
fn state_name(status: UNAuthorizationStatus) -> &'static str {
    match status {
        UNAuthorizationStatus::NotDetermined => "ask",
        UNAuthorizationStatus::Denied => "denied",
        _ => "allowed",
    }
}

pub fn permission() -> oneshot::Receiver<Permission> {
    let (send, rx) = once();
    let done = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        let settings = unsafe { settings.as_ref() };
        send(Permission {
            state: state_name(settings.authorizationStatus()),
            banners: settings.alertSetting() == UNNotificationSetting::Enabled,
            badge: settings.badgeSetting() == UNNotificationSetting::Enabled,
        });
    });
    UNUserNotificationCenter::currentNotificationCenter().getNotificationSettingsWithCompletionHandler(&done);
    rx
}

/// Shows the system's Allow prompt the first time; later macOS answers from what was chosen.
pub fn authorize() -> oneshot::Receiver<Result<bool, String>> {
    let (send, rx) = once();
    let done = RcBlock::new(move |granted: Bool, error: *mut NSError| {
        send(match unsafe { error.as_ref() } {
            Some(e) => Err(e.localizedDescription().to_string()),
            None => Ok(granted.as_bool()),
        });
    });
    UNUserNotificationCenter::currentNotificationCenter().requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
        &done,
    );
    rx
}

/// macOS moves an attachment's file into its own store, so each notification gets its own copy of the cached photo.
fn attachment_copy(id: &str, path: &Path) -> Option<PathBuf> {
    let ext = path.extension()?.to_str()?;
    let copy = std::env::temp_dir().join(format!("lobby-notify-{id}.{ext}"));
    std::fs::copy(path, &copy).ok()?;
    Some(copy)
}

/// Answers with the reason when macOS refuses it.
pub fn notify(id: &str, title: &str, body: &str, image: Option<&str>) -> oneshot::Receiver<Option<String>> {
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    if let Some(path) = image.and_then(|p| attachment_copy(id, Path::new(p))) {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let attachment: Option<Retained<UNNotificationAttachment>> =
            unsafe { UNNotificationAttachment::attachmentWithIdentifier_URL_options_error(&NSString::from_str("photo"), &url, None) }.ok();
        if let Some(a) = attachment {
            content.setAttachments(&NSArray::from_retained_slice(&[a]));
        }
    }
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(id), &content, None);
    let (send, rx) = once();
    let done = RcBlock::new(move |error: *mut NSError| send(unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string())));
    UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, Some(&done));
    rx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attachment_copy_leaves_the_cached_photo_alone() {
        let photo = std::env::temp_dir().join("lobby-test-photo.png");
        std::fs::write(&photo, b"png").unwrap();
        let copy = attachment_copy("42", &photo).unwrap();
        assert_ne!(copy, photo);
        assert_eq!(std::fs::read(&copy).unwrap(), b"png");
        std::fs::remove_file(&copy).unwrap();
        assert!(photo.exists());
        assert!(attachment_copy("43", &std::env::temp_dir().join("lobby-missing.png")).is_none());
    }

    #[test]
    fn states_read_as_the_page_expects() {
        assert_eq!(state_name(UNAuthorizationStatus::NotDetermined), "ask");
        assert_eq!(state_name(UNAuthorizationStatus::Denied), "denied");
        assert_eq!(state_name(UNAuthorizationStatus::Authorized), "allowed");
        assert_eq!(state_name(UNAuthorizationStatus::Provisional), "allowed");
        assert_eq!(state_name(UNAuthorizationStatus::Ephemeral), "allowed");
    }

    #[test]
    fn permission_reaches_the_page_with_its_field_names() {
        let json = serde_json::to_value(Permission { state: "ask", banners: false, badge: true }).unwrap();
        assert_eq!(json, serde_json::json!({ "state": "ask", "banners": false, "badge": true }));
    }

    #[test]
    fn only_the_first_answer_counts() {
        let (send, mut rx) = once();
        send(1);
        send(2);
        assert_eq!(rx.try_recv(), Ok(1));
    }
}
