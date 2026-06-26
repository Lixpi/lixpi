import {
    Container,
    DisplacementFilter,
    Graphics,
    Mesh,
    MeshGeometry,
    RenderTexture,
    Sprite,
    Texture,
} from 'pixi.js'
import { ClosedGlassStripMaterial, type GlassMaterialStyle } from '$src/utils/animations/gradients/pixiGlassMaterial.ts'
import {
    getRoundedOutlineFrame,
    getRoundedOutlinePerimeter,
} from '$src/utils/animations/gradients/pixiTravelingOutlineRenderer.ts'

export type PixiGlassBorderStyle = {
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
    materialColors: ReadonlyArray<string>
    materialTailAlpha: number
    glassMaterial: GlassMaterialStyle
}

export type PixiGlassBorderDatum = {
    id: string
    x: number
    y: number
    width: number
    height: number
    radius: number
    visible: boolean
}

export type PixiGlassBorderRendererOptions = {
    container: Container
    style: PixiGlassBorderStyle
}

type ViewportSize = {
    width: number
    height: number
}

type GlassBorderEntry = {
    mesh: Mesh
    geometry: MeshGeometry
}

type GlassBorderMeshGeometry = {
    positions: Float32Array
    uvs: Float32Array
    indices: Uint32Array
}

type TextureCanvas = OffscreenCanvas | HTMLCanvasElement
type TextureCanvasContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value))
}

function parseHexColor(value: string, fallback: number): number {
    const normalized = value.trim().replace(/^#/, '')
    if (!/^[\da-f]{6}$/i.test(normalized)) return fallback
    return Number.parseInt(normalized, 16)
}

function createTextureCanvas(width: number, height: number): TextureCanvas {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

function getTextureCanvasContext(canvas: TextureCanvas): TextureCanvasContext | null {
    try {
        return canvas.getContext('2d') as TextureCanvasContext | null
    } catch {
        return null
    }
}

function fillNeutralDisplacementCanvas(context: TextureCanvasContext, width: number, height: number): void {
    context.fillStyle = 'rgb(128, 128, 128)'
    context.fillRect(0, 0, width, height)
}

function getRoundedRectSignedDistance(
    px: number,
    py: number,
    rect: { x: number; y: number; width: number; height: number; radius: number }
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

function getRoundedRectNormal(
    px: number,
    py: number,
    rect: { x: number; y: number; width: number; height: number; radius: number }
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

function getGlassBorderSampleCount(perimeter: number, borderWidth: number): number {
    const spacing = Math.max(1, borderWidth * 0.35)
    return Math.max(48, Math.min(1600, Math.ceil(perimeter / spacing)))
}

function setMeshVertex(
    geometry: GlassBorderMeshGeometry,
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

function buildClosedRoundedBorderGeometry(
    datum: PixiGlassBorderDatum,
    borderWidth: number,
    edgeFeatherFraction: number
): GlassBorderMeshGeometry {
    const boundedWidth = Math.max(0, datum.width)
    const boundedHeight = Math.max(0, datum.height)
    const radius = Math.max(0, Math.min(datum.radius, boundedWidth / 2, boundedHeight / 2))
    const perimeter = getRoundedOutlinePerimeter(boundedWidth, boundedHeight, radius)
    const sampleCount = getGlassBorderSampleCount(perimeter, borderWidth)
    const vertexCount = (sampleCount + 1) * 2
    const positions = new Float32Array(vertexCount * 2)
    const uvs = new Float32Array(positions.length)
    const indices = new Uint32Array(sampleCount * 6)
    const geometry = { positions, uvs, indices }
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
            0
        )
        setMeshVertex(
            geometry,
            innerVertex,
            datum.x + frame.point.x + inwardNormal.x * halfWidth,
            datum.y + frame.point.y + inwardNormal.y * halfWidth,
            progress,
            1
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

    return geometry
}

function drawGlassBorderMask(graphics: Graphics, datum: PixiGlassBorderDatum, borderWidth: number, color: number, alpha: number): void {
    const halfWidth = borderWidth / 2
    const outerX = datum.x - halfWidth
    const outerY = datum.y - halfWidth
    const outerWidth = datum.width + borderWidth
    const outerHeight = datum.height + borderWidth
    const outerRadius = Math.max(0, datum.radius + halfWidth)
    const innerX = datum.x + halfWidth
    const innerY = datum.y + halfWidth
    const innerWidth = datum.width - borderWidth
    const innerHeight = datum.height - borderWidth
    const innerRadius = Math.max(0, datum.radius - halfWidth)

    graphics.roundRect(outerX, outerY, outerWidth, outerHeight, outerRadius)
    graphics.fill({ color, alpha })
    if (innerWidth > 0 && innerHeight > 0) {
        graphics.roundRect(innerX, innerY, innerWidth, innerHeight, innerRadius)
        graphics.cut()
    }
}

function drawGlassBorderStroke(graphics: Graphics, datum: PixiGlassBorderDatum, offset: number, color: number, alpha: number): void {
    const width = Math.max(1, datum.width + offset * 2)
    const height = Math.max(1, datum.height + offset * 2)
    const radius = Math.max(0, datum.radius + offset)
    graphics.roundRect(datum.x - offset, datum.y - offset, width, height, radius)
    graphics.stroke({ color, alpha, width: 1 })
}

function getDisplacementMapScale(viewport: ViewportSize, style: PixiGlassBorderStyle): number {
    const maxDimension = Math.max(256, Math.round(style.displacementMapMaxDimensionPx || 1400))
    const longestSide = Math.max(1, viewport.width, viewport.height)
    return Math.min(1, maxDimension / longestSide)
}

function getDisplacementSignature(
    datums: ReadonlyArray<PixiGlassBorderDatum>,
    viewport: ViewportSize,
    style: PixiGlassBorderStyle
): string {
    const geometry = datums
        .map((datum) => [
            datum.id,
            Math.round(datum.x * 10) / 10,
            Math.round(datum.y * 10) / 10,
            Math.round(datum.width * 10) / 10,
            Math.round(datum.height * 10) / 10,
            Math.round(datum.radius * 10) / 10,
        ].join(':'))
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

function writeLiquidGlassDisplacementMap(
    imageData: ImageData,
    mapWidth: number,
    mapHeight: number,
    mapScale: number,
    datums: ReadonlyArray<PixiGlassBorderDatum>,
    style: PixiGlassBorderStyle
): void {
    imageData.data.fill(128)
    for (let offset = 3; offset < imageData.data.length; offset += 4) {
        imageData.data[offset] = 255
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
                imageData.data[offset] = Math.max(0, Math.min(255, 128 + Math.round(vectorX * 127)))
                imageData.data[offset + 1] = Math.max(0, Math.min(255, 128 + Math.round(vectorY * 127)))
                imageData.data[offset + 2] = Math.max(0, Math.min(255, 128 + Math.round(rimVolume * 70)))
                imageData.data[offset + 3] = 255
            }
        }
    }
}

export class PixiGlassBorderRenderer {
    private readonly container: Container
    private readonly style: PixiGlassBorderStyle
    private readonly refractionSprite: Sprite
    private readonly maskGraphics: Graphics
    private readonly highlightGraphics: Graphics
    private readonly materialContainer: Container
    private readonly displacementSprite: Sprite
    private readonly displacementCanvas: TextureCanvas
    private displacementContext: TextureCanvasContext | null
    private readonly displacementTexture: Texture
    private readonly displacementFilter: DisplacementFilter
    private readonly materialTexture: Texture
    private readonly entries = new Map<string, GlassBorderEntry>()
    private displacementSignature = ''
    private displacementMapWidth = 8
    private displacementMapHeight = 8
    private renderTexture: RenderTexture | null = null
    private renderTextureWidth = 0
    private renderTextureHeight = 0
    private renderTextureResolution = 1
    private hasTargets = false
    private destroyed = false

    constructor(options: PixiGlassBorderRendererOptions) {
        this.container = options.container
        this.style = options.style
        this.displacementCanvas = createTextureCanvas(this.displacementMapWidth, this.displacementMapHeight)
        this.displacementContext = getTextureCanvasContext(this.displacementCanvas)
        if (this.displacementContext) {
            fillNeutralDisplacementCanvas(this.displacementContext, this.displacementMapWidth, this.displacementMapHeight)
        }
        this.displacementTexture = Texture.from(this.displacementCanvas as HTMLCanvasElement, true)
        this.displacementSprite = new Sprite(this.displacementTexture)
        this.displacementSprite.label = 'workspace-pixi-glass-displacement-map'
        this.displacementSprite.eventMode = 'none'
        this.displacementFilter = new DisplacementFilter({
            sprite: this.displacementSprite,
            scale: Math.max(0, this.style.displacementScalePx),
        })
        this.refractionSprite = new Sprite(Texture.EMPTY)
        this.refractionSprite.label = 'workspace-pixi-glass-refraction'
        this.refractionSprite.eventMode = 'none'
        this.refractionSprite.filters = [this.displacementFilter]
        this.maskGraphics = new Graphics()
        this.maskGraphics.label = 'workspace-pixi-glass-mask'
        this.maskGraphics.eventMode = 'none'
        this.refractionSprite.mask = this.maskGraphics
        this.materialContainer = new Container({ label: 'workspace-pixi-glass-material' })
        this.materialContainer.eventMode = 'none'
        this.highlightGraphics = new Graphics()
        this.highlightGraphics.label = 'workspace-pixi-glass-highlights'
        this.highlightGraphics.eventMode = 'none'
        this.materialTexture = new ClosedGlassStripMaterial(
            this.style.materialColors,
            this.style.materialTailAlpha,
            this.style.glassMaterial
        ).bake()

        this.container.addChild(this.refractionSprite)
        this.container.addChild(this.maskGraphics)
        this.container.addChild(this.materialContainer)
        this.container.addChild(this.highlightGraphics)
        this.container.addChild(this.displacementSprite)
        this.container.renderable = false
        this.container.eventMode = 'none'
    }

    sync(datums: ReadonlyArray<PixiGlassBorderDatum>, viewport: ViewportSize): void {
        if (this.destroyed) return
        const visibleDatums = this.style.enabled
            ? datums.filter((datum) => datum.visible && this.isInViewport(datum, viewport))
            : []
        const borderWidth = Math.max(0, this.style.widthPx)
        this.hasTargets = visibleDatums.length > 0 && viewport.width > 0 && viewport.height > 0 && borderWidth > 0
        this.container.renderable = this.hasTargets

        if (!this.hasTargets) {
            this.maskGraphics.clear()
            this.highlightGraphics.clear()
            this.displacementSignature = ''
            this.destroyStaleEntries(new Set())
            return
        }

        this.syncRenderTexture(viewport)
        this.refractionSprite.position.set(0, 0)
        this.refractionSprite.width = viewport.width
        this.refractionSprite.height = viewport.height
        this.syncDisplacementMap(visibleDatums, viewport)
        this.displacementSprite.position.set(0, 0)
        this.displacementSprite.width = viewport.width
        this.displacementSprite.height = viewport.height
        this.syncMaskAndHighlights(visibleDatums)
        this.syncMaterialMeshes(visibleDatums)
    }

    getCaptureTexture(): RenderTexture | null {
        return this.hasTargets ? this.renderTexture : null
    }

    setCapturing(capturing: boolean): void {
        if (this.destroyed) return
        this.container.renderable = this.hasTargets && !capturing
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        for (const id of Array.from(this.entries.keys())) this.destroyEntry(id)
        this.refractionSprite.mask = null
        this.container.removeChild(this.refractionSprite)
        this.container.removeChild(this.maskGraphics)
        this.container.removeChild(this.materialContainer)
        this.container.removeChild(this.highlightGraphics)
        this.container.removeChild(this.displacementSprite)
        this.refractionSprite.destroy()
        this.maskGraphics.destroy()
        this.materialContainer.destroy()
        this.highlightGraphics.destroy()
        this.displacementSprite.destroy()
        if (this.displacementTexture !== Texture.WHITE) this.displacementTexture.destroy(true)
        if (this.materialTexture !== Texture.WHITE) this.materialTexture.destroy(true)
        this.renderTexture?.destroy(true)
        this.renderTexture = null
    }

    private syncRenderTexture(viewport: ViewportSize): void {
        const width = Math.max(1, Math.ceil(viewport.width))
        const height = Math.max(1, Math.ceil(viewport.height))
        const resolution = typeof window === 'undefined'
            ? 1
            : Math.min(window.devicePixelRatio || 1, 2)
        if (!this.renderTexture) {
            this.renderTexture = RenderTexture.create({ width, height, resolution, dynamic: true })
            this.renderTextureWidth = width
            this.renderTextureHeight = height
            this.renderTextureResolution = resolution
            this.refractionSprite.texture = this.renderTexture
            return
        }
        if (
            width === this.renderTextureWidth
            && height === this.renderTextureHeight
            && resolution === this.renderTextureResolution
        ) return
        this.renderTexture.resize(width, height, resolution)
        this.renderTextureWidth = width
        this.renderTextureHeight = height
        this.renderTextureResolution = resolution
    }

    private syncDisplacementMap(datums: ReadonlyArray<PixiGlassBorderDatum>, viewport: ViewportSize): void {
        const signature = getDisplacementSignature(datums, viewport, this.style)
        if (signature === this.displacementSignature) return

        const mapScale = getDisplacementMapScale(viewport, this.style)
        const mapWidth = Math.max(1, Math.ceil(viewport.width * mapScale))
        const mapHeight = Math.max(1, Math.ceil(viewport.height * mapScale))
        if (mapWidth !== this.displacementMapWidth || mapHeight !== this.displacementMapHeight) {
            this.displacementCanvas.width = mapWidth
            this.displacementCanvas.height = mapHeight
            this.displacementMapWidth = mapWidth
            this.displacementMapHeight = mapHeight
            this.displacementContext = getTextureCanvasContext(this.displacementCanvas)
            this.displacementTexture.source.resize(mapWidth, mapHeight)
        }

        const context = this.displacementContext
        if (!context) return

        const imageData = context.createImageData(mapWidth, mapHeight)
        writeLiquidGlassDisplacementMap(imageData, mapWidth, mapHeight, mapScale, datums, this.style)
        context.putImageData(imageData, 0, 0)
        this.displacementTexture.source.update()
        this.displacementSignature = signature
    }

    private syncMaskAndHighlights(datums: ReadonlyArray<PixiGlassBorderDatum>): void {
        const borderWidth = Math.max(0, this.style.widthPx)
        const bodyColor = parseHexColor(this.style.bodyColor, 0xffffff)
        const highlightColor = parseHexColor(this.style.highlightColor, 0xffffff)
        const shadowColor = parseHexColor(this.style.shadowColor, 0x415061)
        this.maskGraphics.clear()
        this.highlightGraphics.clear()
        for (const datum of datums) {
            drawGlassBorderMask(this.maskGraphics, datum, borderWidth, 0xffffff, 1)
            drawGlassBorderMask(this.highlightGraphics, datum, borderWidth, bodyColor, clamp01(this.style.bodyAlpha))
            drawGlassBorderStroke(this.highlightGraphics, datum, borderWidth / 2, highlightColor, clamp01(this.style.highlightAlpha))
            drawGlassBorderStroke(this.highlightGraphics, datum, -borderWidth / 2, shadowColor, clamp01(this.style.shadowAlpha))
        }
    }

    private syncMaterialMeshes(datums: ReadonlyArray<PixiGlassBorderDatum>): void {
        const activeIds = new Set(datums.map((datum) => datum.id))
        this.destroyStaleEntries(activeIds)
        for (const datum of datums) {
            const entry = this.entries.get(datum.id) ?? this.createEntry(datum.id)
            const geometry = buildClosedRoundedBorderGeometry(
                datum,
                Math.max(0, this.style.widthPx),
                this.style.glassMaterial.edgeFeatherFraction
            )
            entry.geometry.positions = geometry.positions
            entry.geometry.uvs = geometry.uvs
            entry.geometry.indices = geometry.indices
            entry.mesh.renderable = true
        }
    }

    private createEntry(id: string): GlassBorderEntry {
        const geometry = new MeshGeometry()
        const mesh = new Mesh({ geometry, texture: this.materialTexture })
        mesh.label = `workspace-pixi-glass-border-${id}`
        mesh.eventMode = 'none'
        this.materialContainer.addChild(mesh)
        const entry = { mesh, geometry }
        this.entries.set(id, entry)
        return entry
    }

    private destroyStaleEntries(activeIds: Set<string>): void {
        for (const id of Array.from(this.entries.keys())) {
            if (!activeIds.has(id)) this.destroyEntry(id)
        }
    }

    private destroyEntry(id: string): void {
        const entry = this.entries.get(id)
        if (!entry) return
        this.materialContainer.removeChild(entry.mesh)
        entry.mesh.destroy()
        entry.geometry.destroy()
        this.entries.delete(id)
    }

    private isInViewport(datum: PixiGlassBorderDatum, viewport: ViewportSize): boolean {
        const borderWidth = Math.max(0, this.style.widthPx)
        return datum.x + datum.width + borderWidth >= 0
            && datum.y + datum.height + borderWidth >= 0
            && datum.x - borderWidth <= viewport.width
            && datum.y - borderWidth <= viewport.height
    }
}
