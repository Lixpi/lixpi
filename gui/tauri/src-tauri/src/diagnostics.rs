// Diagnostics for a build made with the `diagnostics` feature. The page's
// console output, uncaught errors, unhandled promise rejections and blocked
// requests are captured from the moment each page starts, along with every
// page load. They go to stderr and to `diagnostics.log` in the app's log
// directory, because an app opened from Finder has no terminal. Access tokens
// are redacted before anything is written.

use std::{
    fs::{
        self,
        OpenOptions,
    },
    io::Write,
    path::PathBuf,
    sync::Arc,
    thread,
    time::{
        Duration,
        SystemTime,
        UNIX_EPOCH,
    },
};

use serde_json::Value;
use tauri::{
    AppHandle,
    Manager,
    WebviewWindow,
    webview::{
        PageLoadEvent,
        PageLoadPayload,
    },
};

use crate::origins;

// Installed before any page script runs, so it sees startup failures too. The
// buffer is capped so a page that logs in a loop can't grow it without bound.
pub(crate) const CAPTURE_SCRIPT: &str = r"
(() => {
  const buffer = window.__lixpiDiagnostics = []
  const describe = value => {
    try {
      // WebKit's stack lists only the frames, unlike Chrome's, so the name
      // and message lead and the stack follows.
      if (value instanceof Error)
        return value.stack ? `${value.name}: ${value.message}\n${value.stack}` : `${value.name}: ${value.message}`

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

  // Measures how often the page can render, which is what canvas animation
  // feels like, plus what the GPU path has to work with.
  addEventListener('load', () => {
    const frames = []
    const step = time => {
      frames.push(time)

      if (time - frames[0] < 1000)
        return requestAnimationFrame(step)

      const rate = Math.round((frames.length - 1) * 1000 / (time - frames[0]))
      record('rendering', [`${rate} frames per second`, `devicePixelRatio ${devicePixelRatio}`, `WebGPU ${'gpu' in navigator ? 'available' : 'unavailable'}`])
    }

    requestAnimationFrame(step)
  })
})()
";

const DRAIN_SCRIPT: &str = "JSON.stringify((window.__lixpiDiagnostics || []).splice(0))";

const POLL_INTERVAL: Duration = Duration::from_secs(1);

pub(crate) struct Diagnostics {
    log_file: Option<PathBuf>,
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
        let diagnostics = Arc::new(Self {
            log_file,
        });
        if let Some(file) = &diagnostics.log_file {
            eprintln!("Writing diagnostics to {}", file.display());
        }

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

    // Drains the page's buffer every second until the window is gone.
    pub(crate) fn watch(
        self: Arc<Self>,
        window: WebviewWindow,
    ) {
        thread::spawn(move || {
            loop {
                thread::sleep(POLL_INTERVAL);

                let diagnostics = Arc::clone(&self);
                let drained = window.eval_with_callback(DRAIN_SCRIPT, move |result| {
                    for entry in entries(&result) {
                        diagnostics.record(&entry);
                    }
                });
                if drained.is_err() {
                    break;
                }
            }
        });
    }

    fn record(
        &self,
        message: &str,
    ) {
        let milliseconds = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis());
        let line = format!("[{milliseconds}] {}", redact(message));

        eprintln!("{line}");

        let Some(path) = &self.log_file else {
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
}

// The page returns the drained buffer as a JSON string, which the runtime
// hands back JSON-encoded again.
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
    use super::{
        entries,
        redact,
    };

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
