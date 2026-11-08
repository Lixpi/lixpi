// Prepares the window's WebKit view before web-ui loads: the view animates at
// the display's own refresh rate, and a local build trusts the local stack's
// certificate authority. Both have to be in place before the first request.

#[cfg(target_os = "macos")]
pub(crate) mod macos;

use tauri::{
    Url,
    WebviewWindow,
};

pub(crate) fn open(
    window: &WebviewWindow,
    url: Url,
) -> tauri::Result<()> {
    // The runtime runs these in order on the main thread. The closure must not
    // call back into the runtime itself: during setup the runtime runs it
    // synchronously, and a nested call would wait on itself.
    #[cfg(target_os = "macos")]
    window.with_webview(|webview| {
        let wk_web_view = match macos::native_web_view(&webview) {
            Ok(wk_web_view) => wk_web_view,
            Err(error) => {
                eprintln!("Could not prepare the web view: {error}");

                return;
            },
        };
        if let Err(error) = macos::render_at_display_rate(wk_web_view) {
            eprintln!("Page animation stays near 60 frames per second: {error}");
        }

        crate::local_trust::install(wk_web_view);
    })?;

    window.navigate(url)
}
