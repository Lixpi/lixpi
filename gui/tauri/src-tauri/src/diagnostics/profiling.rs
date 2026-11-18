#[cfg(any(target_os = "macos", test))]
use std::time::Duration;
#[cfg(target_os = "macos")]
use std::{
    sync::{
        Arc,
        atomic::{
            AtomicU64,
            Ordering,
        },
    },
    time::Instant,
};

#[cfg(target_os = "macos")]
use tauri::{
    Manager,
    WebviewWindow,
};

#[cfg(target_os = "macos")]
use super::{
    Diagnostics,
    unix_milliseconds,
};

// This sampler writes to the same bounded page buffer as console capture.
pub(super) const RENDERING_SCRIPT: &str = r"
addEventListener('load', () => {
  const frames = []
  const step = time => {
    frames.push(time)

    if (time - frames[0] < 1000)
      return requestAnimationFrame(step)

    const buffer = window.__lixpiDiagnostics
    if (!buffer || buffer.length >= 1000)
      return

    const rate = Math.round((frames.length - 1) * 1000 / (time - frames[0]))
    buffer.push(`rendering ${location.pathname}: ${rate} frames per second devicePixelRatio ${devicePixelRatio} WebGPU ${'gpu' in navigator ? 'available' : 'unavailable'}`.slice(0, 2000))
  }

  requestAnimationFrame(step)
})
";

#[cfg(any(target_os = "macos", test))]
const SLOW_PROBE: Duration = Duration::from_millis(50);
#[cfg(target_os = "macos")]
const PROBE_PENDING: u64 = u64::MAX;

#[cfg(target_os = "macos")]
pub(super) struct ResponsivenessProbe {
    scheduled_at: u128,
    started: Instant,
    native_queue_micros: AtomicU64,
}

#[cfg(target_os = "macos")]
impl ResponsivenessProbe {
    pub(super) fn schedule(
        window: &WebviewWindow,
        diagnostics: &Arc<Diagnostics>,
    ) -> tauri::Result<Arc<Self>> {
        let probe = Arc::new(Self {
            scheduled_at: unix_milliseconds(),
            started: Instant::now(),
            native_queue_micros: AtomicU64::new(PROBE_PENDING),
        });
        let native_probe = Arc::clone(&probe);
        let diagnostics = Arc::clone(diagnostics);
        window.run_on_main_thread(move || {
            if let Some(message) = native_probe.native_completed() {
                diagnostics.record(&message);
            }
        })?;

        Ok(probe)
    }

    fn native_completed(&self) -> Option<String> {
        let elapsed = self.started.elapsed();
        self.native_queue_micros
            .store(u64::try_from(elapsed.as_micros()).unwrap_or(PROBE_PENDING - 1), Ordering::Relaxed);

        // Report a blocked native loop even if the webview never returns its callback.
        latency_message(self.scheduled_at, Some(elapsed), None)
    }

    pub(super) fn webview_completed(&self) -> Option<String> {
        let elapsed = self.started.elapsed();
        let native_micros = self.native_queue_micros.load(Ordering::Relaxed);
        let native_queue = (native_micros != PROBE_PENDING).then(|| Duration::from_micros(native_micros));

        latency_message(self.scheduled_at, native_queue, Some(elapsed))
    }
}

#[cfg(any(target_os = "macos", test))]
fn latency_message(
    scheduled_at: u128,
    native_queue: Option<Duration>,
    webview_roundtrip: Option<Duration>,
) -> Option<String> {
    if ![native_queue, webview_roundtrip]
        .into_iter()
        .flatten()
        .any(|elapsed| elapsed >= SLOW_PROBE)
    {
        return None;
    }

    let milliseconds =
        |elapsed: Option<Duration>| elapsed.map_or_else(|| String::from("pending"), |elapsed| format!("{:.3}", elapsed.as_secs_f64() * 1000.0));

    Some(format!(
        "responsiveness scheduledAt={scheduled_at} nativeQueueMs={} webviewRoundtripMs={}",
        milliseconds(native_queue),
        milliseconds(webview_roundtrip),
    ))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::latency_message;

    #[test]
    fn reports_native_queue_delay_without_waiting_for_the_webview() {
        assert_eq!(
            latency_message(123, Some(Duration::from_millis(75)), None),
            Some(String::from(
                "responsiveness scheduledAt=123 nativeQueueMs=75.000 webviewRoundtripMs=pending"
            ))
        );
        assert_eq!(
            latency_message(124, Some(Duration::from_millis(2)), Some(Duration::from_millis(525))),
            Some(String::from(
                "responsiveness scheduledAt=124 nativeQueueMs=2.000 webviewRoundtripMs=525.000"
            ))
        );
        assert_eq!(latency_message(125, Some(Duration::from_millis(2)), Some(Duration::from_millis(8))), None);
    }
}
