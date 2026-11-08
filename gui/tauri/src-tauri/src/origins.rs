use tauri::Url;

use crate::connection_url::{
    self,
    API_VARIABLE,
    WEB_UI_VARIABLE,
};

// Both URLs are fixed when the app is built, from the environment file the
// build used. build.rs refuses to build without them.
const WEB_UI_URL: &str = env!("LIXPI_WEB_UI_URL");
const API_URL: &str = env!("LIXPI_API_URL");

// What the window does with a navigation inside web-ui.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NavigationAction {
    Allow,
    Download,
}

// What the window does when web-ui asks for a new window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NewWindowAction {
    Download,
    OpenInBrowser,
    Ignore,
}

#[derive(Debug, Clone)]
pub(crate) struct Origins {
    pub(crate) web_ui: Url,
    api: Url,
}

impl Origins {
    pub(crate) fn from_build() -> Result<Self, String> {
        Self::new(WEB_UI_URL, API_URL)
    }

    fn new(
        web_ui: &str,
        api: &str,
    ) -> Result<Self, String> {
        Ok(Self {
            web_ui: parse(WEB_UI_VARIABLE, web_ui)?,
            api: parse(API_VARIABLE, api)?,
        })
    }

    // WebKit shows an image even when the API marks it as an attachment, so a
    // media download would replace the workspace with the bare image. The API
    // answers `download=true` with `Content-Disposition: attachment`, so those
    // navigations become downloads instead.
    pub(crate) fn navigation(
        &self,
        url: &Url,
    ) -> NavigationAction {
        let download = url.query_pairs().any(|(key, value)| key == "download" && value == "true");
        if self.is_api(url) && download {
            return NavigationAction::Download;
        }

        NavigationAction::Allow
    }

    // A desktop app has no tabs. API links such as the workspace export are
    // saved as downloads, and every other web link opens in the default
    // browser.
    pub(crate) fn new_window(
        &self,
        url: &Url,
    ) -> NewWindowAction {
        if self.is_api(url) {
            return NewWindowAction::Download;
        }

        if matches!(url.scheme(), "http" | "https") {
            return NewWindowAction::OpenInBrowser;
        }

        NewWindowAction::Ignore
    }

    fn is_api(
        &self,
        url: &Url,
    ) -> bool {
        url.origin() == self.api.origin()
    }
}

// API URLs carry the user's access token in the query, so anything logged
// keeps only the origin and path.
pub(crate) fn without_query(url: &Url) -> String {
    format!("{}{}", url.origin().ascii_serialization(), url.path())
}

fn parse(
    name: &str,
    value: &str,
) -> Result<Url, String> {
    connection_url::check(name, value)?;

    Url::parse(value).map_err(|error| format!("{name} is not a valid URL ({value}): {error}"))
}

#[cfg(test)]
mod tests {
    use tauri::Url;

    use super::{
        NavigationAction,
        NewWindowAction,
        Origins,
        without_query,
    };

    fn origins() -> Origins {
        Origins::new("https://localhost:3443", "https://localhost:3445").unwrap_or_else(|error| panic!("{error}"))
    }

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap_or_else(|error| panic!("{value}: {error}"))
    }

    #[test]
    fn builds_from_http_and_https_urls() {
        let origins = origins();

        assert_eq!(origins.web_ui.as_str(), "https://localhost:3443/");
        assert!(Origins::new("http://localhost:3001", "http://localhost:3005").is_ok());
    }

    #[test]
    fn rejects_urls_the_window_cannot_open() {
        let scheme = Origins::new("tauri://localhost", "https://localhost:3445").err().unwrap_or_default();
        let api = Origins::new("https://localhost:3443", "https://").err().unwrap_or_default();

        assert!(scheme.starts_with("LIXPI_WEB_UI_URL must be an http or https URL"), "{scheme}");
        assert!(api.starts_with("LIXPI_API_URL is not a valid URL"), "{api}");
    }

    #[test]
    fn only_api_downloads_leave_the_navigation_to_the_download_handler() {
        let origins = origins();

        for (value, expected) in [
            (
                "https://localhost:3445/api/assets/1/original?token=secret&download=true",
                NavigationAction::Download,
            ),
            ("https://localhost:3445/api/assets/1/original?token=secret", NavigationAction::Allow),
            ("https://localhost:3445/api/assets/1/original?download=false", NavigationAction::Allow),
            ("https://localhost:3443/workspace?download=true", NavigationAction::Allow),
            ("https://localhost:3000/authorize?download=true", NavigationAction::Allow),
            ("http://localhost:3445/api/assets/1?download=true", NavigationAction::Allow),
        ] {
            assert_eq!(origins.navigation(&url(value)), expected, "{value}");
        }
    }

    #[test]
    fn new_windows_become_downloads_or_open_in_the_browser() {
        let origins = origins();

        for (value, expected) in [
            ("https://localhost:3445/api/workspaces/1/export?token=secret", NewWindowAction::Download),
            ("https://localhost:3444/?auth=continue", NewWindowAction::OpenInBrowser),
            ("http://example.com/docs", NewWindowAction::OpenInBrowser),
            ("mailto:support@lixpi.ai", NewWindowAction::Ignore),
            ("about:blank", NewWindowAction::Ignore),
        ] {
            assert_eq!(origins.new_window(&url(value)), expected, "{value}");
        }
    }

    #[test]
    fn logged_urls_drop_the_query_and_fragment() {
        assert_eq!(
            without_query(&url("https://localhost:3445/api/assets/1?token=secret&download=true#part")),
            "https://localhost:3445/api/assets/1",
        );
    }
}
