import {
    type CanvasEngineRect,
    type CanvasEngineSize,
} from '../geometry/types.ts'
import {
    type CanvasViewport,
} from '../scene/types.ts'

export type CanvasFitOptions = {
    // Screen pixels kept between the content and the canvas edge.
    padding?: number
    minZoom?: number
    maxZoom?: number
    // 'start' pins content that is larger than the canvas to the top-left
    // padding instead of centering its overflow.
    alignment?: 'center' | 'start'
}

export const defaultCanvasFitOptions: Required<CanvasFitOptions> = {
    padding: 32,
    minZoom: 0.1,
    maxZoom: 1,
    alignment: 'center',
}

// Returns the viewport that shows the whole content rectangle inside a canvas
// of the given screen size, or null when either side has no area.
export const computeCanvasFitViewport = (
    content: CanvasEngineRect,
    size: CanvasEngineSize,
    options: CanvasFitOptions = {},
): CanvasViewport | null => {
    const fit = {
        padding: options.padding ?? defaultCanvasFitOptions.padding,
        minZoom: options.minZoom ?? defaultCanvasFitOptions.minZoom,
        maxZoom: options.maxZoom ?? defaultCanvasFitOptions.maxZoom,
        alignment: options.alignment ?? defaultCanvasFitOptions.alignment,
    }

    if (
        size.width <= 0
        || size.height <= 0
        || ![content.x, content.y, content.width, content.height].every(Number.isFinite)
    )
        return null

    const padding = Math.max(0, fit.padding)
    const maximumZoom = Math.max(fit.maxZoom, 0.01)
    const minimumZoom = Math.min(
        maximumZoom,
        Math.max(0.01, fit.minZoom),
    )
    const zoom = Math.max(
        minimumZoom,
        Math.min(
            maximumZoom,
            Math.max(1, size.width - padding * 2) / Math.max(1, content.width),
            Math.max(1, size.height - padding * 2) / Math.max(1, content.height),
        ),
    )
    const sceneWidth = content.width * zoom
    const sceneHeight = content.height * zoom
    const start = fit.alignment === 'start'

    return {
        x: (start
            && sceneWidth > size.width - padding * 2
            ? padding
            : (size.width - sceneWidth) / 2) - content.x * zoom,
        y: (start
            && sceneHeight > size.height - padding * 2
            ? padding
            : (size.height - sceneHeight) / 2) - content.y * zoom,
        zoom,
    }
}
