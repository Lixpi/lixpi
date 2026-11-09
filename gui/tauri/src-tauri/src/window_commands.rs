// The commands a browser gives every page and a bare web view doesn't:
// reloading the page and showing the WebKit inspector. The app menu runs them
// by their shortcuts, and on macOS F12 toggles the inspector too.

use tauri::{
    AppHandle,
    Manager,
    Url,
    WebviewWindow,
};

use crate::MAIN_WINDOW;

pub(crate) const RELOAD: &str = "reload";
pub(crate) const DEVELOPER_TOOLS: &str = "developer-tools";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Command {
    Reload,
    ToggleDeveloperTools,
}

impl Command {
    fn from_menu_id(id: &str) -> Option<Self> {
        match id {
            RELOAD => Some(Self::Reload),
            DEVELOPER_TOOLS => Some(Self::ToggleDeveloperTools),
            _ => None,
        }
    }
}

// What reloading does with the page the window currently shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReloadAction {
    Reload,
    OpenWebUi,
}

// Runs the command behind an app menu item. Items the app doesn't own, such
// as Copy or Quit, are handled by the system and ignored here.
pub(crate) fn run_menu_item(
    app: &AppHandle,
    id: &str,
    web_ui: &Url,
) {
    let Some(command) = Command::from_menu_id(id) else {
        return;
    };

    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    match command {
        Command::Reload => reload(&window, web_ui),
        Command::ToggleDeveloperTools => toggle_developer_tools(&window),
    }
}

pub(crate) fn toggle_developer_tools(window: &WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

fn reload(
    window: &WebviewWindow,
    web_ui: &Url,
) {
    let action = window.url().map_or(ReloadAction::Reload, |current| reload_action(&current));
    let reloaded = match action {
        ReloadAction::Reload => window.reload(),
        ReloadAction::OpenWebUi => window.navigate(web_ui.clone()),
    };
    if let Err(error) = reloaded {
        eprintln!("Could not reload the page: {error}");
    }
}

// The window starts on a blank page and can still be on it when the first
// load of web-ui failed, for example because the stack wasn't running.
// Reloading the blank page would show nothing, so it opens web-ui instead.
fn reload_action(current: &Url) -> ReloadAction {
    if current.scheme() == "about" {
        return ReloadAction::OpenWebUi;
    }

    ReloadAction::Reload
}

#[cfg(test)]
mod tests {
    use tauri::Url;

    use super::{
        Command,
        DEVELOPER_TOOLS,
        RELOAD,
        ReloadAction,
        reload_action,
    };

    #[test]
    fn only_the_apps_own_menu_items_run_a_command() {
        assert_eq!(Command::from_menu_id(RELOAD), Some(Command::Reload));
        assert_eq!(Command::from_menu_id(DEVELOPER_TOOLS), Some(Command::ToggleDeveloperTools));

        for id in ["", "quit", "copy", "__tauri_window_menu__"] {
            assert_eq!(Command::from_menu_id(id), None, "{id}");
        }
    }

    #[test]
    fn reloading_a_blank_window_opens_web_ui() {
        for url in ["about:blank", "about:srcdoc"] {
            assert_eq!(reload_action(&Url::parse(url).unwrap()), ReloadAction::OpenWebUi, "{url}");
        }
    }

    #[test]
    fn reloading_a_page_reloads_that_page() {
        for url in ["https://localhost:3443/", "https://localhost:3443/workspace/1?tab=2", "https://lixpi.ai/"] {
            assert_eq!(reload_action(&Url::parse(url).unwrap()), ReloadAction::Reload, "{url}");
        }
    }
}
