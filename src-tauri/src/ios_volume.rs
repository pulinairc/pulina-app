//! iPhone only: the volume buttons step the text size while Lobby is in front.
//!
//! iOS has no event for the buttons, so Lobby watches the system volume, reports which way it
//! moved, and puts it back. A hidden MPVolumeView keeps the volume bubble off the screen.

use objc2::rc::{Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject, NSObject};
use objc2::{AllocAnyThread, define_class, msg_send};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_foundation::{NSArray, NSError, NSString};
use std::cell::RefCell;
use std::ffi::{CStr, c_char, c_int, c_void};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const AVFAUDIO: &CStr = c"/System/Library/Frameworks/AVFAudio.framework/AVFAudio";
const MEDIA_PLAYER: &CStr = c"/System/Library/Frameworks/MediaPlayer.framework/MediaPlayer";
const RTLD_NOW: c_int = 2;
const KVO_NEW: usize = 1;
const MIX_WITH_OTHERS: usize = 1;
const MIDDLE: f32 = 0.5;
// One button press moves the volume by 1/16; at the very ends one direction gives nothing.
const EDGE: f32 = 0.07;
const SAME: f32 = 0.01;
// Coming back to Lobby, iOS may report the volume changed elsewhere: not a press.
const SETTLE: Duration = Duration::from_millis(800);

unsafe extern "C" {
    fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static BASE: AtomicU32 = AtomicU32::new(0);
static SETTLE_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

thread_local! {
    /// The hidden volume view; only touched on the main thread.
    static VOLUME_VIEW: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "LobbyVolumeWatch"]
    struct VolumeWatch;

    impl VolumeWatch {
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn observe(&self, _path: Option<&NSString>, _object: Option<&AnyObject>, _change: Option<&AnyObject>, _context: *mut c_void) {
            if let Some(app) = APP.get() {
                let _ = app.run_on_main_thread(moved);
            }
        }
    }
);

fn session() -> Option<Retained<AnyObject>> {
    let class = AnyClass::get(c"AVAudioSession")?;
    unsafe { msg_send![class, sharedInstance] }
}

fn volume() -> Option<f32> {
    let session = session()?;
    Some(unsafe { msg_send![&*session, outputVolume] })
}

fn base() -> f32 {
    f32::from_bits(BASE.load(Ordering::Relaxed))
}

fn set_base(v: f32) {
    BASE.store(v.to_bits(), Ordering::Relaxed);
}

/// Set the system volume through the hidden view's slider. Main thread.
fn set_volume(v: f32) {
    VOLUME_VIEW.with_borrow(|view| {
        let Some(view) = view else { return };
        let Some(slider_class) = AnyClass::get(c"UISlider") else { return };
        let subviews: Retained<NSArray<AnyObject>> = unsafe { msg_send![&**view, subviews] };
        for i in 0..subviews.count() {
            let sub = subviews.objectAtIndex(i);
            let is_slider: bool = unsafe { msg_send![&*sub, isKindOfClass: slider_class] };
            if is_slider {
                let _: () = unsafe { msg_send![&*sub, setValue: v] };
                return;
            }
        }
    });
}

/// The volume changed: a press, unless it is Lobby's own reset or iOS settling after a return.
fn moved() {
    let Some(v) = volume() else { return };
    let settling = SETTLE_UNTIL.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|t| Instant::now() < t);
    if settling {
        set_base(v);
        return;
    }
    let base = base();
    if (v - base).abs() < SAME {
        return;
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("volume-key", if v > base { 1 } else { -1 });
    }
    set_volume(base);
}

/// Remember where the volume is, moved off the ends so both buttons register. Main thread.
fn rebase() {
    let Some(v) = volume() else { return };
    if (EDGE..=1.0 - EDGE).contains(&v) {
        set_base(v);
        return;
    }
    set_base(MIDDLE);
    set_volume(MIDDLE);
}

fn activate(session: &AnyObject) -> Result<(), Retained<NSError>> {
    let ambient = unsafe { dlsym(dlopen(AVFAUDIO.as_ptr(), RTLD_NOW), c"AVAudioSessionCategoryAmbient".as_ptr()) };
    if ambient.is_null() {
        return Ok(());
    }
    // Ambient and mixing: other apps' music keeps playing.
    let category: &AnyObject = unsafe { &**(ambient as *const *const AnyObject) };
    let set: Result<(), Retained<NSError>> = unsafe { msg_send![session, setCategory: category, withOptions: MIX_WITH_OTHERS, error: _] };
    set?;
    unsafe { msg_send![session, setActive: true, error: _] }
}

/// Start watching the buttons. Call once, at start.
pub fn start(app: &AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| {
        unsafe { dlopen(MEDIA_PLAYER.as_ptr(), RTLD_NOW) };
        let (Some(session), Some(view_class)) = (session(), AnyClass::get(c"MPVolumeView")) else { return };
        if let Err(e) = activate(&session) {
            eprintln!("volume buttons: {e:?}");
            return;
        }

        // Off screen, yet in the window: that is what keeps the system's volume bubble away.
        let frame = CGRect::new(CGPoint::new(-1000.0, -1000.0), CGSize::new(1.0, 1.0));
        let blank: Allocated<AnyObject> = unsafe { msg_send![view_class, alloc] };
        let view: Retained<AnyObject> = unsafe { msg_send![blank, initWithFrame: frame] };
        let host = webview.inner() as *const AnyObject;
        let _: () = unsafe { msg_send![&*host, addSubview: &*view] };
        VOLUME_VIEW.set(Some(view));

        let watch: Retained<VolumeWatch> = unsafe { msg_send![VolumeWatch::alloc(), init] };
        let key = NSString::from_str("outputVolume");
        let _: () = unsafe {
            msg_send![&*session, addObserver: &*watch, forKeyPath: &*key, options: KVO_NEW, context: std::ptr::null_mut::<c_void>()]
        };
        // Watched for as long as Lobby runs.
        std::mem::forget(watch);
        rebase();
    });
}

/// Lobby is in front again: the volume may have changed meanwhile.
pub fn resumed(app: &AppHandle) {
    *SETTLE_UNTIL.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now() + SETTLE);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SETTLE);
        let _ = app.run_on_main_thread(|| {
            if let Some(session) = session() {
                let _ = activate(&session);
            }
            rebase();
        });
    });
}
