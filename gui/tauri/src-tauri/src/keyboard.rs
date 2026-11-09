// Browsers open their developer tools with F12 as well as the inspector
// shortcut. A menu item has room for one shortcut, which Developer Tools uses
// for Option-Command-I, so on macOS the app watches its own key presses for
// F12. Like a browser, it leaves F12 alone when a modifier key is held.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub(crate) use macos::install;

// The virtual key code macOS gives F12, `kVK_F12` in Carbon's Events.h.
#[cfg(any(target_os = "macos", test))]
const F12_KEY_CODE: u16 = 111;

#[cfg(any(target_os = "macos", test))]
fn toggles_developer_tools(
    key_code: u16,
    modifier_held: bool,
) -> bool {
    key_code == F12_KEY_CODE && !modifier_held
}

#[cfg(test)]
mod tests {
    use super::{
        F12_KEY_CODE,
        toggles_developer_tools,
    };

    #[test]
    fn f12_alone_toggles_the_developer_tools() {
        assert!(toggles_developer_tools(F12_KEY_CODE, false));
    }

    #[test]
    fn other_keys_and_modified_f12_reach_the_page() {
        assert!(!toggles_developer_tools(F12_KEY_CODE, true));

        // F11, F1 and I.
        for key_code in [103, 122, 34] {
            assert!(!toggles_developer_tools(key_code, false), "{key_code}");
        }
    }
}
