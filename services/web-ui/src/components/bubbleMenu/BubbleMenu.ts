// =============================================================================
// CORE BUBBLE MENU
//
// Framework-agnostic floating menu component. Handles DOM creation,
// show/hide lifecycle, context-based item visibility, transform-aware
// positioning, and the prevent-hide pattern for button clicks.
//
// Consumers (ProseMirror plugin, workspace canvas) drive when to show/hide
// and supply a target rect + placement for positioning.
// =============================================================================

import { createEl } from '$src/utils/domTemplates.ts'
import type {
    BubbleMenuItem,
    BubbleMenuOptions,
    BubbleMenuPositionRequest,
} from '$src/components/bubbleMenu/types.ts'

const isTouchDevice = (): boolean => 'ontouchstart' in window || navigator.maxTouchPoints > 0

export class BubbleMenu {
    private menu: HTMLElement
    private menuContent: HTMLElement
    private parentEl: HTMLElement
    private items: BubbleMenuItem[]
    private panels: HTMLElement[]
    private currentContext: string = ''
    private lastPosition: BubbleMenuPositionRequest | null = null
    private scrollContainer: HTMLElement | Window = window
    private onShow?: (context: string) => void
    private onHide?: () => void

    // Prevent-hide pattern: when user clicks a menu button, the editor blur
    // shouldn't hide the menu. The consumer sets this before dispatching.
    preventHide = false

    constructor(options: BubbleMenuOptions) {
        this.parentEl = options.parentEl
        this.items = options.items
        this.panels = options.panels ?? []
        this.onShow = options.onShow
        this.onHide = options.onHide

        this.menu = createEl('div', {
            className: 'bubble-menu',
            role: 'toolbar',
            'aria-label': 'Formatting toolbar',
            tabIndex: 0,
            style: {
                position: 'absolute',
                visibility: 'hidden',
                zIndex: '100',
            },
        })

        this.menuContent = createEl('div', { className: 'bubble-menu-content' })
        this.menu.appendChild(this.menuContent)

        for (const item of this.items) {
            this.menuContent.appendChild(item.element)
        }

        for (const panel of this.panels) {
            this.menu.appendChild(panel)
        }

        this.menu.addEventListener('mousedown', this.handleMenuMouseDown)

        this.scrollContainer = this.findScrollContainer(this.parentEl)
        this.scrollContainer.addEventListener('scroll', this.handleScroll, { passive: true })

        this.parentEl.appendChild(this.menu)

        if (isTouchDevice()) {
            window.visualViewport?.addEventListener('resize', this.handleViewportResize)
        }
    }

    get element(): HTMLElement {
        return this.menu
    }

    get isVisible(): boolean {
        return this.menu.classList.contains('is-visible')
    }

    get context(): string {
        return this.currentContext
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    show(context: string, position: BubbleMenuPositionRequest): void {
        this.updateVisibleItems(context)
        this.menu.style.visibility = 'visible'
        this.menu.classList.add('is-visible')
        this.onShow?.(context)
        this.lastPosition = position
        this.updatePosition(position)
    }

    hide(): void {
        if (!this.isVisible && this.currentContext === '') return
        this.menu.style.visibility = 'hidden'
        this.menu.classList.remove('is-visible')
        this.currentContext = ''
        this.lastPosition = null
        this.onHide?.()
    }

    forceHide(): void {
        this.preventHide = false
        this.hide()
    }

    reposition(position?: BubbleMenuPositionRequest): void {
        const pos = position ?? this.lastPosition
        if (!pos) return
        this.lastPosition = pos
        this.updatePosition(pos)
    }

    refreshState(): void {
        for (const item of this.items) {
            item.update?.()
        }
    }

    updateContext(context: string, position: BubbleMenuPositionRequest): void {
        if (context !== this.currentContext) {
            this.updateVisibleItems(context)
        }
        this.lastPosition = position
        this.refreshState()
        this.reposition(position)
    }

    destroy(): void {
        this.menu.removeEventListener('mousedown', this.handleMenuMouseDown)
        this.scrollContainer.removeEventListener('scroll', this.handleScroll)
        window.visualViewport?.removeEventListener('resize', this.handleViewportResize)
        this.menu.remove()
    }

    // =========================================================================
    // CONTEXT SWITCHING
    // =========================================================================

    private updateVisibleItems(context: string): void {
        this.currentContext = context
        for (const item of this.items) {
            const isVisible = item.context.includes(context)
            item.element.style.display = isVisible ? '' : 'none'
        }
    }

    // =========================================================================
    // POSITIONING
    // =========================================================================

    private updatePosition(position: BubbleMenuPositionRequest, retryCount = 0): void {
        const scale = this.getScale()
        const { targetRect, placement } = position

        if (!targetRect.width && !targetRect.height) {
            if (retryCount < 3) {
                requestAnimationFrame(() => this.updatePosition(position, retryCount + 1))
            }
            return
        }

        // Measure menu
        this.menu.style.visibility = 'hidden'
        this.menu.style.display = 'flex'
        const menuRect = this.menu.getBoundingClientRect()
        const menuWidthLocal = menuRect.width / scale

        if (placement === 'below') {
            // Center horizontally below target
            const targetCenterX = targetRect.left + targetRect.width / 2
            const menuScreenLeft = targetCenterX - menuRect.width / 2
            const menuScreenTop = targetRect.bottom + 8 * scale

            const local = this.screenToLocal(menuScreenLeft, menuScreenTop)
            const clampedLeft = this.clampHorizontal(local.x, menuWidthLocal, scale)

            Object.assign(this.menu.style, {
                left: `${clampedLeft}px`,
                top: `${local.y}px`,
                visibility: 'visible',
            })
        } else {
            // Center horizontally above target
            const targetCenterX = targetRect.left + targetRect.width / 2
            const menuScreenLeft = targetCenterX - menuRect.width / 2
            const menuScreenTop = targetRect.top - menuRect.height - 8 * scale

            const local = this.screenToLocal(menuScreenLeft, menuScreenTop)
            const clampedLeft = this.clampHorizontal(local.x, menuWidthLocal, scale)

            // Flip below if above is out of bounds
            let finalY = local.y
            if (local.y < 8) {
                const belowScreenTop = targetRect.bottom + 8 * scale
                finalY = this.screenToLocal(0, belowScreenTop).y
            }

            Object.assign(this.menu.style, {
                left: `${clampedLeft}px`,
                top: `${finalY}px`,
                visibility: 'visible',
            })
        }
    }

    private clampHorizontal(localX: number, menuWidthLocal: number, scale: number): number {
        const parentRect = this.parentEl.getBoundingClientRect()
        const parentWidthLocal = parentRect.width / scale
        const maxLeft = parentWidthLocal - menuWidthLocal - 8
        return Math.max(8, Math.min(localX, maxLeft))
    }

    // =========================================================================
    // TRANSFORM AWARENESS
    // =========================================================================

    findTransformedAncestor(): { element: HTMLElement; scale: number } | null {
        let current: HTMLElement | null = this.parentEl
        while (current) {
            const style = getComputedStyle(current)
            const transform = style.transform
            if (transform && transform !== 'none') {
                const match = transform.match(/matrix\(([^,]+),/)
                if (match) {
                    return { element: current, scale: parseFloat(match[1]) }
                }
            }
            current = current.parentElement
        }
        return null
    }

    screenToLocal(screenX: number, screenY: number): { x: number; y: number } {
        const parentRect = this.parentEl.getBoundingClientRect()
        const transformInfo = this.findTransformedAncestor()
        const scale = transformInfo?.scale ?? 1

        const localX = (screenX - parentRect.left) / scale
        const localY = (screenY - parentRect.top) / scale

        return { x: localX, y: localY }
    }

    getScale(): number {
        const transformInfo = this.findTransformedAncestor()
        return transformInfo?.scale ?? 1
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    private handleMenuMouseDown = (event: MouseEvent): void => {
        this.preventHide = true

        const target = event.target as HTMLElement
        if (target.closest('.bubble-menu-button') || target.closest('.bubble-menu-dropdown')) {
            event.preventDefault()
        }
    }

    private handleScroll = (): void => {
        if (this.isVisible && this.lastPosition) {
            this.updatePosition(this.lastPosition)
        }
    }

    private handleViewportResize = (): void => {
        if (this.isVisible && this.lastPosition) {
            this.updatePosition(this.lastPosition)
        }
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private findScrollContainer(element: HTMLElement): HTMLElement | Window {
        let current: HTMLElement | null = element
        while (current) {
            const style = getComputedStyle(current)
            if (style.overflow === 'auto' || style.overflow === 'scroll' ||
                style.overflowY === 'auto' || style.overflowY === 'scroll') {
                return current
            }
            current = current.parentElement
        }
        return window
    }
}
