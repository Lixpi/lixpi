// The app loads web-ui from its real origin, so the origins come from the
// environment file the build was started with. Checking them here turns a
// missing or malformed value into a clear build error instead of a window
// that opens on nothing.
//
// A local build also embeds the stack's certificate authority, which
// LIXPI_LOCAL_CA_DER names. Every other build embeds an empty file.

use std::{
    env,
    fs,
    path::PathBuf,
    process::ExitCode,
};

#[path = "src/connection_url.rs"]
mod connection_url;

use connection_url::{
    API_VARIABLE,
    WEB_UI_VARIABLE,
};

const LOCAL_CA_VARIABLE: &str = "LIXPI_LOCAL_CA_DER";

fn main() -> ExitCode {
    for name in [WEB_UI_VARIABLE, API_VARIABLE] {
        println!("cargo:rerun-if-env-changed={name}");

        let checked = env::var(name)
            .map_err(|_| format!("{name} must be set to the URL the desktop app connects to"))
            .and_then(|value| connection_url::check(name, &value));
        if let Err(error) = checked {
            eprintln!("{error}");

            return ExitCode::FAILURE;
        }
    }

    if let Err(error) = embed_local_ca() {
        eprintln!("{error}");

        return ExitCode::FAILURE;
    }

    tauri_build::build();

    ExitCode::SUCCESS
}

fn embed_local_ca() -> Result<(), String> {
    println!("cargo:rerun-if-env-changed={LOCAL_CA_VARIABLE}");

    let authority = match env::var(LOCAL_CA_VARIABLE) {
        Ok(path) => {
            println!("cargo:rerun-if-changed={path}");

            fs::read(&path).map_err(|error| format!("read {LOCAL_CA_VARIABLE} ({path}): {error}"))?
        },
        Err(_) => Vec::new(),
    };
    let output = env::var("OUT_DIR").map_err(|error| format!("read OUT_DIR: {error}"))?;

    fs::write(PathBuf::from(output).join("local-ca.der"), authority).map_err(|error| format!("write the embedded certificate authority: {error}"))
}
