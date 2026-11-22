export type CanvasNodeClicksOptions = {
    root: HTMLElement
    nodeAt: (event: PointerEvent) => string | null
    onNodeClick: (nodeId: string) => void
}

const CLICK_TOLERANCE = 5
const INTERACTIVE_TARGET = 'button, input, textarea, select, a, [data-canvas-interactive]'

// Reports a primary press and release that stays within the click tolerance
// over one node. Panning, dragging and node controls never report a click.
export class CanvasNodeClicks {
    private press: {
        pointerId: number
        x: number
        y: number
    } | null = null

    constructor(private readonly options: CanvasNodeClicksOptions) {
        options.root.addEventListener('pointerdown', this.pointerDown)
        options.root.addEventListener('pointerup', this.pointerUp)
        options.root.addEventListener('pointercancel', this.pointerCancel)
    }

    private pointerDown = (event: PointerEvent): void => {
        if (
            event.button !== 0
            || !event.isPrimary
        )
            return

        const target = event.target

        if (
            target instanceof Element
            && target.closest(INTERACTIVE_TARGET)
        )
            return

        this.press = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
        }
    }

    private pointerUp = (event: PointerEvent): void => {
        const press = this.press

        if (press?.pointerId !== event.pointerId)
            return

        this.press = null

        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_TOLERANCE)
            return

        const nodeId = this.options.nodeAt(event)

        if (nodeId)
            this.options.onNodeClick(nodeId)
    }

    private pointerCancel = (): void => void (this.press = null)

    destroy(): void {
        this.options.root.removeEventListener('pointerdown', this.pointerDown)
        this.options.root.removeEventListener('pointerup', this.pointerUp)
        this.options.root.removeEventListener('pointercancel', this.pointerCancel)
        this.press = null
    }
}
