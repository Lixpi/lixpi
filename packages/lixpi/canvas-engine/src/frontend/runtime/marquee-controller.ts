import {
    assertCanvasBounds,
    rectangleFromPoints,
    type CanvasEnginePoint,
    type CanvasEngineRect,
    type Dispose,
} from '../../shared/index.ts'
import {
    type GestureController,
    type CanvasGesture,
    type GestureCancelReason,
} from './gesture-controller.ts'

export type MarqueeControllerOptions = {
    root: HTMLElement
    gestures: GestureController
    getWorldPoint: (
        clientX: number,
        clientY: number,
    ) => CanvasEnginePoint
    threshold?: number
    lock?: () => Dispose
    onStart: () => void
    onChange: (bounds: CanvasEngineRect) => void
    onEnd: (moved: boolean) => void
    onCancel: (reason: GestureCancelReason) => void
}

export class MarqueeController {
    private gesture: CanvasGesture | null = null
    private releaseLock: Dispose | undefined
    private startClient: CanvasEnginePoint = {
        x: 0,
        y: 0,
    }
    private startWorld: CanvasEnginePoint = {
        x: 0,
        y: 0,
    }
    private rectangle: CanvasEngineRect | null = null
    private destroyed = false

    constructor(private readonly options: MarqueeControllerOptions) {
        if (
            !Number.isFinite(options.threshold ?? 3)
            || (options.threshold ?? 3) < 0
        )
            throw new Error('Marquee threshold must be finite and nonnegative')
    }

    get active(): boolean {
        return this.rectangle !== null
    }
    get bounds(): CanvasEngineRect | null {
        return this.rectangle ? { ...this.rectangle } : null
    }

    start(event: MouseEvent | PointerEvent): void {
        if (this.destroyed)
            throw new Error('Marquee controller is disposed')

        this.cancel()
        this.startClient = {
            x: event.clientX,
            y: event.clientY,
        }
        this.startWorld = this.options.getWorldPoint(event.clientX, event.clientY)

        try {
            this.releaseLock = this.options.lock?.()
            this.gesture = this.options.gestures.start({
                root: this.options.root,
                event,
                onMove: this.move,
                onEnd: this.end,
                onCancel: this.cancelled,
            })
        } catch (error) {
            this.cleanup()

            throw error
        }
    }

    private move = (event: MouseEvent | PointerEvent): void => {
        const first = !this.active

        if (
            first
            && Math.max(
                Math.abs(event.clientX - this.startClient.x),
                Math.abs(event.clientY - this.startClient.y),
            ) <= (this.options.threshold ?? 3)
        )
            return

        try {
            const rectangle = rectangleFromPoints(
                this.startWorld,
                this.options.getWorldPoint(event.clientX, event.clientY),
            )
            assertCanvasBounds(rectangle)
            this.rectangle = rectangle

            if (first)
                this.options.onStart()

            if (this.rectangle)
                this.options.onChange({ ...this.rectangle })
        } catch (error) {
            this.cancel()

            throw error
        }
    }

    private end = (): void => {
        const moved = this.active
        this.cleanup()
        this.options.onEnd(moved)
    }

    private cancelled = (reason: GestureCancelReason): void => {
        this.cleanup()
        this.options.onCancel(reason)
    }

    private cleanup(): void {
        this.gesture = null
        this.rectangle = null
        const release = this.releaseLock
        this.releaseLock = undefined
        release?.()
    }

    cancel(): void {
        this.gesture?.cancel('replaced')
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.gesture?.cancel('destroyed')
    }
}
