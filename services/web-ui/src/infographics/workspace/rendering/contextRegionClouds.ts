export type ContextRegionCloudAspect = 'wide' | 'square' | 'tall'
export type ContextRegionCloudStyleKey =
    | 'lavender-wide-a'
    | 'lavender-wide-b'
    | 'lavender-square-a'
    | 'lavender-square-b'
    | 'lavender-tall-a'
    | 'lavender-tall-b'

export type ContextRegionCloudPoint = { x: number; y: number }
export type ContextRegionCloudRect = { x: number; y: number; width: number; height: number }

export type ContextRegionCloudPalette = {
    wash: string
    pool: string
    bloom: string
    edge: string
    ink: string
}

export type ContextRegionCloudStyle = {
    key: ContextRegionCloudStyleKey
    aspect: ContextRegionCloudAspect
    bleedRatio: number
    titleAnchor: ContextRegionCloudPoint
    hitPolygon: ContextRegionCloudPoint[]
    palette: ContextRegionCloudPalette
    seed: number
}

export type ContextRegionCloudDatum = {
    nodeId: string
    referenceId: string
    x: number
    y: number
    width: number
    height: number
    title: string
    selected: boolean
}

export type ContextRegionCloudResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export type ContextRegionCloudHit =
    | { kind: 'none' }
    | { kind: 'body'; nodeId: string }
    | { kind: 'title'; nodeId: string }
    | { kind: 'resize-handle'; nodeId: string; corner: ContextRegionCloudResizeCorner }

const WIDE_POLYGON_A: ContextRegionCloudPoint[] = [
    { x: -0.06, y: 0.48 },
    { x: 0.01, y: 0.28 },
    { x: 0.13, y: 0.17 },
    { x: 0.27, y: 0.08 },
    { x: 0.42, y: 0.04 },
    { x: 0.58, y: 0.05 },
    { x: 0.75, y: 0.10 },
    { x: 0.91, y: 0.21 },
    { x: 1.05, y: 0.42 },
    { x: 1.07, y: 0.58 },
    { x: 0.98, y: 0.77 },
    { x: 0.82, y: 0.90 },
    { x: 0.63, y: 0.96 },
    { x: 0.43, y: 0.95 },
    { x: 0.23, y: 0.88 },
    { x: 0.06, y: 0.72 },
]

const WIDE_POLYGON_B: ContextRegionCloudPoint[] = [
    { x: -0.07, y: 0.42 },
    { x: 0.04, y: 0.22 },
    { x: 0.20, y: 0.11 },
    { x: 0.36, y: 0.05 },
    { x: 0.53, y: 0.07 },
    { x: 0.70, y: 0.04 },
    { x: 0.90, y: 0.17 },
    { x: 1.07, y: 0.38 },
    { x: 1.04, y: 0.62 },
    { x: 0.93, y: 0.82 },
    { x: 0.72, y: 0.94 },
    { x: 0.54, y: 0.91 },
    { x: 0.35, y: 0.98 },
    { x: 0.14, y: 0.84 },
    { x: 0.01, y: 0.64 },
]

const SQUARE_POLYGON_A: ContextRegionCloudPoint[] = [
    { x: -0.06, y: 0.46 },
    { x: 0.02, y: 0.24 },
    { x: 0.22, y: 0.06 },
    { x: 0.47, y: 0.00 },
    { x: 0.70, y: 0.06 },
    { x: 0.93, y: 0.23 },
    { x: 1.06, y: 0.49 },
    { x: 0.98, y: 0.76 },
    { x: 0.77, y: 0.95 },
    { x: 0.51, y: 1.02 },
    { x: 0.26, y: 0.94 },
    { x: 0.05, y: 0.73 },
]

const SQUARE_POLYGON_B: ContextRegionCloudPoint[] = [
    { x: -0.04, y: 0.39 },
    { x: 0.10, y: 0.15 },
    { x: 0.34, y: 0.03 },
    { x: 0.58, y: 0.02 },
    { x: 0.84, y: 0.14 },
    { x: 1.04, y: 0.39 },
    { x: 1.02, y: 0.66 },
    { x: 0.85, y: 0.90 },
    { x: 0.59, y: 0.99 },
    { x: 0.34, y: 0.96 },
    { x: 0.11, y: 0.84 },
    { x: -0.06, y: 0.62 },
]

const TALL_POLYGON_A: ContextRegionCloudPoint[] = [
    { x: 0.48, y: -0.06 },
    { x: 0.72, y: 0.02 },
    { x: 0.90, y: 0.16 },
    { x: 1.05, y: 0.36 },
    { x: 1.02, y: 0.58 },
    { x: 0.94, y: 0.79 },
    { x: 0.75, y: 0.98 },
    { x: 0.49, y: 1.05 },
    { x: 0.25, y: 0.97 },
    { x: 0.08, y: 0.82 },
    { x: -0.05, y: 0.57 },
    { x: -0.02, y: 0.35 },
    { x: 0.10, y: 0.14 },
    { x: 0.28, y: 0.02 },
]

const TALL_POLYGON_B: ContextRegionCloudPoint[] = [
    { x: 0.41, y: -0.05 },
    { x: 0.68, y: 0.03 },
    { x: 0.88, y: 0.18 },
    { x: 1.03, y: 0.41 },
    { x: 0.97, y: 0.64 },
    { x: 1.04, y: 0.82 },
    { x: 0.78, y: 1.01 },
    { x: 0.52, y: 0.98 },
    { x: 0.31, y: 1.05 },
    { x: 0.10, y: 0.86 },
    { x: -0.04, y: 0.62 },
    { x: 0.02, y: 0.38 },
    { x: -0.02, y: 0.20 },
    { x: 0.19, y: 0.03 },
]

const PALE_LAVENDER: ContextRegionCloudPalette = {
    wash: '#DBC2E8',
    pool: '#BE8FD2',
    bloom: '#F0DFF5',
    edge: '#9460AC',
    ink: '#72427F',
}

const PALE_VIOLET: ContextRegionCloudPalette = {
    wash: '#D5B3E6',
    pool: '#B27ACB',
    bloom: '#EDD9F5',
    edge: '#8753A4',
    ink: '#663775',
}

export const CONTEXT_REGION_CLOUD_STYLES: ContextRegionCloudStyle[] = [
    { key: 'lavender-wide-a', aspect: 'wide', bleedRatio: 0.30, titleAnchor: { x: 0.12, y: 0.12 }, hitPolygon: WIDE_POLYGON_A, palette: PALE_LAVENDER, seed: 1103 },
    { key: 'lavender-wide-b', aspect: 'wide', bleedRatio: 0.32, titleAnchor: { x: 0.10, y: 0.12 }, hitPolygon: WIDE_POLYGON_B, palette: PALE_VIOLET, seed: 1291 },
    { key: 'lavender-square-a', aspect: 'square', bleedRatio: 0.30, titleAnchor: { x: 0.12, y: 0.12 }, hitPolygon: SQUARE_POLYGON_A, palette: PALE_LAVENDER, seed: 1427 },
    { key: 'lavender-square-b', aspect: 'square', bleedRatio: 0.31, titleAnchor: { x: 0.13, y: 0.12 }, hitPolygon: SQUARE_POLYGON_B, palette: PALE_VIOLET, seed: 1559 },
    { key: 'lavender-tall-a', aspect: 'tall', bleedRatio: 0.30, titleAnchor: { x: 0.14, y: 0.12 }, hitPolygon: TALL_POLYGON_A, palette: PALE_LAVENDER, seed: 1667 },
    { key: 'lavender-tall-b', aspect: 'tall', bleedRatio: 0.30, titleAnchor: { x: 0.13, y: 0.12 }, hitPolygon: TALL_POLYGON_B, palette: PALE_VIOLET, seed: 1789 },
]

function hashString(input: string): number {
    let hash = 2166136261
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
}

export function getContextRegionCloudAspect(width: number, height: number): ContextRegionCloudAspect {
    const safeHeight = Math.max(1, height)
    const ratio = width / safeHeight
    if (ratio >= 1.25) return 'wide'
    if (ratio <= 0.8) return 'tall'
    return 'square'
}

export function getContextRegionCloudStyle(nodeId: string, width: number, height: number): ContextRegionCloudStyle {
    const aspect = getContextRegionCloudAspect(width, height)
    const candidates = CONTEXT_REGION_CLOUD_STYLES.filter((style) => style.aspect === aspect)
    const index = hashString(nodeId) % candidates.length
    return candidates[index]
}

export function getContextRegionCloudBleed(style: ContextRegionCloudStyle, rect: Pick<ContextRegionCloudDatum, 'width' | 'height'>): number {
    return Math.max(28, Math.min(rect.width, rect.height) * style.bleedRatio)
}

export function getContextRegionCloudBounds(datum: ContextRegionCloudDatum, style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)): ContextRegionCloudRect {
    const bleed = getContextRegionCloudBleed(style, datum)
    return {
        x: datum.x - bleed,
        y: datum.y - bleed,
        width: datum.width + bleed * 2,
        height: datum.height + bleed * 2,
    }
}

export function getContextRegionCloudPolygon(datum: ContextRegionCloudDatum, style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)): ContextRegionCloudPoint[] {
    return style.hitPolygon.map((point) => ({
        x: datum.x + point.x * datum.width,
        y: datum.y + point.y * datum.height,
    }))
}

export function isPointInPolygon(point: ContextRegionCloudPoint, polygon: ContextRegionCloudPoint[]): boolean {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const pi = polygon[i]
        const pj = polygon[j]
        const intersects = ((pi.y > point.y) !== (pj.y > point.y)) &&
            point.x < (pj.x - pi.x) * (point.y - pi.y) / ((pj.y - pi.y) || 1e-6) + pi.x
        if (intersects) inside = !inside
    }
    return inside
}

function rectContainsPoint(rect: ContextRegionCloudRect, point: ContextRegionCloudPoint): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

export function getContextRegionCloudTitleRect(datum: ContextRegionCloudDatum, zoom: number): ContextRegionCloudRect {
    const safeZoom = Math.max(zoom, 0.01)
    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    const height = 30 / safeZoom
    const charWidth = 8.25 / safeZoom
    const width = Math.min(280 / safeZoom, Math.max(112 / safeZoom, datum.title.length * charWidth + 20 / safeZoom))
    return {
        x: datum.x + Math.max(22 / safeZoom, datum.width * style.titleAnchor.x),
        y: datum.y + Math.max(18 / safeZoom, datum.height * style.titleAnchor.y),
        width,
        height,
    }
}

export function getContextRegionCloudResizeHandleRects(datum: ContextRegionCloudDatum, zoom: number): Array<{ corner: ContextRegionCloudResizeCorner; rect: ContextRegionCloudRect }> {
    const safeZoom = Math.max(zoom, 0.01)
    const size = 28 / safeZoom
    const half = size / 2
    return [
        { corner: 'top-left', rect: { x: datum.x - half, y: datum.y - half, width: size, height: size } },
        { corner: 'top-right', rect: { x: datum.x + datum.width - half, y: datum.y - half, width: size, height: size } },
        { corner: 'bottom-left', rect: { x: datum.x - half, y: datum.y + datum.height - half, width: size, height: size } },
        { corner: 'bottom-right', rect: { x: datum.x + datum.width - half, y: datum.y + datum.height - half, width: size, height: size } },
    ]
}

export function hitTestContextRegionCloud(datum: ContextRegionCloudDatum, point: ContextRegionCloudPoint, zoom: number): ContextRegionCloudHit {
    for (const handle of getContextRegionCloudResizeHandleRects(datum, zoom)) {
        if (rectContainsPoint(handle.rect, point)) return { kind: 'resize-handle', nodeId: datum.nodeId, corner: handle.corner }
    }

    if (rectContainsPoint(getContextRegionCloudTitleRect(datum, zoom), point)) {
        return { kind: 'title', nodeId: datum.nodeId }
    }

    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    if (!rectContainsPoint(getContextRegionCloudBounds(datum, style), point)) return { kind: 'none' }
    if (!isPointInPolygon(point, getContextRegionCloudPolygon(datum, style))) return { kind: 'none' }
    return { kind: 'body', nodeId: datum.nodeId }
}

function getRectSamplePoints(rect: ContextRegionCloudRect): ContextRegionCloudPoint[] {
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    return [
        { x: centerX, y: centerY },
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x, y: rect.y + rect.height },
        { x: rect.x + rect.width, y: rect.y + rect.height },
        { x: centerX, y: rect.y },
        { x: centerX, y: rect.y + rect.height },
        { x: rect.x, y: centerY },
        { x: rect.x + rect.width, y: centerY },
    ]
}

export function scoreRectAgainstContextRegionCloud(datum: ContextRegionCloudDatum, rect: ContextRegionCloudRect, dropPoint: ContextRegionCloudPoint): number {
    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    const polygon = getContextRegionCloudPolygon(datum, style)
    const bounds = getContextRegionCloudBounds(datum, style)
    const broadOverlap = rect.x < bounds.x + bounds.width &&
        rect.x + rect.width > bounds.x &&
        rect.y < bounds.y + bounds.height &&
        rect.y + rect.height > bounds.y
    if (!broadOverlap && !rectContainsPoint(bounds, dropPoint)) return 0

    const samples = getRectSamplePoints(rect)
    const insideSamples = samples.filter((sample) => isPointInPolygon(sample, polygon)).length
    const area = Math.max(1, rect.width * rect.height)
    const sampleScore = (insideSamples / samples.length) * area
    const pointerBonus = isPointInPolygon(dropPoint, polygon) ? area : 0
    return sampleScore + pointerBonus
}