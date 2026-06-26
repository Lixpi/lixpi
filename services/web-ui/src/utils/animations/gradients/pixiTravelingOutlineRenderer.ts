import {
    Container,
    Mesh,
    MeshGeometry,
    Texture,
} from 'pixi.js'
import { Easing } from '$src/utils/animations/easing.ts'
import {
    TravelingSnakeGlassMaterial,
    interpolateTravelingOutlineColor,
    type GlassMaterialStyle,
} from '$src/utils/animations/gradients/pixiGlassMaterial.ts'

// Re-exported for back-compat with existing call sites and tests that import
// these names from the renderer.
export { interpolateTravelingOutlineColor }
export type PixiTravelingOutlineGlassMaterialStyle = GlassMaterialStyle

export type PixiTravelingOutlineStyle = {
    radius: number
    gap: number
    snakeHeadWidth: number
    snakeTailWidthFraction: number
    snakeTailThinLengthFraction: number
    snakeWidthTaperPower: number
    snakeLengthFraction: number
    snakeHeadRoundLengthFraction: number
    snakeTailAlpha: number
    snakeColors: ReadonlyArray<string>
    glassMaterial: PixiTravelingOutlineGlassMaterialStyle
    durationMs: number
}

export type PixiTravelingOutlineDirection = 'clockwise' | 'counterclockwise'

export type PixiTravelingOutlineDatum = {
    id: string
    x: number
    y: number
    width: number
    height: number
    radius: number
    visible: boolean
    direction?: PixiTravelingOutlineDirection
    durationMs?: number
    snakeLengthFraction?: number
}

export type PixiTravelingOutlineRendererOptions = {
    container: Container
    style: PixiTravelingOutlineStyle
    onFrame: () => void
    ease?: (progress: number) => number
    getStrokeScale?: () => number
}

const OUTLINE_GEOMETRY_RING_SIZE = 8
const TRAVELING_SNAKE_MIN_SAMPLE_COUNT = 32
const TRAVELING_SNAKE_MAX_SAMPLE_COUNT = 1440

type OutlineMeshSlot = {
    mesh: Mesh
    geometry: MeshGeometry
    buffers: TravelingSnakeMeshGeometry
}

type OutlineEntry = {
    slots: OutlineMeshSlot[]
    activeSlotIndex: number
    active: boolean
    renderable: boolean
    x: number
    y: number
    width: number
    height: number
    radius: number
    direction: PixiTravelingOutlineDirection
    durationMs?: number
    snakeLengthFraction?: number
}

export type OutlinePoint = {
    x: number
    y: number
}

export type OutlineFrame = {
    point: OutlinePoint
    tangent: OutlinePoint
}

type OutlineGeometryUpdate = Pick<PixiTravelingOutlineDatum, 'x' | 'y' | 'width' | 'height'>
    & Partial<Pick<PixiTravelingOutlineDatum, 'radius' | 'direction' | 'durationMs' | 'snakeLengthFraction'>>

type TravelingSnakeMeshGeometry = {
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
    distance: number
): OutlinePoint {
    return getRoundedOutlineFrame(width, height, radius, distance).point
}

// Samples a rounded rectangle at a wrapped path distance. The tangent is kept
// with the point because the mesh builder needs a stable normal for strip width.
export function getRoundedOutlineFrame(
    width: number,
    height: number,
    radius: number,
    distance: number
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
    ease: (progress: number) => number = Easing.travelingOutlineTransition
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

// Allocates the maximum typed arrays once per mesh slot. Runtime paints mutate
// these arrays in place instead of replacing them, which avoids Pixi destroying
// and recreating GPU buffers during WebGPU submits.
function createTravelingSnakeMeshGeometry(): TravelingSnakeMeshGeometry {
    const stripVertexCount = (TRAVELING_SNAKE_MAX_SAMPLE_COUNT + 1) * 2
    const positions = new Float32Array(stripVertexCount * 2)
    const uvs = new Float32Array(positions.length)
    const indices = new Uint32Array(TRAVELING_SNAKE_MAX_SAMPLE_COUNT * 6)
    return { positions, uvs, indices }
}

// Notifies Pixi that the existing buffers changed. This is intentionally
// `update()` rather than assigning new `positions`/`uvs`/`indices` arrays.
function updateMeshGeometryBuffers(geometry: MeshGeometry): void {
    const dynamicGeometry = geometry as MeshGeometry & {
        attributes: {
            aPosition: { buffer: { update: () => void } }
            aUV: { buffer: { update: () => void } }
        }
        indexBuffer: { update: () => void }
    }
    dynamicGeometry.attributes.aPosition.buffer.update()
    dynamicGeometry.attributes.aUV.buffer.update()
    dynamicGeometry.indexBuffer.update()
}

// Writes one vertex into the fixed typed arrays. Keeping this tiny prevents the
// mesh-building loop from repeating offset math for position and UV arrays.
function setMeshVertex(
    geometry: TravelingSnakeMeshGeometry,
    vertexIndex: number,
    x: number,
    y: number,
    u: number,
    v: number
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
    roundLength: number
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
    taperPower: number
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
function getTravelingOutlineDirectionSign(direction?: PixiTravelingOutlineDirection): 1 | -1 {
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
    distance: number
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
            { x: 1, y: 0 }
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
            { x: -Math.sin(angle), y: Math.cos(angle) }
        )
    }
    remaining -= headCorner
    if (remaining <= vertical) {
        return shifted(
            { x: sampleWidth, y: sampleRadius + remaining },
            { x: 0, y: 1 }
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
            { x: -Math.sin(angle), y: Math.cos(angle) }
        )
    }
    remaining -= headCorner
    if (remaining <= horizontal) {
        return shifted(
            { x: sampleWidth - sampleRadius - remaining, y: sampleHeight },
            { x: -1, y: 0 }
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
            { x: -Math.sin(angle), y: Math.cos(angle) }
        )
    }
    remaining -= headCorner
    if (remaining <= vertical) {
        return shifted(
            { x: 0, y: sampleHeight - sampleRadius - remaining },
            { x: 0, y: -1 }
        )
    }
    remaining -= vertical

    const angle = Math.PI + (headCorner > 0 ? (remaining / headCorner) * (Math.PI / 2) : 0)
    return shifted(
        {
            x: sampleRadius + sampleRadius * Math.cos(angle),
            y: sampleRadius + sampleRadius * Math.sin(angle),
        },
        { x: -Math.sin(angle), y: Math.cos(angle) }
    )
}

// Rewrites the active mesh slot for one frame of the traveling snake. The mesh
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
    snakeHeadRoundLengthFraction: number
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
            headDistance - travelDirection * snakeLength * (1 - progress)
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
            crossSectionStart
        )
        setMeshVertex(
            geometry,
            rightVertex,
            frame.point.x - normal.x * halfWidth,
            frame.point.y - normal.y * halfWidth,
            progress,
            crossSectionEnd
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

// Owns animated Pixi meshes for generated-media progress outlines. Each entry
// keeps a small ring of fixed-size mesh slots so WebGPU can render one slot
// while the next frame writes another slot, avoiding same-buffer overwrite and
// buffer replacement during rapid prompt/drag/model updates.
export class PixiTravelingOutlineRenderer {
    private readonly container: Container
    private readonly style: PixiTravelingOutlineStyle
    private readonly onFrame: () => void
    private readonly ease: (progress: number) => number
    private readonly getStrokeScale: () => number
    private readonly texture: Texture
    private readonly entries = new Map<string, OutlineEntry>()
    private animationRaf: number | null = null
    private animationStartedAt: number | null = null
    private destroyed = false

    // Constructor bakes the shared glass texture once. Per-target animation only
    // changes geometry, so all outlines use the same material resource.
    constructor(options: PixiTravelingOutlineRendererOptions) {
        this.container = options.container
        this.style = options.style
        this.onFrame = options.onFrame
        this.ease = options.ease ?? Easing.travelingOutlineTransition
        this.getStrokeScale = options.getStrokeScale ?? (() => 1)
        this.texture = new TravelingSnakeGlassMaterial(
            this.style.snakeColors,
            this.style.snakeTailAlpha,
            this.style.glassMaterial
        ).bake()
    }

    // Reconciles caller datums with renderer entries. Missing datums are hidden,
    // not destroyed, so transient selection/reference changes do not churn Pixi
    // DisplayObjects or GPU resources.
    sync(datums: ReadonlyArray<PixiTravelingOutlineDatum>): void {
        if (this.destroyed) return
        const activeIds = new Set(datums.map((datum) => datum.id))
        for (const [id, entry] of this.entries) {
            if (!activeIds.has(id)) this.hideEntry(entry)
        }

        for (const datum of datums) {
            const entry = this.entries.get(datum.id) ?? this.createEntry(datum)
            this.entries.set(datum.id, entry)
            entry.active = true
            this.updateEntryGeometry(entry, datum)
            this.setEntryRenderable(entry, datum.visible)
        }

        this.stopIfIdle()
        if (this.hasRenderableEntries()) this.start()
        this.onFrame()
    }

    // Updates geometry for one existing entry without changing visibility. This
    // lets live node transforms move outlines during drag without rebuilding the
    // whole target set.
    updateGeometry(
        id: string,
        geometry: OutlineGeometryUpdate
    ): void {
        const entry = this.entries.get(id)
        if (!entry) return
        this.updateEntryGeometry(entry, geometry)
    }

    // Flips one entry between drawn and hidden while keeping its mesh slots
    // alive. Used when a target remains known but should stop rendering.
    setVisible(id: string, visible: boolean): void {
        const entry = this.entries.get(id)
        if (!entry) return
        this.setEntryRenderable(entry, visible)
    }

    // Releases all renderer-owned Pixi resources. This path runs on layer
    // teardown, not normal sync, so destroying meshes is safe here.
    destroy(): void {
        this.destroyed = true
        if (this.animationRaf !== null) {
            cancelAnimationFrame(this.animationRaf)
            this.animationRaf = null
        }
        for (const id of this.entries.keys()) this.destroyEntry(id)
        this.animationStartedAt = null
        if (this.texture !== Texture.WHITE) this.texture.destroy(true)
    }

    // Paints one animation frame into the next mesh slot. Slot rotation prevents
    // editing the same GPU buffer that a just-submitted frame may still read.
    private paint(entry: OutlineEntry, elapsed: number): void {
        const activeSlotIndex = (entry.activeSlotIndex + 1) % entry.slots.length
        const activeSlot = entry.slots[activeSlotIndex]
        const strokeScale = this.getSafeStrokeScale()
        const snakeHeadWidth = this.style.snakeHeadWidth * strokeScale
        const outlineGap = this.style.gap * strokeScale
        const mediaRadius = Number.isFinite(entry.radius) ? Math.max(0, entry.radius) : this.style.radius
        const snakeTailWidth = snakeHeadWidth * Math.max(0, Math.min(1, this.style.snakeTailWidthFraction))
        const headOutset = outlineGap + snakeHeadWidth / 2
        const outlineWidth = entry.width + headOutset * 2
        const outlineHeight = entry.height + headOutset * 2
        const outlineRadius = mediaRadius + headOutset
        const perimeter = getRoundedOutlinePerimeter(outlineWidth, outlineHeight, outlineRadius)
        const travelDirection = getTravelingOutlineDirectionSign(entry.direction)
        const durationMs = Number.isFinite(entry.durationMs) && Number(entry.durationMs) > 0
            ? Number(entry.durationMs)
            : this.style.durationMs
        const headDistance = getTravelingOutlineHeadDistance(elapsed, durationMs, perimeter, this.ease) * travelDirection
        const snakeLengthFraction = Number.isFinite(entry.snakeLengthFraction) && Number(entry.snakeLengthFraction) > 0
            ? Number(entry.snakeLengthFraction)
            : this.style.snakeLengthFraction
        const snakeLength = perimeter * snakeLengthFraction
        const sampleCount = getTravelingSnakeSampleCount(snakeLength, snakeHeadWidth)
        buildTravelingSnakeMeshGeometry(
            activeSlot.buffers,
            entry.width,
            entry.height,
            mediaRadius,
            outlineGap,
            headDistance,
            snakeLength,
            sampleCount,
            snakeHeadWidth,
            snakeTailWidth,
            this.style.snakeTailThinLengthFraction,
            this.style.snakeWidthTaperPower,
            travelDirection,
            this.style.glassMaterial.edgeFeatherFraction,
            this.style.snakeHeadRoundLengthFraction
        )

        activeSlot.mesh.position.set(entry.x - headOutset, entry.y - headOutset)
        updateMeshGeometryBuffers(activeSlot.geometry)
        entry.activeSlotIndex = activeSlotIndex
        this.syncSlotVisibility(entry)
    }

    // Guards against bad zoom-scaling callbacks so one invalid value cannot
    // collapse the outline mesh or create NaN vertex data.
    private getSafeStrokeScale(): number {
        const scale = this.getStrokeScale()
        return Number.isFinite(scale) && scale > 0 ? scale : 1
    }

    // Creates one outline entry with preallocated mesh slots. The initial paint
    // uploads valid geometry before the entry becomes visible.
    private createEntry(datum: PixiTravelingOutlineDatum): OutlineEntry {
        const slots: OutlineMeshSlot[] = []
        for (let index = 0; index < OUTLINE_GEOMETRY_RING_SIZE; index++) {
            const buffers = createTravelingSnakeMeshGeometry()
            const geometry = new MeshGeometry({
                positions: buffers.positions,
                uvs: buffers.uvs,
                indices: buffers.indices,
            })
            const mesh = new Mesh({ geometry, texture: this.texture })
            mesh.label = `pixi-traveling-outline-glass-${index}`
            mesh.eventMode = 'none'
            mesh.renderable = false
            this.container.addChild(mesh)
            slots.push({ mesh, geometry, buffers })
        }

        const entry = {
            slots,
            activeSlotIndex: -1,
            active: true,
            renderable: false,
            x: datum.x,
            y: datum.y,
            width: datum.width,
            height: datum.height,
            radius: datum.radius,
            direction: datum.direction ?? 'clockwise',
            durationMs: datum.durationMs,
            snakeLengthFraction: datum.snakeLengthFraction,
        }
        this.updateEntryGeometry(entry, datum)
        this.setEntryRenderable(entry, datum.visible)
        this.paint(entry, 0)
        return entry
    }

    // Records desired visibility separately from `active` so stale entries can
    // remain allocated but render nothing.
    private setEntryRenderable(entry: OutlineEntry, renderable: boolean): void {
        entry.renderable = renderable
        this.syncSlotVisibility(entry)
    }

    // Only the latest painted slot renders. Older slots stay allocated so their
    // GPU buffers can safely retire before being reused.
    private syncSlotVisibility(entry: OutlineEntry): void {
        for (let index = 0; index < entry.slots.length; index++) {
            entry.slots[index].mesh.renderable = entry.active && entry.renderable && index === entry.activeSlotIndex
        }
    }

    // Marks an entry absent from the latest sync while preserving its resources
    // for reuse if the same id returns.
    private hideEntry(entry: OutlineEntry): void {
        entry.active = false
        this.setEntryRenderable(entry, false)
    }

    // Copies caller geometry into the entry. Optional fields only update when
    // present, which lets drag updates avoid clobbering per-run animation data.
    private updateEntryGeometry(
        entry: OutlineEntry,
        geometry: OutlineGeometryUpdate
    ): void {
        entry.width = geometry.width
        entry.height = geometry.height
        entry.x = geometry.x
        entry.y = geometry.y
        if (typeof geometry.radius === 'number') entry.radius = geometry.radius
        if (geometry.direction) entry.direction = geometry.direction
        if ('durationMs' in geometry) entry.durationMs = geometry.durationMs
        if ('snakeLengthFraction' in geometry) entry.snakeLengthFraction = geometry.snakeLengthFraction
    }

    // Fully destroys one entry. Normal sync avoids this path; teardown uses it
    // because no further WebGPU frames will reference these buffers.
    private destroyEntry(id: string): void {
        const entry = this.entries.get(id)
        if (!entry) return
        for (const slot of entry.slots) {
            this.container.removeChild(slot.mesh)
            slot.mesh.destroy()
            slot.geometry.destroy()
        }
        this.entries.delete(id)
    }

    // Stops rAF work when nothing is visible. This keeps idle work at zero while
    // preserving entries for future reuse.
    private stopIfIdle(): void {
        if (this.hasRenderableEntries()) return
        if (this.animationRaf !== null) {
            cancelAnimationFrame(this.animationRaf)
            this.animationRaf = null
        }
        this.animationStartedAt = null
    }

    // Fast visibility predicate used by both sync and the animation tick.
    private hasRenderableEntries(): boolean {
        for (const entry of this.entries.values()) {
            if (entry.active && entry.renderable) return true
        }
        return false
    }

    // Animation tick paints every visible entry, requests one media-layer render,
    // and schedules the next tick only while visible entries remain.
    private updateFrame = (timestamp: number): void => {
        this.animationRaf = null
        if (this.destroyed || !this.hasRenderableEntries()) {
            this.stopIfIdle()
            return
        }

        this.animationStartedAt ??= timestamp
        const elapsed = timestamp - this.animationStartedAt
        for (const entry of this.entries.values()) {
            if (entry.active && entry.renderable) this.paint(entry, elapsed)
        }

        this.onFrame()
        this.animationRaf = requestAnimationFrame(this.updateFrame)
    }

    // Starts the animation loop once. Repeated sync calls can happen every
    // canvas update, so this guard prevents duplicate rAF loops.
    private start(): void {
        if (this.destroyed || !this.hasRenderableEntries() || this.animationRaf !== null) return
        this.animationRaf = requestAnimationFrame(this.updateFrame)
    }
}
