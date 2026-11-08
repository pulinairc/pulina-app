//! macOS only: the Dock icon and badge, and notifications through the system's notification centre.

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, MainThreadMarker};
use std::sync::OnceLock;
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::{NSArray, NSData, NSError, NSString, NSURL};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationAttachment, UNNotificationRequest,
    UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

/// Gets the id of a notification the user clicked.
static ON_CLICK: OnceLock<Box<dyn Fn(String) + Send + Sync>> = OnceLock::new();

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "LobbyNotificationDelegate"]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
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

/// Ask once to show notifications; macOS remembers the answer.
pub fn authorize() {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let done = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
        &done,
    );
}

pub fn notify(id: &str, title: &str, body: &str, image: Option<&str>) {
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    if let Some(path) = image {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let attachment: Option<Retained<UNNotificationAttachment>> =
            unsafe { UNNotificationAttachment::attachmentWithIdentifier_URL_options_error(&NSString::from_str("photo"), &url, None) }.ok();
        if let Some(a) = attachment {
            content.setAttachments(&NSArray::from_retained_slice(&[a]));
        }
    }
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(id), &content, None);
    UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, None);
}
