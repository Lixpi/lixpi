use std::{
    sync::atomic::{
        AtomicU8,
        Ordering,
    },
    thread,
};

use tauri::{
    Url,
    WebviewWindow,
};

const TRUST_VERIFIED: u8 = 1;
const BLANK_FINISHED: u8 = 2;

// The runtime can finish its deferred about:blank navigation before or after
// setup verifies trust. Only the second condition releases the real URL, and
// neither condition can release it again after both bits have been set.
#[derive(Default)]
pub(crate) struct StartupNavigation {
    ready: AtomicU8,
}

impl StartupNavigation {
    pub(crate) fn trust_verified(&self) -> bool {
        self.ready.fetch_or(TRUST_VERIFIED, Ordering::AcqRel) == BLANK_FINISHED
    }

    pub(crate) fn page_finished(
        &self,
        url: &Url,
    ) -> bool {
        url.scheme() == "about" && url.path() == "blank" && self.ready.fetch_or(BLANK_FINISHED, Ordering::AcqRel) == TRUST_VERIFIED
    }
}

// CEF may dispatch a load callback from inside the event-loop callback that
// services navigation. A worker forces Tauri to queue the operation instead
// of re-entering that callback and loading the URL before CEF has unwound.
pub(crate) fn schedule(
    window: WebviewWindow,
    web_ui: Url,
) -> tauri::Result<()> {
    thread::Builder::new().name("lixpi-startup-navigation".to_owned()).spawn(move || {
        if let Err(error) = window.navigate(web_ui) {
            eprintln!("Could not open the Web UI after Chromium startup: {error}");
        }
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use tauri::Url;

    use super::StartupNavigation;

    #[test]
    fn ignores_cef_internal_document_and_releases_web_ui_once_the_blank_finishes() {
        let startup = StartupNavigation::default();
        let internal = Url::parse("data:text/html;charset=utf-8,placeholder").unwrap();
        let blank = Url::parse("about:blank").unwrap();
        assert!(!startup.trust_verified());
        assert!(!startup.page_finished(&internal));
        assert!(startup.page_finished(&blank));
        assert!(!startup.page_finished(&blank));
        assert!(!startup.trust_verified());
    }

    #[test]
    fn releases_web_ui_once_when_verified_trust_finishes_second() {
        let startup = StartupNavigation::default();
        let blank = Url::parse("about:blank#initial").unwrap();
        assert!(!startup.page_finished(&blank));
        assert!(startup.trust_verified());
        assert!(!startup.trust_verified());
        assert!(!startup.page_finished(&blank));
    }
}
