// @ts-nocheck
import { html } from '../../../components/domTemplates.ts'
import { infoBubbleStateManager } from './infoBubbleStateManager.ts'

type InfoBubbleConfig = {
    id: string
    anchor: HTMLElement
    positioningAnchor?: HTMLElement
    theme?: 'dark' | 'light'
    arrowSide?: 'top' | 'bottom' | 'left' | 'right'
    headerContent?: HTMLElement
    bodyContent: HTMLElement
    visible?: boolean
    onOpen?: () => void
    onClose?: () => void
    closeOnClickOutside?: boolean
    offset?: { x?: number, y?: number }
    className?: string
}

export function createInfoBubble(config: InfoBubbleConfig) {
    const {
        id,
        anchor,
        positioningAnchor,
        theme = 'dark',
        arrowSide = 'top',
        headerContent = null,
        bodyContent,
        visible = false,
        onOpen,
        onClose,
        closeOnClickOutside = true,
        offset = { x: 0, y: 20 }, // Default 20px spacing from anchor
        className = ''
    } = config

    let isVisible = visible

    // Create the info bubble DOM structure
    const dom = html`
        <div class="info-bubble-wrapper theme-${theme} ${className}" data-arrow-side="${arrowSide}" data-bubble-id="${id}">
            <nav class="bubble-wrapper ${isVisible ? 'visible' : ''}" contenteditable="false">
                <div class="bubble-container">
                    ${headerContent && html`<div class="bubble-header">${headerContent}</div>`}
                    <div class="bubble-body">${bodyContent}</div>
                </div>
            </nav>
        </div>
    ` as HTMLElement

    const bubbleWrapper = dom.querySelector('.bubble-wrapper') as HTMLElement
    const bubbleContainer = dom.querySelector('.bubble-container') as HTMLElement
    const posAnchorEl = positioningAnchor ?? anchor

    // Calculate offset based on arrow side (reusable for original and flipped sides)
    const calculateOffsetForSide = (side: string) => {
        switch (side) {
            case 'top':
                return { x: offset.x, y: offset.y }
            case 'bottom':
                return { x: offset.x, y: -offset.y }
            case 'left':
                return { x: offset.y, y: offset.x }
            case 'right':
                return { x: -offset.y, y: offset.x }
            default:
                return { x: offset.x, y: offset.y }
        }
    }

    // Measure arrow dimensions from actual rendered CSS
    const measureArrowDimensions = () => {
        if (!bubbleContainer) return { crossOffset: 8, outerSize: 9 }

        const beforeStyle = window.getComputedStyle(bubbleContainer, '::before')

        // Extract arrow size from border-width
        const borders = beforeStyle.borderWidth.split(' ').map(parseFloat).filter(b => b > 0)
        const outerSize = Math.max(...borders, 9) // Fallback to 9

        // Extract cross-axis offset (right or top depending on arrow side)
        const positionValue = (arrowSide === 'top' || arrowSide === 'bottom')
            ? beforeStyle.right
            : beforeStyle.top
        const crossOffset = parseFloat(positionValue) || 8

        return { crossOffset, outerSize }
    }

    // Compute and apply viewport-relative position using the anchor rect
    const applyPosition = () => {
        if (!bubbleWrapper) return

        const anchorRect = posAnchorEl.getBoundingClientRect()

        // Temporarily make bubble visible and measurable
        const wasVisible = bubbleWrapper.classList.contains('visible')
        if (!wasVisible) {
            bubbleWrapper.classList.add('visible')
            bubbleWrapper.style.visibility = 'hidden'
        }

        const bubbleRect = bubbleWrapper.getBoundingClientRect()
        const { crossOffset, outerSize } = measureArrowDimensions()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        // Calculate target center
        const targetCenterX = anchorRect.left + anchorRect.width / 2
        const targetCenterY = anchorRect.top + anchorRect.height / 2

        // Determine if we need to flip arrow side based on available space
        const currentOffset = calculateOffsetForSide(arrowSide)
        const spaceNeeded = {
            top: bubbleRect.height + Math.abs(currentOffset.y),
            bottom: bubbleRect.height + Math.abs(currentOffset.y),
            left: bubbleRect.width + Math.abs(currentOffset.x),
            right: bubbleRect.width + Math.abs(currentOffset.x)
        }

        const spaceAvailable = {
            top: anchorRect.top,
            bottom: viewportHeight - anchorRect.bottom,
            left: anchorRect.left,
            right: viewportWidth - anchorRect.right
        }

        // Determine effective arrow side with auto-flip
        // Note: arrow side 'top' means arrow on top of bubble = bubble BELOW anchor
        const oppositeSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

        const flippedSide = oppositeSide[arrowSide]
        const spaceToCheck = oppositeSide[arrowSide]
        const spaceToCheckFlipped = oppositeSide[flippedSide]

        const notEnoughSpaceOnOriginalSide = spaceAvailable[spaceToCheck] < spaceNeeded[arrowSide]
        const enoughSpaceOnFlippedSide = spaceAvailable[spaceToCheckFlipped] >= spaceNeeded[flippedSide]
        const shouldFlip = notEnoughSpaceOnOriginalSide && enoughSpaceOnFlippedSide

        const effectiveArrowSide = shouldFlip ? flippedSide : arrowSide

        // Update DOM attribute if flipped
        if (effectiveArrowSide !== dom.getAttribute('data-arrow-side')) {
            dom.setAttribute('data-arrow-side', effectiveArrowSide)
        }

        // Calculate final offset and arrow tip position
        const finalOffset = calculateOffsetForSide(effectiveArrowSide)
        const arrowTipOffset = {
            top:    { x: bubbleRect.width - crossOffset - outerSize, y: 0 },
            bottom: { x: bubbleRect.width - crossOffset - outerSize, y: bubbleRect.height },
            left:   { x: 0, y: crossOffset + outerSize },
            right:  { x: bubbleRect.width, y: crossOffset + outerSize }
        }[effectiveArrowSide]

        // Calculate and apply position
        let left = targetCenterX - arrowTipOffset.x + finalOffset.x
        let top = targetCenterY - arrowTipOffset.y + finalOffset.y

        // Clamp within viewport
        left = Math.max(4, Math.min(left, viewportWidth - bubbleRect.width - 4))
        top = Math.max(4, Math.min(top, viewportHeight - bubbleRect.height - 4))

        dom.style.left = `${Math.round(left)}px`
        dom.style.top = `${Math.round(top)}px`

        // Restore visibility state
        if (!wasVisible) {
            bubbleWrapper.classList.remove('visible')
            bubbleWrapper.style.visibility = ''
        }
    }

    // Internal close method (called by state manager)
    const closeInternal = () => {
        if (!isVisible) return

        isVisible = false
        if (bubbleWrapper) {
            bubbleWrapper.classList.remove('visible')
        }

        infoBubbleStateManager.close(id)
        onClose?.()
    }

    // Public API
    const open = () => {
        if (isVisible) return

        isVisible = true
        if (bubbleWrapper) {
            bubbleWrapper.classList.add('visible')
        }

        infoBubbleStateManager.open(id)
        onOpen?.()

        // Position after becoming visible
        applyPosition()
    }

    const close = () => {
        closeInternal()
    }

    const toggle = () => {
        if (isVisible) {
            close()
        } else {
            open()
        }
    }

    const isOpen = () => {
        return isVisible
    }

    // Handle anchor click to toggle
    const handleAnchorClick = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        toggle()
    }

    // Handle click outside to close
    const handleWindowClick = (e: Event) => {
        if (!closeOnClickOutside || !isVisible) return

        // Check if click is outside both anchor and bubble
        const path = e.composedPath()
        if (!path.includes(anchor) && !path.includes(dom)) {
            close()
        }
    }

    // Reposition on viewport changes
    const handleViewportChange = () => {
        if (isVisible) applyPosition()
    }

    // Attach anchor click handler
    anchor.addEventListener('click', handleAnchorClick)

    // Attach window click handler
    if (closeOnClickOutside) {
        document.addEventListener('click', handleWindowClick)
    }

    window.addEventListener('resize', handleViewportChange, { passive: true })
    window.addEventListener('scroll', handleViewportChange, { passive: true, capture: true })

    // Watch for content changes and reposition
    const contentObserver = new MutationObserver(() => {
        if (isVisible) applyPosition()
    })

    contentObserver.observe(bubbleWrapper, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
    })

    // Register with state manager
    infoBubbleStateManager.register(id, { close: closeInternal })

    // Initialize visibility if needed
    if (visible) {
        open()
    }

    const destroy = () => {
        // Clean up event listeners
        anchor.removeEventListener('click', handleAnchorClick)
        if (closeOnClickOutside) {
            document.removeEventListener('click', handleWindowClick)
        }

        window.removeEventListener('resize', handleViewportChange)
        window.removeEventListener('scroll', handleViewportChange, { capture: true })

        // Disconnect content observer
        contentObserver.disconnect()

        // Unregister from state manager
        infoBubbleStateManager.unregister(id)

        // Remove DOM
        dom.remove()
    }

    return {
        dom,
        open,
        close,
        toggle,
        isOpen,
        destroy
    }
}
