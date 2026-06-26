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
    buffers: GlassBorderMeshGeometry
    geometrySignature: string
}

type GlassBorderMeshGeometry = {
    positions: Float32Array
    uvs: Float32Array
    indices: Uint32Array
}

const GLASS_BORDER_MAX_SAMPLE_COUNT = 1600

type TextureCanvas = OffscreenCanvas | HTMLCanvasElement
type TextureCanvasContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

// Local numeric clamp used in the pixel baker. Keeping it tiny and local avoids
// pulling broader utility code into this Pixi-only renderer.
function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value))
}

// Settings accept CSS-like hex strings, while Pixi drawing APIs want packed
// numeric colors. Invalid values intentionally fall back instead of throwing so
// a bad tuning token cannot break canvas rendering.
function parseHexColor(value: string, fallback: number): number {
    const normalized = value.trim().replace(/^#/, '')
    if (!/^[\da-f]{6}$/i.test(normalized)) return fallback
    return Number.parseInt(normalized, 16)
}

// The displacement map is CPU-baked into a tiny canvas and uploaded into one
// stable Pixi texture. OffscreenCanvas is preferred when available; happy-dom
// and older browsers fall back to an HTML canvas.
function createTextureCanvas(width: number, height: number): TextureCanvas {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

// Canvas context creation can throw in some restricted canvas implementations.
// Treat that as "glass refraction unavailable" while leaving the visual overlay
// and renderer lifecycle intact.
function getTextureCanvasContext(canvas: TextureCanvas): TextureCanvasContext | null {
    try {
        return canvas.getContext('2d') as TextureCanvasContext | null
    } catch {
        return null
    }
}

// Neutral displacement is encoded as 128/128. A neutral map must move no source
// pixels, which keeps the border invisible over flat backgrounds and gives the
// filter valid texture data before the first geometry sync.
function fillNeutralDisplacementCanvas(context: TextureCanvasContext, width: number, height: number): void {
    context.fillStyle = 'rgb(128, 128, 128)'
    context.fillRect(0, 0, width, height)
}

// Signed-distance field for a rounded rectangle in screen space. Negative is
// inside the rectangle, zero is the centerline of the visible border, positive
// is outside. The displacement baker uses this as the glass cross-section.
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

// Numerical gradient of the rounded-rect SDF. This gives a stable outward
// normal on straight sides and corners, which is what creates edge refraction
// that follows the actual input/button shape instead of a generic screen wave.
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

// The border mesh is a closed strip around the rounded perimeter. Sampling more
// densely for wider/longer borders keeps corners smooth without allowing a huge
// prompt bar to create unbounded geometry.
function getGlassBorderSampleCount(perimeter: number, borderWidth: number): number {
    const spacing = Math.max(1, borderWidth * 0.35)
    return Math.max(48, Math.min(GLASS_BORDER_MAX_SAMPLE_COUNT, Math.ceil(perimeter / spacing)))
}

// Allocates the maximum closed-strip buffers once per material mesh. Sync
// rewrites these arrays in place so changing composer/button geometry does not
// force Pixi to replace WebGPU buffers.
function createGlassBorderMeshGeometry(): GlassBorderMeshGeometry {
    const vertexCount = (GLASS_BORDER_MAX_SAMPLE_COUNT + 1) * 2
    const positions = new Float32Array(vertexCount * 2)
    const uvs = new Float32Array(positions.length)
    const indices = new Uint32Array(GLASS_BORDER_MAX_SAMPLE_COUNT * 6)
    return { positions, uvs, indices }
}

// Tells Pixi that existing mesh buffers have new contents. Using `update()`
// keeps buffer identity stable; replacing arrays would trigger Pixi
// `setDataWithSize()` and can destroy GPU buffers during submit.
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

// MeshGeometry buffers stay fixed-size for WebGPU. Replacing typed arrays can
// make Pixi destroy and recreate GPU buffers while the previous submit still
// references them.
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

// Builds the visible closed glass strip. The strip is separate from the
// displacement mask: the mask refracts captured canvas pixels, while this mesh
// adds the faint specular body that makes the border read as glass on top of
// busy imagery without becoming visible on plain white.
function writeClosedRoundedBorderGeometry(
    geometry: GlassBorderMeshGeometry,
    datum: PixiGlassBorderDatum,
    borderWidth: number,
    edgeFeatherFraction: number
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

    indices.fill(0, indexOffset)
}

// Draws a ring into Graphics by filling the outer rounded rect and cutting the
// inner one out. This mask is applied to the refraction sprite so only the 10px
// border refracts the captured Pixi stage.
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

// One-pixel highlight/shadow strokes ride the inner and outer rim. They are
// intentionally subtle; the heavy lifting is the displaced captured content,
// not an opaque decorative outline.
function drawGlassBorderStroke(graphics: Graphics, datum: PixiGlassBorderDatum, offset: number, color: number, alpha: number): void {
    const width = Math.max(1, datum.width + offset * 2)
    const height = Math.max(1, datum.height + offset * 2)
    const radius = Math.max(0, datum.radius + offset)
    graphics.roundRect(datum.x - offset, datum.y - offset, width, height, radius)
    graphics.stroke({ color, alpha, width: 1 })
}

// The map is screen-space, but it does not need to match full retina canvas
// size. Capping the longest side keeps CPU image-data writes bounded while the
// displacement sprite stretches the map across the viewport.
function getDisplacementMapScale(viewport: ViewportSize, style: PixiGlassBorderStyle): number {
    const maxDimension = Math.max(256, Math.round(style.displacementMapMaxDimensionPx || 1400))
    const longestSide = Math.max(1, viewport.width, viewport.height)
    return Math.min(1, maxDimension / longestSide)
}

// The displacement map is expensive enough to avoid rewriting when geometry and
// tuning values have not materially changed. Geometry is rounded to tenths of a
// pixel so tiny DOM layout noise does not force a full image-data repaint.
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

// Fingerprint for one material mesh. It is intentionally rounded so tiny
// DOM-measurement jitter does not rewrite buffers every render.
function getMaterialGeometrySignature(
    datum: PixiGlassBorderDatum,
    borderWidth: number,
    edgeFeatherFraction: number
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
function getMaskAndHighlightSignature(
    datums: ReadonlyArray<PixiGlassBorderDatum>,
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
// debugging/future material use, and A stays opaque so Pixi samples defined data
// across the whole map. Pixels outside every ring stay neutral 128/128/128/255.
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
                imageData.data[offset] = Math.max(0, Math.min(255, 128 + Math.round(vectorX * 127)))
                imageData.data[offset + 1] = Math.max(0, Math.min(255, 128 + Math.round(vectorY * 127)))
                imageData.data[offset + 2] = Math.max(0, Math.min(255, 128 + Math.round(rimVolume * 70)))
                imageData.data[offset + 3] = 255
            }
        }
    }
}

// Screen-space Pixi glass border renderer for DOM chrome that sits over the
// canvas, such as the bottom composer and the adjacent action buttons.
//
// Important split:
// - pixiMediaLayer captures the Pixi stage into `renderTexture`.
// - `refractionSprite` draws that capture back through `DisplacementFilter`.
// - `maskGraphics` limits the refraction to a rounded 10px ring.
// - `materialContainer` overlays a faint baked closed-strip glass texture.
//
// Browser DOM is never sampled by this renderer. Only Pixi-rendered canvas
// layers below the screen glass layer can distort under the ring.
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
    private maskAndHighlightSignature = ''
    private displacementMapWidth = 8
    private displacementMapHeight = 8
    private renderTexture: RenderTexture | null = null
    private renderTextureWidth = 0
    private renderTextureHeight = 0
    private renderTextureResolution = 1
    private hasTargets = false
    private destroyed = false

    // Constructor wires long-lived Pixi resources once. The displacement
    // texture is intentionally stable for the entire renderer lifetime because
    // Pixi filter bind groups can keep references to texture resources between
    // frames; swapping and destroying that texture can leave WebGPU/WebGL with a
    // null bind-group resource.
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
        this.displacementSprite.renderable = false
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

    // Sync receives screen-space rectangles from pixiMediaLayer. It decides
    // whether there is any visible glass, sizes the stage capture, refreshes the
    // displacement map only when needed, and updates mask/material geometry.
    sync(datums: ReadonlyArray<PixiGlassBorderDatum>, viewport: ViewportSize): void {
        if (this.destroyed) return
        const visibleDatums = this.style.enabled
            ? datums.filter((datum) => datum.visible && this.isInViewport(datum, viewport))
            : []
        const borderWidth = Math.max(0, this.style.widthPx)
        this.hasTargets = visibleDatums.length > 0 && viewport.width > 0 && viewport.height > 0 && borderWidth > 0
        this.container.renderable = this.hasTargets

        if (!this.hasTargets) {
            // Leave long-lived textures in place, but clear draw state and mark
            // the displacement signature dirty so the next visible sync writes a
            // fresh map for the new geometry.
            if (this.maskAndHighlightSignature) {
                this.maskGraphics.clear()
                this.highlightGraphics.clear()
                this.maskAndHighlightSignature = ''
            }
            this.displacementSignature = ''
            this.hideInactiveEntries(new Set())
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

    // The media layer asks for this capture texture before rendering. Returning
    // null when there are no visible targets skips the extra stage capture.
    getCaptureTexture(): RenderTexture | null {
        return this.hasTargets ? this.renderTexture : null
    }

    // During stage capture, the glass layer must hide itself or it would capture
    // and refract its own previous frame. The caller restores it in a finally
    // block before the final app.render().
    setCapturing(capturing: boolean): void {
        if (this.destroyed) return
        this.container.renderable = this.hasTargets && !capturing
    }

    // Destroy releases resources that this renderer owns. The displacement
    // texture is destroyed exactly once here, not during sync, for filter safety.
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

    // Capture texture mirrors the pane in CSS pixels and caps resolution at 2x.
    // Resizing the existing RenderTexture preserves the sprite/filter wiring.
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

    // Rebuilds the CPU displacement map in place. This is the runtime-crash
    // sensitive path: update the existing canvas/source, do not assign a new
    // texture to `displacementSprite.texture` and do not destroy an old texture.
    private syncDisplacementMap(datums: ReadonlyArray<PixiGlassBorderDatum>, viewport: ViewportSize): void {
        const signature = getDisplacementSignature(datums, viewport, this.style)
        if (signature === this.displacementSignature) return

        const mapScale = getDisplacementMapScale(viewport, this.style)
        const mapWidth = Math.max(1, Math.ceil(viewport.width * mapScale))
        const mapHeight = Math.max(1, Math.ceil(viewport.height * mapScale))
        if (mapWidth !== this.displacementMapWidth || mapHeight !== this.displacementMapHeight) {
            // Canvas resize clears bitmap contents and can invalidate context
            // state. Pixi's source resize must see the same dimensions before
            // the context writes and source.update() uploads the new pixels.
            this.displacementCanvas.width = mapWidth
            this.displacementCanvas.height = mapHeight
            this.displacementMapWidth = mapWidth
            this.displacementMapHeight = mapHeight
            this.displacementTexture.source.resize(mapWidth, mapHeight)
            this.displacementContext = getTextureCanvasContext(this.displacementCanvas)
        }

        const context = this.displacementContext
        if (!context) return

        // Create fresh ImageData each time so the neutral fill starts from a
        // clean buffer and no stale ring pixels remain after targets move.
        const imageData = context.createImageData(mapWidth, mapHeight)
        writeLiquidGlassDisplacementMap(imageData, mapWidth, mapHeight, mapScale, datums, this.style)
        context.putImageData(imageData, 0, 0)
        this.displacementTexture.source.update()
        this.displacementSignature = signature
    }

    // The mask defines the actual refractive area; highlights draw extra
    // low-alpha rim cues on top of the refraction and material mesh.
    private syncMaskAndHighlights(datums: ReadonlyArray<PixiGlassBorderDatum>): void {
        const signature = getMaskAndHighlightSignature(datums, this.style)
        if (signature === this.maskAndHighlightSignature) return
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
        this.maskAndHighlightSignature = signature
    }

    // Keeps one mesh per target id so stable composer/buttons do not churn Pixi
    // DisplayObjects or WebGPU buffers on every render. Geometry is rewritten
    // only when the screen-space target actually moves/resizes.
    private syncMaterialMeshes(datums: ReadonlyArray<PixiGlassBorderDatum>): void {
        const activeIds = new Set(datums.map((datum) => datum.id))
        this.hideInactiveEntries(activeIds)
        const borderWidth = Math.max(0, this.style.widthPx)
        const edgeFeatherFraction = this.style.glassMaterial.edgeFeatherFraction
        for (const datum of datums) {
            const entry = this.entries.get(datum.id) ?? this.createEntry(datum.id)
            const signature = getMaterialGeometrySignature(datum, borderWidth, edgeFeatherFraction)
            entry.mesh.renderable = true
            if (entry.geometrySignature === signature) continue
            writeClosedRoundedBorderGeometry(
                entry.buffers,
                datum,
                borderWidth,
                edgeFeatherFraction
            )
            updateMeshGeometryBuffers(entry.geometry)
            entry.geometrySignature = signature
        }
    }

    // Create the material mesh for one target. The baked texture is shared by
    // all border meshes; only geometry differs per rounded rectangle.
    private createEntry(id: string): GlassBorderEntry {
        const buffers = createGlassBorderMeshGeometry()
        const geometry = new MeshGeometry({
            positions: buffers.positions,
            uvs: buffers.uvs,
            indices: buffers.indices,
        })
        const mesh = new Mesh({ geometry, texture: this.materialTexture })
        mesh.label = `workspace-pixi-glass-border-${id}`
        mesh.eventMode = 'none'
        this.materialContainer.addChild(mesh)
        const entry = { mesh, geometry, buffers, geometrySignature: '' }
        this.entries.set(id, entry)
        return entry
    }

    // Any target missing from the latest visible set stops drawing but keeps
    // its mesh/geometry alive. Destroying geometry during sync can invalidate
    // GPU buffers still referenced by the current WebGPU submit.
    private hideInactiveEntries(activeIds: Set<string>): void {
        for (const [id, entry] of this.entries) {
            if (!activeIds.has(id)) entry.mesh.renderable = false
        }
    }

    // Remove the mesh from the material container before destroying the mesh and
    // geometry. This mirrors Pixi's ownership tree and keeps destroy idempotent.
    private destroyEntry(id: string): void {
        const entry = this.entries.get(id)
        if (!entry) return
        this.materialContainer.removeChild(entry.mesh)
        entry.mesh.destroy()
        entry.geometry.destroy()
        this.entries.delete(id)
    }

    // Cheap screen-space culling. Offscreen glass targets do not need mask,
    // material, capture, or displacement work.
    private isInViewport(datum: PixiGlassBorderDatum, viewport: ViewportSize): boolean {
        const borderWidth = Math.max(0, this.style.widthPx)
        return datum.x + datum.width + borderWidth >= 0
            && datum.y + datum.height + borderWidth >= 0
            && datum.x - borderWidth <= viewport.width
            && datum.y - borderWidth <= viewport.height
    }
}
