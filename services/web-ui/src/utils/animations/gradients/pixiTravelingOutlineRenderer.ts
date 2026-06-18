import {
    Container,
    Mesh,
    MeshGeometry,
    Texture,
} from 'pixi.js'
import { Easing } from '$src/utils/animations/easing.ts'

export type PixiTravelingOutlineStyle = {
    radius: number
    gap: number
    snakeHeadWidth: number
    snakeTailWidthFraction: number
    snakeLengthFraction: number
    snakeTailAlpha: number
    snakeColors: ReadonlyArray<string>
    durationMs: number
}

export type PixiTravelingOutlineDatum = {
    id: string
    x: number
    y: number
    width: number
    height: number
    radius: number
    visible: boolean
}

export type PixiTravelingOutlineRendererOptions = {
    container: Container
    style: PixiTravelingOutlineStyle
    onFrame: () => void
    ease?: (progress: number) => number
    getStrokeScale?: () => number
}

type OutlineEntry = {
    mesh: Mesh
    geometry: MeshGeometry
    x: number
    y: number
    width: number
    height: number
    radius: number
}

export type OutlinePoint = {
    x: number
    y: number
}

type OutlineFrame = {
    point: OutlinePoint
    tangent: OutlinePoint
}

type OutlineGeometryUpdate = Pick<PixiTravelingOutlineDatum, 'x' | 'y' | 'width' | 'height'>
    & Partial<Pick<PixiTravelingOutlineDatum, 'radius'>>

type TravelingSnakeMeshGeometry = {
    positions: Float32Array
    uvs: Float32Array
    indices: Uint32Array
}

type GradientCanvas = OffscreenCanvas | HTMLCanvasElement
type GradientCanvasContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export function getRoundedOutlinePerimeter(width: number, height: number, radius: number): number {
    const boundedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
    return 2 * (width + height - 4 * boundedRadius) + 2 * Math.PI * boundedRadius
}

export function getRoundedOutlinePoint(
    width: number,
    height: number,
    radius: number,
    distance: number
): OutlinePoint {
    return getRoundedOutlineFrame(width, height, radius, distance).point
}

function getRoundedOutlineFrame(
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

export function interpolateTravelingOutlineColor(colors: ReadonlyArray<string>, progress: number): number {
    if (colors.length === 0) return 0xffffff
    if (colors.length === 1) return Number.parseInt(colors[0].slice(1), 16)

    const bounded = Math.max(0, Math.min(1, progress))
    const scaled = bounded * (colors.length - 1)
    const index = Math.min(colors.length - 2, Math.floor(scaled))
    const blend = scaled - index
    const from = Number.parseInt(colors[index].slice(1), 16)
    const to = Number.parseInt(colors[index + 1].slice(1), 16)
    const channel = (shift: number) => Math.round(((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * blend)
    return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
    const normalized = hex.trim().replace(/^#/, '')
    if (!/^[\da-f]{6}$/i.test(normalized)) return { r: 255, g: 255, b: 255 }
    const value = Number.parseInt(normalized, 16)
    return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff,
    }
}

function getGradientColorStop(color: string, alpha: number): string {
    const { r, g, b } = parseHexColor(color)
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

function createGradientCanvas(width: number, height: number): GradientCanvas {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

function createTravelingSnakeTexture(colors: ReadonlyArray<string>, tailAlpha: number): Texture {
    const width = 256
    const height = 4
    const canvas = createGradientCanvas(width, height)
    const context = canvas.getContext('2d') as GradientCanvasContext | null
    if (!context) return Texture.WHITE

    const gradient = context.createLinearGradient(0, 0, width, 0)
    const safeColors = colors.length > 0 ? colors : ['#ffffff']
    const colorStopCount = Math.max(2, safeColors.length)
    for (let index = 0; index < colorStopCount; index++) {
        const progress = index / (colorStopCount - 1)
        const color = safeColors[Math.min(index, safeColors.length - 1)]
        const opacityProgress = Math.pow(progress, 1.35)
        const alpha = tailAlpha + (1 - tailAlpha) * opacityProgress
        gradient.addColorStop(progress, getGradientColorStop(color, alpha))
    }

    context.clearRect(0, 0, width, height)
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)

    return Texture.from(canvas as HTMLCanvasElement, true)
}

function getTravelingSnakeSampleCount(snakeLength: number, snakeHeadWidth: number): number {
    const spacing = Math.max(0.75, snakeHeadWidth * 0.16)
    return Math.max(32, Math.min(720, Math.ceil(snakeLength / spacing)))
}

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

function buildTravelingSnakeMeshGeometry(
    mediaWidth: number,
    mediaHeight: number,
    mediaRadius: number,
    outlineGap: number,
    headDistance: number,
    snakeLength: number,
    sampleCount: number,
    snakeHeadWidth: number,
    snakeTailWidth: number
): TravelingSnakeMeshGeometry {
    const stripVertexCount = (sampleCount + 1) * 2
    const headCapSegmentCount = 12
    const headCapVertexCount = headCapSegmentCount + 2
    const positions = new Float32Array((stripVertexCount + headCapVertexCount) * 2)
    const uvs = new Float32Array(positions.length)
    const indices = new Uint32Array(sampleCount * 6 + headCapSegmentCount * 3)
    const geometry = { positions, uvs, indices }
    let indexOffset = 0
    let headFrame: OutlineFrame | null = null
    const headOutset = outlineGap + snakeHeadWidth / 2

    for (let index = 0; index <= sampleCount; index++) {
        const progress = index / sampleCount
        const widthProgress = Math.pow(progress, 0.86)
        const sampleWidth = snakeTailWidth + (snakeHeadWidth - snakeTailWidth) * widthProgress
        const sampleOutset = outlineGap + sampleWidth / 2
        const frame = getInsetAlignedRoundedOutlineFrame(
            mediaWidth,
            mediaHeight,
            mediaRadius,
            sampleOutset,
            headOutset,
            headDistance - snakeLength * (1 - progress)
        )
        const normal = { x: -frame.tangent.y, y: frame.tangent.x }
        const halfWidth = sampleWidth / 2
        const leftVertex = index * 2
        const rightVertex = leftVertex + 1

        setMeshVertex(
            geometry,
            leftVertex,
            frame.point.x + normal.x * halfWidth,
            frame.point.y + normal.y * halfWidth,
            progress,
            0
        )
        setMeshVertex(
            geometry,
            rightVertex,
            frame.point.x - normal.x * halfWidth,
            frame.point.y - normal.y * halfWidth,
            progress,
            1
        )

        if (index < sampleCount) {
            const nextLeftVertex = leftVertex + 2
            const nextRightVertex = leftVertex + 3
            indices[indexOffset++] = leftVertex
            indices[indexOffset++] = rightVertex
            indices[indexOffset++] = nextLeftVertex
            indices[indexOffset++] = rightVertex
            indices[indexOffset++] = nextRightVertex
            indices[indexOffset++] = nextLeftVertex
        } else {
            headFrame = frame
        }
    }

    if (headFrame) {
        const normal = { x: -headFrame.tangent.y, y: headFrame.tangent.x }
        const headRadius = snakeHeadWidth / 2
        const centerVertex = stripVertexCount
        const firstArcVertex = centerVertex + 1
        setMeshVertex(geometry, centerVertex, headFrame.point.x, headFrame.point.y, 1, 0.5)

        for (let index = 0; index <= headCapSegmentCount; index++) {
            const angle = Math.PI / 2 - Math.PI * (index / headCapSegmentCount)
            const x = headFrame.point.x
                + headFrame.tangent.x * Math.cos(angle) * headRadius
                + normal.x * Math.sin(angle) * headRadius
            const y = headFrame.point.y
                + headFrame.tangent.y * Math.cos(angle) * headRadius
                + normal.y * Math.sin(angle) * headRadius
            setMeshVertex(geometry, firstArcVertex + index, x, y, 1, index / headCapSegmentCount)
        }

        for (let index = 0; index < headCapSegmentCount; index++) {
            indices[indexOffset++] = centerVertex
            indices[indexOffset++] = firstArcVertex + index
            indices[indexOffset++] = firstArcVertex + index + 1
        }
    }

    return { positions, uvs, indices }
}

export class PixiTravelingOutlineRenderer {
    private readonly container: Container
    private readonly style: PixiTravelingOutlineStyle
    private readonly onFrame: () => void
    private readonly ease: (progress: number) => number
    private readonly getStrokeScale: () => number
    private readonly gradientTexture: Texture
    private readonly entries = new Map<string, OutlineEntry>()
    private animationRaf: number | null = null
    private animationStartedAt: number | null = null
    private destroyed = false

    constructor(options: PixiTravelingOutlineRendererOptions) {
        this.container = options.container
        this.style = options.style
        this.onFrame = options.onFrame
        this.ease = options.ease ?? Easing.travelingOutlineTransition
        this.getStrokeScale = options.getStrokeScale ?? (() => 1)
        this.gradientTexture = createTravelingSnakeTexture(this.style.snakeColors, this.style.snakeTailAlpha)
    }

    sync(datums: ReadonlyArray<PixiTravelingOutlineDatum>): void {
        if (this.destroyed) return
        const activeIds = new Set(datums.map((datum) => datum.id))
        for (const id of this.entries.keys()) {
            if (!activeIds.has(id)) this.destroyEntry(id)
        }

        for (const datum of datums) {
            const entry = this.entries.get(datum.id) ?? this.createEntry(datum)
            this.entries.set(datum.id, entry)
            this.updateEntryGeometry(entry, datum)
            entry.mesh.renderable = datum.visible
        }

        this.stopIfIdle()
        this.start()
        this.onFrame()
    }

    updateGeometry(
        id: string,
        geometry: OutlineGeometryUpdate
    ): void {
        const entry = this.entries.get(id)
        if (!entry) return
        this.updateEntryGeometry(entry, geometry)
    }

    setVisible(id: string, visible: boolean): void {
        const entry = this.entries.get(id)
        if (!entry) return
        entry.mesh.renderable = visible
    }

    destroy(): void {
        this.destroyed = true
        if (this.animationRaf !== null) {
            cancelAnimationFrame(this.animationRaf)
            this.animationRaf = null
        }
        for (const id of this.entries.keys()) this.destroyEntry(id)
        this.animationStartedAt = null
        if (this.gradientTexture !== Texture.WHITE) this.gradientTexture.destroy(true)
    }

    private paint(entry: OutlineEntry, elapsed: number): void {
        const strokeScale = this.getSafeStrokeScale()
        const snakeHeadWidth = this.style.snakeHeadWidth * strokeScale
        const snakeTailWidth = snakeHeadWidth * Math.max(0, Math.min(1, this.style.snakeTailWidthFraction))
        const outlineGap = this.style.gap * strokeScale
        const headOutset = outlineGap + snakeHeadWidth / 2
        const width = entry.width + headOutset * 2
        const height = entry.height + headOutset * 2
        const mediaRadius = Number.isFinite(entry.radius) ? Math.max(0, entry.radius) : this.style.radius
        const radius = mediaRadius + headOutset
        const perimeter = getRoundedOutlinePerimeter(width, height, radius)
        const headDistance = getTravelingOutlineHeadDistance(elapsed, this.style.durationMs, perimeter, this.ease)
        const snakeLength = perimeter * this.style.snakeLengthFraction
        const sampleCount = getTravelingSnakeSampleCount(snakeLength, snakeHeadWidth)
        const geometry = buildTravelingSnakeMeshGeometry(
            entry.width,
            entry.height,
            mediaRadius,
            outlineGap,
            headDistance,
            snakeLength,
            sampleCount,
            snakeHeadWidth,
            snakeTailWidth
        )

        entry.mesh.position.set(entry.x - headOutset, entry.y - headOutset)
        entry.geometry.positions = geometry.positions
        entry.geometry.uvs = geometry.uvs
        entry.geometry.indices = geometry.indices
    }

    private getSafeStrokeScale(): number {
        const scale = this.getStrokeScale()
        return Number.isFinite(scale) && scale > 0 ? scale : 1
    }

    private createEntry(datum: PixiTravelingOutlineDatum): OutlineEntry {
        const geometry = new MeshGeometry()
        const mesh = new Mesh({ geometry, texture: this.gradientTexture })
        mesh.label = 'pixi-traveling-outline'
        mesh.eventMode = 'none'
        this.container.addChild(mesh)
        const entry = {
            mesh,
            geometry,
            x: datum.x,
            y: datum.y,
            width: datum.width,
            height: datum.height,
            radius: datum.radius,
        }
        this.updateEntryGeometry(entry, datum)
        mesh.renderable = datum.visible
        this.paint(entry, 0)
        return entry
    }

    private updateEntryGeometry(
        entry: OutlineEntry,
        geometry: OutlineGeometryUpdate
    ): void {
        entry.width = geometry.width
        entry.height = geometry.height
        entry.x = geometry.x
        entry.y = geometry.y
        if (typeof geometry.radius === 'number') entry.radius = geometry.radius
    }

    private destroyEntry(id: string): void {
        const entry = this.entries.get(id)
        if (!entry) return
        this.container.removeChild(entry.mesh)
        entry.mesh.destroy()
        entry.geometry.destroy()
        this.entries.delete(id)
    }

    private stopIfIdle(): void {
        if (this.entries.size > 0) return
        if (this.animationRaf !== null) {
            cancelAnimationFrame(this.animationRaf)
            this.animationRaf = null
        }
        this.animationStartedAt = null
    }

    private updateFrame = (timestamp: number): void => {
        this.animationRaf = null
        if (this.destroyed || this.entries.size === 0) {
            this.stopIfIdle()
            return
        }

        this.animationStartedAt ??= timestamp
        const elapsed = timestamp - this.animationStartedAt
        for (const entry of this.entries.values()) {
            if (entry.mesh.renderable) this.paint(entry, elapsed)
        }

        this.onFrame()
        this.animationRaf = requestAnimationFrame(this.updateFrame)
    }

    private start(): void {
        if (this.destroyed || this.entries.size === 0 || this.animationRaf !== null) return
        this.animationRaf = requestAnimationFrame(this.updateFrame)
    }
}
