// Keep Lixpi's encrypted browser data separate from Chromium's shared key.

use std::io;

use tauri_runtime_cef::{
    Cef,
    SecretStorage,
    cef::CefString,
};

const KEYCHAIN_SERVICE: &str = "Lixpi Safe Storage";
const KEYCHAIN_ACCOUNT: &str = "com.lixpi.desktop";
const PROFILE_DIRECTORY: &str = "cef-protected";

pub(crate) fn configure(runtime: Cef) -> tauri::Result<Cef> {
    let cache =
        dirs::cache_dir().ok_or_else(|| io::Error::other("Could not find the macOS cache directory for Lixpi's protected browser profile"))?;

    Ok(runtime
        .secret_storage(SecretStorage::System)
        .root_cache_path(cache.join(KEYCHAIN_ACCOUNT).join(PROFILE_DIRECTORY))
        .with_settings(|settings| {
            settings.keychain_service_name = CefString::from(KEYCHAIN_SERVICE);
            settings.keychain_account_name = CefString::from(KEYCHAIN_ACCOUNT);
        }))
}
