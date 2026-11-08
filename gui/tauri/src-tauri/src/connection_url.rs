// The rule for the two URLs the app connects to. build.rs includes this file
// too, so a URL the build accepts is one the running app can open.

pub(crate) const WEB_UI_VARIABLE: &str = "LIXPI_WEB_UI_URL";
pub(crate) const API_VARIABLE: &str = "LIXPI_API_URL";

pub(crate) fn check(
    name: &str,
    value: &str,
) -> Result<(), String> {
    if value.starts_with("https://") || value.starts_with("http://") {
        return Ok(());
    }

    Err(format!("{name} must be an http or https URL, found {value:?}"))
}

#[cfg(test)]
mod tests {
    use super::check;

    #[test]
    fn accepts_http_and_https_urls() {
        assert_eq!(check("NAME", "https://lixpi.ai"), Ok(()));
        assert_eq!(check("NAME", "http://localhost:3001"), Ok(()));
    }

    #[test]
    fn rejects_other_values_and_names_the_variable() {
        for value in ["", "localhost:3443", "tauri://localhost", "ftp://lixpi.ai"] {
            let error = check("LIXPI_WEB_UI_URL", value).err().unwrap_or_default();

            assert!(error.starts_with("LIXPI_WEB_UI_URL must be an http or https URL"), "{value:?}: {error}");
        }
    }
}
