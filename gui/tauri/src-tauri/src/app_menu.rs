// The app menu. It has the items Tauri's default menu has, and its View menu
// adds the browser's Reload and Developer Tools with the browser's shortcuts.
// The shortcuts are menu key equivalents, so they work while the page is busy
// or broken, and they don't depend on anything the page does with the keys.

use tauri::{
    AppHandle,
    DynRuntime,
    menu::{
        AboutMetadata,
        HELP_SUBMENU_ID,
        Menu,
        MenuItem,
        PredefinedMenuItem,
        Submenu,
        WINDOW_SUBMENU_ID,
    },
};

use crate::window_commands::{
    DEVELOPER_TOOLS,
    RELOAD,
};

const RELOAD_SHORTCUT: &str = "CmdOrCtrl+R";

// Safari and Chrome open their inspector with Option-Command-I on a Mac and
// Ctrl+Shift+I elsewhere. Plain Command-I stays with the page, where the
// editors use it for italic.
#[cfg(target_os = "macos")]
const DEVELOPER_TOOLS_SHORTCUT: &str = "Cmd+Alt+I";
#[cfg(not(target_os = "macos"))]
const DEVELOPER_TOOLS_SHORTCUT: &str = "Ctrl+Shift+I";

pub(crate) fn build(app: &AppHandle) -> tauri::Result<Menu<DynRuntime>> {
    let package = app.package_info();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        ..AboutMetadata::default()
    };

    #[cfg(target_os = "macos")]
    let application = Submenu::with_items(
        app,
        package.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, RELOAD, "Reload", true, Some(RELOAD_SHORTCUT))?,
            &MenuItem::with_id(app, DEVELOPER_TOOLS, "Developer Tools", true, Some(DEVELOPER_TOOLS_SHORTCUT))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    // Tauri gives the menus with these ids the system's window list and help
    // search.
    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let help = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app, None, Some(about))?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &application,
            &file,
            &edit,
            &view,
            &window,
            &help,
        ],
    )
}
