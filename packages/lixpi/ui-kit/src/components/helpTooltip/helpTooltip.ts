import { applyStyle, html } from '../../dom/domTemplates.ts'
import { questionMarkCircleIcon } from '../../svg/svgIcons.ts'
import { uiKitSettings } from '../../runtime-settings.ts'

let nextHelpTooltipId = 0

type HelpTooltipPlacement = 'right' | 'left' | 'bottom' | 'top'

type HelpTooltipViewportBounds = {
    left: number
    top: number
    right: number
    bottom: number
}

type HelpTooltipPosition = {
    left: number
    top: number
}

type HelpTooltipContent = string | HTMLElement | HTMLElement[]

const helpTooltipCssVariableNames = [
    '--help-tooltip-trigger-size',
    '--help-tooltip-trigger-border',
    '--help-tooltip-trigger-background',
    '--help-tooltip-trigger-color',
    '--help-tooltip-trigger-hover-background',
    '--help-tooltip-trigger-hover-color',
    '--help-tooltip-icon-size',
    '--help-tooltip-trigger-focus-outline',
    '--help-tooltip-trigger-focus-outline-offset',
    '--help-tooltip-offset',
    '--help-tooltip-viewport-margin',
    '--help-tooltip-width',
    '--help-tooltip-max-width',
    '--help-tooltip-padding',
    '--help-tooltip-background',
    '--help-tooltip-border',
    '--help-tooltip-border-radius',
    '--help-tooltip-box-shadow',
    '--help-tooltip-color',
    '--help-tooltip-font-size',
    '--help-tooltip-font-weight',
    '--help-tooltip-line-height',
    '--help-tooltip-content-z-index',
]

// Small TypeScript-html tooltip primitive for ProseMirror and other non-Svelte DOM surfaces.
export type HelpTooltipConfig = {
    label: string
    text?: string
    content?: HelpTooltipContent
    triggerContent?: HTMLElement
    preferredPlacement?: HelpTooltipPlacement
    className?: string
    triggerClassName?: string
    contentClassName?: string
    contentCssVariableNames?: string[]
    interactive?: boolean
}

export type HelpTooltipInstance = {
    dom: HTMLElement
    destroy: () => void
}

class HelpTooltip implements HelpTooltipInstance {
    readonly dom: HTMLElement

    private readonly trigger: HTMLElement
    private readonly content: HTMLElement
    private readonly tooltipId = `help-tooltip-${nextHelpTooltipId++}`
    private isTrackingViewport = false
    private isTriggerActive = false
    private isContentActive = false
    private hideTimer: number | null = null
    private contentResizeObserver: ResizeObserver | null = null

    constructor(private readonly config: HelpTooltipConfig) {
        this.dom = this.render()
        this.trigger = this.dom.querySelector('.help-tooltip-trigger') as HTMLElement
        this.content = this.dom.querySelector('.help-tooltip-content') as HTMLElement
        this.addTriggerListeners()
    }

    private render(): HTMLElement {
        const contentClassName = `help-tooltip-content${this.config.contentClassName ? ` ${this.config.contentClassName}` : ''}${this.config.interactive ? ' help-tooltip-content-interactive' : ''}`

        return html`
            <span className=${`help-tooltip${this.config.className ? ` ${this.config.className}` : ''}`} contenteditable="false">
                ${this.renderTrigger()}
                <span id=${this.tooltipId} className=${contentClassName} role="tooltip">
                    ${this.config.content ?? this.config.text ?? ''}
                </span>
            </span>
        ` as HTMLElement
    }

    private renderTrigger(): HTMLElement {
        const triggerClassName = this.config.triggerClassName ? ` ${this.config.triggerClassName}` : ''
        if (this.config.triggerContent) {
            return html`
                <span
                    className=${`help-tooltip-trigger help-tooltip-trigger-custom${triggerClassName}`}
                    tabindex="0"
                    aria-label=${this.config.label}
                    aria-describedby=${this.tooltipId}
                    onmousedown=${this.stopControlEvent}
                    onclick=${this.stopControlEvent}
                >
                    ${this.config.triggerContent}
                </span>
            ` as HTMLElement
        }

        return html`
            <button
                type="button"
                className=${`help-tooltip-trigger${triggerClassName}`}
                aria-label=${this.config.label}
                aria-describedby=${this.tooltipId}
                onmousedown=${this.stopControlEvent}
                onclick=${this.stopControlEvent}
            >
                <span className="help-tooltip-mark" innerHTML=${questionMarkCircleIcon}></span>
            </button>
        ` as HTMLButtonElement
    }

    private stopControlEvent = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
    }

    private addTriggerListeners(): void {
        this.trigger.addEventListener('pointerenter', this.handleTriggerPointerEnter)
        this.trigger.addEventListener('pointerleave', this.handleTriggerPointerLeave)
        this.trigger.addEventListener('focusin', this.handleTriggerFocusIn)
        this.trigger.addEventListener('focusout', this.handleTriggerFocusOut)

        if (this.config.interactive) {
            this.content.addEventListener('pointerenter', this.handleContentPointerEnter)
            this.content.addEventListener('pointerleave', this.handleContentPointerLeave)
            this.content.addEventListener('focusin', this.handleContentFocusIn)
            this.content.addEventListener('focusout', this.handleContentFocusOut)
        }
    }

    private removeTriggerListeners(): void {
        this.trigger.removeEventListener('pointerenter', this.handleTriggerPointerEnter)
        this.trigger.removeEventListener('pointerleave', this.handleTriggerPointerLeave)
        this.trigger.removeEventListener('focusin', this.handleTriggerFocusIn)
        this.trigger.removeEventListener('focusout', this.handleTriggerFocusOut)

        if (this.config.interactive) {
            this.content.removeEventListener('pointerenter', this.handleContentPointerEnter)
            this.content.removeEventListener('pointerleave', this.handleContentPointerLeave)
            this.content.removeEventListener('focusin', this.handleContentFocusIn)
            this.content.removeEventListener('focusout', this.handleContentFocusOut)
        }
    }

    private syncContentCssVariables(): void {
        const computedStyle = getComputedStyle(this.dom)
        const cssVariableNames = this.config.contentCssVariableNames
            ? [...helpTooltipCssVariableNames, ...this.config.contentCssVariableNames]
            : helpTooltipCssVariableNames

        for (const variableName of cssVariableNames) {
            const value = computedStyle.getPropertyValue(variableName)
            if (value.trim()) {
                this.content.style.setProperty(variableName, value)
            }
        }
    }

    private mountContent(): void {
        if (this.content.parentElement === document.body) return

        this.syncContentCssVariables()
        document.body.appendChild(this.content)
        this.observeContentSize()
    }

    private observeContentSize(): void {
        if (this.contentResizeObserver || typeof ResizeObserver === 'undefined') return

        this.contentResizeObserver = new ResizeObserver(() => {
            this.positionTooltip()
        })
        this.contentResizeObserver.observe(this.content)
    }

    private disconnectContentResizeObserver(): void {
        this.contentResizeObserver?.disconnect()
        this.contentResizeObserver = null
    }

    private getCssPixelValue(propertyName: string, fallback: number): number {
        const value = Number.parseFloat(getComputedStyle(this.dom).getPropertyValue(propertyName))
        return Number.isFinite(value) ? value : fallback
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max)
    }

    private getViewportBounds(): HelpTooltipViewportBounds {
        const viewport = window.visualViewport
        const left = viewport?.offsetLeft ?? 0
        const top = viewport?.offsetTop ?? 0
        const width = viewport?.width ?? window.innerWidth
        const height = viewport?.height ?? window.innerHeight

        return {
            left,
            top,
            right: left + width,
            bottom: top + height,
        }
    }

    private choosePlacement(triggerRect: DOMRect, contentRect: DOMRect, viewportBounds: HelpTooltipViewportBounds, offset: number, margin: number): HelpTooltipPlacement {
        if (this.config.preferredPlacement) return this.config.preferredPlacement

        const availableRight = viewportBounds.right - triggerRect.right - margin
        const availableLeft = triggerRect.left - viewportBounds.left - margin
        const availableBottom = viewportBounds.bottom - triggerRect.bottom - margin
        const availableTop = triggerRect.top - viewportBounds.top - margin
        const requiredWidth = contentRect.width + offset
        const requiredHeight = contentRect.height + offset
        const defaultPlacementOrder: HelpTooltipPlacement[] = ['right', 'left', 'bottom', 'top']
        const placementFits: Record<HelpTooltipPlacement, boolean> = {
            right: availableRight >= requiredWidth,
            left: availableLeft >= requiredWidth,
            bottom: availableBottom >= requiredHeight,
            top: availableTop >= requiredHeight,
        }

        for (const placement of defaultPlacementOrder) {
            if (placementFits[placement]) return placement
        }

        return availableLeft > availableRight ? 'left' : 'right'
    }

    private getPlacementPositions(triggerRect: DOMRect, contentRect: DOMRect, offset: number): Record<HelpTooltipPlacement, HelpTooltipPosition> {
        const centerLeft = triggerRect.left + (triggerRect.width / 2) - (contentRect.width / 2)
        const centerTop = triggerRect.top + (triggerRect.height / 2) - (contentRect.height / 2)

        return {
            right: {
                left: triggerRect.right + offset,
                top: centerTop,
            },
            left: {
                left: triggerRect.left - contentRect.width - offset,
                top: centerTop,
            },
            bottom: {
                left: centerLeft,
                top: triggerRect.bottom + offset,
            },
            top: {
                left: centerLeft,
                top: triggerRect.top - contentRect.height - offset,
            },
        }
    }

    private positionTooltip = (): void => {
        const triggerRect = this.trigger.getBoundingClientRect()
        const viewportBounds = this.getViewportBounds()
        const offset = this.getCssPixelValue('--help-tooltip-offset', 8)
        const margin = this.getCssPixelValue('--help-tooltip-viewport-margin', 8)
        if (this.config.preferredPlacement === 'top') {
            const availableHeight = triggerRect.top - viewportBounds.top - margin - offset
            this.content.style.setProperty('--help-tooltip-available-max-height', `${Math.max(0, availableHeight)}px`)
        } else {
            this.content.style.removeProperty('--help-tooltip-available-max-height')
        }
        const contentRect = this.content.getBoundingClientRect()
        const placement = this.choosePlacement(triggerRect, contentRect, viewportBounds, offset, margin)
        const minLeft = viewportBounds.left + margin
        const maxLeft = viewportBounds.right - contentRect.width - margin
        const minTop = viewportBounds.top + margin
        const maxTop = viewportBounds.bottom - contentRect.height - margin
        const position = this.getPlacementPositions(triggerRect, contentRect, offset)[placement]

        this.content.dataset.placement = placement
        applyStyle(this.content, {
            left: `${this.clamp(position.left, minLeft, Math.max(minLeft, maxLeft))}px`,
            top: `${this.clamp(position.top, minTop, Math.max(minTop, maxTop))}px`,
        })
    }

    private addViewportListeners(): void {
        if (this.isTrackingViewport) return

        window.addEventListener('resize', this.positionTooltip)
        window.visualViewport?.addEventListener('resize', this.positionTooltip)
        window.visualViewport?.addEventListener('scroll', this.positionTooltip)
        document.addEventListener('scroll', this.positionTooltip, true)
        this.isTrackingViewport = true
    }

    private removeViewportListeners(): void {
        if (!this.isTrackingViewport) return

        window.removeEventListener('resize', this.positionTooltip)
        window.visualViewport?.removeEventListener('resize', this.positionTooltip)
        window.visualViewport?.removeEventListener('scroll', this.positionTooltip)
        document.removeEventListener('scroll', this.positionTooltip, true)
        this.isTrackingViewport = false
    }

    private showTooltip = (): void => {
        this.clearHideTimer()
        this.mountContent()
        this.positionTooltip()
        this.content.classList.add('is-visible')
        this.addViewportListeners()
    }

    private clearHideTimer(): void {
        if (this.hideTimer === null) return

        window.clearTimeout(this.hideTimer)
        this.hideTimer = null
    }

    private requestHideTooltip = (): void => {
        if (!this.config.interactive) {
            this.hideTooltip()
            return
        }

        this.clearHideTimer()
        this.hideTimer = window.setTimeout(() => {
            this.hideTimer = null
            const activeElement = document.activeElement
            const hasFocus = activeElement ? this.dom.contains(activeElement) || this.content.contains(activeElement) : false
            if (!this.isTriggerActive && !this.isContentActive && !hasFocus) {
                this.hideTooltip()
            }
        }, uiKitSettings.helpTooltip.interactiveHideDelayMs)
    }

    private handleTriggerPointerEnter = (): void => {
        this.isTriggerActive = true
        this.showTooltip()
    }

    private handleTriggerPointerLeave = (): void => {
        this.isTriggerActive = false
        this.requestHideTooltip()
    }

    private handleTriggerFocusIn = (): void => {
        this.isTriggerActive = true
        this.showTooltip()
    }

    private handleTriggerFocusOut = (): void => {
        this.isTriggerActive = false
        this.requestHideTooltip()
    }

    private handleContentPointerEnter = (): void => {
        this.isContentActive = true
        this.showTooltip()
    }

    private handleContentPointerLeave = (): void => {
        this.isContentActive = false
        this.requestHideTooltip()
    }

    private handleContentFocusIn = (): void => {
        this.isContentActive = true
        this.showTooltip()
    }

    private handleContentFocusOut = (): void => {
        this.isContentActive = false
        this.requestHideTooltip()
    }

    private hideTooltip = (): void => {
        this.clearHideTimer()
        this.content.classList.remove('is-visible')
        this.removeViewportListeners()
        this.disconnectContentResizeObserver()
        this.content.remove()
    }

    destroy(): void {
        this.hideTooltip()
        this.removeTriggerListeners()
        this.content.remove()
        this.dom.remove()
    }
}

export function createHelpTooltip(config: HelpTooltipConfig): HelpTooltipInstance {
    return new HelpTooltip(config)
}
