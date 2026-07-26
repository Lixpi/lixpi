export type FloatingMenuRect = {
    left: number
    top: number
    right: number
    bottom: number
}

export type FloatingMenuSize = {
    width: number
    height: number
}

export type FloatingMenuViewport = {
    width: number
    height: number
}

export type FloatingMenuScreenPosition = {
    left: number
    top: number
    placement: FloatingMenuPlacement
}

export type FloatingMenuPlacement = 'above' | 'below'

export type FloatingMenuPositionOptions = {
    viewportMargin?: number
    preferredPlacement?: FloatingMenuPlacement
}

export function resolveFloatingMenuScreenPosition(
    anchor: FloatingMenuRect,
    menu: FloatingMenuSize,
    viewport: FloatingMenuViewport,
    gap: number,
    options: FloatingMenuPositionOptions = {},
): FloatingMenuScreenPosition {
    const { viewportMargin = 8, preferredPlacement } = options
    const spaceAbove = anchor.top - viewportMargin
    const spaceBelow = viewport.height - anchor.bottom - viewportMargin
    const placement = preferredPlacement ?? (
        spaceBelow < menu.height + gap && spaceAbove > spaceBelow
            ? 'above'
            : 'below'
    )
    const desiredTop = placement === 'above'
        ? anchor.top - menu.height - gap
        : anchor.bottom + gap
    const maxLeft = Math.max(viewportMargin, viewport.width - menu.width - viewportMargin)
    const maxTop = Math.max(viewportMargin, viewport.height - menu.height - viewportMargin)

    return {
        left: Math.min(Math.max(anchor.left, viewportMargin), maxLeft),
        top: Math.min(Math.max(desiredTop, viewportMargin), maxTop),
        placement,
    }
}

export function getTransformedAncestorScale(element: HTMLElement | null): number {
    let scale = 1
    let current = element
    while (current) {
        const transform = getComputedStyle(current).transform
        if (transform && transform !== 'none') {
            const match = transform.match(/^matrix(?:3d)?\(([^,]+),/)
            const parsedScale = match ? Number.parseFloat(match[1]) : Number.NaN
            if (Number.isFinite(parsedScale) && parsedScale > 0) scale *= parsedScale
        }
        current = current.parentElement
    }
    return scale
}

export function screenPointToLocal(
    parentRect: Pick<FloatingMenuRect, 'left' | 'top'>,
    screenPoint: { left: number; top: number },
    scale: number,
): { left: number; top: number } {
    return {
        left: (screenPoint.left - parentRect.left) / scale,
        top: (screenPoint.top - parentRect.top) / scale,
    }
}
