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

type RgbColor = { r: number; g: number; b: number }

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

function getTravelingOutlineColorChannels(colors: ReadonlyArray<string>, progress: number): RgbColor {
    const color = interpolateTravelingOutlineColor(colors, progress)
    return {
        r: (color >> 16) & 0xff,
        g: (color >> 8) & 0xff,
        b: color & 0xff,
    }
}

function mixChannel(from: number, to: number, amount: number): number {
    return Math.round(from + (to - from) * Math.max(0, Math.min(1, amount)))
}

function mixColor(from: RgbColor, to: RgbColor, amount: number): RgbColor {
    return {
        r: mixChannel(from.r, to.r, amount),
        g: mixChannel(from.g, to.g, amount),
        b: mixChannel(from.b, to.b, amount),
    }
}

function gaussian(position: number, center: number, width: number): number {
    return Math.exp(-((position - center) ** 2) / (2 * width ** 2))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    const progress = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
    return progress * progress * (3 - 2 * progress)
}

function getTextureOpacityProgress(progress: number, tailAlpha: number): number {
    const configuredOpacity = tailAlpha + (1 - tailAlpha) * Math.pow(progress, 0.72)
    const tailFade = smoothstep(0, 0.08, progress)
    return tailFade * Math.max(0.62, Math.min(1, configuredOpacity))
}

function getGlassTexturePixel(
    colors: ReadonlyArray<string>,
    progress: number,
    crossSection: number,
    tailAlpha: number
): { color: RgbColor; alpha: number } {
    const white = { r: 255, g: 255, b: 255 }
    const glassShadow = { r: 78, g: 91, b: 108 }
    const baseColor = getTravelingOutlineColorChannels(colors, progress)
    const opacityProgress = getTextureOpacityProgress(progress, tailAlpha)
    const edgeDistance = Math.abs(crossSection - 0.5) * 2
    const roundedBody = Math.max(0, Math.sin(Math.PI * crossSection))
    const lensCore = Math.pow(roundedBody, 0.42)
    const upperSpecular = gaussian(crossSection, 0.32 + 0.035 * Math.sin(progress * Math.PI), 0.16)
        * smoothstep(0.1, 0.32, progress)
    const headSpecular = gaussian(progress, 0.91, 0.22) * gaussian(crossSection, 0.48, 0.26)
    const lowerEdgeShadow = gaussian(crossSection, 0.88, 0.2)
    const upperEdgeShadow = gaussian(crossSection, 0.1, 0.2)
    const edgeShadow = lowerEdgeShadow * 0.16 + upperEdgeShadow * 0.07 + Math.pow(edgeDistance, 2.2) * 0.04
    const highlight = upperSpecular * 0.24 + headSpecular * 0.18 + lensCore * 0.08

    const litColor = mixColor(baseColor, white, Math.min(0.3, highlight))
    const color = mixColor(litColor, glassShadow, Math.min(0.14, edgeShadow))
    const alpha = opacityProgress * Math.min(0.94, 0.72 + lensCore * 0.16 + upperSpecular * 0.04 + headSpecular * 0.03)
    return {
        color,
        alpha: Math.min(0.99, alpha),
    }
}

function createGradientCanvas(width: number, height: number): GradientCanvas {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

function createTravelingSnakeTexture(
    colors: ReadonlyArray<string>,
    tailAlpha: number
): Texture {
    const width = 256
    const height = 64
    const canvas = createGradientCanvas(width, height)
    const context = canvas.getContext('2d') as GradientCanvasContext | null
    if (!context) return Texture.WHITE
    const safeColors = colors.length > 0 ? colors : ['#ffffff']

    const imageData = context.createImageData(width, height)
    for (let y = 0; y < height; y++) {
        const crossSection = y / (height - 1)
        for (let x = 0; x < width; x++) {
            const progress = x / (width - 1)
            const { color, alpha } = getGlassTexturePixel(safeColors, progress, crossSection, tailAlpha)
            const offset = (y * width + x) * 4
            imageData.data[offset] = color.r
            imageData.data[offset + 1] = color.g
            imageData.data[offset + 2] = color.b
            imageData.data[offset + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
        }
    }

    context.clearRect(0, 0, width, height)
    context.putImageData(imageData, 0, 0)

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
    private readonly texture: Texture
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
        this.texture = createTravelingSnakeTexture(this.style.snakeColors, this.style.snakeTailAlpha)
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
            this.setEntryRenderable(entry, datum.visible)
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
        this.setEntryRenderable(entry, visible)
    }

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

    private paint(entry: OutlineEntry, elapsed: number): void {
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
        const mesh = new Mesh({ geometry, texture: this.texture })
        mesh.label = 'pixi-traveling-outline-glass'
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
        this.setEntryRenderable(entry, datum.visible)
        this.paint(entry, 0)
        return entry
    }

    private setEntryRenderable(entry: OutlineEntry, renderable: boolean): void {
        entry.mesh.renderable = renderable
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
