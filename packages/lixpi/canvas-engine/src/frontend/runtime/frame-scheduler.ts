import {
    type CanvasEngineRect,
    type Dispose,
} from '../../shared/index.ts'

export type FrameInvalidation = {
    full: boolean
    bounds: readonly CanvasEngineRect[]
}
export type FrameSchedulerOptions = {
    render: (invalidation: FrameInvalidation) => void
    onError: (error: unknown) => void
    request?: (callback: FrameRequestCallback) => number
    cancel?: (id: number) => void
}

export class FrameScheduler {
    private readonly animations = new Set<(elapsedMs: number) => void>()
    private readonly request: (callback: FrameRequestCallback) => number
    private readonly cancel: (id: number) => void
    private frameId: number | null = null
    private lastTime: number | null = null
    private dirtyBounds: CanvasEngineRect[] = []
    private full = false
    private dirty = false
    private destroyed = false
    private ticking = false

    constructor(private readonly options: FrameSchedulerOptions) {
        this.request = options.request ?? (callback => globalThis.requestAnimationFrame(callback))
        this.cancel = options.cancel ?? (id => globalThis.cancelAnimationFrame(id))
    }

    invalidate(bounds?: CanvasEngineRect): void {
        if (this.destroyed)
            return

        this.dirty = true

        if (!bounds) {
            this.full = true
            this.dirtyBounds.length = 0
        } else if (!this.full)
            this.dirtyBounds.push({ ...bounds })

        this.schedule()
    }

    animate(callback: (elapsedMs: number) => void): Dispose {
        if (this.destroyed)
            return () => {}

        this.animations.add(callback)
        this.schedule()

        return () => {
            this.animations.delete(callback)

            if (
                this.animations.size === 0
                && !this.dirty
                && this.frameId !== null
            ) {
                this.cancel(this.frameId)
                this.frameId = null
                this.lastTime = null
            }
        }
    }

    private schedule(): void {
        if (
            this.frameId !== null
            || this.destroyed
            || this.ticking
        )
            return

        this.frameId = this.request(this.tick)
    }

    private tick = (time: number): void => {
        this.frameId = null

        if (this.destroyed)
            return

        this.ticking = true
        const elapsed = this.lastTime === null ? 0 : Math.max(0, time - this.lastTime)
        this.lastTime = time

        for (const callback of Array.from(this.animations)) {
            if (
                !this.animations.has(callback)
                || this.destroyed
            )
                continue

            try {
                callback(elapsed)
            } catch (error) {
                this.animations.delete(callback)
                this.options.onError(error)
            }
        }

        if (
            this.dirty
            && !this.destroyed
        ) {
            const invalidation = {
                full: this.full,
                bounds: this.dirtyBounds,
            }
            this.dirty = false
            this.full = false
            this.dirtyBounds = []

            try {
                this.options.render(invalidation)
            } catch (error) {
                this.options.onError(error)
            }
        }

        this.ticking = false

        if (
            this.animations.size > 0
            || this.dirty
        )
            this.schedule()
        else
            this.lastTime = null
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true

        if (this.frameId !== null)
            this.cancel(this.frameId)

        this.frameId = null
        this.animations.clear()
        this.dirtyBounds.length = 0
    }
}
