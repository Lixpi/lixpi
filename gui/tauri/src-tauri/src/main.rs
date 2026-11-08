use std::process::ExitCode;

fn main() -> ExitCode {
    match lixpi_desktop::run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("The Lixpi desktop app stopped: {error}");

            ExitCode::FAILURE
        },
    }
}
