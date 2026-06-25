import { Texture } from 'pixi.js'

// Render-agnostic glass shading. The traveling-outline snake and the branch
// lineage media-model circles share the same per-pixel material (lens core,
// specular highlights, edge shadow, feathered translucency); only the UV
// mapping that feeds `progress`/`crossSection` differs. Concrete subclasses
// can bake that mapping into Pixi textures or browser-ready image data.

export type GlassMaterialStyle = {
    shadowColor: string
    tailOpacityPower: number
    tailFadeFraction: number
    minTailOpacity: number
    edgeFeatherFraction: number
    edgeFeatherPower: number
    lensCorePower: number
    upperSpecularCenter: number
    upperSpecularDrift: number
    upperSpecularWidth: number
    upperSpecularFadeStart: number
    upperSpecularFadeEnd: number
    upperSpecularStrength: number
    headSpecularProgressCenter: number
    headSpecularProgressWidth: number
    headSpecularCrossSectionCenter: number
    headSpecularCrossSectionWidth: number
    headSpecularStrength: number
    lowerEdgeShadowCenter: number
    lowerEdgeShadowWidth: number
    lowerEdgeShadowStrength: number
    upperEdgeShadowCenter: number
    upperEdgeShadowWidth: number
    upperEdgeShadowStrength: number
    edgeShadowPower: number
    edgeShadowStrength: number
    lensHighlightStrength: number
    highlightWhiteMixMax: number
    shadowMixMax: number
    materialAlphaBase: number
    materialAlphaMax: number
    lensAlphaStrength: number
    upperSpecularAlphaStrength: number
    headSpecularAlphaStrength: number
}

export type RgbColor = { r: number; g: number; b: number }

type GradientCanvas = OffscreenCanvas | HTMLCanvasElement
type GradientCanvasContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type GradientCanvasFactory<TCanvas extends GradientCanvas> = (width: number, height: number) => TCanvas

// Result of mapping one destination pixel into the material's UV space.
// `alphaMask` (default 1) lets a baker carve a shape out of the texture — the
// circular baker uses it for the feathered round cutout.
export type GlassUvSample = {
    progress: number
    crossSection: number
    alphaMask?: number
    volume?: number
    fresnel?: number
    caustic?: number
    specular?: number
    innerShadow?: number
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

function parseHexColor(hex: string): RgbColor {
    const normalized = hex.trim().replace(/^#/, '')
    if (!/^[\da-f]{6}$/i.test(normalized)) return { r: 78, g: 91, b: 108 }
    const value = Number.parseInt(normalized, 16)
    return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff,
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

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value))
}

function gaussian(position: number, center: number, width: number): number {
    return Math.exp(-((position - center) ** 2) / (2 * width ** 2))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    if (edge0 === edge1) return value >= edge1 ? 1 : 0
    const progress = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
    return progress * progress * (3 - 2 * progress)
}

function getTextureEdgeFeatherFraction(edgeFeatherFraction: number): number {
    const boundedFeather = Math.max(0, edgeFeatherFraction)
    return Math.min(0.49, boundedFeather / (1 + 2 * boundedFeather))
}

function getTextureOpacityProgress(
    progress: number,
    tailAlpha: number,
    glassMaterial: GlassMaterialStyle
): number {
    const configuredOpacity = tailAlpha + (1 - tailAlpha) * Math.pow(progress, glassMaterial.tailOpacityPower)
    const tailFade = smoothstep(0, glassMaterial.tailFadeFraction, progress)
    return tailFade * Math.max(glassMaterial.minTailOpacity, Math.min(1, configuredOpacity))
}

function createGradientCanvas(width: number, height: number): GradientCanvas {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

function createHtmlCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

export abstract class GlassMaterial {
    protected readonly colors: ReadonlyArray<string>
    protected readonly tailAlpha: number
    protected readonly style: GlassMaterialStyle

    constructor(colors: ReadonlyArray<string>, tailAlpha: number, style: GlassMaterialStyle) {
        this.colors = colors.length > 0 ? colors : ['#ffffff']
        this.tailAlpha = tailAlpha
        this.style = style
    }

    abstract bake(): Texture

    protected shadeSample(sample: GlassUvSample): { color: RgbColor; alpha: number } {
        return this.shade(sample.progress, sample.crossSection)
    }

    // Core glass shading shared by every baker. `progress` runs tail→head,
    // `crossSection` runs top edge (0) → bottom edge (1).
    protected shade(progress: number, crossSection: number): { color: RgbColor; alpha: number } {
        const glassMaterial = this.style
        const white = { r: 255, g: 255, b: 255 }
        const glassShadow = parseHexColor(glassMaterial.shadowColor)
        const baseColor = getTravelingOutlineColorChannels(this.colors, progress)
        const opacityProgress = getTextureOpacityProgress(progress, this.tailAlpha, glassMaterial)
        const textureEdgeFeather = getTextureEdgeFeatherFraction(glassMaterial.edgeFeatherFraction)
        const coreSpan = Math.max(0.001, 1 - textureEdgeFeather * 2)
        const coreCrossSection = Math.max(0, Math.min(1, (crossSection - textureEdgeFeather) / coreSpan))
        const edgeDistance = Math.abs(coreCrossSection - 0.5) * 2
        const edgeFeather = textureEdgeFeather <= 0
            ? 1
            : smoothstep(0, textureEdgeFeather, crossSection) * smoothstep(0, textureEdgeFeather, 1 - crossSection)
        const roundedBody = Math.max(0, Math.sin(Math.PI * coreCrossSection))
        const lensCore = Math.pow(roundedBody, glassMaterial.lensCorePower)
        const upperSpecular = gaussian(
            coreCrossSection,
            glassMaterial.upperSpecularCenter + glassMaterial.upperSpecularDrift * Math.sin(progress * Math.PI),
            glassMaterial.upperSpecularWidth
        ) * smoothstep(glassMaterial.upperSpecularFadeStart, glassMaterial.upperSpecularFadeEnd, progress)
        const headSpecular = gaussian(progress, glassMaterial.headSpecularProgressCenter, glassMaterial.headSpecularProgressWidth)
            * gaussian(coreCrossSection, glassMaterial.headSpecularCrossSectionCenter, glassMaterial.headSpecularCrossSectionWidth)
        const lowerEdgeShadow = gaussian(coreCrossSection, glassMaterial.lowerEdgeShadowCenter, glassMaterial.lowerEdgeShadowWidth)
        const upperEdgeShadow = gaussian(coreCrossSection, glassMaterial.upperEdgeShadowCenter, glassMaterial.upperEdgeShadowWidth)
        const edgeShadow = lowerEdgeShadow * glassMaterial.lowerEdgeShadowStrength
            + upperEdgeShadow * glassMaterial.upperEdgeShadowStrength
            + Math.pow(edgeDistance, glassMaterial.edgeShadowPower) * glassMaterial.edgeShadowStrength
        const highlight = upperSpecular * glassMaterial.upperSpecularStrength
            + headSpecular * glassMaterial.headSpecularStrength
            + lensCore * glassMaterial.lensHighlightStrength

        const litColor = mixColor(baseColor, white, Math.min(glassMaterial.highlightWhiteMixMax, highlight))
        const color = mixColor(litColor, glassShadow, Math.min(glassMaterial.shadowMixMax, edgeShadow))
        const materialAlpha = Math.min(
            glassMaterial.materialAlphaMax,
            glassMaterial.materialAlphaBase
                + lensCore * glassMaterial.lensAlphaStrength
                + upperSpecular * glassMaterial.upperSpecularAlphaStrength
                + headSpecular * glassMaterial.headSpecularAlphaStrength
        )
        const alpha = opacityProgress * materialAlpha * Math.pow(edgeFeather, glassMaterial.edgeFeatherPower)
        return {
            color,
            alpha: Math.min(0.99, alpha),
        }
    }

    protected bakeCanvas<TCanvas extends GradientCanvas>(
        width: number,
        height: number,
        sample: (px: number, py: number) => GlassUvSample,
        createCanvas: GradientCanvasFactory<TCanvas>,
    ): TCanvas | null {
        const canvas = createCanvas(width, height)
        let context: GradientCanvasContext | null = null
        try {
            context = canvas.getContext('2d') as GradientCanvasContext | null
        } catch {
            return null
        }
        if (!context) return null

        const imageData = context.createImageData(width, height)
        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                const uvSample = sample(px, py)
                const { alphaMask = 1 } = uvSample
                const { color, alpha } = this.shadeSample(uvSample)
                const maskedAlpha = Math.max(0, Math.min(1, alpha * alphaMask))
                const offset = (py * width + px) * 4
                imageData.data[offset] = color.r
                imageData.data[offset + 1] = color.g
                imageData.data[offset + 2] = color.b
                imageData.data[offset + 3] = Math.round(maskedAlpha * 255)
            }
        }

        context.clearRect(0, 0, width, height)
        context.putImageData(imageData, 0, 0)

        return canvas
    }

    // Generic baker: fills a `width`×`height` texture by mapping each pixel into
    // UV space via `sample`, shading it, then applying the optional shape mask.
    protected bakeTexture(
        width: number,
        height: number,
        sample: (px: number, py: number) => GlassUvSample
    ): Texture {
        const canvas = this.bakeCanvas(width, height, sample, createGradientCanvas)
        if (!canvas) return Texture.WHITE

        return Texture.from(canvas as HTMLCanvasElement, true)
    }

    protected bakePngDataUrl(
        width: number,
        height: number,
        sample: (px: number, py: number) => GlassUvSample
    ): string {
        if (typeof document === 'undefined') return ''
        const canvas = this.bakeCanvas(width, height, sample, createHtmlCanvas)
        try {
            return canvas?.toDataURL('image/png') ?? ''
        } catch {
            return ''
        }
    }
}

// Snake strip: progress along the X axis (tail→head), cross-section along Y.
// Reproduces the previous `createTravelingSnakeTexture` exactly.
export class TravelingSnakeGlassMaterial extends GlassMaterial {
    private readonly width = 256
    private readonly height = 64

    bake(): Texture {
        return this.bakeTexture(this.width, this.height, (px, py) => ({
            progress: px / (this.width - 1),
            crossSection: py / (this.height - 1),
        }))
    }
}

export type CircularGlassMaterialOptions = {
    // Texture resolution in pixels (square). Higher = crisper at large zoom.
    size?: number
    // Final-alpha multiplier so the disc reads as see-through glass.
    translucency?: number
    // Fraction of the radius used to feather the round rim to transparent.
    rimFeatherFraction?: number
}

// Glass disc: a feathered round cutout with shallow slab-style thickness.
// It avoids a radial sphere normal and instead uses rim/meniscus bands, a
// restrained top reflection, and a subtle lower glow.
export class CircularGlassMaterial extends GlassMaterial {
    private readonly size: number
    private readonly translucency: number
    private readonly rimFeatherFraction: number

    constructor(
        colors: ReadonlyArray<string>,
        tailAlpha: number,
        style: GlassMaterialStyle,
        options: CircularGlassMaterialOptions = {}
    ) {
        super(colors, tailAlpha, style)
        this.size = Math.max(2, Math.round(options.size ?? 128))
        this.translucency = Math.max(0, Math.min(1, options.translucency ?? 1))
        this.rimFeatherFraction = Math.max(0, Math.min(0.5, options.rimFeatherFraction ?? 0.08))
    }

    bake(): Texture {
        const size = this.size
        return this.bakeTexture(size, size, (px, py) => this.sampleDisc(px, py))
    }

    bakeDataUrl(): string {
        const size = this.size
        return this.bakePngDataUrl(size, size, (px, py) => this.sampleDisc(px, py))
    }

    protected override shadeSample(sample: GlassUvSample): { color: RgbColor; alpha: number } {
        const shaded = super.shadeSample(sample)
        const white = { r: 255, g: 255, b: 255 }
        const glassShadow = parseHexColor(this.style.shadowColor)
        const volume = clamp01(sample.volume ?? 0)
        const fresnel = clamp01(sample.fresnel ?? 0)
        const caustic = clamp01(sample.caustic ?? 0)
        const specular = clamp01(sample.specular ?? 0)
        const innerShadow = clamp01(sample.innerShadow ?? 0)
        const absorption = clamp01(volume * 0.04 + fresnel * 0.26 + innerShadow * 0.34)
        const transmittedLight = clamp01(caustic * 0.34 + specular * 0.58)
        const shadowedColor = mixColor(shaded.color, glassShadow, Math.min(this.style.shadowMixMax, absorption))
        const color = mixColor(shadowedColor, white, Math.min(this.style.highlightWhiteMixMax, transmittedLight))
        const alpha = clamp01(shaded.alpha * (0.82 + volume * 0.12) + specular * 0.022 + caustic * 0.014)

        return {
            color,
            alpha: Math.min(0.95, alpha),
        }
    }

    private sampleDisc(px: number, py: number): GlassUvSample {
        const size = this.size
        const center = (size - 1) / 2
        const radius = size / 2
        const innerEdge = 1 - this.rimFeatherFraction
        const dx = (px - center) / radius
        const dy = (py - center) / radius
        const distance = Math.sqrt(dx * dx + dy * dy)
        const innerDistance = Math.min(1, distance)
        const rimThickness = smoothstep(0.56, 1, innerDistance)
        const upperMeniscusShadow = gaussian(dy, -0.42, 0.08) * gaussian(dx, 0.02, 0.68)
        const lowerMeniscusDepth = gaussian(dy, 0.64, 0.18) * gaussian(dx, -0.02, 0.64)
        const lowerTransmittedLight = gaussian(dy, 0.5, 0.16) * gaussian(dx, -0.1, 0.5)
        const topReflection = gaussian(dy, -0.28, 0.1) * gaussian(dx, -0.24, 0.26)
        const leftEdgeReflection = gaussian(dx, -0.48, 0.08) * gaussian(dy, -0.08, 0.46)
        const smallGlint = gaussian(dx, -0.18, 0.04) * gaussian(dy, -0.02, 0.06)
        const flatThickness = clamp01(
            0.48
                + rimThickness * 0.28
                + lowerMeniscusDepth * 0.18
                + smoothstep(-0.12, 0.9, dy) * 0.1
        )
        const directionalLight = clamp01(
            0.24
                + lowerTransmittedLight * 0.2
                + topReflection * 0.16
                + leftEdgeReflection * 0.1
                - upperMeniscusShadow * 0.12
                - rimThickness * 0.1
        )
        const crossSection = clamp01(0.5 + dy * 0.58 - dx * 0.035)
        // 1 inside the disc, feathered to 0 across the rim, 0 outside.
        const rimMask = smoothstep(1, innerEdge, distance)
        const lensAlpha = 0.84 + flatThickness * 0.12 + lowerMeniscusDepth * 0.04

        return {
            progress: 0.14 + directionalLight * 0.64,
            crossSection,
            volume: flatThickness,
            fresnel: rimThickness,
            caustic: clamp01(lowerTransmittedLight * 0.52),
            specular: clamp01(topReflection * 0.5 + leftEdgeReflection * 0.34 + smallGlint * 0.7),
            innerShadow: clamp01(upperMeniscusShadow * 0.9 + rimThickness * 0.22),
            alphaMask: rimMask * lensAlpha * this.translucency,
        }
    }
}
