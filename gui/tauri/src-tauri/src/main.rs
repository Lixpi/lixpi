use std::process::ExitCode;

#[cfg_attr(target_os = "macos", tauri_runtime_cef::cef_entry_point)]
fn main() -> ExitCode {
    match lixpi_desktop::run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("The Lixpi desktop app stopped: {error}");

            ExitCode::FAILURE
        },
    }
}
