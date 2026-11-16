use std::sync::atomic::{
    AtomicU8,
    Ordering,
};

const TRUST_VERIFIED: u8 = 1;
const BLANK_FINISHED: u8 = 2;

// The runtime can finish its deferred about:blank navigation before or after
// setup verifies trust. Only the second condition releases the real URL, and
// neither condition can release it again after both bits have been set.
#[derive(Default)]
pub(crate) struct StartupNavigation {
    ready: AtomicU8,
}

impl StartupNavigation {
    pub(crate) fn trust_verified(&self) -> bool {
        self.ready.fetch_or(TRUST_VERIFIED, Ordering::AcqRel) == BLANK_FINISHED
    }

    pub(crate) fn blank_finished(&self) -> bool {
        self.ready.fetch_or(BLANK_FINISHED, Ordering::AcqRel) == TRUST_VERIFIED
    }
}
