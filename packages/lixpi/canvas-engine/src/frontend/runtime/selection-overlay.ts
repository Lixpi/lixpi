import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import {
    assertCanvasBounds,
    type CanvasEngineRect,
} from '../../shared/index.ts'

export type SelectionOverlayOptions = {
    root: HTMLElement
    marquee: {
        borderColor: string
        backgroundColor: string
        radius?: number
    }
    onGroupPointerDown: (event: MouseEvent) => void
}

export class SelectionOverlay {
    private readonly marquee: HTMLElement
    private readonly group: HTMLElement
    private groupBounds: CanvasEngineRect | null = null
    private destroyed = false

    constructor(private readonly options: SelectionOverlayOptions) {
        const html = createDocumentHtml(options.root.ownerDocument)
        const marqueeStyle = {
            display: 'none',
            borderColor: options.marquee.borderColor,
            background: options.marquee.backgroundColor,
            borderRadius: `${options.marquee.radius ?? 0}px`,
        }
        this.marquee = html`<div
                className="canvas-selection-marquee"
                style=${marqueeStyle}
            ></div>` as HTMLElement
        this.group = html`<div
                className="canvas-selection-group"
                style=${{ display: 'none' }}
            ></div>` as HTMLElement
        this.group.addEventListener('mousedown', this.groupPointerDown)
    }

    private groupPointerDown = (event: MouseEvent): void => {
        if (
            !this.destroyed
            && this.groupBounds
            && event.button === 0
        )
            this.options.onGroupPointerDown(event)
    }

    private update(
        element: HTMLElement,
        bounds: CanvasEngineRect | null,
    ): void {
        if (this.destroyed)
            return

        if (!bounds) {
            element.style.display = 'none'

            return
        }

        assertCanvasBounds(bounds)

        if (element.parentElement !== this.options.root)
            this.options.root.appendChild(element)

        applyStyle(
            element,
            {
                display: 'block',
                left: `${bounds.x}px`,
                top: `${bounds.y}px`,
                width: `${bounds.width}px`,
                height: `${bounds.height}px`,
            },
        )
    }

    setMarquee(bounds: CanvasEngineRect | null): void {
        this.update(this.marquee, bounds)
    }

    setGroup(bounds: CanvasEngineRect | null): void {
        if (this.destroyed)
            return

        if (bounds)
            assertCanvasBounds(bounds)

        this.groupBounds = bounds ? { ...bounds } : null
        this.update(this.group, bounds)
    }

    contains(target: Node): boolean {
        return !this.destroyed && Boolean(this.groupBounds) && this.group.contains(target)
    }

    reset(): void {
        this.groupBounds = null
        this.marquee.remove()
        this.group.remove()
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.group.removeEventListener('mousedown', this.groupPointerDown)
        this.reset()
    }
}
