mod app_menu;
mod connection_url;
#[cfg(feature = "diagnostics")]
mod diagnostics;
mod downloads;
mod hot_reload;
mod keyboard;
mod local_trust;
mod origins;
mod webkit;
mod window_commands;

use origins::{
    NavigationAction,
    NewWindowAction,
    Origins,
};
use tauri::{
    AppHandle,
    WebviewUrl,
    WebviewWindowBuilder,
    webview::{
        DownloadEvent,
        NewWindowResponse,
    },
};
use tauri_plugin_opener::OpenerExt;

pub(crate) const MAIN_WINDOW: &str = "main";

const TITLE: &str = "Lixpi";

/// Starts the desktop app and returns when its last window closes.
///
/// # Errors
///
/// Returns the error that stopped the app from starting or running, such as a
/// window that could not be created.
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry {})
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .menu(app_menu::build)
        .setup(|app| {
            let origins = Origins::from_build()?;
            let web_ui = origins.web_ui.clone();
            app.on_menu_event(move |app, event| window_commands::run_menu_item(app, event.id().as_ref(), &web_ui));

            open_main_window(app.handle(), origins)?;

            Ok(())
        })
        .run(tauri::generate_context!())
}

// The window shows web-ui from the same origin a browser uses. Sign-in,
// NATS and the API all check that origin, so the app works with every
// environment exactly as the browser does, without a copy of web-ui inside it.
fn open_main_window(
    app: &AppHandle,
    origins: Origins,
) -> tauri::Result<()> {
    let navigation_app = app.clone();
    let navigation_origins = origins.clone();
    let new_window_app = app.clone();

    let web_ui = origins.web_ui.clone();
    let blank = tauri::Url::parse("about:blank").map_err(tauri::Error::InvalidUrl)?;
    // The window starts blank and opens web-ui once it can answer certificate
    // checks for the local stack.
    let builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::External(blank))
        .title(window_title(""))
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 700.0)
        .zoom_hotkeys_enabled(true)
        .on_document_title_changed(|window, title| {
            if let Err(error) = window.set_title(&window_title(&title)) {
                eprintln!("Could not set the window title: {error}");
            }
        })
        .on_navigation(move |url| match navigation_origins.navigation(url) {
            NavigationAction::Allow => true,
            NavigationAction::Download => {
                downloads::start(&navigation_app, url);

                false
            },
        })
        .on_new_window(move |url, _features| {
            match origins.new_window(&url) {
                NewWindowAction::Download => downloads::start(&new_window_app, &url),
                NewWindowAction::OpenInBrowser => {
                    if let Err(error) = new_window_app.opener().open_url(url.as_str(), None::<String>) {
                        eprintln!("Could not open {} in the default browser: {error}", origins::without_query(&url));
                    }
                },
                NewWindowAction::Ignore => {},
            }

            NewWindowResponse::Deny
        })
        // WebKit saves each download to the Downloads folder under a name
        // that doesn't overwrite an existing file.
        .on_download(|_, event| {
            if let DownloadEvent::Finished {
                url,
                success: false,
                ..
            } = event
            {
                eprintln!("Download failed: {}", origins::without_query(&url));
            }

            true
        });
    let builder = match hot_reload::initialization_script() {
        Some(script) => builder.initialization_script(script),
        None => builder,
    };

    #[cfg(feature = "diagnostics")]
    let diagnostics = diagnostics::Diagnostics::new(app);
    #[cfg(feature = "diagnostics")]
    let builder = {
        let page_loads = std::sync::Arc::clone(&diagnostics);

        builder
            .initialization_script(diagnostics::CAPTURE_SCRIPT)
            .on_page_load(move |_, payload| page_loads.page_load(&payload))
    };
    let window = builder.build()?;

    #[cfg(feature = "diagnostics")]
    diagnostics.watch(window.clone());

    #[cfg(target_os = "macos")]
    keyboard::install(window.clone());

    webkit::open(&window, web_ui)
}

fn window_title(document_title: &str) -> String {
    let title = if document_title.is_empty() { TITLE } else { document_title };

    title.to_owned()
}

#[cfg(test)]
mod tests {
    use super::window_title;

    #[test]
    fn titles_the_window_after_the_page() {
        assert_eq!(window_title("Workspace"), "Workspace");
        assert_eq!(window_title(""), "Lixpi");
    }
}
