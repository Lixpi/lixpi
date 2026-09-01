// Shared workspace persistence timing. The API owns authoritative settled
// snapshots, while the browser owns local fallback timers; using one exported
// value keeps those write cadences aligned.

export type WorkspacePersistenceSettings = {
    // Quiet period before debounced workspace/document persistence flushes.
    debounceMs: number
}

export const workspacePersistenceSettings: WorkspacePersistenceSettings = {
    // Three seconds keeps edit bursts coalesced without leaving saves stale for too long.
    debounceMs: 3000,
}
