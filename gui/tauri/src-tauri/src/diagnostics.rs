// Diagnostics for a build made with the `diagnostics` feature. The page's
// console output, uncaught errors, unhandled promise rejections and blocked
// requests are captured from the moment each page starts, along with every
// page load. They go to stderr and to `diagnostics.log` in the app's log
// directory, because an app opened from Finder has no terminal. Access tokens
// are redacted before anything is written.

#[cfg(target_os = "macos")]
mod page_logs;
#[cfg(feature = "profiling")]
mod profiling;

use std::{
    fs::{
        self,
        OpenOptions,
    },
    io::Write,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{
            AtomicUsize,
            Ordering,
        },
        mpsc::{
            self,
            SyncSender,
        },
    },
    thread,
    time::{
        SystemTime,
        UNIX_EPOCH,
    },
};

#[cfg(any(target_os = "macos", test))]
use serde_json::Value;
#[cfg(target_os = "macos")]
use tauri::WebviewWindow;
use tauri::{
    AppHandle,
    Manager,
    webview::{
        PageLoadEvent,
        PageLoadPayload,
    },
};

use crate::origins;

// Installed before any page script runs, so it sees startup failures too. The
// buffer is capped so a page that logs in a loop can't grow it without bound.
const CAPTURE_SCRIPT: &str = r"
(() => {
  const buffer = window.__lixpiDiagnostics = []
  const describe = value => {
    try {
      if (value instanceof Error) {
        const summary = `${value.name}: ${value.message}`
        return value.stack?.startsWith(summary) ? value.stack : value.stack ? `${summary}\n${value.stack}` : summary
      }

      return typeof value === 'object' ? JSON.stringify(value) : String(value)
    } catch {
      return String(value)
    }
  }
  const record = (level, values) => {
    if (buffer.length < 1000)
      buffer.push(`${level} ${location.pathname}: ${Array.from(values, describe).join(' ').slice(0, 2000)}`)
  }

  for (const level of ['error', 'warn', 'info', 'log', 'debug']) {
    const original = console[level].bind(console)
    console[level] = (...values) => {
      record(level, values)
      original(...values)
    }
  }

  addEventListener('error', event => record('uncaught', [event.message, `${event.filename}:${event.lineno}:${event.colno}`]))
  addEventListener('unhandledrejection', event => record('unhandled-rejection', [event.reason]))
  addEventListener('securitypolicyviolation', event => record('blocked', [event.violatedDirective, event.blockedURI]))
})()
";

pub(crate) const INITIALIZATION_SCRIPTS: &[&str] = &[
    CAPTURE_SCRIPT,
    #[cfg(feature = "profiling")]
    profiling::RENDERING_SCRIPT,
];

// Tauri's application log resolver is unavailable until CEF is initialized.
#[cfg(target_os = "macos")]
#[derive(Clone)]
pub(crate) struct NativeStartup {
    log_file: Option<PathBuf>,
}

#[cfg(target_os = "macos")]
impl NativeStartup {
    pub(crate) fn new(identifier: &str) -> Self {
        let log_file = dirs::home_dir().and_then(|home| {
            let directory = home.join("Library/Logs").join(identifier);

            match fs::create_dir_all(&directory) {
                Ok(()) => Some(directory.join("diagnostics.log")),
                Err(error) => {
                    eprintln!("Could not create the native startup log directory: {error}");

                    None
                },
            }
        });

        Self {
            log_file,
        }
    }

    pub(crate) fn record(
        &self,
        stage: &str,
    ) {
        write_line(self.log_file.as_ref(), &format!("[{}] native startup: {stage}", unix_milliseconds()));
    }
}

const LOG_QUEUE_CAPACITY: usize = 64;

enum LogPayload {
    Message(String),
    #[cfg(any(target_os = "macos", test))]
    PageBuffer(String),
}

struct QueuedLog {
    milliseconds: u128,
    payload: LogPayload,
}

impl QueuedLog {
    fn lines(self) -> Vec<String> {
        let messages = match self.payload {
            LogPayload::Message(message) => vec![message],
            #[cfg(any(target_os = "macos", test))]
            LogPayload::PageBuffer(buffer) => entries(&buffer),
        };

        messages
            .into_iter()
            .map(|message| format!("[{}] {}", self.milliseconds, redact(&message)))
            .collect()
    }
}

pub(crate) struct Diagnostics {
    pending: SyncSender<QueuedLog>,
    dropped: Arc<AtomicUsize>,
}

impl Diagnostics {
    pub(crate) fn new(app: &AppHandle) -> Arc<Self> {
        let log_file = match app.path().app_log_dir() {
            Ok(directory) => match fs::create_dir_all(&directory) {
                Ok(()) => Some(directory.join("diagnostics.log")),
                Err(error) => {
                    eprintln!("Diagnostics are not written to a file: create {}: {error}", directory.display());

                    None
                },
            },
            Err(error) => {
                eprintln!("Diagnostics are not written to a file: {error}");

                None
            },
        };
        let (pending, receiver) = mpsc::sync_channel::<QueuedLog>(LOG_QUEUE_CAPACITY);
        let dropped = Arc::new(AtomicUsize::new(0));
        let writer_dropped = Arc::clone(&dropped);
        thread::spawn(move || {
            if let Some(file) = &log_file {
                eprintln!("Writing diagnostics to {}", file.display());
            }

            for queued in receiver {
                let lost = writer_dropped.swap(0, Ordering::Relaxed);
                if lost > 0 {
                    write_line(
                        log_file.as_ref(),
                        &format!(
                            "[{}] diagnostics dropped {lost} records while the writer queue was full",
                            unix_milliseconds()
                        ),
                    );
                }

                for line in queued.lines() {
                    write_line(log_file.as_ref(), &line);
                }
            }
        });
        let diagnostics = Arc::new(Self {
            pending,
            dropped,
        });
        diagnostics.record("diagnostics started");

        diagnostics
    }

    pub(crate) fn page_load(
        &self,
        payload: &PageLoadPayload<'_>,
    ) {
        let event = match payload.event() {
            PageLoadEvent::Started => "started",
            PageLoadEvent::Finished => "finished",
        };

        self.record(&format!("page {event}: {}", origins::without_query(payload.url())));
    }

    // Keep the protocol observer alive across drains. CEF alpha.7's one-shot
    // eval callback unregisters itself while its own mutex is still locked.
    #[cfg(target_os = "macos")]
    pub(crate) fn watch(
        self: Arc<Self>,
        window: WebviewWindow,
    ) {
        thread::spawn(move || {
            let logs = match page_logs::PageLogs::new(window.clone()) {
                Ok(logs) => logs,
                Err(error) => {
                    self.record(&format!("Could not start page log capture: {error}"));

                    return;
                },
            };

            loop {
                thread::sleep(std::time::Duration::from_secs(1));

                #[cfg(feature = "profiling")]
                let Ok(probe) = profiling::ResponsivenessProbe::schedule(&window, &self) else {
                    break;
                };

                match logs.read() {
                    Ok(Some(result)) => {
                        #[cfg(feature = "profiling")]
                        if let Some(message) = probe.webview_completed() {
                            self.record(&message);
                        }

                        self.enqueue(LogPayload::PageBuffer(result));
                    },
                    // Navigation can discard an evaluation. A timed-out request
                    // is retired so the next page can resume capture.
                    Ok(None) => {},
                    Err(error) => {
                        self.record(&format!("Page log capture stopped: {error}"));

                        break;
                    },
                }
            }
        });
    }

    pub(crate) fn record(
        &self,
        message: &str,
    ) {
        self.enqueue(LogPayload::Message(message.to_owned()));
    }

    fn enqueue(
        &self,
        payload: LogPayload,
    ) {
        if self
            .pending
            .try_send(QueuedLog {
                milliseconds: unix_milliseconds(),
                payload,
            })
            .is_err()
        {
            // A slow or stopped writer must never block the native event loop.
            // The writer reports losses when it next receives a record.
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

fn unix_milliseconds() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis())
}

fn write_line(
    log_file: Option<&PathBuf>,
    line: &str,
) {
    eprintln!("{line}");

    let Some(path) = log_file else {
        return;
    };

    let written = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| writeln!(file, "{line}"));
    if let Err(error) = written {
        eprintln!("Could not write {}: {error}", path.display());
    }
}

// Accept the page buffer and the older runtime callback
// representation, which JSON-encoded that string again.
#[cfg(any(target_os = "macos", test))]
fn entries(result: &str) -> Vec<String> {
    let mut value: Value = serde_json::from_str(result).unwrap_or(Value::Null);
    if let Value::String(inner) = &value {
        value = serde_json::from_str(inner).unwrap_or(Value::Null);
    }

    match value {
        Value::Array(items) => items.into_iter().filter_map(|item| item.as_str().map(str::to_owned)).collect(),
        _ => Vec::new(),
    }
}

const TOKEN_PARAMETER: &str = "token=";
const JWT_PREFIX: &str = "eyJ";

// Removes access tokens: the value of a `token=` parameter and anything shaped
// like a JSON Web Token.
fn redact(text: &str) -> String {
    let mut redacted = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(character) = rest.chars().next() {
        if rest.starts_with(TOKEN_PARAMETER) {
            redacted.push_str("token=[redacted]");
            rest = &rest[TOKEN_PARAMETER.len()..];
            rest = &rest[rest.find(is_parameter_end).unwrap_or(rest.len())..];

            continue;
        }

        let follows_word = redacted.chars().next_back().is_some_and(is_token_character);
        if !follows_word && rest.starts_with(JWT_PREFIX) {
            let length = rest
                .find(|candidate: char| !is_token_character(candidate) && candidate != '.')
                .unwrap_or(rest.len());
            if rest[..length].matches('.').count() == 2 {
                redacted.push_str("[redacted token]");
                rest = &rest[length..];

                continue;
            }
        }

        redacted.push(character);
        rest = &rest[character.len_utf8()..];
    }

    redacted
}

fn is_token_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '-' || character == '_'
}

fn is_parameter_end(character: char) -> bool {
    matches!(character, '&' | '#' | '"' | '\'' | ' ' | ',' | ')' | ']' | '}' | '<' | '>' | '\\' | '\n')
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{
            AtomicUsize,
            Ordering,
        },
        mpsc,
    };

    use super::{
        Diagnostics,
        INITIALIZATION_SCRIPTS,
        LogPayload,
        QueuedLog,
        entries,
        redact,
    };

    #[test]
    fn captures_page_errors_with_or_without_the_startup_frame_sampler() {
        assert!(INITIALIZATION_SCRIPTS.iter().any(|script| script.contains("unhandledrejection")));
        assert_eq!(
            INITIALIZATION_SCRIPTS.iter().any(|script| script.contains("requestAnimationFrame")),
            cfg!(feature = "profiling")
        );
    }

    #[test]
    fn drops_records_instead_of_waiting_for_a_full_writer_queue() {
        let (pending, receiver) = mpsc::sync_channel(1);
        let dropped = Arc::new(AtomicUsize::new(0));
        let diagnostics = Diagnostics {
            pending,
            dropped: Arc::clone(&dropped),
        };
        diagnostics.record("first");
        diagnostics.record("second");
        assert_eq!(dropped.load(Ordering::Relaxed), 1);
        assert!(receiver.recv().unwrap().lines()[0].ends_with(" first"));
    }

    #[test]
    fn queued_page_logs_keep_the_capture_time_and_are_redacted_before_output() {
        let queued = QueuedLog {
            milliseconds: 123,
            payload: LogPayload::PageBuffer(String::from(r#"["info /: token=secret","warn /: next"]"#)),
        };

        assert_eq!(queued.lines(), ["[123] info /: token=[redacted]", "[123] warn /: next"]);
    }

    #[test]
    fn redacts_token_parameters_and_json_web_tokens() {
        for (input, expected) in [
            (
                "GET https://localhost:3445/api/a?token=abc.def&download=true",
                "GET https://localhost:3445/api/a?token=[redacted]&download=true",
            ),
            (
                "Authorization eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl failed",
                "Authorization [redacted token] failed",
            ),
            (
                "{\"token\":\"x\",\"url\":\"/e?token=secret\"}",
                "{\"token\":\"x\",\"url\":\"/e?token=[redacted]\"}",
            ),
            ("keyJabc.def.ghi stays", "keyJabc.def.ghi stays"),
            ("eyJ only.one", "eyJ only.one"),
            (
                "NATS -> authorization failed, refreshing credentials",
                "NATS -> authorization failed, refreshing credentials",
            ),
            ("café token=ünïcode end", "café token=[redacted] end"),
        ] {
            assert_eq!(redact(input), expected, "{input}");
        }
    }

    #[test]
    fn decodes_the_drained_buffer() {
        assert_eq!(entries(r#""[\"error /: one\",\"warn /: two\"]""#), ["error /: one", "warn /: two"]);
        assert_eq!(entries(r#"["log /: plain"]"#), ["log /: plain"]);
        assert_eq!(entries("not json"), Vec::<String>::new());
        assert_eq!(entries(r#""{}""#), Vec::<String>::new());
    }
}
