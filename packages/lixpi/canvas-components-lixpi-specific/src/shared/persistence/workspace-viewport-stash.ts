import {
    viewportsMatch,
    type ViewportSnapshot,
} from '@lixpi/canvas-engine/shared'

// Version suffix: v2 invalidates stashes written before the startup persistence
// gate existed — those could contain spurious near-default viewports captured
// during page load, and replaying them resets the canvas after a reload.
const STASH_KEY_PREFIX = 'lixpi.pendingViewport.v2.'

export function getStashedViewportStorageKey(workspaceId: string): string {
    return `${STASH_KEY_PREFIX}${workspaceId}`
}

export function encodeStashedViewport(viewport: ViewportSnapshot): string {
    return JSON.stringify({ viewport })
}

export function parseStashedViewport(raw: string | null): ViewportSnapshot | null {
    if (!raw) return null

    let parsed: { viewport?: unknown }
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    const viewport = parsed.viewport as Partial<ViewportSnapshot> | null | undefined
    if (
        !viewport
        || !Number.isFinite(viewport.x)
        || !Number.isFinite(viewport.y)
        || !Number.isFinite(viewport.zoom)
    ) return null
    return { x: viewport.x as number, y: viewport.y as number, zoom: viewport.zoom as number }
}

// The stash is only proven obsolete when the unload-time network flush landed,
// i.e. the server already holds the stashed viewport.
export function shouldApplyStashedViewport(
    stashedViewport: ViewportSnapshot,
    serverViewport: ViewportSnapshot | null | undefined,
): boolean {
    return !viewportsMatch(stashedViewport, serverViewport)
}
