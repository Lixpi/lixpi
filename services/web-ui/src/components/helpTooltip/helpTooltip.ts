import { applyStyle, html } from '$src/utils/domTemplates.ts'
import { questionMarkCircleIcon } from '$src/svgIcons/index.ts'

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
    text: string
    className?: string
}

export type HelpTooltipInstance = {
    dom: HTMLElement
    destroy: () => void
}

class HelpTooltip implements HelpTooltipInstance {
    readonly dom: HTMLElement

    private readonly trigger: HTMLButtonElement
    private readonly content: HTMLElement
    private readonly tooltipId = `help-tooltip-${nextHelpTooltipId++}`
    private isTrackingViewport = false

    constructor(private readonly config: HelpTooltipConfig) {
        this.dom = this.render()
        this.trigger = this.dom.querySelector('.help-tooltip-trigger') as HTMLButtonElement
        this.content = this.dom.querySelector('.help-tooltip-content') as HTMLElement
        this.addTriggerListeners()
    }

    private render(): HTMLElement {
        return html`
            <span className=${`help-tooltip${this.config.className ? ` ${this.config.className}` : ''}`} contenteditable="false">
                <button
                    type="button"
                    className="help-tooltip-trigger"
                    aria-label=${this.config.label}
                    aria-describedby=${this.tooltipId}
                    onmousedown=${this.stopControlEvent}
                    onclick=${this.stopControlEvent}
                >
                    <span className="help-tooltip-mark" innerHTML=${questionMarkCircleIcon}></span>
                </button>
                <span id=${this.tooltipId} className="help-tooltip-content" role="tooltip">
                    ${this.config.text}
                </span>
            </span>
        ` as HTMLElement
    }

    private stopControlEvent = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
    }

    private addTriggerListeners(): void {
        this.dom.addEventListener('pointerenter', this.showTooltip)
        this.dom.addEventListener('pointerleave', this.hideTooltip)
        this.dom.addEventListener('focusin', this.showTooltip)
        this.dom.addEventListener('focusout', this.hideTooltip)
    }

    private removeTriggerListeners(): void {
        this.dom.removeEventListener('pointerenter', this.showTooltip)
        this.dom.removeEventListener('pointerleave', this.hideTooltip)
        this.dom.removeEventListener('focusin', this.showTooltip)
        this.dom.removeEventListener('focusout', this.hideTooltip)
    }

    private syncContentCssVariables(): void {
        const computedStyle = getComputedStyle(this.dom)

        for (const variableName of helpTooltipCssVariableNames) {
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
        const availableRight = viewportBounds.right - triggerRect.right - margin
        const availableLeft = triggerRect.left - viewportBounds.left - margin
        const availableBottom = viewportBounds.bottom - triggerRect.bottom - margin
        const availableTop = triggerRect.top - viewportBounds.top - margin
        const requiredWidth = contentRect.width + offset
        const requiredHeight = contentRect.height + offset

        if (availableRight >= requiredWidth) return 'right'
        if (availableLeft >= requiredWidth) return 'left'
        if (availableBottom >= requiredHeight) return 'bottom'
        if (availableTop >= requiredHeight) return 'top'

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
        const contentRect = this.content.getBoundingClientRect()
        const viewportBounds = this.getViewportBounds()
        const offset = this.getCssPixelValue('--help-tooltip-offset', 8)
        const margin = this.getCssPixelValue('--help-tooltip-viewport-margin', 8)
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
        this.mountContent()
        this.positionTooltip()
        this.content.classList.add('is-visible')
        this.addViewportListeners()
    }

    private hideTooltip = (): void => {
        this.content.classList.remove('is-visible')
        this.removeViewportListeners()
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
