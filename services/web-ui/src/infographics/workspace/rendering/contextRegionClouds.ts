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

type SvgPathSampleState = {
    x: number
    y: number
    startX: number
    startY: number
    lastControlX: number
    lastControlY: number
    lastCommand: string
}

const CO2_CLOUD_VIEWBOX_SIZE = 512
const CO2_CLOUD_MAIN_PATH = 'm482.856 229.936c12.391-15.534 19.801-35.216 19.801-56.63 0-50.198-40.694-90.892-90.892-90.892-5.966 0-11.796.581-17.441 1.679-25.94-49.959-78.143-84.093-138.324-84.093s-112.384 34.134-138.324 84.093c-5.645-1.097-11.475-1.679-17.441-1.679-50.198 0-90.892 40.694-90.892 90.892 0 21.415 7.41 41.096 19.801 56.63-18.325 25.172-29.144 56.158-29.144 89.676 0 84.244 68.293 152.538 152.537 152.538 5.374 0 10.683-.282 15.914-.824 21.017 24.873 52.435 40.674 87.549 40.674s66.532-15.801 87.549-40.674c5.231.542 10.539.824 15.914.824 84.244 0 152.537-68.294 152.537-152.538 0-33.518-10.819-64.504-29.144-89.676z'
const CO2_CLOUD_CIRCLES = [
    { x: 74.302, y: 30.905, radius: 30.905 },
]

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

function isSvgPathCommand(token: string): boolean {
    return /^[a-z]$/i.test(token)
}

function cubicAt(start: number, controlA: number, controlB: number, end: number, progress: number): number {
    const inverse = 1 - progress
    return inverse * inverse * inverse * start +
        3 * inverse * inverse * progress * controlA +
        3 * inverse * progress * progress * controlB +
        progress * progress * progress * end
}

function sampleSvgPath(path: string): ContextRegionCloudPoint[] {
    const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? []
    const points: ContextRegionCloudPoint[] = []
    const state: SvgPathSampleState = { x: 0, y: 0, startX: 0, startY: 0, lastControlX: 0, lastControlY: 0, lastCommand: '' }
    let index = 0
    let command = ''

    function hasNumber(): boolean {
        return index < tokens.length && !isSvgPathCommand(tokens[index])
    }

    function readNumber(): number {
        const token = tokens[index]
        index += 1
        return Number(token)
    }

    function pushPoint(x: number, y: number): void {
        points.push({ x, y })
    }

    while (index < tokens.length) {
        if (isSvgPathCommand(tokens[index])) {
            command = tokens[index]
            index += 1
        }

        const lowerCommand = command.toLowerCase()
        const relative = command === lowerCommand

        if (lowerCommand === 'm') {
            const nextX = readNumber()
            const nextY = readNumber()
            state.x = relative ? state.x + nextX : nextX
            state.y = relative ? state.y + nextY : nextY
            state.startX = state.x
            state.startY = state.y
            pushPoint(state.x, state.y)
            while (hasNumber()) {
                const lineX = readNumber()
                const lineY = readNumber()
                state.x = relative ? state.x + lineX : lineX
                state.y = relative ? state.y + lineY : lineY
                pushPoint(state.x, state.y)
            }
            state.lastCommand = lowerCommand
            command = relative ? 'l' : 'L'
            continue
        }

        if (lowerCommand === 'c') {
            while (hasNumber()) {
                const startX = state.x
                const startY = state.y
                const controlX1 = readNumber()
                const controlY1 = readNumber()
                const controlX2 = readNumber()
                const controlY2 = readNumber()
                const endX = readNumber()
                const endY = readNumber()
                const absoluteControlX1 = relative ? state.x + controlX1 : controlX1
                const absoluteControlY1 = relative ? state.y + controlY1 : controlY1
                const absoluteControlX2 = relative ? state.x + controlX2 : controlX2
                const absoluteControlY2 = relative ? state.y + controlY2 : controlY2
                const absoluteEndX = relative ? state.x + endX : endX
                const absoluteEndY = relative ? state.y + endY : endY
                for (let step = 1; step <= 18; step++) {
                    const progress = step / 18
                    pushPoint(
                        cubicAt(startX, absoluteControlX1, absoluteControlX2, absoluteEndX, progress),
                        cubicAt(startY, absoluteControlY1, absoluteControlY2, absoluteEndY, progress)
                    )
                }
                state.lastControlX = absoluteControlX2
                state.lastControlY = absoluteControlY2
                state.x = absoluteEndX
                state.y = absoluteEndY
            }
            state.lastCommand = lowerCommand
            continue
        }

        if (lowerCommand === 's') {
            while (hasNumber()) {
                const startX = state.x
                const startY = state.y
                const controlX1 = state.lastCommand === 'c' || state.lastCommand === 's' ? state.x * 2 - state.lastControlX : state.x
                const controlY1 = state.lastCommand === 'c' || state.lastCommand === 's' ? state.y * 2 - state.lastControlY : state.y
                const controlX2 = readNumber()
                const controlY2 = readNumber()
                const endX = readNumber()
                const endY = readNumber()
                const absoluteControlX2 = relative ? state.x + controlX2 : controlX2
                const absoluteControlY2 = relative ? state.y + controlY2 : controlY2
                const absoluteEndX = relative ? state.x + endX : endX
                const absoluteEndY = relative ? state.y + endY : endY
                for (let step = 1; step <= 18; step++) {
                    const progress = step / 18
                    pushPoint(
                        cubicAt(startX, controlX1, absoluteControlX2, absoluteEndX, progress),
                        cubicAt(startY, controlY1, absoluteControlY2, absoluteEndY, progress)
                    )
                }
                state.lastControlX = absoluteControlX2
                state.lastControlY = absoluteControlY2
                state.x = absoluteEndX
                state.y = absoluteEndY
            }
            state.lastCommand = lowerCommand
            continue
        }

        if (lowerCommand === 'z') {
            pushPoint(state.startX, state.startY)
            state.x = state.startX
            state.y = state.startY
            state.lastControlX = state.x
            state.lastControlY = state.y
            state.lastCommand = lowerCommand
            command = ''
            continue
        }

        break
    }

    return points
}

const CO2_CLOUD_POLYGONS = [
    sampleSvgPath(CO2_CLOUD_MAIN_PATH),
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

function getContextRegionCloudVisualBounds(datum: ContextRegionCloudDatum, style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)): ContextRegionCloudRect {
    const bleed = getContextRegionCloudBleed(style, datum)
    const size = Math.max(datum.width, datum.height) + bleed * 2
    return {
        x: datum.x + datum.width / 2 - size / 2,
        y: datum.y + datum.height / 2 - size / 2,
        width: size,
        height: size,
    }
}

export function getContextRegionCloudBounds(datum: ContextRegionCloudDatum, style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)): ContextRegionCloudRect {
    return getContextRegionCloudVisualBounds(datum, style)
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

function worldPointToCo2CloudPoint(bounds: ContextRegionCloudRect, point: ContextRegionCloudPoint): ContextRegionCloudPoint {
    return {
        x: (point.x - bounds.x) / bounds.width * CO2_CLOUD_VIEWBOX_SIZE,
        y: (point.y - bounds.y) / bounds.height * CO2_CLOUD_VIEWBOX_SIZE,
    }
}

function isPointInCo2Circle(point: ContextRegionCloudPoint, circle: { x: number; y: number; radius: number }): boolean {
    const dx = point.x - circle.x
    const dy = point.y - circle.y
    return dx * dx + dy * dy <= circle.radius * circle.radius
}

function isPointInCo2CloudShape(datum: ContextRegionCloudDatum, point: ContextRegionCloudPoint, style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)): boolean {
    const bounds = getContextRegionCloudVisualBounds(datum, style)
    if (!rectContainsPoint(bounds, point)) return false

    const cloudPoint = worldPointToCo2CloudPoint(bounds, point)
    for (const circle of CO2_CLOUD_CIRCLES) {
        if (isPointInCo2Circle(cloudPoint, circle)) return true
    }
    return CO2_CLOUD_POLYGONS.some((polygon) => isPointInPolygon(cloudPoint, polygon))
}

export function getContextRegionCloudTitleRect(datum: ContextRegionCloudDatum, zoom: number): ContextRegionCloudRect {
    const safeZoom = Math.max(zoom, 0.01)
    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    const bounds = getContextRegionCloudVisualBounds(datum, style)
    const height = 30 / safeZoom
    const charWidth = 8.25 / safeZoom
    const width = Math.min(280 / safeZoom, Math.max(112 / safeZoom, datum.title.length * charWidth + 20 / safeZoom))
    return {
        x: bounds.x + Math.max(22 / safeZoom, bounds.width * style.titleAnchor.x),
        y: bounds.y - height - 10 / safeZoom,
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
    if (rectContainsPoint(getContextRegionCloudTitleRect(datum, zoom), point)) {
        return { kind: 'title', nodeId: datum.nodeId }
    }

    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    if (!isPointInCo2CloudShape(datum, point, style)) return { kind: 'none' }
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
    const bounds = getContextRegionCloudBounds(datum, style)
    const broadOverlap = rect.x < bounds.x + bounds.width &&
        rect.x + rect.width > bounds.x &&
        rect.y < bounds.y + bounds.height &&
        rect.y + rect.height > bounds.y
    if (!broadOverlap && !rectContainsPoint(bounds, dropPoint)) return 0

    const samples = getRectSamplePoints(rect)
    const insideSamples = samples.filter((sample) => isPointInCo2CloudShape(datum, sample, style)).length
    const area = Math.max(1, rect.width * rect.height)
    const sampleScore = (insideSamples / samples.length) * area
    const pointerBonus = isPointInCo2CloudShape(datum, dropPoint, style) ? area : 0
    return sampleScore + pointerBonus
}