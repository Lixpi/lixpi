import { isEditableTarget } from '@lixpi/ui-primitives/dom'

export type CanvasKeyboardOptions = {
    root: HTMLElement
    ownsTarget?: (target: Node) => boolean
    onEscape: () => void
    onDelete: () => boolean
}

export class CanvasKeyboardController {
    private readonly document: Document
    private active = false

    constructor(private readonly options: CanvasKeyboardOptions) {
        this.document = options.root.ownerDocument
        this.document.addEventListener(
            'pointerdown',
            this.updateOwner,
            true,
        )
        this.document.addEventListener(
            'focusin',
            this.updateOwner,
            true,
        )
        this.document.addEventListener('keydown', this.keyDown)
    }

    private owns(target: EventTarget | null): boolean {
        if (
            !target
            || !('nodeType' in target)
        )
            return false

        const node = target as Node

        return this.options.root.contains(node) || Boolean(this.options.ownsTarget?.(node))
    }

    private updateOwner = (event: Event): void => void (this.active = this.owns(event.target))

    private keyDown = (event: KeyboardEvent): void => {
        if (event.defaultPrevented)
            return

        const targetOwned = this.owns(event.target)
        const isDocumentTarget = event.target === this.document
            || event.target === this.document.body
            || event.target === this.document.documentElement

        if (
            !targetOwned
            && !(isDocumentTarget && this.active)
        )
            return

        if (event.key === 'Escape') {
            this.options.onEscape()

            return
        }

        if (isEditableTarget(event.target))
            return

        if (
            (event.key === 'Delete' || event.key === 'Backspace')
            && this.options.onDelete()
        )
            event.preventDefault()
    }

    destroy(): void {
        this.document.removeEventListener(
            'pointerdown',
            this.updateOwner,
            true,
        )
        this.document.removeEventListener(
            'focusin',
            this.updateOwner,
            true,
        )
        this.document.removeEventListener('keydown', this.keyDown)
        this.active = false
    }
}
