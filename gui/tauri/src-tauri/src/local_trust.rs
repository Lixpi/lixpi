// The development CA is private to Chromium's app profile. Both DNS and IP
// constraints are present so an omitted constraint cannot admit other hosts.
// Chromium still verifies certificate signatures, validity and hostnames.

use std::{
    io,
    sync::mpsc,
};

use base64::{
    Engine,
    engine::general_purpose::STANDARD,
};
use serde_json::{
    Value,
    json,
};
use tauri::WebviewWindow;
use tauri_runtime_cef::{
    Cef,
    WebviewCefExt,
    cef::{
        self,
        CefString,
        ImplBrowser,
        ImplBrowserHost,
        ImplPreferenceManager,
        ImplValue,
        JsonParserOptions,
    },
};

const PREFERENCE: &str = "certificates.ca_certificates_with_constraints";
const LOCAL_CA: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/local-ca.der"));

#[cfg(feature = "diagnostics")]
pub(crate) fn has_authority() -> bool {
    !LOCAL_CA.is_empty()
}

pub(crate) fn configure(runtime: Cef) -> Cef {
    // An empty array also clears a previous local build's persisted anchor
    // when this build connects to an environment with public certificates.
    runtime.profile_preference_value(PREFERENCE, constraints(LOCAL_CA))
}

fn constraints(authority: &[u8]) -> Value {
    if authority.is_empty() {
        return json!([]);
    }

    json!([{
        "certificate": STANDARD.encode(authority),
        "constraints": {
            "permitted_dns_names": ["localhost"],
            "permitted_cidrs": ["127.0.0.1/32", "::1/128"]
        }
    }])
}

// Called on the setup thread while the window is still about:blank. CEF runs
// with_webview synchronously there. Refuse navigation if its scheduling or
// profile contract changes, rather than starting with unverified trust.
pub(crate) fn verify(window: &WebviewWindow) -> tauri::Result<()> {
    let (sender, receiver) = mpsc::sync_channel(1);
    window.with_cef_webview(move |webview| {
        if sender.send(verify_profile(webview)).is_err() {
            eprintln!("The Chromium trust check completed after startup stopped");
        }
    })?;
    let result = receiver
        .try_recv()
        .map_err(|error| io::Error::other(format!("Chromium trust verification did not finish during setup: {error}")))?;

    result.map_err(|error| io::Error::other(format!("Could not configure Chromium's development CA: {error}")).into())
}

fn verify_profile(webview: &tauri_runtime_cef::Webview) -> Result<(), String> {
    let context = webview
        .browser()
        .host()
        .and_then(|host| host.request_context())
        .ok_or("the browser has no request context")?;
    let name = CefString::from(PREFERENCE);
    if context.has_preference(Some(&name)) == 0 {
        return Err(format!("{PREFERENCE} is not registered"));
    }

    if context.can_set_preference(Some(&name)) == 0 {
        return Err(format!("{PREFERENCE} is not writable"));
    }

    let encoded = CefString::from(constraints(LOCAL_CA).to_string().as_str());
    let mut expected = cef::parse_json(Some(&encoded), JsonParserOptions::RFC).ok_or("could not allocate the CA preference")?;
    // A real writable string is required by CEF's error out-parameter; a
    // default CefString represents a null pointer and makes every write fail.
    let mut error = CefString::from("");
    if context.set_preference(Some(&name), Some(&mut expected), Some(&mut error)) == 0 {
        return Err(format!("{PREFERENCE} was rejected: {error}"));
    }

    let actual = context.preference(Some(&name)).ok_or("could not read back the CA preference")?;
    if actual.is_equal(Some(&mut expected)) == 0 {
        return Err("the stored CA preference differs from this build's constrained authority".to_owned());
    }

    Ok(())
}
