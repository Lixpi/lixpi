// The window's native WKWebView, and the rendering preference the app changes
// on it. Both are only reachable through the Objective-C runtime.
#![expect(
    unsafe_code,
    reason = "WebKit's native view and feature flags are only reachable through the Objective-C runtime"
)]

use objc2::{
    class,
    msg_send,
    runtime::{
        AnyObject,
        Bool,
    },
    sel,
};
use objc2_foundation::NSString;
use tauri::webview::PlatformWebview;

// WebKit runs `requestAnimationFrame`, and with it every canvas animation, pan
// and zoom, near 60 frames a second by default, even on a 120 Hz display where
// Chrome runs at 120. Safari exposes the same switch as the "Prefer Page
// Rendering Updates near 60fps" feature flag.
const NEAR_60_FPS_FEATURE: &str = "PreferPageRenderingUpdatesNear60FPSEnabled";

pub(crate) fn native_web_view(webview: &PlatformWebview) -> Result<*mut AnyObject, String> {
    let native = webview
        .downcast_ref::<tauri_runtime_wry::Webview>()
        .ok_or("the window does not use the WebKit runtime")?;
    let wk_web_view = native.inner().cast::<AnyObject>().cast_mut();
    if wk_web_view.is_null() {
        return Err(String::from("the window has no web view"));
    }

    Ok(wk_web_view)
}

// Lets the page render at the display's refresh rate. WebKit lists its feature
// flags through `+[WKPreferences _features]`; the app looks the flag up by key
// and leaves everything unchanged when this WebKit doesn't have it.
pub(crate) fn render_at_display_rate(wk_web_view: *mut AnyObject) -> Result<(), String> {
    let preferences_class = class!(WKPreferences);
    // SAFETY: `respondsToSelector:` is NSObject API on a valid class object.
    let lists_features: bool = unsafe { msg_send![preferences_class, respondsToSelector: sel!(_features)] };
    if !lists_features {
        return Err(String::from("this WebKit has no feature flag interface"));
    }

    // SAFETY: The class responds to `_features`, which returns an NSArray of
    // _WKFeature objects that lives at least as long as this call.
    let features: *mut AnyObject = unsafe { msg_send![preferences_class, _features] };
    // SAFETY: `features` is the NSArray returned above.
    let count: usize = unsafe { msg_send![features, count] };
    // SAFETY: `wk_web_view` is the window's live WKWebView on the main thread.
    let configuration: *mut AnyObject = unsafe { msg_send![wk_web_view, configuration] };
    // SAFETY: `configuration` is the web view's WKWebViewConfiguration, whose
    // preferences object is the one the live view reads.
    let preferences: *mut AnyObject = unsafe { msg_send![configuration, preferences] };

    for index in 0..count {
        // SAFETY: `index` is within the array's count.
        let feature: *mut AnyObject = unsafe { msg_send![features, objectAtIndex: index] };
        // SAFETY: Every _WKFeature answers `key` with an NSString.
        let key: *mut NSString = unsafe { msg_send![feature, key] };
        // SAFETY: The pointer is null or the live NSString returned above.
        let is_near_60_fps = unsafe { key.as_ref() }.is_some_and(|key| key.to_string() == NEAR_60_FPS_FEATURE);
        if is_near_60_fps {
            // SAFETY: `preferences` is a live WKPreferences and `feature` one of
            // its own features.
            let () = unsafe { msg_send![preferences, _setEnabled: Bool::NO, forFeature: feature] };

            return Ok(());
        }
    }

    Err(format!("this WebKit has no {NEAR_60_FPS_FEATURE} feature"))
}
