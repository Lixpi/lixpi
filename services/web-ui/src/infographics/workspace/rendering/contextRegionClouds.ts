import {
    webUiThemeSettings,
    type ContextRegionCloudThemeStyle,
} from '$src/webUiThemeSettings.ts'
import { scaleCanvasChromeForZoom } from '$src/infographics/utils/zoomScaling.ts'

export type ContextRegionCloudAspect = ContextRegionCloudThemeStyle['aspect']

export type ContextRegionCloudPoint = { x: number; y: number }
export type ContextRegionCloudRect = { x: number; y: number; width: number; height: number }
export type ContextRegionCloudPalette = ContextRegionCloudThemeStyle['palette']
export type ContextRegionCloudStyle = ContextRegionCloudThemeStyle
export type ContextRegionCloudAnchorSide = 'left' | 'right' | 'top' | 'bottom' | 'center'
export type ContextRegionCloudResizeHandle = 'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left'
export type ContextRegionCloudCircle = { x: number; y: number; radius: number }
export type ContextRegionCloudOutline = {
    polygons: ContextRegionCloudPoint[][]
    circles: ContextRegionCloudCircle[]
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

export type ContextRegionCloudHit =
    | { kind: 'none' }
    | { kind: 'resize'; nodeId: string; handle: ContextRegionCloudResizeHandle; cursor: string }
    | { kind: 'body'; nodeId: string }
    | { kind: 'title'; nodeId: string }

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
const EDGE_HIT_SCREEN_RADIUS_PX = 24
const EDGE_ANCHOR_SAMPLE_STEPS = 128
const EDGE_ANCHOR_BINARY_SEARCH_STEPS = 12
const EDGE_ANCHOR_CROSS_AXIS_STEPS = 96
const EDGE_SAMPLE_DIRECTIONS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
    { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
]

export const CONTEXT_REGION_CLOUD_STYLES: ContextRegionCloudStyle[] = webUiThemeSettings.contextRegionCloudStyles

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
    return Math.max(webUiThemeSettings.contextRegionCloudMinBleed, Math.min(rect.width, rect.height) * style.bleedRatio)
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

function rectsIntersect(a: ContextRegionCloudRect, b: ContextRegionCloudRect): boolean {
    return a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
}

function worldPointToCo2CloudPoint(bounds: ContextRegionCloudRect, point: ContextRegionCloudPoint): ContextRegionCloudPoint {
    return {
        x: (point.x - bounds.x) / bounds.width * CO2_CLOUD_VIEWBOX_SIZE,
        y: (point.y - bounds.y) / bounds.height * CO2_CLOUD_VIEWBOX_SIZE,
    }
}

function co2CloudPointToWorldPoint(bounds: ContextRegionCloudRect, point: ContextRegionCloudPoint): ContextRegionCloudPoint {
    return {
        x: bounds.x + point.x / CO2_CLOUD_VIEWBOX_SIZE * bounds.width,
        y: bounds.y + point.y / CO2_CLOUD_VIEWBOX_SIZE * bounds.height,
    }
}

function co2CloudCircleToWorldCircle(bounds: ContextRegionCloudRect, circle: ContextRegionCloudCircle): ContextRegionCloudCircle {
    return {
        x: bounds.x + circle.x / CO2_CLOUD_VIEWBOX_SIZE * bounds.width,
        y: bounds.y + circle.y / CO2_CLOUD_VIEWBOX_SIZE * bounds.height,
        radius: circle.radius / CO2_CLOUD_VIEWBOX_SIZE * bounds.width,
    }
}

function isPointInCo2Circle(point: ContextRegionCloudPoint, circle: { x: number; y: number; radius: number }): boolean {
    const dx = point.x - circle.x
    const dy = point.y - circle.y
    return dx * dx + dy * dy <= circle.radius * circle.radius
}

function isPointInCo2CloudBoundsShape(bounds: ContextRegionCloudRect, point: ContextRegionCloudPoint): boolean {
    if (!rectContainsPoint(bounds, point)) return false

    const cloudPoint = worldPointToCo2CloudPoint(bounds, point)
    for (const circle of CO2_CLOUD_CIRCLES) {
        if (isPointInCo2Circle(cloudPoint, circle)) return true
    }
    return CO2_CLOUD_POLYGONS.some((polygon) => isPointInPolygon(cloudPoint, polygon))
}

function isPointInCo2CloudShape(datum: ContextRegionCloudDatum, point: ContextRegionCloudPoint, style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)): boolean {
    const bounds = getContextRegionCloudVisualBounds(datum, style)
    return isPointInCo2CloudBoundsShape(bounds, point)
}

export function isPointInContextRegionCloudShape(datum: ContextRegionCloudDatum, point: ContextRegionCloudPoint): boolean {
    return isPointInCo2CloudShape(datum, point)
}

export function getContextRegionCloudOutline(datum: ContextRegionCloudDatum, style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)): ContextRegionCloudOutline {
    const bounds = getContextRegionCloudVisualBounds(datum, style)
    return {
        polygons: CO2_CLOUD_POLYGONS.map((polygon) => polygon.map((point) => co2CloudPointToWorldPoint(bounds, point))),
        circles: CO2_CLOUD_CIRCLES.map((circle) => co2CloudCircleToWorldCircle(bounds, circle)),
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

function getContextRegionCloudLogicalAnchorPoint(
    datum: ContextRegionCloudDatum,
    side: ContextRegionCloudAnchorSide,
    t: number
): ContextRegionCloudPoint {
    const safeT = clamp(t, 0, 1)
    switch (side) {
        case 'left': return { x: datum.x, y: datum.y + datum.height * safeT }
        case 'right': return { x: datum.x + datum.width, y: datum.y + datum.height * safeT }
        case 'top': return { x: datum.x + datum.width * safeT, y: datum.y }
        case 'bottom': return { x: datum.x + datum.width * safeT, y: datum.y + datum.height }
        case 'center': return { x: datum.x + datum.width / 2, y: datum.y + datum.height / 2 }
    }
}

function getCrossAxisSearchValues(preferred: number, min: number, max: number): number[] {
    const clampedPreferred = clamp(preferred, min, max)
    const values = [clampedPreferred]
    const range = max - min

    for (let step = 1; step <= EDGE_ANCHOR_CROSS_AXIS_STEPS; step++) {
        const offset = range * step / EDGE_ANCHOR_CROSS_AXIS_STEPS
        const lower = clampedPreferred - offset
        const upper = clampedPreferred + offset
        if (lower >= min) values.push(lower)
        if (upper <= max) values.push(upper)
    }

    return values
}

function findCloudBoundary(
    bounds: ContextRegionCloudRect,
    fixedAxisValue: number,
    side: Exclude<ContextRegionCloudAnchorSide, 'center'>
): ContextRegionCloudPoint | null {
    const isHorizontal = side === 'left' || side === 'right'
    const axisStart = side === 'right'
        ? bounds.x + bounds.width
        : side === 'left'
        ? bounds.x
        : side === 'bottom'
        ? bounds.y + bounds.height
        : bounds.y
    const axisSize = isHorizontal ? bounds.width : bounds.height
    const direction = side === 'right' || side === 'bottom' ? -1 : 1
    let previousAxisValue = axisStart

    const makePoint = (axisValue: number) => isHorizontal
        ? { x: axisValue, y: fixedAxisValue }
        : { x: fixedAxisValue, y: axisValue }

    if (isPointInCo2CloudBoundsShape(bounds, makePoint(axisStart))) {
        return makePoint(axisStart)
    }

    for (let step = 1; step <= EDGE_ANCHOR_SAMPLE_STEPS; step++) {
        const axisValue = axisStart + direction * axisSize * step / EDGE_ANCHOR_SAMPLE_STEPS
        if (!isPointInCo2CloudBoundsShape(bounds, makePoint(axisValue))) {
            previousAxisValue = axisValue
            continue
        }

        let outsideAxisValue = previousAxisValue
        let insideAxisValue = axisValue
        for (let refine = 0; refine < EDGE_ANCHOR_BINARY_SEARCH_STEPS; refine++) {
            const midAxisValue = (outsideAxisValue + insideAxisValue) / 2
            if (isPointInCo2CloudBoundsShape(bounds, makePoint(midAxisValue))) {
                insideAxisValue = midAxisValue
            } else {
                outsideAxisValue = midAxisValue
            }
        }
        return makePoint(insideAxisValue)
    }

    return null
}

export function getContextRegionCloudAnchorPoint(
    datum: ContextRegionCloudDatum,
    side: ContextRegionCloudAnchorSide,
    t: number = 0.5,
    style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
): ContextRegionCloudPoint {
    const logicalPoint = getContextRegionCloudLogicalAnchorPoint(datum, side, t)
    if (side === 'center') return logicalPoint

    const bounds = getContextRegionCloudVisualBounds(datum, style)

    if (side === 'left' || side === 'right') {
        const yValues = getCrossAxisSearchValues(logicalPoint.y, bounds.y, bounds.y + bounds.height)
        for (const y of yValues) {
            const boundary = findCloudBoundary(bounds, y, side)
            if (boundary) return boundary
        }
        return logicalPoint
    }

    const xValues = getCrossAxisSearchValues(logicalPoint.x, bounds.x, bounds.x + bounds.width)
    for (const x of xValues) {
        const boundary = findCloudBoundary(bounds, x, side)
        if (boundary) return boundary
    }

    return logicalPoint
}

function isPointNearCo2CloudEdge(
    datum: ContextRegionCloudDatum,
    point: ContextRegionCloudPoint,
    zoom: number,
    style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
): boolean {
    const safeZoom = Math.max(zoom, 0.01)
    const radius = EDGE_HIT_SCREEN_RADIUS_PX / safeZoom
    const inside = isPointInCo2CloudShape(datum, point, style)

    for (const direction of EDGE_SAMPLE_DIRECTIONS) {
        const sample = {
            x: point.x + direction.x * radius,
            y: point.y + direction.y * radius,
        }
        if (isPointInCo2CloudShape(datum, sample, style) !== inside) return true
    }

    return false
}

function getContextRegionCloudResizeHandleForPoint(
    datum: ContextRegionCloudDatum,
    point: ContextRegionCloudPoint,
    style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
): ContextRegionCloudResizeHandle {
    const bounds = getContextRegionCloudVisualBounds(datum, style)
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    const degrees = (Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI + 360) % 360

    if (degrees < 22.5 || degrees >= 337.5) return 'right'
    if (degrees < 67.5) return 'bottom-right'
    if (degrees < 112.5) return 'bottom'
    if (degrees < 157.5) return 'bottom-left'
    if (degrees < 202.5) return 'left'
    if (degrees < 247.5) return 'top-left'
    if (degrees < 292.5) return 'top'
    return 'top-right'
}

export function getContextRegionCloudResizeCursor(handle: ContextRegionCloudResizeHandle): string {
    switch (handle) {
        case 'top':
        case 'bottom':
            return 'ns-resize'
        case 'left':
        case 'right':
            return 'ew-resize'
        case 'top-left':
        case 'bottom-right':
            return 'nwse-resize'
        case 'top-right':
        case 'bottom-left':
            return 'nesw-resize'
    }
}

export function getContextRegionCloudTitleRect(datum: ContextRegionCloudDatum, zoom: number): ContextRegionCloudRect {
    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    const bounds = getContextRegionCloudVisualBounds(datum, style)
    const height = scaleCanvasChromeForZoom(webUiThemeSettings.contextRegionCloudTitleHeight, zoom)
    const charWidth = scaleCanvasChromeForZoom(webUiThemeSettings.contextRegionCloudTitleCharWidth, zoom)
    const paddingX = scaleCanvasChromeForZoom(webUiThemeSettings.contextRegionCloudTitlePaddingX, zoom)
    const width = Math.min(
        scaleCanvasChromeForZoom(webUiThemeSettings.contextRegionCloudTitleMaxWidth, zoom),
        Math.max(
            scaleCanvasChromeForZoom(webUiThemeSettings.contextRegionCloudTitleMinWidth, zoom),
            datum.title.length * charWidth + paddingX
        )
    )
    return {
        x: bounds.x + Math.max(scaleCanvasChromeForZoom(webUiThemeSettings.contextRegionCloudTitleMinX, zoom), bounds.width * style.titleAnchor.x),
        y: bounds.y - height - scaleCanvasChromeForZoom(webUiThemeSettings.contextRegionCloudTitleGap, zoom),
        width,
        height,
    }
}

export function hitTestContextRegionCloud(datum: ContextRegionCloudDatum, point: ContextRegionCloudPoint, zoom: number): ContextRegionCloudHit {
    if (rectContainsPoint(getContextRegionCloudTitleRect(datum, zoom), point)) {
        return { kind: 'title', nodeId: datum.nodeId }
    }

    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    const inBody = isPointInCo2CloudShape(datum, point, style)
    const onEdge = isPointNearCo2CloudEdge(datum, point, zoom, style)
    if (onEdge) {
        const handle = getContextRegionCloudResizeHandleForPoint(datum, point, style)
        return { kind: 'resize', nodeId: datum.nodeId, handle, cursor: getContextRegionCloudResizeCursor(handle) }
    }
    if (!inBody) return { kind: 'none' }
    return { kind: 'body', nodeId: datum.nodeId }
}

function getRectCorners(rect: ContextRegionCloudRect): ContextRegionCloudPoint[] {
    return [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x, y: rect.y + rect.height },
        { x: rect.x + rect.width, y: rect.y + rect.height },
    ]
}

function crossProduct(a: ContextRegionCloudPoint, b: ContextRegionCloudPoint, c: ContextRegionCloudPoint): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function pointIsOnSegment(point: ContextRegionCloudPoint, a: ContextRegionCloudPoint, b: ContextRegionCloudPoint): boolean {
    const epsilon = 1e-6
    return Math.abs(crossProduct(a, b, point)) <= epsilon &&
        point.x >= Math.min(a.x, b.x) - epsilon &&
        point.x <= Math.max(a.x, b.x) + epsilon &&
        point.y >= Math.min(a.y, b.y) - epsilon &&
        point.y <= Math.max(a.y, b.y) + epsilon
}

function segmentsIntersect(a: ContextRegionCloudPoint, b: ContextRegionCloudPoint, c: ContextRegionCloudPoint, d: ContextRegionCloudPoint): boolean {
    const abC = crossProduct(a, b, c)
    const abD = crossProduct(a, b, d)
    const cdA = crossProduct(c, d, a)
    const cdB = crossProduct(c, d, b)

    if (abC === 0 && pointIsOnSegment(c, a, b)) return true
    if (abD === 0 && pointIsOnSegment(d, a, b)) return true
    if (cdA === 0 && pointIsOnSegment(a, c, d)) return true
    if (cdB === 0 && pointIsOnSegment(b, c, d)) return true

    return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0)
}

function rectEdges(rect: ContextRegionCloudRect): Array<[ContextRegionCloudPoint, ContextRegionCloudPoint]> {
    const corners = getRectCorners(rect)
    return [
        [corners[0], corners[1]],
        [corners[1], corners[3]],
        [corners[3], corners[2]],
        [corners[2], corners[0]],
    ]
}

function polygonIntersectsRect(polygon: ContextRegionCloudPoint[], rect: ContextRegionCloudRect): boolean {
    if (polygon.some((point) => rectContainsPoint(rect, point))) return true
    if (getRectCorners(rect).some((point) => isPointInPolygon(point, polygon))) return true

    const edges = rectEdges(rect)
    for (let i = 0; i < polygon.length; i++) {
        const current = polygon[i]
        const next = polygon[(i + 1) % polygon.length]
        if (edges.some(([start, end]) => segmentsIntersect(current, next, start, end))) return true
    }

    return false
}

function circleIntersectsRect(circle: ContextRegionCloudCircle, rect: ContextRegionCloudRect): boolean {
    const closestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width))
    const closestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height))
    const dx = circle.x - closestX
    const dy = circle.y - closestY
    return dx * dx + dy * dy <= circle.radius * circle.radius
}

export function rectIntersectsContextRegionCloud(datum: ContextRegionCloudDatum, rect: ContextRegionCloudRect): boolean {
    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    const bounds = getContextRegionCloudBounds(datum, style)
    if (!rectsIntersect(rect, bounds)) return false

    const outline = getContextRegionCloudOutline(datum, style)
    return outline.circles.some((circle) => circleIntersectsRect(circle, rect)) ||
        outline.polygons.some((polygon) => polygonIntersectsRect(polygon, rect))
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
