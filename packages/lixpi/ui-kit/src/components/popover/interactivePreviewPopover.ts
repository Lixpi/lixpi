'use strict'
export type InteractivePreviewPopoverOptions = {
    root: HTMLElement
    trigger: HTMLElement
    popover: HTMLElement
    closeDelayMs?: number
    beforeOpen?: () => void
    afterOpen?: () => void
    afterClose?: () => void
}

export class InteractivePreviewPopover {
    private closeTimer: ReturnType<typeof setTimeout> | null = null
    private destroyed = false
    private suppressNextFocusOpen = false

    constructor(private readonly options: InteractivePreviewPopoverOptions) {
        options.root.addEventListener('pointerenter', this.open)
        options.root.addEventListener('pointerleave', this.scheduleClose)
        options.root.addEventListener('focusin', this.open)
        options.root.addEventListener('focusout', this.scheduleClose)
        options.popover.addEventListener('pointerenter', this.cancelScheduledClose)
        options.popover.addEventListener('pointerleave', this.scheduleClose)
        options.popover.addEventListener('focusin', this.cancelScheduledClose)
        options.popover.addEventListener('focusout', this.scheduleClose)
        options.root.ownerDocument.addEventListener('keydown', this.handleDocumentKeyDown, true)
        options.root.ownerDocument.addEventListener('pointerdown', this.handleDocumentPointerDown, true)
    }

    open = (event?: Event): void => {
        if (this.destroyed) return
        if (event?.type === 'focusin' && this.suppressNextFocusOpen) {
            this.suppressNextFocusOpen = false
            return
        }
        this.cancelScheduledClose()
        this.options.beforeOpen?.()
        this.options.root.classList.add('is-open')
        this.options.popover.classList.add('is-open')
        this.options.trigger.setAttribute('aria-expanded', 'true')
        this.options.afterOpen?.()
    }

    close = (): void => {
        if (this.destroyed) return
        this.cancelScheduledClose()
        this.options.root.classList.remove('is-open')
        this.options.popover.classList.remove('is-open')
        this.options.trigger.setAttribute('aria-expanded', 'false')
        this.options.afterClose?.()
    }

    destroy(): void {
        if (this.destroyed) return
        this.close()
        this.destroyed = true
        this.options.root.removeEventListener('pointerenter', this.open)
        this.options.root.removeEventListener('pointerleave', this.scheduleClose)
        this.options.root.removeEventListener('focusin', this.open)
        this.options.root.removeEventListener('focusout', this.scheduleClose)
        this.options.popover.removeEventListener('pointerenter', this.cancelScheduledClose)
        this.options.popover.removeEventListener('pointerleave', this.scheduleClose)
        this.options.popover.removeEventListener('focusin', this.cancelScheduledClose)
        this.options.popover.removeEventListener('focusout', this.scheduleClose)
        this.options.root.ownerDocument.removeEventListener('keydown', this.handleDocumentKeyDown, true)
        this.options.root.ownerDocument.removeEventListener('pointerdown', this.handleDocumentPointerDown, true)
        this.options.popover.remove()
        this.options.root.remove()
    }

    private cancelScheduledClose = (): void => {
        if (this.closeTimer === null) return
        clearTimeout(this.closeTimer)
        this.closeTimer = null
    }

    private scheduleClose = (event: PointerEvent | FocusEvent): void => {
        const nextTarget = event.relatedTarget
        if (
            nextTarget instanceof Node
            && (this.options.root.contains(nextTarget) || this.options.popover.contains(nextTarget))
        ) return
        this.cancelScheduledClose()
        this.closeTimer = setTimeout(this.close, this.options.closeDelayMs ?? 80)
    }

    private handleDocumentKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || !this.options.root.classList.contains('is-open')) return
        event.preventDefault()
        this.close()
        this.suppressNextFocusOpen = true
        this.options.trigger.focus()
    }

    private handleDocumentPointerDown = (event: PointerEvent): void => {
        if (!this.options.root.classList.contains('is-open')) return
        const target = event.target
        if (
            target instanceof Node
            && (this.options.root.contains(target) || this.options.popover.contains(target))
        ) return
        this.close()
    }
}
