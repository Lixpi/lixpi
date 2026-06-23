import type {
    CanvasNode,
    ImageCanvasNode,
} from '@lixpi/constants'

const MIN_INSERTION_ZOOM = 0.01

type ViewportLike = { x: number; y: number; zoom: number }
type Dimensions = { width: number; height: number }
type RectLike = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type PaneSize = { width: number; height: number }
type GridInsertionOptions = {
    columns?: number
    startX?: number
    startY?: number
    columnGap?: number
    rowGap?: number
}

export function getSafeInsertionZoom(zoom: number | undefined): number {
    if (!Number.isFinite(zoom) || !zoom || zoom <= 0) return 1
    return Math.max(zoom, MIN_INSERTION_ZOOM)
}

export function screenSizeToWorldSize(size: number, zoom: number | undefined): number {
    return size / getSafeInsertionZoom(zoom)
}

export function screenDimensionsToWorldDimensions(dimensions: Dimensions, zoom: number | undefined): Dimensions {
    const safeZoom = getSafeInsertionZoom(zoom)
    return {
        width: dimensions.width / safeZoom,
        height: dimensions.height / safeZoom,
    }
}

export function screenPointToWorldPoint(point: Point, viewport: ViewportLike): Point {
    const safeZoom = getSafeInsertionZoom(viewport.zoom)
    return {
        x: (point.x - viewport.x) / safeZoom,
        y: (point.y - viewport.y) / safeZoom,
    }
}

export function computeViewportGridInsertionPosition(
    existingNodeCount: number,
    viewport: ViewportLike,
    options: GridInsertionOptions = {}
): Point {
    const columns = options.columns ?? 3
    const startX = options.startX ?? 50
    const startY = options.startY ?? 50
    const columnGap = options.columnGap ?? 450
    const rowGap = options.rowGap ?? 400
    const column = existingNodeCount % columns
    const row = Math.floor(existingNodeCount / columns)

    return screenPointToWorldPoint({
        x: startX + column * columnGap,
        y: startY + row * rowGap,
    }, viewport)
}

export function computeViewportCenterInsertionPosition(
    dimensions: Dimensions,
    viewport: ViewportLike,
    paneSize: PaneSize
): Point {
    const center = screenPointToWorldPoint({
        x: paneSize.width / 2,
        y: paneSize.height / 2,
    }, viewport)

    return {
        x: center.x - dimensions.width / 2,
        y: center.y - dimensions.height / 2,
    }
}

export function computeStackedPositionToRightOfRect(
    rect: RectLike,
    existingItemCount: number,
    itemHeight: number,
    gap: number
): Point {
    return {
        x: rect.x + rect.width + gap,
        y: rect.y + existingItemCount * (itemHeight + gap),
    }
}

export function computeNextBranchRowPositionToRightOfRect(
    rect: RectLike,
    previousBranchRect: RectLike | undefined,
    itemHeight: number,
    horizontalGap: number,
    verticalGap: number
): Point {
    return {
        x: rect.x + rect.width + horizontalGap,
        y: previousBranchRect
            ? previousBranchRect.y + Math.max(previousBranchRect.height, itemHeight) + verticalGap
            : rect.y,
    }
}

export function computeVerticallyCenteredY(rect: RectLike, itemHeight: number): number {
    return rect.y + (rect.height - itemHeight) / 2
}

export function computeLineageContinuationPositionToRightOfRect(
    rect: RectLike,
    itemHeight: number,
    horizontalGap: number
): Point {
    return {
        x: rect.x + rect.width + horizontalGap,
        y: computeVerticallyCenteredY(rect, itemHeight),
    }
}

export function countExistingImagesForThread(
    nodes: CanvasNode[],
    threadId: string
): number {
    return nodes.filter(
        (n): n is ImageCanvasNode =>
            n.type === 'image' && n.generatedBy?.aiChatThreadId === threadId
    ).length
}
