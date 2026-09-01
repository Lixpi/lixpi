import {
    applyStyle,
    html,
} from '@lixpi/ui-primitives/dom'
import { infoBubbleStateManager } from './infoBubbleStateManager.ts'

type InfoBubbleTheme = 'dark' | 'light'
type InfoBubbleArrowSide = 'top' | 'bottom' | 'left' | 'right'
type InfoBubbleOffset = { x?: number; y?: number }
type InfoBubblePosition = { x: number; y: number }

export type InfoBubbleConfig = {
    id: string
    anchor: HTMLElement
    positioningAnchor?: HTMLElement
    theme?: InfoBubbleTheme
    arrowSide?: InfoBubbleArrowSide
    headerContent?: HTMLElement
    bodyContent: HTMLElement
    visible?: boolean
    onOpen?: () => void
    onClose?: () => void
    closeOnClickOutside?: boolean
    disableAutoPositioning?: boolean
    offset?: InfoBubbleOffset
    arrowCrossOffset?: number
    className?: string
}

export type InfoBubbleInstance = {
    dom: HTMLElement
    open: () => void
    close: () => void
    toggle: () => void
    isOpen: () => boolean
    destroy: () => void
}

const staticPositionGap = 15
const viewportMargin = 8
const defaultOffset: Required<InfoBubbleOffset> = { x: 0, y: 20 }
const oppositeArrowSide: Record<InfoBubbleArrowSide, InfoBubbleArrowSide> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
}

class InfoBubble implements InfoBubbleInstance {
    readonly dom: HTMLElement

    private readonly bubbleWrapper: HTMLElement
    private readonly bubbleContainer: HTMLElement
    private readonly positioningAnchor: HTMLElement
    private readonly theme: InfoBubbleTheme
    private readonly arrowSide: InfoBubbleArrowSide
    private readonly offset: Required<InfoBubbleOffset>
    private readonly headerContent: HTMLElement | undefined
    private readonly onOpen: (() => void) | undefined
    private readonly onClose: (() => void) | undefined
    private readonly closeOnClickOutside: boolean
    private readonly disableAutoPositioning: boolean
    private readonly arrowCrossOffset: number | undefined
    private readonly className: string
    private readonly contentObserver: MutationObserver
    private isVisible = false

    constructor(private readonly config: InfoBubbleConfig) {
        this.theme = config.theme ?? 'dark'
        this.arrowSide = config.arrowSide ?? 'top'
        this.headerContent = config.headerContent
        this.onOpen = config.onOpen
        this.onClose = config.onClose
        this.closeOnClickOutside = config.closeOnClickOutside ?? true
        this.disableAutoPositioning = config.disableAutoPositioning ?? false
        this.offset = { ...defaultOffset, ...(config.offset ?? {}) }
        this.arrowCrossOffset = config.arrowCrossOffset
        this.className = config.className ?? ''
        this.positioningAnchor = config.positioningAnchor ?? config.anchor

        this.dom = this.render()
        this.bubbleWrapper = this.dom.querySelector('.bubble-wrapper') as HTMLElement
        this.bubbleContainer = this.dom.querySelector('.bubble-container') as HTMLElement

        if (this.arrowCrossOffset !== undefined) {
            this.dom.style.setProperty('--arrow-cross-offset', `${this.arrowCrossOffset}px`)
        }

        this.contentObserver = new MutationObserver(this.handleContentMutation)
        this.contentObserver.observe(this.bubbleWrapper, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
        })

        this.config.anchor.addEventListener('click', this.handleAnchorClick)
        if (this.closeOnClickOutside) {
            document.addEventListener('click', this.handleWindowClick)
        }
        window.addEventListener('resize', this.handleViewportChange, { passive: true })
        window.addEventListener('scroll', this.handleViewportChange, { passive: true, capture: true })
        infoBubbleStateManager.register(this.config.id, { close: this.closeInternal })

        if (config.visible) {
            this.open()
        }
    }

    private render(): HTMLElement {
        return html`
            <div className=${`info-bubble-wrapper theme-${this.theme} ${this.className} ${this.disableAutoPositioning ? 'static-position' : ''}`} data-arrow-side=${this.arrowSide} data-bubble-id=${this.config.id}>
                <nav className="bubble-wrapper" contenteditable="false">
                    <div className="bubble-container">
                        ${this.headerContent ? html`<div className="bubble-header">${this.headerContent}</div>` : null}
                        <div className="bubble-body">${this.config.bodyContent}</div>
                    </div>
                </nav>
            </div>
        ` as HTMLElement
    }

    private calculateOffsetForSide(side: InfoBubbleArrowSide): InfoBubblePosition {
        switch (side) {
            case 'top':
                return { x: this.offset.x, y: this.offset.y }
            case 'bottom':
                return { x: this.offset.x, y: -this.offset.y }
            case 'left':
                return { x: this.offset.y, y: this.offset.x }
            case 'right':
                return { x: -this.offset.y, y: this.offset.x }
        }
    }

    private measureArrowDimensions(): { crossOffset: number; outerSize: number } {
        const beforeStyle = window.getComputedStyle(this.bubbleContainer, '::before')
        const borders = beforeStyle.borderWidth
            .split(' ')
            .map((border) => Number.parseFloat(border))
            .filter((border) => border > 0)
        const outerSize = Math.max(...borders, 9)

        if (this.arrowCrossOffset !== undefined) {
            return { crossOffset: this.arrowCrossOffset, outerSize }
        }

        const positionValue = this.arrowSide === 'top' || this.arrowSide === 'bottom'
            ? beforeStyle.right
            : beforeStyle.top

        return {
            crossOffset: Number.parseFloat(positionValue) || 8,
            outerSize,
        }
    }

    private measureHiddenBubble(): DOMRect {
        const wasVisible = this.bubbleWrapper.classList.contains('visible')
        if (!wasVisible) {
            this.bubbleWrapper.classList.add('visible')
            applyStyle(this.bubbleWrapper, { visibility: 'hidden' })
        }

        const bubbleRect = this.bubbleWrapper.getBoundingClientRect()

        if (!wasVisible) {
            this.bubbleWrapper.classList.remove('visible')
            applyStyle(this.bubbleWrapper, { visibility: '' })
        }

        return bubbleRect
    }

    private applyStaticPosition(): void {
        if (!this.disableAutoPositioning) return

        const anchorRect = this.positioningAnchor.getBoundingClientRect()
        const bubbleRect = this.measureHiddenBubble()
        const bubbleHeight = bubbleRect.height || 200
        const spaceBelow = window.innerHeight - anchorRect.bottom - viewportMargin
        const spaceAbove = anchorRect.top - viewportMargin
        const placement = spaceBelow < bubbleHeight + staticPositionGap && spaceAbove > spaceBelow
            ? 'top'
            : 'bottom'
        const availableSpace = placement === 'top' ? spaceAbove : spaceBelow
        const maxHeight = Math.max(0, availableSpace - staticPositionGap)

        this.dom.setAttribute('data-static-placement', placement)
        this.dom.style.setProperty('--static-bubble-max-height', `${Math.floor(maxHeight)}px`)
    }

    private getSpaceAvailable(anchorRect: DOMRect): Record<InfoBubbleArrowSide, number> {
        return {
            top: anchorRect.top,
            bottom: window.innerHeight - anchorRect.bottom,
            left: anchorRect.left,
            right: window.innerWidth - anchorRect.right,
        }
    }

    private getSpaceNeeded(bubbleRect: DOMRect, currentOffset: InfoBubblePosition): Record<InfoBubbleArrowSide, number> {
        return {
            top: bubbleRect.height + Math.abs(currentOffset.y),
            bottom: bubbleRect.height + Math.abs(currentOffset.y),
            left: bubbleRect.width + Math.abs(currentOffset.x),
            right: bubbleRect.width + Math.abs(currentOffset.x),
        }
    }

    private getEffectiveArrowSide(anchorRect: DOMRect, bubbleRect: DOMRect): InfoBubbleArrowSide {
        const currentOffset = this.calculateOffsetForSide(this.arrowSide)
        const spaceNeeded = this.getSpaceNeeded(bubbleRect, currentOffset)
        const spaceAvailable = this.getSpaceAvailable(anchorRect)
        const flippedSide = oppositeArrowSide[this.arrowSide]
        const spaceToCheck = oppositeArrowSide[this.arrowSide]
        const spaceToCheckFlipped = oppositeArrowSide[flippedSide]
        const notEnoughSpaceOnOriginalSide = spaceAvailable[spaceToCheck] < spaceNeeded[this.arrowSide]
        const enoughSpaceOnFlippedSide = spaceAvailable[spaceToCheckFlipped] >= spaceNeeded[flippedSide]

        return notEnoughSpaceOnOriginalSide && enoughSpaceOnFlippedSide ? flippedSide : this.arrowSide
    }

    private getArrowTipOffset(effectiveArrowSide: InfoBubbleArrowSide, bubbleRect: DOMRect, crossOffset: number, outerSize: number): InfoBubblePosition {
        const offsets: Record<InfoBubbleArrowSide, InfoBubblePosition> = {
            top: { x: bubbleRect.width - crossOffset - outerSize, y: 0 },
            bottom: { x: bubbleRect.width - crossOffset - outerSize, y: bubbleRect.height },
            left: { x: 0, y: crossOffset + outerSize },
            right: { x: bubbleRect.width, y: crossOffset + outerSize },
        }

        return offsets[effectiveArrowSide]
    }

    private applyPosition(): void {
        if (this.disableAutoPositioning) return

        const anchorRect = this.positioningAnchor.getBoundingClientRect()
        const bubbleRect = this.measureHiddenBubble()
        const { crossOffset, outerSize } = this.measureArrowDimensions()
        const targetCenterX = anchorRect.left + (anchorRect.width / 2)
        const targetCenterY = anchorRect.top + (anchorRect.height / 2)
        const effectiveArrowSide = this.getEffectiveArrowSide(anchorRect, bubbleRect)

        if (effectiveArrowSide !== this.dom.getAttribute('data-arrow-side')) {
            this.dom.setAttribute('data-arrow-side', effectiveArrowSide)
        }

        const finalOffset = this.calculateOffsetForSide(effectiveArrowSide)
        const arrowTipOffset = this.getArrowTipOffset(effectiveArrowSide, bubbleRect, crossOffset, outerSize)
        const left = Math.max(4, Math.min(targetCenterX - arrowTipOffset.x + finalOffset.x, window.innerWidth - bubbleRect.width - 4))
        const top = Math.max(4, Math.min(targetCenterY - arrowTipOffset.y + finalOffset.y, window.innerHeight - bubbleRect.height - 4))

        applyStyle(this.dom, {
            left: `${Math.round(left)}px`,
            top: `${Math.round(top)}px`,
        })
    }

    private closeInternal = (): void => {
        if (!this.isVisible) return

        this.isVisible = false
        this.bubbleWrapper.classList.remove('visible')
        infoBubbleStateManager.close(this.config.id)
        this.onClose?.()
    }

    open = (): void => {
        if (this.isVisible) return

        this.isVisible = true
        this.applyStaticPosition()
        this.bubbleWrapper.classList.add('visible')
        infoBubbleStateManager.open(this.config.id)
        this.onOpen?.()
        this.applyPosition()
    }

    close = (): void => {
        this.closeInternal()
    }

    toggle = (): void => {
        if (this.isVisible) {
            this.close()
            return
        }

        this.open()
    }

    isOpen = (): boolean => this.isVisible

    private handleAnchorClick = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        this.toggle()
    }

    private handleWindowClick = (event: Event): void => {
        if (!this.closeOnClickOutside || !this.isVisible) return

        const path = event.composedPath()
        if (!path.includes(this.config.anchor) && !path.includes(this.dom)) {
            this.close()
        }
    }

    private handleViewportChange = (): void => {
        if (!this.isVisible) return

        if (this.disableAutoPositioning) {
            this.applyStaticPosition()
            return
        }

        this.applyPosition()
    }

    private handleContentMutation = (): void => {
        this.handleViewportChange()
    }

    destroy = (): void => {
        this.closeInternal()
        this.config.anchor.removeEventListener('click', this.handleAnchorClick)
        if (this.closeOnClickOutside) {
            document.removeEventListener('click', this.handleWindowClick)
        }

        window.removeEventListener('resize', this.handleViewportChange)
        window.removeEventListener('scroll', this.handleViewportChange, true)
        this.contentObserver.disconnect()
        infoBubbleStateManager.unregister(this.config.id)
        this.dom.remove()
    }
}

export function createInfoBubble(config: InfoBubbleConfig): InfoBubbleInstance {
    return new InfoBubble(config)
}
