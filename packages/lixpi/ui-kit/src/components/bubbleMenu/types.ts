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
}

// 'right' sits beside the target, vertically centered on it; with the 'end'
// alignment it sits inside the target against its right edge.
export type BubbleMenuPlacement = 'above' | 'below' | 'left' | 'right'
export type BubbleMenuHorizontalAlignment = 'center' | 'end'

export type BubbleMenuPositionRequest = {
    targetRect: DOMRect
    placement: BubbleMenuPlacement
    horizontalAlignment?: BubbleMenuHorizontalAlignment
    clampToParent?: boolean
    animateOnShow?: boolean
}

export type BubbleMenuOptions = {
    label?: string
    parentEl: HTMLElement
    items: BubbleMenuItem[]
    panels?: HTMLElement[]
    debounceDelay?: number
    getVisualScale?: () => number
    onShow?: (context: string) => void
    onHide?: () => void
}
