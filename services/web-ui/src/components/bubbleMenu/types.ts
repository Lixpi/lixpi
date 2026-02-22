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

export type BubbleMenuPlacement = 'above' | 'below'

export type BubbleMenuPositionRequest = {
    targetRect: DOMRect
    placement: BubbleMenuPlacement
}

export type BubbleMenuOptions = {
    parentEl: HTMLElement
    items: BubbleMenuItem[]
    panels?: HTMLElement[]
    debounceDelay?: number
    onShow?: (context: string) => void
    onHide?: () => void
}
