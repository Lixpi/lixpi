use tauri::{
    AppHandle,
    Manager,
    Url,
};

use crate::{
    MAIN_WINDOW,
    origins,
};

// Runs inside the web-ui page, which the API's CORS policy already admits.
// Fetching the file and clicking a `download` link hands it to WebKit's
// download handling, so the file lands in the Downloads folder while the
// workspace stays open. The API exposes `Content-Disposition`, which carries
// the original file name.
const DOWNLOAD_SCRIPT: &str = r#"
(async (url) => {
  const fileName = (response) => {
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)

    if (encoded)
      return decodeURIComponent(encoded[1])

    const plain = disposition.match(/filename="?([^";]+)"?/i)

    if (plain)
      return plain[1]

    return new URL(response.url).pathname.split('/').filter(Boolean).pop() || 'download'
  }

  try {
    const response = await fetch(url)

    if (!response.ok)
      throw new Error(`The server answered ${response.status}`)

    const objectUrl = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = fileName(response)
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
  } catch (error) {
    console.error('Lixpi desktop download failed:', error instanceof Error ? error.message : error)
  }
})(__LIXPI_DOWNLOAD_URL__)
"#;

const URL_PLACEHOLDER: &str = "__LIXPI_DOWNLOAD_URL__";

pub(crate) fn start(
    app: &AppHandle,
    url: &Url,
) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    if let Err(error) = window.eval(script(url)) {
        eprintln!("Could not start the download of {}: {error}", origins::without_query(url));
    }
}

// The URL enters the script as a JSON string literal, so nothing in it can
// close the string or run as code.
fn script(url: &Url) -> String {
    DOWNLOAD_SCRIPT.replace(URL_PLACEHOLDER, &serde_json::Value::String(url.to_string()).to_string())
}

#[cfg(test)]
mod tests {
    use tauri::Url;

    use super::{
        URL_PLACEHOLDER,
        script,
    };

    #[test]
    fn passes_the_url_to_the_script_as_a_string_literal() {
        let url = Url::parse("https://localhost:3445/api/assets/1?token=a.b&name=x%22").unwrap_or_else(|error| panic!("{error}"));
        let source = script(&url);

        assert!(!source.contains(URL_PLACEHOLDER));
        assert!(
            source
                .trim_end()
                .ends_with(r#"})("https://localhost:3445/api/assets/1?token=a.b&name=x%22")"#),
            "{source}"
        );
    }

    #[test]
    fn escapes_characters_that_would_end_the_literal() {
        let url = Url::parse(r#"https://localhost:3445/a?q=x\"y"#).unwrap_or_else(|error| panic!("{error}"));
        let source = script(&url);

        assert!(source.contains(r#"("https://localhost:3445/a?q=x\\%22y")"#), "{source}");
    }
}
