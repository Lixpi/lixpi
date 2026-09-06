import {
    applyStyle,
    createDocumentHtml,
    copyCssCustomProperties,
} from '@lixpi/ui-primitives/dom'
import {
    createHelpTooltip,
    type HelpTooltipInstance,
} from '../helpTooltip/index.ts'
import { InteractivePreviewPopover } from '../popover/interactivePreviewPopover.ts'

export type ContextPreviewTileInstance = {
    dom: HTMLElement
    destroy: () => void
}
export type ContextPreviewPortal = {
    root: HTMLElement
    scale: number
}
export type ContextPreviewPopoverPlacement = 'top' | 'bottom' | 'left' | 'right'

export type ContextPreviewPopoverContent = {
    accessibleLabel: string
    content: HTMLElement
    contentClassName: string
}

export type ContextPreviewPopoverInstance = ContextPreviewTileInstance & {
    updateContent: (content: ContextPreviewPopoverContent) => void
}

export type CreateContextPreviewPopoverOptions = ContextPreviewPopoverContent & {
    getPortal?: (root: HTMLElement) => ContextPreviewPortal | null
    contentCssVariableNames?: string[]
    hideDelayMs?: number
    gap?: number
    triggerContent: HTMLElement
    preferredPlacement?: ContextPreviewPopoverPlacement
    inlinePopover?: boolean
    inlineLabelTrigger?: boolean
    beforeOpen?: () => void
}

const portalCssVariables = [
    '--help-tooltip-width',
    '--help-tooltip-max-width',
    '--help-tooltip-padding',
    '--help-tooltip-background',
    '--help-tooltip-border-radius',
    '--help-tooltip-box-shadow',
    '--help-tooltip-color',
    '--help-tooltip-content-z-index',
]

const positionContextPreviewCanvasPopover = (
    trigger: HTMLElement,
    popover: HTMLElement,
    portal: ContextPreviewPortal,
    placement: ContextPreviewPopoverPlacement,
    gap: number,
): void => {
    const triggerRect = trigger.getBoundingClientRect()
    const paneRect = portal.root.getBoundingClientRect()
    const triggerLeft = triggerRect.left - paneRect.left
    const triggerTop = triggerRect.top - paneRect.top
    const triggerRight = triggerRect.right - paneRect.left
    const triggerBottom = triggerRect.bottom - paneRect.top
    const scaledGap = `${gap}px`
    const positionByPlacement: Record<ContextPreviewPopoverPlacement, {
        left: string
        top: string
        transform: string
    }> = {
        top: {
            left: `${triggerLeft}px`,
            top: `${triggerTop}px`,
            transform: `scale(${portal.scale}) translateY(calc(-100% - ${scaledGap}))`,
        },
        bottom: {
            left: `${triggerLeft}px`,
            top: `${triggerBottom}px`,
            transform: `scale(${portal.scale}) translateY(${scaledGap})`,
        },
        left: {
            left: `${triggerLeft}px`,
            top: `${triggerTop}px`,
            transform: `scale(${portal.scale}) translateX(calc(-100% - ${scaledGap}))`,
        },
        right: {
            left: `${triggerRight}px`,
            top: `${triggerTop}px`,
            transform: `scale(${portal.scale}) translateX(${scaledGap})`,
        },
    }
    applyStyle(
        popover,
        {
            ...positionByPlacement[placement],
            right: 'auto',
            bottom: 'auto',
            transformOrigin: 'top left',
        },
    )
}

// Inline content may be portaled to a supplied root while preserving view scale.
class ContextPreviewPopover implements ContextPreviewPopoverInstance {
    private destroyed = false
    private readonly view: Window
    readonly dom: HTMLElement

    private readonly trigger: HTMLElement
    private readonly popover: HTMLElement
    private readonly helpTooltip: HelpTooltipInstance | null
    private readonly inlineController: InteractivePreviewPopover | null
    private readonly preferredPlacement: ContextPreviewPopoverPlacement
    private portal: ContextPreviewPortal | null = null
    private portalPositionFrame: number | null = null

    constructor(private readonly options: CreateContextPreviewPopoverOptions) {
        const html = createDocumentHtml(options.triggerContent.ownerDocument)
        this.view = options.triggerContent.ownerDocument.defaultView ?? window
        this.preferredPlacement = options.preferredPlacement ?? 'top'

        if (options.inlinePopover) {
            const rootClassName = [
                'context-preview-main',
                'context-preview-inline',
                options.inlineLabelTrigger ? 'context-preview-inline-label' : '',
            ].filter(Boolean).join(' ')
            this.trigger = html`
                <div
                    className="context-preview-trigger context-preview-inline-trigger"
                    tabindex="0"
                    aria-label=${options.accessibleLabel}
                    aria-expanded="false"
                >${options.triggerContent}</div>
            ` as HTMLElement
            this.popover = html`
                <div
                    className=${this.getInlinePopoverClassName(options.contentClassName, false)}
                    role="tooltip"
                >
                ${options.content}
            </div>
            ` as HTMLElement
            this.dom = html`<div className=${rootClassName}>${this.trigger}${this.popover}</div>` as HTMLElement
            this.helpTooltip = null
            this.inlineController = new InteractivePreviewPopover({
                root: this.dom,
                trigger: this.trigger,
                popover: this.popover,
                beforeOpen: options.beforeOpen,
                afterOpen: this.portalPopoverToCanvasPane,
                afterClose: () => {
                    if (this.popover.parentElement !== this.dom)
                        this.restorePopoverToTile()
                },
            })

            return
        }

        const usesInlineLabelTrigger = options.inlineLabelTrigger ?? false
        this.helpTooltip = createHelpTooltip({
            hideDelayMs: options.hideDelayMs,
            label: options.accessibleLabel,
            triggerContent: options.triggerContent,
            content: options.content,
            preferredPlacement: this.preferredPlacement,
            className: [
                'context-preview-tooltip',
                usesInlineLabelTrigger ? 'context-preview-tooltip-inline-label' : '',
            ].filter(Boolean).join(' '),
            triggerClassName: [
                'context-preview-trigger',
                usesInlineLabelTrigger ? 'context-preview-trigger-inline-label' : '',
            ].filter(Boolean).join(' '),
            contentClassName: options.contentClassName,
            contentCssVariableNames: options.contentCssVariableNames,
            interactive: true,
        })
        this.trigger = this.helpTooltip.dom.querySelector<HTMLElement>('.help-tooltip-trigger') as HTMLElement
        this.popover = this.helpTooltip.dom.querySelector<HTMLElement>('.help-tooltip-content') as HTMLElement
        this.dom = usesInlineLabelTrigger
            ? this.helpTooltip.dom
            : html`<div className="context-preview-main">${this.helpTooltip.dom}</div>` as HTMLElement
        this.inlineController = null
        this.trigger.addEventListener(
            'pointerenter',
            this.handleBeforeOpen,
            true,
        )
        this.trigger.addEventListener(
            'focusin',
            this.handleBeforeOpen,
            true,
        )
    }

    updateContent = ({
        accessibleLabel,
        content,
        contentClassName,
    }: ContextPreviewPopoverContent): void => {
        if (this.destroyed)
            return

        this.popover.replaceChildren(content)
        this.trigger.setAttribute('aria-label', accessibleLabel)

        if (this.options.inlinePopover) {
            const isPortaled = this.popover.classList.contains('context-preview-inline-popover-portaled')
            this.popover.className = this.getInlinePopoverClassName(
                contentClassName,
                this.dom.classList.contains('is-open'),
            )
            this.popover.classList.toggle('context-preview-inline-popover-portaled', isPortaled)

            return
        }

        const isVisible = this.popover.classList.contains('is-visible')
        this.popover.className = [
            'help-tooltip-content',
            contentClassName,
            'help-tooltip-content-interactive',
            isVisible ? 'is-visible' : '',
        ].filter(Boolean).join(' ')
    }

    destroy = (): void => {
        if (this.destroyed)
            return

        this.destroyed = true
        this.stopPortalPositionSync()

        if (this.helpTooltip) {
            this.trigger.removeEventListener(
                'pointerenter',
                this.handleBeforeOpen,
                true,
            )
            this.trigger.removeEventListener(
                'focusin',
                this.handleBeforeOpen,
                true,
            )
            this.helpTooltip.destroy()
            this.dom.remove()

            return
        }

        this.inlineController?.destroy()
    }

    private getInlinePopoverClassName(
        contentClassName: string,
        isOpen: boolean,
    ): string {
        return [
            contentClassName,
            'context-preview-inline-popover',
            `context-preview-inline-popover-${this.preferredPlacement}`,
            isOpen ? 'is-open' : '',
        ].filter(Boolean).join(' ')
    }

    private handleBeforeOpen = (): void => void this.options.beforeOpen?.()

    private stopPortalPositionSync(): void {
        if (this.portalPositionFrame === null)
            return

        this.view.cancelAnimationFrame(this.portalPositionFrame)
        this.portalPositionFrame = null
    }

    private restorePopoverToTile(): void {
        this.stopPortalPositionSync()
        this.portal = null
        this.popover.classList.remove('context-preview-inline-popover-portaled')
        this.popover.removeAttribute('style')

        if (this.dom.isConnected) {
            this.dom.appendChild(this.popover)

            return
        }

        this.popover.remove()
    }

    private syncPortalPosition(): void {
        if (
            !this.portal
            || !this.dom.isConnected
        )
            return

        this.portal = this.options.getPortal?.(this.dom) ?? this.portal
        positionContextPreviewCanvasPopover(
            this.trigger,
            this.popover,
            this.portal,
            this.preferredPlacement,
            this.options.gap ?? 10,
        )
    }

    private startPortalPositionSync(): void {
        this.stopPortalPositionSync()
        const update = (): void => {
            if (!this.dom.isConnected) {
                this.restorePopoverToTile()

                return
            }

            this.syncPortalPosition()
            this.portalPositionFrame = this.view.requestAnimationFrame(update)
        }
        this.portalPositionFrame = this.view.requestAnimationFrame(update)
    }

    private portalPopoverToCanvasPane = (): void => {
        const nextPortal = this.options.getPortal?.(this.dom)

        if (!nextPortal)
            return

        this.portal = nextPortal
        copyCssCustomProperties(
            this.dom,
            this.popover,
            [...(this.options.contentCssVariableNames ?? []), ...portalCssVariables],
        )
        this.popover.classList.add('context-preview-inline-popover-portaled')
        nextPortal.root.appendChild(this.popover)
        this.syncPortalPosition()
        this.startPortalPositionSync()
    }
}

export const createContextPreviewPopover = (options: CreateContextPreviewPopoverOptions): ContextPreviewPopoverInstance =>
    new ContextPreviewPopover(options)
