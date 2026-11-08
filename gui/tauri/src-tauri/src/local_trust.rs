// A local development stack serves HTTPS with certificates from its own
// certificate authority. A local build embeds that authority, and the app
// trusts it for `localhost` itself, so the developer's Mac doesn't need the
// authority installed in its keychain. Builds for any other environment embed
// nothing and leave every certificate to the system.

#[cfg(target_os = "macos")]
mod macos;

use tauri::{
    Url,
    WebviewWindow,
};

// build.rs writes the authority here in DER form, or an empty file when the
// build has none. Only the macOS web view consults it.
#[cfg(target_os = "macos")]
const LOCAL_CA: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/local-ca.der"));

// The local authority issues certificates for `localhost` only.
#[cfg(any(target_os = "macos", test))]
const LOCAL_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "::1"];

// Opens `url` in the window once the app is ready to answer WebKit's
// certificate checks, so the first request to the local stack is already
// covered.
pub(crate) fn open(
    window: &WebviewWindow,
    url: Url,
) -> tauri::Result<()> {
    // The runtime runs these in order on the main thread. The installer must
    // not call back into the runtime itself: during setup the runtime runs it
    // synchronously, and a nested call would wait on itself.
    #[cfg(target_os = "macos")]
    if !LOCAL_CA.is_empty() {
        window.with_webview(|webview| {
            if let Err(error) = macos::install(&webview) {
                eprintln!("Could not trust the local certificate authority: {error}");
            }
        })?;
    }

    window.navigate(url)
}

// The embedded authority's certificate, when it may vouch for `host`.
#[cfg(target_os = "macos")]
fn anchor_for(host: &str) -> Option<&'static [u8]> {
    anchor(host, LOCAL_CA)
}

#[cfg(any(target_os = "macos", test))]
fn anchor<'a>(
    host: &str,
    authority: &'a [u8],
) -> Option<&'a [u8]> {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if authority.is_empty() || !LOCAL_HOSTS.contains(&host) {
        return None;
    }

    Some(authority)
}

#[cfg(test)]
mod tests {
    use super::anchor;

    const AUTHORITY: &[u8] = b"local authority";

    #[test]
    fn vouches_only_for_local_hosts() {
        for host in ["localhost", "127.0.0.1", "::1", "[::1]"] {
            assert_eq!(anchor(host, AUTHORITY), Some(AUTHORITY), "{host}");
        }

        for host in ["lixpi.ai", "localhost.lixpi.ai", "dev.lixpi.dev", "127.0.0.2", ""] {
            assert_eq!(anchor(host, AUTHORITY), None, "{host}");
        }
    }

    #[test]
    fn a_build_without_an_authority_vouches_for_nothing() {
        assert_eq!(anchor("localhost", b""), None);
    }
}
