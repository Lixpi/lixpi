// CEF alpha.7's eval_with_callback releases its one-shot observer while a
// mutex in that observer is locked. Use the runtime's persistent observer so
// receiving a result never unregisters or destroys its native callback.

use std::{
    sync::{
        Arc,
        atomic::{
            AtomicI32,
            Ordering,
        },
        mpsc::{
            self,
            Receiver,
            RecvTimeoutError,
        },
    },
    time::{
        Duration,
        Instant,
    },
};

use serde_json::{
    Value,
    json,
};
use tauri::WebviewWindow;
use tauri_runtime_cef::{
    DevToolsProtocol,
    WebviewCefExt,
    allocate_devtools_message_id,
};

const DRAIN_SCRIPT: &str = "JSON.stringify((window.__lixpiDiagnostics || []).splice(0))";
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

struct EvaluationResult {
    message_id: i32,
    success: bool,
    payload: Vec<u8>,
}

pub(super) struct PageLogs {
    window: WebviewWindow,
    pending: Arc<AtomicI32>,
    results: Receiver<EvaluationResult>,
}

impl PageLogs {
    pub(super) fn new(window: WebviewWindow) -> Result<Self, String> {
        let pending = Arc::new(AtomicI32::new(0));
        let observed = Arc::clone(&pending);
        let (sender, results) = mpsc::sync_channel(1);
        window
            .on_dev_tools_protocol(move |event| {
                let DevToolsProtocol::MethodResult {
                    message_id,
                    success,
                    result,
                } = event
                else {
                    return;
                };

                if message_id != observed.load(Ordering::Acquire) {
                    return;
                }

                if let Err(error) = sender.try_send(EvaluationResult {
                    message_id,
                    success,
                    payload: result,
                }) {
                    eprintln!("Could not queue the page log response: {error}");
                }
            })
            .map_err(|error| format!("register the Chromium protocol observer: {error}"))?;

        Ok(Self {
            window,
            pending,
            results,
        })
    }

    pub(super) fn read(&self) -> Result<Option<String>, String> {
        let message_id = allocate_devtools_message_id().map_err(|error| error.to_string())?;
        self.pending.store(message_id, Ordering::Release);
        let result = self.request(message_id);
        self.pending.store(0, Ordering::Release);

        result
    }

    fn request(
        &self,
        message_id: i32,
    ) -> Result<Option<String>, String> {
        let message = json!({
            "id": message_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": DRAIN_SCRIPT,
                "returnByValue": true
            }
        });
        self.window
            .send_dev_tools_message(message.to_string().as_bytes())
            .map_err(|error| format!("request the page log buffer: {error}"))?;
        let deadline = Instant::now() + RESPONSE_TIMEOUT;

        loop {
            match self.results.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(result) if result.message_id == message_id => return Ok(page_buffer(&result)),
                // A result can race a timeout just before the pending ID is
                // retired. It must not be mistaken for the next request.
                Ok(_) => {},
                Err(RecvTimeoutError::Timeout) => return Ok(None),
                Err(RecvTimeoutError::Disconnected) => return Err("the Chromium protocol observer closed".to_owned()),
            }
        }
    }
}

fn page_buffer(result: &EvaluationResult) -> Option<String> {
    if !result.success {
        return None;
    }

    let payload: Value = serde_json::from_slice(&result.payload).ok()?;
    if payload.get("exceptionDetails").is_some() {
        return None;
    }

    let remote_object = payload.get("result").unwrap_or(&payload);

    remote_object.get("value")?.as_str().map(str::to_owned)
}
