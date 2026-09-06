import {
    type CanvasEnginePoint,
    type CanvasEngineRect,
    type CanvasEngineSize,
} from './types.ts'

export const fitDimensionsToAspectRatio = (
    dimensions: CanvasEngineSize,
    aspectRatio: number,
): CanvasEngineSize => {
    const widthFromHeight = dimensions.height * aspectRatio

    if (widthFromHeight <= dimensions.width)
        return {
            width: widthFromHeight,
            height: dimensions.height,
        }

    return {
        width: dimensions.width,
        height: dimensions.width / aspectRatio,
    }
}

export const computeVerticallyCenteredY = (
    rect: CanvasEngineRect,
    itemHeight: number,
): number => rect.y + rect.height / 2 - itemHeight / 2

export const rectangleFromPoints = (
    start: CanvasEnginePoint,
    end: CanvasEnginePoint,
): CanvasEngineRect => {
    return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
    }
}

export const rectanglesOverlap = (
    a: CanvasEngineRect,
    b: CanvasEngineRect,
): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

export const rectangleContainsPoint = (
    rectangle: CanvasEngineRect,
    point: CanvasEnginePoint,
): boolean =>
    point.x >= rectangle.x && point.x <= rectangle.x + rectangle.width && point.y >= rectangle.y && point.y <= rectangle.y + rectangle.height

export const unionRectangles = (
    rectangles: readonly CanvasEngineRect[],
    padding = 0,
): CanvasEngineRect | null => {
    if (!rectangles.length)
        return null

    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity

    for (const rect of rectangles) {
        left = Math.min(left, rect.x)
        top = Math.min(top, rect.y)
        right = Math.max(right, rect.x + rect.width)
        bottom = Math.max(bottom, rect.y + rect.height)
    }

    return {
        x: left - padding,
        y: top - padding,
        width: right - left + padding * 2,
        height: bottom - top + padding * 2,
    }
}

export const getIntersectingNodeIds = <Node extends { nodeId: string }>(
    nodes: readonly Node[],
    rectangle: CanvasEngineRect,
    measure: (node: Node) => CanvasEngineRect,
): string[] => {
    return nodes.filter(
        node => rectanglesOverlap(
            rectangle,
            measure(node),
        ),
    ).map(node => node.nodeId)
}
