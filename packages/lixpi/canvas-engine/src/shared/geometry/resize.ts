import {
    type CanvasEnginePoint,
    type CanvasEngineRect,
    type CanvasEngineSize,
} from './types.ts'
import { assertCanvasBounds } from '../scene/validation.ts'

export type ResizeHandle = 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type ResizeConstraints = {
    min: CanvasEngineSize
    max?: CanvasEngineSize
    preserveAspectRatio: boolean
    aspectRatio?: number
}

export const getResizeCursor = (handle: ResizeHandle): string => {
    if (
        handle === 'top'
        || handle === 'bottom'
    )
        return 'ns-resize'

    if (
        handle === 'left'
        || handle === 'right'
    )
        return 'ew-resize'

    return handle === 'top-left'
        || handle === 'bottom-right'
        ? 'nwse-resize'
        : 'nesw-resize'
}

export const computeResizedBounds = (
    start: CanvasEngineRect,
    delta: CanvasEnginePoint,
    handle: ResizeHandle,
    constraints: ResizeConstraints,
): CanvasEngineRect => {
    assertCanvasBounds(start)
    assertCanvasBounds({
        x: 0,
        y: 0,
        ...constraints.min,
    })

    if (constraints.max)
        assertCanvasBounds({
            x: 0,
            y: 0,
            ...constraints.max,
        })

    if (![delta.x, delta.y].every(Number.isFinite))
        throw new Error('Resize deltas must be finite')

    if (
        constraints.max
        && (constraints.max.width < constraints.min.width || constraints.max.height < constraints.min.height)
    )
        throw new Error('Resize maximum must not be smaller than its minimum')

    if (
        constraints.aspectRatio !== undefined
        && (!Number.isFinite(constraints.aspectRatio) || constraints.aspectRatio <= 0)
    )
        throw new Error('Resize aspect ratio must be finite and positive')

    const left = handle.includes('left')
    const top = handle.includes('top')
    const x = delta.x * (left
        ? -1
        : handle.includes('right')
            ? 1
            : 0)
    const y = delta.y * (top
        ? -1
        : handle.includes('bottom')
            ? 1
            : 0)
    const aspect = constraints.preserveAspectRatio
        && start.height > 0
        ? constraints.aspectRatio ?? start.width / start.height
        : 0
    let width: number
    let height: number

    if (aspect > 0) {
        const minWidth = Math.max(constraints.min.width, constraints.min.height * aspect)
        const maxWidth = Math.min(constraints.max?.width ?? Infinity, (constraints.max?.height ?? Infinity) * aspect)

        if (minWidth > maxWidth)
            throw new Error('Resize constraints cannot preserve this aspect ratio')

        width = Math.max(
            minWidth,
            Math.min(maxWidth, start.width + (x + y * aspect) / (1 + aspect)),
        )
        height = width / aspect
    } else {
        width = Math.max(
            constraints.min.width,
            Math.min(constraints.max?.width ?? Infinity, start.width + x),
        )
        height = Math.max(
            constraints.min.height,
            Math.min(constraints.max?.height ?? Infinity, start.height + y),
        )
    }

    const result = {
        x: left ? start.x + start.width - width : start.x,
        y: top ? start.y + start.height - height : start.y,
        width,
        height,
    }
    assertCanvasBounds(result)

    return result
}

export const growParentBounds = (
    parent: CanvasEngineRect,
    child: CanvasEngineRect,
    padding: number,
): CanvasEngineSize => {
    return {
        width: Math.max(parent.width, child.x - parent.x + child.width + padding),
        height: Math.max(parent.height, child.y - parent.y + child.height + padding),
    }
}
