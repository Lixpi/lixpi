// Watches the app's key presses for F12 through an AppKit local event monitor,
// which sees each key press in the app's windows before the page does.
#![expect(
    unsafe_code,
    reason = "AppKit's local event monitor and the events it passes are only reachable through unsafe bindings"
)]

use std::{
    cell::RefCell,
    ptr::{
        self,
        NonNull,
    },
    sync::mpsc,
    thread,
};

use block2::RcBlock;
use objc2::{
    rc::Retained,
    runtime::AnyObject,
};
use objc2_app_kit::{
    NSEvent,
    NSEventMask,
    NSEventModifierFlags,
};
use tauri::WebviewWindow;

use crate::window_commands;

thread_local! {
    // The monitor object AppKit returns identifies the monitor for as long as
    // it is installed. The app keeps it on the main thread for its whole life.
    static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

// Installs the F12 event monitor. Installation must run on the main thread.
pub(crate) fn install(window: WebviewWindow) {
    // The AppKit monitor runs outside winit's dispatch. Keep synchronous
    // DevTools queries off that callback, and process F12 presses in order.
    let (toggle, requests) = mpsc::channel::<()>();
    if let Err(error) = thread::Builder::new().name("lixpi-devtools".to_owned()).spawn(move || {
        for () in requests {
            window_commands::toggle_developer_tools(&window);
        }
    }) {
        eprintln!("F12 does not open the developer tools: could not start its worker: {error}");

        return;
    }

    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit passes a live NSEvent that stays valid for the call.
        let key_press = unsafe { event.as_ref() };
        let modifier_held = key_press
            .modifierFlags()
            .intersects(NSEventModifierFlags::Command | NSEventModifierFlags::Control | NSEventModifierFlags::Option | NSEventModifierFlags::Shift);
        if super::toggles_developer_tools(key_press.keyCode(), modifier_held) {
            if let Err(error) = toggle.send(()) {
                eprintln!("Could not schedule the F12 developer-tools command: {error}");
            }

            // A null event tells AppKit the key press was handled.
            return ptr::null_mut();
        }

        event.as_ptr()
    });
    // SAFETY: The handler returns either the event AppKit passed it or null,
    // which is what the monitor's contract requires.
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &handler) };

    match monitor {
        Some(monitor) => MONITOR.with(|slot| *slot.borrow_mut() = Some(monitor)),
        None => eprintln!("F12 does not open the developer tools: AppKit refused the key monitor"),
    }
}
