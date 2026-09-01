import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'

let nextHelpTooltipId = 0

const DEFAULT_HELP_TOOLTIP_TRIGGER_SIZE = 14
const DEFAULT_HELP_TOOLTIP_ICON_SIZE = 12
const DEFAULT_HELP_TOOLTIP_ICON_SCALE = DEFAULT_HELP_TOOLTIP_ICON_SIZE / DEFAULT_HELP_TOOLTIP_TRIGGER_SIZE
const DEFAULT_HELP_TOOLTIP_ARROW_SIZE = 6

type HelpTooltipPlacement = 'right' | 'left' | 'bottom' | 'top'

type HelpTooltipTriggerElement = HTMLElement | SVGElement

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

export type HelpTooltipContent = string | HTMLElement | HTMLElement[]

const helpTooltipTargetAttribute = 'data-help-tooltip'
const helpTooltipPlacementAttribute = 'data-help-tooltip-placement'
const helpTooltipSimplePlacementOrder: HelpTooltipPlacement[] = ['top', 'bottom', 'right', 'left']

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

// Small TypeScript-html tooltip primitive for ProseMirror and other imperative DOM surfaces.
export type HelpTooltipConfig = {
    document?: Document
    portalRoot?: HTMLElement
    hideDelayMs?: number
    label: string
    text?: string
    content?: HelpTooltipContent
    triggerElement?: HelpTooltipTriggerElement
    describeTrigger?: boolean
    triggerContent?: HTMLElement
    icon?: string
    triggerSize?: number
    iconSize?: number
    preferredPlacement?: HelpTooltipPlacement
    placementOrder?: readonly HelpTooltipPlacement[]
    showDelayMs?: number
    shouldShow?: () => boolean
    className?: string
    triggerClassName?: string
    contentClassName?: string
    contentCssVariableNames?: string[]
    inheritContentStyles?: boolean
    interactive?: boolean
}

export type HelpTooltipInstance = {
    dom: HTMLElement
    show: () => void
    hide: () => void
    setContent: (content: HelpTooltipContent) => void
    destroy: () => void
}

export type HelpTooltipProviderConfig = {
    portalRoot?: HTMLElement
    showDelayMs?: number
    root?: Document | HTMLElement
    shouldShow?: (trigger: HelpTooltipTriggerElement) => boolean
}

export type HelpTooltipProviderInstance = {
    destroy: () => void
}

class HelpTooltip implements HelpTooltipInstance {
    private readonly document: Document
    private readonly view: Window
    private readonly html: ReturnType<typeof createDocumentHtml>
    private readonly portalRoot: HTMLElement
    private destroyed = false
    readonly dom: HTMLElement

    private readonly trigger: HelpTooltipTriggerElement
    private readonly content: HTMLElement
    private readonly tooltipId = `help-tooltip-${nextHelpTooltipId++}`
    private readonly ownsTrigger: boolean
    private isTrackingViewport = false
    private isTriggerActive = false
    private isPointerWithinTrigger = false
    private isActivationSuppressedUntilExit = false
    private isContentActive = false
    private showTimer: number | null = null
    private hideTimer: number | null = null
    private contentResizeObserver: ResizeObserver | null = null

    constructor(private readonly config: HelpTooltipConfig) {
        this.document = config.portalRoot?.ownerDocument ?? config.triggerElement?.ownerDocument ?? config.document ?? document
        this.view = this.document.defaultView ?? window
        this.html = createDocumentHtml(this.document)
        this.portalRoot = config.portalRoot ?? this.document.body
        this.ownsTrigger = !config.triggerElement
        this.dom = this.render()
        this.trigger = config.triggerElement
            ?? this.dom.querySelector<HTMLElement>('.help-tooltip-trigger') as HTMLElement
        this.content = this.dom.querySelector('.help-tooltip-content') as HTMLElement
        this.applyTriggerDimensions()
        this.addTriggerListeners()
    }

    private render(): HTMLElement {
        const rootClassName = `help-tooltip${this.config.className ? ` ${this.config.className}` : ''}`
        const contentClassName = `help-tooltip-content${this.config.contentClassName ? ` ${this.config.contentClassName}` : ''}${this.config.interactive ? ' help-tooltip-content-interactive' : ''}`
        const content = this.html`
            <span id=${this.tooltipId} className=${contentClassName} role="tooltip">
                ${this.config.content ?? this.config.text ?? ''}
            </span>
        ` as HTMLElement

        if (this.config.triggerElement) {
            return this.html`
                <span className=${rootClassName} contenteditable="false">${content}</span>
            ` as HTMLElement
        }

        return this.html`
            <span className=${rootClassName} contenteditable="false">
                ${this.renderTrigger()}
                ${content}
            </span>
        ` as HTMLElement
    }

    private renderTrigger(): HTMLElement {
        const triggerClassName = this.config.triggerClassName ? ` ${this.config.triggerClassName}` : ''
        if (this.config.triggerContent) {
            return this.html`
                <span
                    className=${`help-tooltip-trigger help-tooltip-trigger-custom${triggerClassName}`}
                    tabindex="0"
                    aria-label=${this.config.label}
                    aria-describedby=${this.tooltipId}
                    onpointerdown=${this.stopControlEvent}
                    onmousedown=${this.stopControlEvent}
                    onclick=${this.stopControlEvent}
                >
                    ${this.config.triggerContent}
                </span>
            ` as HTMLElement
        }

        return this.html`
            <button
                type="button"
                className=${`help-tooltip-trigger${triggerClassName}`}
                aria-label=${this.config.label}
                aria-describedby=${this.tooltipId}
                onpointerdown=${this.stopControlEvent}
                onmousedown=${this.stopControlEvent}
                onclick=${this.stopControlEvent}
            >
                <span className="help-tooltip-mark" innerHTML=${this.config.icon ?? '?'}></span>
            </button>
        ` as HTMLButtonElement
    }

    private applyTriggerDimensions(): void {
        if (!this.ownsTrigger || this.config.triggerContent) return

        const triggerSize = Math.max(1, this.config.triggerSize ?? DEFAULT_HELP_TOOLTIP_TRIGGER_SIZE)
        const iconSize = Math.max(1, this.config.iconSize ?? triggerSize * DEFAULT_HELP_TOOLTIP_ICON_SCALE)
        this.dom.style.setProperty('--help-tooltip-trigger-size', `${triggerSize}px`)
        this.dom.style.setProperty('--help-tooltip-icon-size', `${iconSize}px`)
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
        this.trigger.addEventListener('click', this.handleTriggerClick)
        this.trigger.addEventListener('keydown', this.handleEscapeKey)

        if (this.config.interactive) {
            this.content.addEventListener('pointerenter', this.handleContentPointerEnter)
            this.content.addEventListener('pointerleave', this.handleContentPointerLeave)
            this.content.addEventListener('focusin', this.handleContentFocusIn)
            this.content.addEventListener('focusout', this.handleContentFocusOut)
            this.content.addEventListener('keydown', this.handleEscapeKey)
        }
    }

    private removeTriggerListeners(): void {
        this.trigger.removeEventListener('pointerenter', this.handleTriggerPointerEnter)
        this.trigger.removeEventListener('pointerleave', this.handleTriggerPointerLeave)
        this.trigger.removeEventListener('focusin', this.handleTriggerFocusIn)
        this.trigger.removeEventListener('focusout', this.handleTriggerFocusOut)
        this.trigger.removeEventListener('click', this.handleTriggerClick)
        this.trigger.removeEventListener('keydown', this.handleEscapeKey)

        if (this.config.interactive) {
            this.content.removeEventListener('pointerenter', this.handleContentPointerEnter)
            this.content.removeEventListener('pointerleave', this.handleContentPointerLeave)
            this.content.removeEventListener('focusin', this.handleContentFocusIn)
            this.content.removeEventListener('focusout', this.handleContentFocusOut)
            this.content.removeEventListener('keydown', this.handleEscapeKey)
        }
    }

    private syncContentCssVariables(): void {
        if (this.config.inheritContentStyles === false) return

        const computedStyle = this.view.getComputedStyle(this.ownsTrigger ? this.dom : this.trigger)
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
        if (this.content.parentElement === this.portalRoot) return

        this.syncContentCssVariables()
        this.portalRoot.appendChild(this.content)
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
        const value = Number.parseFloat(this.view.getComputedStyle(this.content).getPropertyValue(propertyName))
        return Number.isFinite(value) ? value : fallback
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max)
    }

    private getViewportBounds(): HelpTooltipViewportBounds {
        const viewport = this.view.visualViewport
        const left = viewport?.offsetLeft ?? 0
        const top = viewport?.offsetTop ?? 0
        const width = viewport?.width ?? this.view.innerWidth
        const height = viewport?.height ?? this.view.innerHeight

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
        const placementOrder = this.config.placementOrder ?? defaultPlacementOrder
        const placementFits: Record<HelpTooltipPlacement, boolean> = {
            right: availableRight >= requiredWidth,
            left: availableLeft >= requiredWidth,
            bottom: availableBottom >= requiredHeight,
            top: availableTop >= requiredHeight,
        }

        for (const placement of placementOrder) {
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
        const arrowSize = this.getCssPixelValue('--help-tooltip-arrow-size', DEFAULT_HELP_TOOLTIP_ARROW_SIZE)
        const arrowGap = this.getCssPixelValue('--help-tooltip-arrow-gap', 8)
        const offset = Math.max(
            this.getCssPixelValue('--help-tooltip-offset', 10),
            arrowSize + arrowGap,
        )
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
        const contentLeft = this.clamp(position.left, minLeft, Math.max(minLeft, maxLeft))
        const contentTop = this.clamp(position.top, minTop, Math.max(minTop, maxTop))
        applyStyle(this.content, {
            left: `${contentLeft}px`,
            top: `${contentTop}px`,
        })
        this.positionArrow(placement, triggerRect, contentRect, contentLeft, contentTop)
    }

    private positionArrow(
        placement: HelpTooltipPlacement,
        triggerRect: DOMRect,
        contentRect: DOMRect,
        contentLeft: number,
        contentTop: number,
    ): void {
        const arrowSize = this.getCssPixelValue('--help-tooltip-arrow-size', DEFAULT_HELP_TOOLTIP_ARROW_SIZE)
        const contentStyle = this.view.getComputedStyle(this.content)
        const borderRadius = Math.max(
            Number.parseFloat(contentStyle.borderTopLeftRadius) || 0,
            Number.parseFloat(contentStyle.borderTopRightRadius) || 0,
            Number.parseFloat(contentStyle.borderBottomLeftRadius) || 0,
            Number.parseFloat(contentStyle.borderBottomRightRadius) || 0,
        )
        const horizontalInset = Math.min(
            contentRect.width / 2,
            Math.max(arrowSize, borderRadius + arrowSize),
        )
        const verticalInset = Math.min(
            contentRect.height / 2,
            Math.max(arrowSize, borderRadius + arrowSize),
        )
        const triggerCenterX = triggerRect.left + triggerRect.width / 2
        const triggerCenterY = triggerRect.top + triggerRect.height / 2
        const contentRight = contentLeft + contentRect.width
        const contentBottom = contentTop + contentRect.height
        const arrowCenterX = this.clamp(
            triggerCenterX,
            contentLeft + horizontalInset,
            Math.max(contentLeft + horizontalInset, contentRight - horizontalInset),
        )
        const arrowCenterY = this.clamp(
            triggerCenterY,
            contentTop + verticalInset,
            Math.max(contentTop + verticalInset, contentBottom - verticalInset),
        )
        const surfaceColor = contentStyle.backgroundColor

        this.content.style.setProperty(
            '--help-tooltip-arrow-cross-position',
            `${
                placement === 'top' || placement === 'bottom'
                    ? arrowCenterX - contentLeft
                    : arrowCenterY - contentTop
            }px`,
        )
        this.content.style.setProperty('--help-tooltip-arrow-surface-color', surfaceColor)
    }

    private addViewportListeners(): void {
        if (this.isTrackingViewport) return

        this.view.addEventListener('resize', this.positionTooltip)
        this.view.visualViewport?.addEventListener('resize', this.positionTooltip)
        this.view.visualViewport?.addEventListener('scroll', this.positionTooltip)
        this.document.addEventListener('scroll', this.positionTooltip, true)
        this.isTrackingViewport = true
    }

    private removeViewportListeners(): void {
        if (!this.isTrackingViewport) return

        this.view.removeEventListener('resize', this.positionTooltip)
        this.view.visualViewport?.removeEventListener('resize', this.positionTooltip)
        this.view.visualViewport?.removeEventListener('scroll', this.positionTooltip)
        this.document.removeEventListener('scroll', this.positionTooltip, true)
        this.isTrackingViewport = false
    }

    private displayTooltip(): void {
        if (!this.canShowTooltip() || (!this.isTriggerActive && !this.isContentActive)) return

        this.mountContent()
        this.syncTriggerDescription(true)
        this.positionTooltip()
        this.content.classList.add('is-visible')
        this.addViewportListeners()
    }

    private showTooltip = (): void => {
        this.clearHideTimer()
        if (!this.canShowTooltip()) {
            this.clearShowTimer()
            return
        }
        if (this.content.classList.contains('is-visible')) return

        const showDelayMs = Math.max(0, this.config.showDelayMs ?? 0)
        if (showDelayMs === 0) {
            this.displayTooltip()
            return
        }
        if (this.showTimer !== null) return

        this.showTimer = this.view.setTimeout(() => {
            this.showTimer = null
            this.displayTooltip()
        }, showDelayMs)
    }

    private clearShowTimer(): void {
        if (this.showTimer === null) return

        this.view.clearTimeout(this.showTimer)
        this.showTimer = null
    }

    private clearHideTimer(): void {
        if (this.hideTimer === null) return

        this.view.clearTimeout(this.hideTimer)
        this.hideTimer = null
    }

    private canShowTooltip(): boolean {
        return !this.destroyed && !this.isActivationSuppressedUntilExit && (this.config.shouldShow?.() ?? true)
    }

    private requestHideTooltip = (): void => {
        if (!this.config.interactive) {
            this.hideTooltip()
            return
        }

        this.clearHideTimer()
        this.hideTimer = this.view.setTimeout(() => {
            this.hideTimer = null
            const activeElement = this.document.activeElement
            const hasFocus = activeElement ? this.trigger.contains(activeElement) || this.content.contains(activeElement) : false
            if (!this.isTriggerActive && !this.isContentActive && !hasFocus) {
                this.hideTooltip()
            }
        }, this.config.hideDelayMs ?? 80)
    }

    private handleTriggerPointerEnter = (): void => {
        this.isPointerWithinTrigger = true
        this.isTriggerActive = true
        this.showTooltip()
    }

    private handleTriggerPointerLeave = (): void => {
        this.isPointerWithinTrigger = false
        this.isActivationSuppressedUntilExit = false
        this.isTriggerActive = false
        this.requestHideTooltip()
    }

    private handleTriggerFocusIn = (): void => {
        this.isTriggerActive = true
        this.showTooltip()
    }

    private handleTriggerFocusOut = (): void => {
        if (!this.isPointerWithinTrigger) this.isActivationSuppressedUntilExit = false
        this.isTriggerActive = false
        this.requestHideTooltip()
    }

    private handleTriggerClick = (): void => {
        this.isPointerWithinTrigger ||= this.trigger.matches(':hover')
        this.isActivationSuppressedUntilExit = true
        this.isTriggerActive = false
        this.hideTooltip()
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

    private handleEscapeKey = (event: Event): void => {
        if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return

        event.stopPropagation()
        this.hideTooltip()
    }

    private syncTriggerDescription(visible: boolean): void {
        if (this.ownsTrigger || this.config.describeTrigger === false) return

        const descriptionIds = new Set((this.trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean))
        if (visible) descriptionIds.add(this.tooltipId)
        else descriptionIds.delete(this.tooltipId)
        const value = [...descriptionIds].join(' ')
        if (value) this.trigger.setAttribute('aria-describedby', value)
        else this.trigger.removeAttribute('aria-describedby')
    }

    private hideTooltip = (): void => {
        this.clearShowTimer()
        this.clearHideTimer()
        this.content.classList.remove('is-visible')
        this.removeViewportListeners()
        this.disconnectContentResizeObserver()
        this.content.remove()
        this.syncTriggerDescription(false)
    }

    show(): void {
        this.isTriggerActive = true
        this.showTooltip()
    }

    hide(): void {
        this.isTriggerActive = false
        this.hideTooltip()
    }

    setContent(content: HelpTooltipContent): void {
        if (typeof content === 'string') {
            this.content.textContent = content
        } else {
            this.content.replaceChildren(...(Array.isArray(content) ? content : [content]))
        }
        if (this.content.classList.contains('is-visible')) this.positionTooltip()
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.hideTooltip()
        this.removeTriggerListeners()
        this.content.remove()
        this.dom.remove()
    }
}

export function createHelpTooltip(config: HelpTooltipConfig): HelpTooltipInstance {
    return new HelpTooltip(config)
}

class HelpTooltipProvider implements HelpTooltipProviderInstance {
    private readonly root: Document | HTMLElement
    private readonly activeTriggerObserver: MutationObserver | null
    private activeTrigger: HelpTooltipTriggerElement | null = null
    private activeTooltip: HelpTooltipInstance | null = null

    constructor(private readonly config: HelpTooltipProviderConfig) {
        this.root = config.root ?? document
        this.activeTriggerObserver = typeof MutationObserver === 'undefined'
            ? null
            : new MutationObserver(this.refreshActiveTooltip)
        this.root.addEventListener('pointerover', this.handleActivation)
        this.root.addEventListener('focusin', this.handleActivation)
    }

    private findTrigger(target: EventTarget | null): HelpTooltipTriggerElement | null {
        if (!(target instanceof Element)) return null

        const trigger = target.closest(`[${helpTooltipTargetAttribute}]`)
        if (!(trigger instanceof HTMLElement) && !(trigger instanceof SVGElement)) return null
        if (this.root instanceof HTMLElement && !this.root.contains(trigger)) return null
        return trigger
    }

    private resolveContent(trigger: HelpTooltipTriggerElement): string {
        const source = trigger.getAttribute(helpTooltipTargetAttribute)?.trim() ?? ''
        if (!source || source === 'aria-label') return trigger.getAttribute('aria-label')?.trim() ?? ''
        if (source === 'aria-description') return trigger.getAttribute('aria-description')?.trim() ?? ''
        return source
    }

    private resolvePlacement(trigger: HelpTooltipTriggerElement): HelpTooltipPlacement | undefined {
        const value = trigger.getAttribute(helpTooltipPlacementAttribute)
        if (value === 'top' || value === 'bottom' || value === 'left' || value === 'right') return value
        return undefined
    }

    private refreshActiveTooltip = (): void => {
        if (!this.activeTrigger || !this.activeTooltip) return

        if (!this.shouldShowTrigger(this.activeTrigger)) {
            this.activeTooltip.hide()
            return
        }

        const content = this.resolveContent(this.activeTrigger)
        if (!content) {
            this.activeTooltip.hide()
            return
        }
        this.activeTooltip.setContent(content)
    }

    private observeActiveTrigger(): void {
        if (!this.activeTrigger) return

        this.activeTriggerObserver?.observe(this.activeTrigger, {
            attributes: true,
        })
    }

    private shouldShowTrigger(trigger: HelpTooltipTriggerElement): boolean {
        return this.config.shouldShow?.(trigger) ?? true
    }

    private handleActivation = (event: Event): void => {
        const trigger = this.findTrigger(event.target)
        if (!trigger) return

        if (!this.shouldShowTrigger(trigger)) {
            if (trigger === this.activeTrigger) this.activeTooltip?.hide()
            return
        }

        const content = this.resolveContent(trigger)
        if (!content) {
            if (trigger === this.activeTrigger) this.activeTooltip?.hide()
            return
        }
        if (trigger === this.activeTrigger && this.activeTooltip) {
            this.activeTooltip.setContent(content)
            this.activeTooltip.show()
            return
        }

        this.destroyActiveTooltip()
        const source = trigger.getAttribute(helpTooltipTargetAttribute)?.trim() ?? ''
        this.activeTrigger = trigger
        this.activeTooltip = createHelpTooltip({
            label: trigger.getAttribute('aria-label')?.trim() || content,
            text: content,
            triggerElement: trigger,
            describeTrigger: source !== '' && source !== 'aria-label' && source !== 'aria-description',
            preferredPlacement: this.resolvePlacement(trigger),
            placementOrder: helpTooltipSimplePlacementOrder,
            showDelayMs: this.config.showDelayMs ?? 1000,
            portalRoot: this.config.portalRoot,
            shouldShow: () => this.shouldShowTrigger(trigger),
            contentClassName: 'help-tooltip-content-simple',
            inheritContentStyles: false,
        })
        this.observeActiveTrigger()
        this.activeTooltip.show()
    }

    private destroyActiveTooltip(): void {
        this.activeTriggerObserver?.disconnect()
        this.activeTooltip?.destroy()
        this.activeTooltip = null
        this.activeTrigger = null
    }

    destroy(): void {
        this.root.removeEventListener('pointerover', this.handleActivation)
        this.root.removeEventListener('focusin', this.handleActivation)
        this.destroyActiveTooltip()
    }
}

export function createHelpTooltipProvider(config: HelpTooltipProviderConfig = {}): HelpTooltipProviderInstance {
    return new HelpTooltipProvider(config)
}
