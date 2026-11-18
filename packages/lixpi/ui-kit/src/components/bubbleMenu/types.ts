// =============================================================================
// CORE BUBBLE MENU TYPES
//
// Framework-agnostic types for the reusable BubbleMenu component.
// Consumed by both ProseMirror (text/image editing) and the workspace canvas
// (node-level actions). No framework or ProseMirror imports allowed here.
// =============================================================================

export type BubbleMenuItem = {
    element: HTMLElement
    context: string[]
    update?: () => void
    hide?: () => void
    reposition?: () => void
    destroy?: () => void
}

// 'right' sits beside the target, vertically centered on it; with the 'end'
// alignment it sits inside the target against its right edge.
export type BubbleMenuPlacement = 'above' | 'below' | 'left' | 'right' | 'auto'
export type BubbleMenuHorizontalAlignment = 'start' | 'center' | 'end'

export type BubbleMenuPositionRequest = {
    targetRect: DOMRect
    placement: BubbleMenuPlacement
    horizontalAlignment?: BubbleMenuHorizontalAlignment
    bounds?: DOMRect
    gap?: number
    clampToParent?: boolean
    animateOnShow?: boolean
}

export type BubbleMenuOptions = {
    label?: string
    role?: 'toolbar' | 'menu'
    orientation?: 'horizontal' | 'vertical'
    inline?: boolean
    parentEl: HTMLElement
    items: BubbleMenuItem[]
    panels?: HTMLElement[]
    debounceDelay?: number
    getScale?: () => number
    getVisualScale?: () => number
    onShow?: (context: string) => void
    onHide?: () => void
}
