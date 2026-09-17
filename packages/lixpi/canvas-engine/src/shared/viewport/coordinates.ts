import {
    type CanvasEnginePoint,
} from '../geometry/index.ts'
import {
    type CanvasViewport,
} from '../scene/types.ts'

export type CanvasTransform = [number, number, number]
export type PanOnScrollMode = 'free' | 'horizontal' | 'vertical'

export const assertViewport = (viewport: CanvasViewport): void => {
    if (
        !Number.isFinite(viewport.x)
        || !Number.isFinite(viewport.y)
        || !Number.isFinite(viewport.zoom)
        || viewport.zoom <= 0
    )
        throw new Error('Canvas viewport must be finite with a positive zoom')
}

export const paneToWorld = (
    point: CanvasEnginePoint,
    transform: CanvasTransform,
): CanvasEnginePoint => ({
    x: (point.x - transform[0]) / transform[2],
    y: (point.y - transform[1]) / transform[2],
})

export const worldToPane = (
    point: CanvasEnginePoint,
    transform: CanvasTransform,
): CanvasEnginePoint => ({
    x: point.x * transform[2] + transform[0],
    y: point.y * transform[2] + transform[1],
})
