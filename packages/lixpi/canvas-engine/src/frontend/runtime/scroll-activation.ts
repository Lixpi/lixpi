import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

// 'always' lets the canvas own wheel and trackpad scrolling. 'on-activate'
// leaves page scrolling alone until a press inside the canvas activates it;
// leaving the canvas or pressing Escape returns scrolling to the page.
export type CanvasScrollCapture = 'always' | 'on-activate'

export type CanvasActivationHint = {
    armed: string
    disarmed: string
}

export const defaultCanvasActivationHint: CanvasActivationHint = {
    armed: 'Scroll or pinch to move and zoom · Esc to release',
    disarmed: 'Drag to move · click to use trackpad scrolling here',
}

export type CanvasScrollActivationOptions = {
    root: HTMLElement
    hint: CanvasActivationHint | false
    // The viewport ignores wheel input inside this class.
    getNoWheelClassName: () => string
}

const INTERACTIVE_TARGET = 'button, input, textarea, select, a, [data-canvas-interactive]'

export class CanvasScrollActivation {
    private readonly hint: HTMLDivElement | null
    private readonly document: Document
    private noWheelClassName: string

    constructor(private readonly options: CanvasScrollActivationOptions) {
        this.document = options.root.ownerDocument
        this.noWheelClassName = options.getNoWheelClassName()
        const html = createDocumentHtml(this.document)
        this.hint = options.hint
            ? html`
                <div
                    className="canvas-engine-activation-hint"
                    aria-hidden="true"
                ></div>
            ` as HTMLDivElement
            : null

        if (this.hint)
            options.root.append(this.hint)

        options.root.addEventListener('pointerdown', this.pointerDown)
        options.root.addEventListener('pointerleave', this.disarm)
        this.document.addEventListener('keydown', this.keyDown)
        this.disarm()
    }

    get armed(): boolean {
        return this.options.root.dataset.canvasScrollCapture === 'armed'
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

        this.arm()
    }

    private keyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape')
            this.disarm()
    }

    arm = (): void => {
        this.refreshClassName()
        this.options.root.classList.remove(this.noWheelClassName)
        this.options.root.dataset.canvasScrollCapture = 'armed'

        if (
            this.hint
            && this.options.hint
        )
            this.hint.textContent = this.options.hint.armed
    }

    disarm = (): void => {
        this.refreshClassName()
        this.options.root.classList.add(this.noWheelClassName)
        this.options.root.dataset.canvasScrollCapture = 'idle'

        if (
            this.hint
            && this.options.hint
        )
            this.hint.textContent = this.options.hint.disarmed
    }

    // A viewport installed after activation can name a different class.
    private refreshClassName(): void {
        const className = this.options.getNoWheelClassName()

        if (className === this.noWheelClassName)
            return

        this.options.root.classList.remove(this.noWheelClassName)
        this.noWheelClassName = className
    }

    destroy(): void {
        this.options.root.removeEventListener('pointerdown', this.pointerDown)
        this.options.root.removeEventListener('pointerleave', this.disarm)
        this.document.removeEventListener('keydown', this.keyDown)
        this.options.root.classList.remove(this.noWheelClassName)
        delete this.options.root.dataset.canvasScrollCapture
        this.hint?.remove()
    }
}
