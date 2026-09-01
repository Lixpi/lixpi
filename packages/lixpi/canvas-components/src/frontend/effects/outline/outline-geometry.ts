import { Easing } from '@lixpi/ui-primitives/animation'

export type TravelingOutlineStyle = {
    radius: number
    gap: number
    snakeHeadWidth: number
    snakeTailWidthFraction: number
    snakeTailThinLengthFraction: number
    snakeWidthTaperPower: number
    snakeLengthFraction: number
    snakeHeadRoundLengthFraction: number
    edgeFeatherFraction: number
    durationMs: number
}

export type TravelingOutlineDirection = 'clockwise' | 'counterclockwise'

export type TravelingOutlineDatum = {
    id: string
    x: number
    y: number
    width: number
    height: number
    radius: number
    visible: boolean
    direction?: TravelingOutlineDirection
    durationMs?: number
    snakeLengthFraction?: number
}

const TRAVELING_SNAKE_MIN_SAMPLE_COUNT = 32
const TRAVELING_SNAKE_MAX_SAMPLE_COUNT = 1440

export type OutlinePoint = {
    x: number
    y: number
}

export type OutlineFrame = {
    point: OutlinePoint
    tangent: OutlinePoint
}

export type OutlineGeometryUpdate =
    & Pick<TravelingOutlineDatum, 'x' | 'y' | 'width' | 'height'>
    & Partial<Pick<TravelingOutlineDatum, 'radius' | 'direction' | 'durationMs' | 'snakeLengthFraction'>>

export type TravelingSnakeMeshGeometry = {
    positions: Float32Array
    uvs: Float32Array
    indices: Uint32Array
}

// Rounded-rectangle perimeter in local media coordinates. Shared by branch
// outline placement and tests so the moving head travels at a consistent speed
// across rectangles and pre-frame circles.
export function getRoundedOutlinePerimeter(width: number, height: number, radius: number): number {
    const boundedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
    return 2 * (width + height - 4 * boundedRadius) + 2 * Math.PI * boundedRadius
}

// Convenience wrapper for callers that only need the sampled point and not the
// tangent. The full frame function below owns the actual path math.
export function getRoundedOutlinePoint(
    width: number,
    height: number,
    radius: number,
    distance: number,
): OutlinePoint {
    return getRoundedOutlineFrame(width, height, radius, distance).point
}

// Samples a rounded rectangle at a wrapped path distance. The tangent is kept
// with the point because the mesh builder needs a stable normal for strip width.
export function getRoundedOutlineFrame(
    width: number,
    height: number,
    radius: number,
    distance: number,
): OutlineFrame {
    const boundedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
    const perimeter = getRoundedOutlinePerimeter(width, height, boundedRadius)
    const offset = perimeter > 0 ? ((distance % perimeter) + perimeter) % perimeter : 0
    const horizontal = width - 2 * boundedRadius
    const vertical = height - 2 * boundedRadius
    const corner = Math.PI * boundedRadius / 2
    let remaining = offset

    if (remaining <= horizontal) {
        return {
            point: { x: boundedRadius + remaining, y: 0 },
            tangent: { x: 1, y: 0 },
        }
    }
    remaining -= horizontal
    if (remaining <= corner && boundedRadius > 0) {
        const angle = -Math.PI / 2 + remaining / boundedRadius
        return {
            point: {
                x: width - boundedRadius + boundedRadius * Math.cos(angle),
                y: boundedRadius + boundedRadius * Math.sin(angle),
            },
            tangent: { x: -Math.sin(angle), y: Math.cos(angle) },
        }
    }
    remaining -= corner
    if (remaining <= vertical) {
        return {
            point: { x: width, y: boundedRadius + remaining },
            tangent: { x: 0, y: 1 },
        }
    }
    remaining -= vertical
    if (remaining <= corner && boundedRadius > 0) {
        const angle = remaining / boundedRadius
        return {
            point: {
                x: width - boundedRadius + boundedRadius * Math.cos(angle),
                y: height - boundedRadius + boundedRadius * Math.sin(angle),
            },
            tangent: { x: -Math.sin(angle), y: Math.cos(angle) },
        }
    }
    remaining -= corner
    if (remaining <= horizontal) {
        return {
            point: { x: width - boundedRadius - remaining, y: height },
            tangent: { x: -1, y: 0 },
        }
    }
    remaining -= horizontal
    if (remaining <= corner && boundedRadius > 0) {
        const angle = Math.PI / 2 + remaining / boundedRadius
        return {
            point: {
                x: boundedRadius + boundedRadius * Math.cos(angle),
                y: height - boundedRadius + boundedRadius * Math.sin(angle),
            },
            tangent: { x: -Math.sin(angle), y: Math.cos(angle) },
        }
    }
    remaining -= corner
    if (remaining <= vertical) {
        return {
            point: { x: 0, y: height - boundedRadius - remaining },
            tangent: { x: 0, y: -1 },
        }
    }
    remaining -= vertical

    const angle = Math.PI + (boundedRadius > 0 ? remaining / boundedRadius : 0)
    return {
        point: {
            x: boundedRadius + boundedRadius * Math.cos(angle),
            y: boundedRadius + boundedRadius * Math.sin(angle),
        },
        tangent: { x: -Math.sin(angle), y: Math.cos(angle) },
    }
}

// Converts elapsed animation time into a path distance for the snake head. The
// easing curve lives here so every outline shape uses the same lap timing.
export function getTravelingOutlineHeadDistance(
    elapsed: number,
    durationMs: number,
    perimeter: number,
    ease: (progress: number) => number = Easing.travelingOutlineTransition,
): number {
    if (durationMs <= 0 || perimeter <= 0) return 0
    const lapProgress = (((elapsed % durationMs) + durationMs) % durationMs) / durationMs
    return ease(lapProgress) * perimeter
}

// Picks enough samples for smooth tapered geometry while clamping the maximum
// count so a huge media node cannot allocate unbounded WebGPU buffers.
function getTravelingSnakeSampleCount(snakeLength: number, snakeHeadWidth: number): number {
    const spacing = Math.max(0.5, snakeHeadWidth * 0.05)
    return Math.max(TRAVELING_SNAKE_MIN_SAMPLE_COUNT, Math.min(TRAVELING_SNAKE_MAX_SAMPLE_COUNT, Math.ceil(snakeLength / spacing)))
}

// Keep bounded CPU staging arrays; the engine owns GPU buffer reuse.
export function createTravelingSnakeMeshGeometry(): TravelingSnakeMeshGeometry {
    const stripVertexCount = (TRAVELING_SNAKE_MAX_SAMPLE_COUNT + 1) * 2
    const positions = new Float32Array(stripVertexCount * 2)
    const uvs = new Float32Array(positions.length)
    const indices = new Uint32Array(TRAVELING_SNAKE_MAX_SAMPLE_COUNT * 6)
    return { positions, uvs, indices }
}

// Writes one vertex into the fixed typed arrays. Keeping this tiny prevents the
// mesh-building loop from repeating offset math for position and UV arrays.
function setMeshVertex(
    geometry: TravelingSnakeMeshGeometry,
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

// Rounds the snake head cap by narrowing the final samples near the head. This
// keeps the droplet from ending in a square cut while preserving fixed geometry.
function getTravelingSnakeHeadRoundFactor(
    progress: number,
    snakeLength: number,
    roundLength: number,
): number {
    if (roundLength <= 0 || snakeLength <= 0) return 1
    const distanceFromHead = snakeLength * (1 - progress)
    if (distanceFromHead >= roundLength) return 1
    const roundProgress = Math.max(0, Math.min(1, distanceFromHead / roundLength))
    return Math.sqrt(Math.max(0, 1 - (1 - roundProgress) ** 2))
}

// Tapers tail width according to the configured thin-tail fraction and power.
// The returned value is 0..1 and is later mixed between tail and head width.
function getTravelingSnakeWidthProgress(
    progress: number,
    thinTailLengthFraction: number,
    taperPower: number,
): number {
    const boundedThinTailLength = Number.isFinite(thinTailLengthFraction)
        ? Math.max(0, Math.min(0.85, thinTailLengthFraction))
        : 0
    const boundedTaperPower = Number.isFinite(taperPower)
        ? Math.max(0.1, taperPower)
        : 1
    const taperProgress = Math.max(0, Math.min(1, (progress - boundedThinTailLength) / (1 - boundedThinTailLength)))

    return Math.pow(taperProgress, boundedTaperPower)
}

// Converts semantic direction into a signed path offset. Geometry code only
// deals with multiplying distances by 1 or -1.
function getTravelingOutlineDirectionSign(direction?: TravelingOutlineDirection): 1 | -1 {
    return direction === 'counterclockwise' ? -1 : 1
}

// Samples the visible outline while letting the head and body use different
// outsets. That keeps the snake centered on the configured media border even
// when head width differs from the thinner tail width.
function getInsetAlignedRoundedOutlineFrame(
    mediaWidth: number,
    mediaHeight: number,
    mediaRadius: number,
    sampleOutset: number,
    headOutset: number,
    distance: number,
): OutlineFrame {
    const baseRadius = Math.max(0, Math.min(mediaRadius, mediaWidth / 2, mediaHeight / 2))
    const sampleRadius = baseRadius + sampleOutset
    const headRadius = baseRadius + headOutset
    const horizontal = Math.max(0, mediaWidth - 2 * baseRadius)
    const vertical = Math.max(0, mediaHeight - 2 * baseRadius)
    const headCorner = Math.PI * headRadius / 2
    const headPerimeter = 2 * (horizontal + vertical) + 4 * headCorner
    const sampleWidth = mediaWidth + sampleOutset * 2
    const sampleHeight = mediaHeight + sampleOutset * 2
    const shift = headOutset - sampleOutset
    let remaining = headPerimeter > 0 ? ((distance % headPerimeter) + headPerimeter) % headPerimeter : 0

    const shifted = (point: OutlinePoint, tangent: OutlinePoint): OutlineFrame => ({
        point: { x: point.x + shift, y: point.y + shift },
        tangent,
    })

    if (remaining <= horizontal) {
        return shifted(
            { x: sampleRadius + remaining, y: 0 },
            { x: 1, y: 0 },
        )
    }
    remaining -= horizontal
    if (remaining <= headCorner && headCorner > 0) {
        const angle = -Math.PI / 2 + (remaining / headCorner) * (Math.PI / 2)
        return shifted(
            {
                x: sampleWidth - sampleRadius + sampleRadius * Math.cos(angle),
                y: sampleRadius + sampleRadius * Math.sin(angle),
            },
            { x: -Math.sin(angle), y: Math.cos(angle) },
        )
    }
    remaining -= headCorner
    if (remaining <= vertical) {
        return shifted(
            { x: sampleWidth, y: sampleRadius + remaining },
            { x: 0, y: 1 },
        )
    }
    remaining -= vertical
    if (remaining <= headCorner && headCorner > 0) {
        const angle = (remaining / headCorner) * (Math.PI / 2)
        return shifted(
            {
                x: sampleWidth - sampleRadius + sampleRadius * Math.cos(angle),
                y: sampleHeight - sampleRadius + sampleRadius * Math.sin(angle),
            },
            { x: -Math.sin(angle), y: Math.cos(angle) },
        )
    }
    remaining -= headCorner
    if (remaining <= horizontal) {
        return shifted(
            { x: sampleWidth - sampleRadius - remaining, y: sampleHeight },
            { x: -1, y: 0 },
        )
    }
    remaining -= horizontal
    if (remaining <= headCorner && headCorner > 0) {
        const angle = Math.PI / 2 + (remaining / headCorner) * (Math.PI / 2)
        return shifted(
            {
                x: sampleRadius + sampleRadius * Math.cos(angle),
                y: sampleHeight - sampleRadius + sampleRadius * Math.sin(angle),
            },
            { x: -Math.sin(angle), y: Math.cos(angle) },
        )
    }
    remaining -= headCorner
    if (remaining <= vertical) {
        return shifted(
            { x: 0, y: sampleHeight - sampleRadius - remaining },
            { x: 0, y: -1 },
        )
    }
    remaining -= vertical

    const angle = Math.PI + (headCorner > 0 ? (remaining / headCorner) * (Math.PI / 2) : 0)
    return shifted(
        {
            x: sampleRadius + sampleRadius * Math.cos(angle),
            y: sampleRadius + sampleRadius * Math.sin(angle),
        },
        { x: -Math.sin(angle), y: Math.cos(angle) },
    )
}

// Rewrites the CPU staging arrays for one frame of the traveling snake. The mesh
// uses zero-filled unused indices so fixed-size buffers can represent shorter
// snakes without changing buffer shape.
function buildTravelingSnakeMeshGeometry(
    geometry: TravelingSnakeMeshGeometry,
    mediaWidth: number,
    mediaHeight: number,
    mediaRadius: number,
    outlineGap: number,
    headDistance: number,
    snakeLength: number,
    sampleCount: number,
    snakeHeadWidth: number,
    snakeTailWidth: number,
    snakeTailThinLengthFraction: number,
    snakeWidthTaperPower: number,
    travelDirection: 1 | -1,
    edgeFeatherFraction: number,
    snakeHeadRoundLengthFraction: number,
): void {
    const boundedSampleCount = Math.min(sampleCount, TRAVELING_SNAKE_MAX_SAMPLE_COUNT)
    const indices = geometry.indices
    let indexOffset = 0
    const headOutset = outlineGap + snakeHeadWidth / 2
    const meshWidthScale = 1 + Math.max(0, edgeFeatherFraction) * 2
    const headRoundLength = snakeHeadWidth * meshWidthScale * Math.max(0, snakeHeadRoundLengthFraction)

    for (let index = 0; index <= boundedSampleCount; index++) {
        const progress = index / boundedSampleCount
        const widthProgress = getTravelingSnakeWidthProgress(progress, snakeTailThinLengthFraction, snakeWidthTaperPower)
        const sampleWidth = snakeTailWidth + (snakeHeadWidth - snakeTailWidth) * widthProgress
        const headRoundFactor = getTravelingSnakeHeadRoundFactor(progress, snakeLength, headRoundLength)
        const meshSampleWidth = sampleWidth * meshWidthScale * headRoundFactor
        const sampleOutset = outlineGap + sampleWidth / 2
        const frame = getInsetAlignedRoundedOutlineFrame(
            mediaWidth,
            mediaHeight,
            mediaRadius,
            sampleOutset,
            headOutset,
            headDistance - travelDirection * snakeLength * (1 - progress),
        )
        const normal = { x: -frame.tangent.y, y: frame.tangent.x }
        const halfWidth = meshSampleWidth / 2
        const leftVertex = index * 2
        const rightVertex = leftVertex + 1
        const crossSectionStart = headRoundFactor <= 0.001 ? 0.5 : 0
        const crossSectionEnd = headRoundFactor <= 0.001 ? 0.5 : 1

        setMeshVertex(
            geometry,
            leftVertex,
            frame.point.x + normal.x * halfWidth,
            frame.point.y + normal.y * halfWidth,
            progress,
            crossSectionStart,
        )
        setMeshVertex(
            geometry,
            rightVertex,
            frame.point.x - normal.x * halfWidth,
            frame.point.y - normal.y * halfWidth,
            progress,
            crossSectionEnd,
        )

        if (index < boundedSampleCount) {
            const nextLeftVertex = leftVertex + 2
            const nextRightVertex = leftVertex + 3
            indices[indexOffset++] = leftVertex
            indices[indexOffset++] = rightVertex
            indices[indexOffset++] = nextLeftVertex
            indices[indexOffset++] = rightVertex
            indices[indexOffset++] = nextRightVertex
            indices[indexOffset++] = nextLeftVertex
        }
    }

    indices.fill(0, indexOffset)
}

export function writeTravelingOutlineGeometry(
    geometry: TravelingSnakeMeshGeometry,
    entry: TravelingOutlineDatum,
    style: TravelingOutlineStyle,
    elapsed: number,
    scale = 1,
    ease: (progress: number) => number = Easing.travelingOutlineTransition,
): OutlinePoint {
    const strokeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
    const snakeHeadWidth = style.snakeHeadWidth * strokeScale
    const outlineGap = style.gap * strokeScale
    const mediaRadius = Number.isFinite(entry.radius) ? Math.max(0, entry.radius) : style.radius
    const snakeTailWidth = snakeHeadWidth * Math.max(0, Math.min(1, style.snakeTailWidthFraction))
    const headOutset = outlineGap + snakeHeadWidth / 2
    const outlineWidth = entry.width + headOutset * 2
    const outlineHeight = entry.height + headOutset * 2
    const outlineRadius = mediaRadius + headOutset
    const perimeter = getRoundedOutlinePerimeter(outlineWidth, outlineHeight, outlineRadius)
    const travelDirection = getTravelingOutlineDirectionSign(entry.direction)
    const durationMs = Number.isFinite(entry.durationMs) && Number(entry.durationMs) > 0
        ? Number(entry.durationMs)
        : style.durationMs
    const headDistance = getTravelingOutlineHeadDistance(elapsed, durationMs, perimeter, ease) * travelDirection
    const snakeLengthFraction = Number.isFinite(entry.snakeLengthFraction) && Number(entry.snakeLengthFraction) > 0
        ? Number(entry.snakeLengthFraction)
        : style.snakeLengthFraction
    const snakeLength = perimeter * snakeLengthFraction
    const sampleCount = getTravelingSnakeSampleCount(snakeLength, snakeHeadWidth)
    buildTravelingSnakeMeshGeometry(
        geometry,
        entry.width,
        entry.height,
        mediaRadius,
        outlineGap,
        headDistance,
        snakeLength,
        sampleCount,
        snakeHeadWidth,
        snakeTailWidth,
        style.snakeTailThinLengthFraction,
        style.snakeWidthTaperPower,
        travelDirection,
        style.edgeFeatherFraction,
        style.snakeHeadRoundLengthFraction,
    )

    return { x: entry.x - headOutset, y: entry.y - headOutset }
}
