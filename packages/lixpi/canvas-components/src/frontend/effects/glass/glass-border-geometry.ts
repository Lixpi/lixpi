import {
    getRoundedOutlineFrame,
    getRoundedOutlinePerimeter,
} from '../outline/outline-geometry.ts'
import {
    type GlassPixels,
} from './glass-material.ts'

export type GlassBorderStyle = {
    enabled: boolean
    widthPx: number
    displacementScalePx: number
    displacementMapMaxDimensionPx: number
    edgeRefractionStrength: number
    surfaceWaveStrength: number
    causticBandStrength: number
    displacementFrequencyX: number
    displacementFrequencyY: number
    bodyColor: string
    bodyAlpha: number
    highlightColor: string
    highlightAlpha: number
    shadowColor: string
    shadowAlpha: number
    edgeFeatherFraction: number
}

export type GlassBorderDatum = {
    id: string
    x: number
    y: number
    width: number
    height: number
    radius: number
    visible: boolean
}

export type ViewportSize = {
    width: number
    height: number
}

export type GlassBorderMeshGeometry = {
    positions: Float32Array
    uvs: Float32Array
    indices: Uint32Array
}

const GLASS_BORDER_MAX_SAMPLE_COUNT = 1600

// Local numeric clamp used in the pixel baker. Keeping it tiny and local avoids
// pulling broader utility code into this effect.
function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value))
}

// Signed-distance field for a rounded rectangle in screen space. Negative is
// inside the rectangle, zero is the centerline of the visible border, positive
// is outside. The displacement baker uses this as the glass cross-section.
function getRoundedRectSignedDistance(
    px: number,
    py: number,
    rect: { x: number; y: number; width: number; height: number; radius: number },
): number {
    const halfWidth = rect.width / 2
    const halfHeight = rect.height / 2
    const radius = Math.max(0, Math.min(rect.radius, halfWidth, halfHeight))
    const qx = Math.abs(px - (rect.x + halfWidth)) - (halfWidth - radius)
    const qy = Math.abs(py - (rect.y + halfHeight)) - (halfHeight - radius)
    const outsideX = Math.max(qx, 0)
    const outsideY = Math.max(qy, 0)
    return Math.hypot(outsideX, outsideY) + Math.min(Math.max(qx, qy), 0) - radius
}

// Numerical gradient of the rounded-rect SDF. This gives a stable outward
// normal on straight sides and corners, which is what creates edge refraction
// that follows the actual input/button shape instead of a generic screen wave.
function getRoundedRectNormal(
    px: number,
    py: number,
    rect: { x: number; y: number; width: number; height: number; radius: number },
): { x: number; y: number } {
    const epsilon = 0.75
    const dx = getRoundedRectSignedDistance(px + epsilon, py, rect)
        - getRoundedRectSignedDistance(px - epsilon, py, rect)
    const dy = getRoundedRectSignedDistance(px, py + epsilon, rect)
        - getRoundedRectSignedDistance(px, py - epsilon, rect)
    const length = Math.hypot(dx, dy)
    if (length <= 0.0001) return { x: 0, y: -1 }
    return { x: dx / length, y: dy / length }
}

// The border mesh is a closed strip around the rounded perimeter. Sampling more
// densely for wider/longer borders keeps corners smooth without allowing a huge
// prompt bar to create unbounded geometry.
function getGlassBorderSampleCount(perimeter: number, borderWidth: number): number {
    const spacing = Math.max(1, borderWidth * 0.35)
    return Math.max(48, Math.min(GLASS_BORDER_MAX_SAMPLE_COUNT, Math.ceil(perimeter / spacing)))
}

// Keep fixed CPU staging arrays; the engine handles GPU buffer reuse.
export function createGlassBorderMeshGeometry(): GlassBorderMeshGeometry {
    const vertexCount = (GLASS_BORDER_MAX_SAMPLE_COUNT + 1) * 2
    const positions = new Float32Array(vertexCount * 2)
    const uvs = new Float32Array(positions.length)
    const indices = new Uint32Array(GLASS_BORDER_MAX_SAMPLE_COUNT * 6)
    return { positions, uvs, indices }
}

function setMeshVertex(
    geometry: GlassBorderMeshGeometry,
    vertexIndex: number,
    x: number,
    y: number,
    u: number,
    v: number,
): void {
    const positionIndex = vertexIndex * 2
    geometry.positions[positionIndex] = x
    geometry.positions[positionIndex + 1] = y
    geometry.uvs[positionIndex] = u
    geometry.uvs[positionIndex + 1] = v
}

// Builds the visible closed glass strip. The strip is separate from the
// displacement mask: the mask refracts captured canvas pixels, while this mesh
// adds the faint specular body that makes the border read as glass on top of
// busy imagery without becoming visible on plain white.
export function writeClosedRoundedBorderGeometry(
    geometry: GlassBorderMeshGeometry,
    datum: GlassBorderDatum,
    borderWidth: number,
    edgeFeatherFraction: number,
): void {
    const boundedWidth = Math.max(0, datum.width)
    const boundedHeight = Math.max(0, datum.height)
    const radius = Math.max(0, Math.min(datum.radius, boundedWidth / 2, boundedHeight / 2))
    const perimeter = getRoundedOutlinePerimeter(boundedWidth, boundedHeight, radius)
    const sampleCount = getGlassBorderSampleCount(perimeter, borderWidth)
    const indices = geometry.indices
    const meshWidthScale = 1 + Math.max(0, edgeFeatherFraction) * 2
    const halfWidth = borderWidth * meshWidthScale / 2
    let indexOffset = 0

    for (let index = 0; index <= sampleCount; index++) {
        const progress = index / sampleCount
        const frame = getRoundedOutlineFrame(boundedWidth, boundedHeight, radius, perimeter * progress)
        const inwardNormal = { x: -frame.tangent.y, y: frame.tangent.x }
        const outerVertex = index * 2
        const innerVertex = outerVertex + 1

        setMeshVertex(
            geometry,
            outerVertex,
            datum.x + frame.point.x - inwardNormal.x * halfWidth,
            datum.y + frame.point.y - inwardNormal.y * halfWidth,
            progress,
            0,
        )
        setMeshVertex(
            geometry,
            innerVertex,
            datum.x + frame.point.x + inwardNormal.x * halfWidth,
            datum.y + frame.point.y + inwardNormal.y * halfWidth,
            progress,
            1,
        )

        if (index < sampleCount) {
            const nextOuterVertex = outerVertex + 2
            const nextInnerVertex = outerVertex + 3
            indices[indexOffset++] = outerVertex
            indices[indexOffset++] = innerVertex
            indices[indexOffset++] = nextOuterVertex
            indices[indexOffset++] = innerVertex
            indices[indexOffset++] = nextInnerVertex
            indices[indexOffset++] = nextOuterVertex
        }
    }

    indices.fill(0, indexOffset)
}

// The map is screen-space, but it does not need to match full retina canvas
// size. Capping the longest side keeps CPU image-data writes bounded while the
// displacement sprite stretches the map across the viewport.
function getDisplacementMapScale(viewport: ViewportSize, style: GlassBorderStyle): number {
    const maxDimension = Math.max(256, Math.round(style.displacementMapMaxDimensionPx || 1400))
    const longestSide = Math.max(1, viewport.width, viewport.height)
    return Math.min(1, maxDimension / longestSide)
}

// The displacement map is expensive enough to avoid rewriting when geometry and
// tuning values have not materially changed. Geometry is rounded to tenths of a
// pixel so tiny DOM layout noise does not force a full image-data repaint.
export function getDisplacementSignature(
    datums: ReadonlyArray<GlassBorderDatum>,
    viewport: ViewportSize,
    style: GlassBorderStyle,
): string {
    const geometry = datums
        .map((datum) =>
            [
                datum.id,
                Math.round(datum.x * 10) / 10,
                Math.round(datum.y * 10) / 10,
                Math.round(datum.width * 10) / 10,
                Math.round(datum.height * 10) / 10,
                Math.round(datum.radius * 10) / 10,
            ].join(':')
        )
        .join('|')
    return [
        Math.round(viewport.width),
        Math.round(viewport.height),
        Math.round(style.widthPx * 10) / 10,
        Math.round(style.edgeRefractionStrength * 100) / 100,
        Math.round(style.surfaceWaveStrength * 100) / 100,
        Math.round(style.causticBandStrength * 100) / 100,
        Math.round(style.displacementFrequencyX * 100) / 100,
        Math.round(style.displacementFrequencyY * 100) / 100,
        geometry,
    ].join(',')
}

// Fingerprint for one material mesh. It is intentionally rounded so tiny
// DOM-measurement jitter does not rewrite buffers every render.
export function getMaterialGeometrySignature(
    datum: GlassBorderDatum,
    borderWidth: number,
    edgeFeatherFraction: number,
): string {
    return [
        Math.round(datum.x * 10) / 10,
        Math.round(datum.y * 10) / 10,
        Math.round(datum.width * 10) / 10,
        Math.round(datum.height * 10) / 10,
        Math.round(datum.radius * 10) / 10,
        Math.round(borderWidth * 10) / 10,
        Math.round(edgeFeatherFraction * 1000) / 1000,
    ].join(',')
}

// Fingerprint for Graphics mask/highlight rebuilds. Graphics.clear() causes
// Pixi to rebuild internal graphics buffers, so this keeps that path out of
// steady-state renders when layout did not actually change.
export function getMaskAndHighlightSignature(
    datums: ReadonlyArray<GlassBorderDatum>,
    style: GlassBorderStyle,
): string {
    const geometry = datums
        .map((datum) =>
            [
                datum.id,
                Math.round(datum.x * 10) / 10,
                Math.round(datum.y * 10) / 10,
                Math.round(datum.width * 10) / 10,
                Math.round(datum.height * 10) / 10,
                Math.round(datum.radius * 10) / 10,
            ].join(':')
        )
        .join('|')
    return [
        Math.round(Math.max(0, style.widthPx) * 10) / 10,
        style.bodyColor,
        Math.round(clamp01(style.bodyAlpha) * 1000) / 1000,
        style.highlightColor,
        Math.round(clamp01(style.highlightAlpha) * 1000) / 1000,
        style.shadowColor,
        Math.round(clamp01(style.shadowAlpha) * 1000) / 1000,
        geometry,
    ].join(',')
}

// CPU-bakes a two-channel normal/displacement map for every visible glass ring.
// R/G are signed displacement vectors centered on 128. B carries rim volume for
// debugging/future material use, and A stays opaque so the renderer samples defined data
// across the whole map. Pixels outside every ring stay neutral 128/128/128/255.
function writeLiquidGlassDisplacementMap(
    rgba: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    mapScale: number,
    datums: ReadonlyArray<GlassBorderDatum>,
    style: GlassBorderStyle,
): void {
    rgba.fill(128)
    for (let offset = 3; offset < rgba.length; offset += 4) {
        rgba[offset] = 255
    }

    const borderWidth = Math.max(1, style.widthPx)
    const halfBorderWidth = borderWidth / 2
    const twoPi = Math.PI * 2
    const edgeRefractionStrength = Math.max(0, style.edgeRefractionStrength)
    const surfaceWaveStrength = Math.max(0, style.surfaceWaveStrength)
    const causticBandStrength = Math.max(0, style.causticBandStrength)
    const frequencyX = Number.isFinite(style.displacementFrequencyX) ? style.displacementFrequencyX : 4.6
    const frequencyY = Number.isFinite(style.displacementFrequencyY) ? style.displacementFrequencyY : 3.8

    for (const datum of datums) {
        // Iterate only the expanded border bounds for each target. The map can
        // cover the whole pane, but most pixels are not near glass and should
        // remain untouched neutral values.
        const outerBounds = {
            minX: Math.max(0, Math.floor((datum.x - halfBorderWidth - 1) * mapScale)),
            minY: Math.max(0, Math.floor((datum.y - halfBorderWidth - 1) * mapScale)),
            maxX: Math.min(mapWidth - 1, Math.ceil((datum.x + datum.width + halfBorderWidth + 1) * mapScale)),
            maxY: Math.min(mapHeight - 1, Math.ceil((datum.y + datum.height + halfBorderWidth + 1) * mapScale)),
        }
        const centerRect = {
            x: datum.x,
            y: datum.y,
            width: datum.width,
            height: datum.height,
            radius: datum.radius,
        }

        for (let mapY = outerBounds.minY; mapY <= outerBounds.maxY; mapY++) {
            const screenY = (mapY + 0.5) / mapScale
            for (let mapX = outerBounds.minX; mapX <= outerBounds.maxX; mapX++) {
                const screenX = (mapX + 0.5) / mapScale
                const centerDistance = getRoundedRectSignedDistance(screenX, screenY, centerRect)
                if (centerDistance < -halfBorderWidth || centerDistance > halfBorderWidth) continue

                // ringProgress is the border cross-section: 0 = inner edge,
                // 0.5 = centerline, 1 = outer edge. The normal term pinches
                // source pixels across edges while tangential waves smear
                // content around the perimeter like liquid glass.
                const ringProgress = clamp01((centerDistance + halfBorderWidth) / borderWidth)
                const rimVolume = Math.sin(ringProgress * Math.PI)
                const edgePinch = Math.cos(ringProgress * Math.PI)
                const normal = getRoundedRectNormal(screenX, screenY, centerRect)
                const tangent = { x: -normal.y, y: normal.x }
                const localU = datum.width > 0 ? (screenX - datum.x) / datum.width : 0
                const localV = datum.height > 0 ? (screenY - datum.y) / datum.height : 0
                const liquidWave = Math.sin((localU * frequencyX + localV * frequencyY) * twoPi)
                const crossWave = Math.cos((localU * (frequencyY + 1.7) - localV * (frequencyX + 0.9)) * twoPi)
                const causticBand = Math.sin((ringProgress * 2.2 + localU * 0.8 - localV * 0.35) * twoPi)
                const normalStrength = edgePinch * edgeRefractionStrength
                    + rimVolume * causticBand * causticBandStrength
                const tangentStrength = rimVolume * (liquidWave * surfaceWaveStrength + crossWave * surfaceWaveStrength * 0.45)
                const vectorX = normal.x * normalStrength + tangent.x * tangentStrength
                const vectorY = normal.y * normalStrength + tangent.y * tangentStrength
                const offset = (mapY * mapWidth + mapX) * 4
                rgba[offset] = Math.max(0, Math.min(255, 128 + Math.round(vectorX * 127)))
                rgba[offset + 1] = Math.max(0, Math.min(255, 128 + Math.round(vectorY * 127)))
                rgba[offset + 2] = Math.max(0, Math.min(255, 128 + Math.round(rimVolume * 70)))
                rgba[offset + 3] = 255
            }
        }
    }
}

export function bakeGlassDisplacementMap(datums: readonly GlassBorderDatum[], viewport: ViewportSize, style: GlassBorderStyle): GlassPixels {
    const scale = getDisplacementMapScale(viewport, style)
    const width = Math.max(1, Math.ceil(viewport.width * scale))
    const height = Math.max(1, Math.ceil(viewport.height * scale))
    const rgba = new Uint8Array(width * height * 4)
    writeLiquidGlassDisplacementMap(rgba, width, height, scale, datums, style)
    return { kind: 'pixels', size: { width, height }, rgba }
}
