mod app_menu;
mod connection_url;
#[cfg(feature = "diagnostics")]
mod diagnostics;
mod downloads;
mod hot_reload;
mod keyboard;
#[cfg(target_os = "macos")]
mod local_trust;
mod origins;
mod startup_navigation;
#[cfg(target_os = "macos")]
mod storage;
mod title_bar;
mod window_commands;

use std::sync::Arc;

use origins::{
    NavigationAction,
    NewWindowAction,
    Origins,
};
use startup_navigation::StartupNavigation;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{
    AppHandle,
    WebviewUrl,
    WebviewWindowBuilder,
    WindowEvent,
    webview::{
        NewWindowResponse,
        PageLoadEvent,
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
    let context = tauri::generate_context!();
    #[cfg(all(feature = "diagnostics", target_os = "macos"))]
    let native_startup = diagnostics::NativeStartup::new(&context.config().identifier);
    #[cfg(all(feature = "diagnostics", target_os = "macos"))]
    native_startup.record("entered the desktop app");

    let builder = runtime_builder()?;
    #[cfg(all(feature = "diagnostics", target_os = "macos"))]
    native_startup.record("initializing Chromium and Tauri");

    #[cfg(all(feature = "diagnostics", target_os = "macos"))]
    let setup_startup = native_startup.clone();
    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .menu(app_menu::build)
        .setup(move |app| {
            #[cfg(all(feature = "diagnostics", target_os = "macos"))]
            setup_startup.record("AppKit started Tauri setup");

            let origins = Origins::from_build()?;
            let web_ui = origins.web_ui.clone();
            app.on_menu_event(move |app, event| window_commands::run_menu_item(app, event.id().as_ref(), &web_ui));
            title_bar::allow_window_dragging(app.handle(), &origins.web_ui)?;

            open_main_window(app.handle(), origins)?;

            Ok(())
        })
        .build(context)?;
    #[cfg(all(feature = "diagnostics", target_os = "macos"))]
    native_startup.record("Chromium and Tauri initialized, entering the AppKit event loop");

    app.run(|_, _| {});

    Ok(())
}

#[cfg(target_os = "macos")]
fn runtime_builder() -> tauri::Result<tauri::Builder> {
    let runtime = storage::configure(
        tauri_runtime_cef::Cef::default()
            .sandbox(tauri_runtime_cef::SandboxPolicy::Required)
            .certificate_errors(tauri_runtime_cef::CertificateErrorPolicy::Cancel),
    )?;

    Ok(tauri::Builder::default().runtime(local_trust::configure(runtime)))
}

#[cfg(not(target_os = "macos"))]
fn runtime_builder() -> tauri::Result<tauri::Builder> {
    Err(std::io::Error::other("The Lixpi desktop application currently supports macOS only").into())
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
    let startup = Arc::new(StartupNavigation::default());
    let loaded_startup = Arc::clone(&startup);
    let startup_web_ui = web_ui.clone();
    // CEF defers the builder URL until its document-start scripts are ready.
    // Wait for that blank load and verified trust before opening web-ui.
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
        .on_download(|webview, event| downloads::handle(&webview, event));
    let builder = match hot_reload::initialization_script() {
        Some(script) => builder.initialization_script(script),
        None => builder,
    };
    // web-ui draws the title bar row, and the traffic lights sit over it.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(title_bar::TRAFFIC_LIGHTS)
        .initialization_script(title_bar::initialization_script());

    #[cfg(feature = "diagnostics")]
    let diagnostics = diagnostics::Diagnostics::new(app);
    #[cfg(feature = "diagnostics")]
    let page_loads = Arc::clone(&diagnostics);
    #[cfg(feature = "diagnostics")]
    let builder = diagnostics::INITIALIZATION_SCRIPTS
        .iter()
        .fold(builder, |builder, &script| builder.initialization_script(script));
    let builder = builder.on_page_load(move |window, payload| {
        if matches!(payload.event(), PageLoadEvent::Finished) {
            if loaded_startup.page_finished(payload.url()) {
                #[cfg(feature = "diagnostics")]
                page_loads.record("startup placeholder finished, scheduling Web UI navigation");

                if let Err(error) = startup_navigation::schedule(window.clone(), startup_web_ui.clone()) {
                    #[cfg(feature = "diagnostics")]
                    page_loads.record(&format!("Could not schedule Web UI navigation after Chromium startup: {error}"));
                    #[cfg(not(feature = "diagnostics"))]
                    eprintln!("Could not schedule Web UI navigation after Chromium startup: {error}");
                }
            }

            title_bar::reflect_fullscreen_after_page_load(window);
        }

        #[cfg(feature = "diagnostics")]
        page_loads.page_load(&payload);
    });
    let window = builder.build()?;
    #[cfg(feature = "diagnostics")]
    diagnostics.record("Chromium window created");

    let resized_window = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Resized(_)) {
            title_bar::reflect_fullscreen(&resized_window);
        }
    });

    #[cfg(target_os = "macos")]
    keyboard::install(window.clone());

    #[cfg(target_os = "macos")]
    {
        let trust = local_trust::verify(&window);
        #[cfg(feature = "diagnostics")]
        record_startup(&diagnostics, &trust);

        trust?;
    }

    #[cfg(all(feature = "diagnostics", target_os = "macos"))]
    Arc::clone(&diagnostics).watch(window.clone());

    if startup.trust_verified() {
        #[cfg(feature = "diagnostics")]
        diagnostics.record("startup trust verified after the placeholder, scheduling Web UI navigation");

        startup_navigation::schedule(window, web_ui)?;
    }

    Ok(())
}

// Records the runtime, storage and trust state a diagnostics build starts with.
#[cfg(all(feature = "diagnostics", target_os = "macos"))]
fn record_startup(
    diagnostics: &diagnostics::Diagnostics,
    trust: &tauri::Result<()>,
) {
    let version = tauri_runtime_cef::webview_version().unwrap_or_else(|error| format!("version unavailable: {error}"));
    diagnostics.record(&format!(
        "runtime Chromium {version}; native profiling enabled={}",
        cfg!(feature = "profiling")
    ));
    diagnostics.record("encrypted browser storage: Lixpi Safe Storage system keychain; cef-protected profile");

    match trust {
        Ok(()) if local_trust::has_authority() => {
            diagnostics.record("development CA preference verified: localhost subtree, 127.0.0.1/32, ::1/128; normal TLS validation enabled");
        },
        Ok(()) => diagnostics.record("development CA preference verified: no embedded authority; normal TLS validation enabled"),
        Err(error) => diagnostics.record(&format!("Chromium trust initialization failed: {error}")),
    }
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
