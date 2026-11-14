// On macOS the window draws no title bar of its own. web-ui fills the whole
// window, the traffic lights float over its top-left corner, and the page draws
// the title bar row itself: a strip that drags the window and a backdrop that
// keeps the buttons readable over the content. The page learns the row's
// geometry from a script that runs before any page script, and the only native
// commands it may call are the two Tauri's drag region uses: dragging the
// window and zooming it on a double click.

#[cfg(any(target_os = "macos", test))]
use tauri::LogicalPosition;
use tauri::{
    AppHandle,
    Manager,
    Url,
    WebviewWindow,
    ipc::CapabilityBuilder,
};

use crate::MAIN_WINDOW;

const START_DRAGGING: &str = "core:window:allow-start-dragging";
const TOGGLE_MAXIMIZE: &str = "core:window:allow-internal-toggle-maximize";

// Height of the row the page draws at the top of the window.
#[cfg(any(target_os = "macos", test))]
const TITLE_BAR_HEIGHT: f64 = 40.0;

// AppKit draws the buttons' centres this much higher than the `y` they are
// placed at, so the position adds it back to line them up with the page's
// controls centred in the row.
#[cfg(any(target_os = "macos", test))]
const TRAFFIC_LIGHTS_RAISE: f64 = 1.5;

// The close button's left edge is at `x`, and the buttons are centred
// vertically in the row.
#[cfg(any(target_os = "macos", test))]
pub(crate) const TRAFFIC_LIGHTS: LogicalPosition<f64> = LogicalPosition {
    x: 16.0,
    y: TITLE_BAR_HEIGHT / 2.0 + TRAFFIC_LIGHTS_RAISE,
};

// How much of the row's left end the three buttons and the space after them
// cover. The buttons end about 76 points in, and the page's first control
// starts here, a clear gap to their right.
#[cfg(any(target_os = "macos", test))]
const CONTROLS_INSET: f64 = 96.0;

// Marks the page as drawing its own title bar and gives it the row's
// geometry. WebKit runs it once the document element exists, before any page
// script, so the first layout already leaves room for the buttons.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn initialization_script() -> String {
    format!(
        r"
(() => {{
  const root = document.documentElement
  if (!root)
    return

  root.dataset.titleBar = 'overlay'
  root.style.setProperty('--window-title-bar-height', '{TITLE_BAR_HEIGHT}px')
  root.style.setProperty('--window-controls-inset', '{CONTROLS_INSET}px')
}})()
"
    )
}

// Lets web-ui, and only web-ui in the main window, drag and zoom the window
// from its title bar row.
pub(crate) fn allow_window_dragging(
    app: &AppHandle,
    web_ui: &Url,
) -> tauri::Result<()> {
    let capability = CapabilityBuilder::new("window-title-bar")
        .remote(remote_pattern(web_ui))
        .local(false)
        .window(MAIN_WINDOW)
        .permission(START_DRAGGING)
        .permission(TOGGLE_MAXIMIZE);

    app.add_capability(capability)
}

fn remote_pattern(web_ui: &Url) -> String {
    format!("{}/*", web_ui.origin().ascii_serialization())
}

// In full screen macOS hides the traffic lights and slides its own title bar
// in on demand, so the page drops its row. The page can't ask the window, so
// the app tells it after each page load and each resize, which is how
// entering and leaving full screen arrive.
pub(crate) fn reflect_fullscreen(window: &WebviewWindow) {
    let fullscreen = match window.is_fullscreen() {
        Ok(fullscreen) => fullscreen,
        Err(error) => {
            eprintln!("Could not read whether the window is full screen: {error}");

            return;
        },
    };
    if let Err(error) = window.eval(fullscreen_script(fullscreen)) {
        eprintln!("Could not tell the page whether the window is full screen: {error}");
    }
}

fn fullscreen_script(fullscreen: bool) -> &'static str {
    if fullscreen {
        return "document.documentElement?.setAttribute('data-window-fullscreen', '')";
    }

    "document.documentElement?.removeAttribute('data-window-fullscreen')"
}

#[cfg(test)]
mod tests {
    use tauri::Url;

    use super::{
        TITLE_BAR_HEIGHT,
        TRAFFIC_LIGHTS,
        TRAFFIC_LIGHTS_RAISE,
        fullscreen_script,
        initialization_script,
        remote_pattern,
    };

    #[test]
    fn the_page_learns_the_row_geometry() {
        let script = initialization_script();

        for expected in [
            "titleBar = 'overlay'",
            "'--window-title-bar-height', '40px'",
            "'--window-controls-inset', '96px'",
        ] {
            assert!(script.contains(expected), "{expected}");
        }
    }

    #[test]
    fn the_traffic_lights_are_centred_in_the_row() {
        assert!((TRAFFIC_LIGHTS.y - TRAFFIC_LIGHTS_RAISE - TITLE_BAR_HEIGHT / 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn dragging_is_granted_to_the_web_ui_origin_only() {
        assert_eq!(
            remote_pattern(&Url::parse("https://localhost:3443/workspace/1?tab=2").unwrap()),
            "https://localhost:3443/*"
        );
        assert_eq!(remote_pattern(&Url::parse("https://lixpi.ai/").unwrap()), "https://lixpi.ai/*");
    }

    #[test]
    fn full_screen_sets_the_page_attribute_and_leaving_removes_it() {
        assert!(fullscreen_script(true).contains("setAttribute('data-window-fullscreen'"));
        assert!(fullscreen_script(false).contains("removeAttribute('data-window-fullscreen')"));
    }
}
