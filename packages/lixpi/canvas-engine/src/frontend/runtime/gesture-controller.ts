import { ElementStyleLease } from '@lixpi/ui-primitives/dom'

export type GestureCancelReason = 'replaced' | 'scene-change' | 'escape' | 'blur' | 'pointer-cancel' | 'destroyed'
export type CanvasGestureOptions = {
    root: HTMLElement
    event: MouseEvent | PointerEvent
    cursor?: string
    onMove: (event: MouseEvent | PointerEvent) => void
    onEnd: (event: MouseEvent | PointerEvent) => void
    onCancel: (reason: GestureCancelReason) => void
}

export class CanvasGesture {
    private readonly document: Document
    private readonly view: Window | null
    private readonly pointerId: number | undefined
    private readonly capture: Element | null
    private readonly styles: ElementStyleLease[] = []
    private ended = false

    constructor(
        private readonly options: CanvasGestureOptions,
        private readonly release: () => void,
    ) {
        this.document = options.root.ownerDocument
        this.view = this.document.defaultView
        this.pointerId = 'pointerId' in options.event ? options.event.pointerId : undefined
        this.capture = this.pointerId !== undefined ? options.root : null

        if (options.cursor) {
            this.styles.push(
                new ElementStyleLease(options.root, { cursor: options.cursor }),
            )
            this.styles.push(
                new ElementStyleLease(
                    this.document.body,
                    {
                        cursor: options.cursor,
                        'user-select': 'none',
                    },
                ),
            )
            this.styles.push(
                new ElementStyleLease(this.document.documentElement, { cursor: options.cursor }),
            )
        }

        this.document.addEventListener(this.pointerId === undefined ? 'mousemove' : 'pointermove', this.move)
        this.document.addEventListener(this.pointerId === undefined ? 'mouseup' : 'pointerup', this.end)
        this.document.addEventListener('pointercancel', this.pointerCancel)
        this.document.addEventListener(
            'keydown',
            this.keyDown,
            true,
        )
        this.view?.addEventListener('blur', this.blur)
        this.capture?.addEventListener('lostpointercapture', this.pointerCancel)

        if (this.pointerId !== undefined) {
            try {
                this.capture?.setPointerCapture(this.pointerId)
            } catch {
                // Capture can be unavailable after pointer release.
            }
        }
    }

    private accepts(event: Event): boolean {
        return this.pointerId === undefined || ('pointerId' in event && event.pointerId === this.pointerId)
    }

    private move = (event: Event): void => {
        if (
            !this.ended
            && this.accepts(event)
        )
            this.options.onMove(event as MouseEvent | PointerEvent)
    }

    private end = (event: Event): void => {
        if (
            this.ended
            || !this.accepts(event)
        )
            return

        this.cleanup()
        this.options.onEnd(event as MouseEvent | PointerEvent)
    }

    private pointerCancel = (event: Event): void => {
        if (this.accepts(event))
            this.cancel('pointer-cancel')
    }

    private keyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape')
            return

        event.preventDefault()
        this.cancel('escape')
    }

    private blur = (): void => void this.cancel('blur')

    cancel(reason: GestureCancelReason): void {
        if (this.ended)
            return

        this.cleanup()
        this.options.onCancel(reason)
    }

    private cleanup(): void {
        this.ended = true
        this.document.removeEventListener(this.pointerId === undefined ? 'mousemove' : 'pointermove', this.move)
        this.document.removeEventListener(this.pointerId === undefined ? 'mouseup' : 'pointerup', this.end)
        this.document.removeEventListener('pointercancel', this.pointerCancel)
        this.document.removeEventListener(
            'keydown',
            this.keyDown,
            true,
        )
        this.view?.removeEventListener('blur', this.blur)
        this.capture?.removeEventListener('lostpointercapture', this.pointerCancel)

        if (
            this.pointerId !== undefined
            && this.capture?.hasPointerCapture(this.pointerId)
        )
            this.capture.releasePointerCapture(this.pointerId)

        for (const style of this.styles)
            style.destroy()

        this.release()
    }
}

export class GestureController {
    private readonly gestures = new Set<CanvasGesture>()
    private destroyed = false

    start(options: CanvasGestureOptions): CanvasGesture {
        if (this.destroyed)
            throw new Error('Gesture controller is disposed')

        const gesture = new CanvasGesture(options, () => this.gestures.delete(gesture))
        this.gestures.add(gesture)

        return gesture
    }

    cancelAll(reason: GestureCancelReason): void {
        const errors: unknown[] = []

        for (const gesture of Array.from(this.gestures)) {
            try {
                gesture.cancel(reason)
            } catch (error) {
                errors.push(error)
            }
        }

        if (errors.length)
            throw new AggregateError(errors, 'Canvas gesture cancellation failed')
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.cancelAll('destroyed')
    }
}
