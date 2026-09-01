import {
    type CanvasState,
} from '@lixpi/constants'
import {
    viewportsMatch,
    type ViewportSnapshot,
} from '@lixpi/canvas-engine/shared'
import {
    type WorkspaceCanvasSession,
} from './workspace-canvas-session.ts'
import {
    encodeStashedViewport,
    getStashedViewportStorageKey,
    parseStashedViewport,
    shouldApplyStashedViewport,
} from './workspace-viewport-stash.ts'

export type WorkspaceViewportPersistencePorts = {
    readCanvasState: () => CanvasState | null
    restoreViewport: (viewport: ViewportSnapshot) => void
    storage: {
        get: (key: string) => string | null
        set: (key: string, value: string) => void
        remove: (key: string) => void
    }
    setTimer: (callback: () => void, delayMs: number) => () => void
    debounceMs?: number
}

export class WorkspaceViewportPersistence {
    private pending: ViewportSnapshot | null = null
    private lastSubmitted: ViewportSnapshot | null = null
    private latestState: CanvasState | null = null
    private cancelTimer: (() => void) | null = null
    private timerRevision = 0
    private restored = false
    private destroyed = false
    private readonly releaseView: () => void
    private readonly removeFlusher: () => void

    constructor(private readonly session: WorkspaceCanvasSession, private readonly ports: WorkspaceViewportPersistencePorts) {
        this.latestState = ports.readCanvasState()
        this.lastSubmitted = this.latestState ? { ...this.latestState.viewport } : null
        this.releaseView = session.acquire().release
        try {
            this.removeFlusher = session.registerFlush(() => this.flush())
        } catch (error) {
            this.releaseView()
            throw error
        }
    }

    get workspaceId(): string {
        return this.session.workspaceId
    }

    get hasPendingViewport(): boolean {
        return this.pending !== null
    }

    change(viewport: ViewportSnapshot): void {
        if (this.destroyed) return
        if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite)) return
        this.latestState = this.ports.readCanvasState() ?? this.latestState
        this.pending = { ...viewport }
        const leading = this.cancelTimer === null
        this.clearTimer()
        if (leading) this.submit(viewport)
        if (this.destroyed) return
        const revision = this.timerRevision
        this.cancelTimer = this.ports.setTimer(() => {
            if (this.destroyed || revision !== this.timerRevision) return
            this.cancelTimer = null
            this.flush()
        }, this.ports.debounceMs ?? 1000)
    }

    sync(viewport: ViewportSnapshot, canvasState: CanvasState | null): void {
        if (this.destroyed) return
        if (canvasState) this.latestState = canvasState
        if (!this.pending && canvasState && viewportsMatch(viewport, canvasState.viewport)) {
            this.lastSubmitted = { ...viewport }
        }
    }

    restore(serverViewport: ViewportSnapshot | null | undefined): void {
        if (this.destroyed || this.restored) return
        this.restored = true
        let raw: string | null
        const key = getStashedViewportStorageKey(this.workspaceId)
        try {
            raw = this.ports.storage.get(key)
            if (raw) this.ports.storage.remove(key)
        } catch {
            return
        }
        const viewport = parseStashedViewport(raw)
        if (!viewport || !shouldApplyStashedViewport(viewport, serverViewport)) return
        this.pending = viewport
        this.ports.restoreViewport(viewport)
        this.flush()
    }

    flush(): void {
        if (this.destroyed) return
        this.clearTimer()
        if (this.pending && this.submit(this.pending)) this.pending = null
    }

    stashForUnload(): void {
        if (this.destroyed) return
        const inFlight = this.session.persistence.getPendingViewport()
        const viewport = this.pending ?? inFlight
        if (!viewport) return
        if (!inFlight && viewportsMatch(viewport, this.lastSubmitted)) return
        try {
            this.ports.storage.set(getStashedViewportStorageKey(this.workspaceId), encodeStashedViewport(viewport))
        } catch {
            // The network flush still runs when storage is unavailable.
        }
        this.flush()
    }

    destroy(): void {
        if (this.destroyed) return
        try {
            this.flush()
        } finally {
            this.destroyed = true
            this.timerRevision += 1
            try {
                this.cancelTimer?.()
            } finally {
                this.cancelTimer = null
                this.removeFlusher()
                this.releaseView()
            }
        }
    }

    private submit(viewport: ViewportSnapshot): boolean {
        if (viewportsMatch(viewport, this.lastSubmitted)) return true
        const state = this.ports.readCanvasState() ?? this.latestState ?? this.session.persistence.read()?.canvasState
        if (!state) return false
        const previous = this.lastSubmitted
        this.lastSubmitted = { ...viewport }
        try {
            this.session.persistence.update({ ...state, viewport: { ...viewport } }, true)
        } catch (error) {
            this.lastSubmitted = previous
            throw error
        }
        return true
    }

    private clearTimer(): void {
        this.timerRevision += 1
        const cancel = this.cancelTimer
        this.cancelTimer = null
        cancel?.()
    }
}
