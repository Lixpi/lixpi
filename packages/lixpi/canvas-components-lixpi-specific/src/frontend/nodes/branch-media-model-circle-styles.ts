import {
    CircularGlassMaterial,
    type GlassMaterialStyle,
    type CircularGlassMaterialStyle,
} from '@lixpi/canvas-components/effects/glass'
import {
    adjustHexColor,
    mixHexColors,
    normalizeHexColor,
    type ColorAdjustment,
} from '@lixpi/ui-primitives/gradients'
import { svgToCssImageUrl } from '@lixpi/ui-primitives/svg'
import { tPatternSvgTexture } from '@lixpi/ui-kit/svg'

export type BranchMediaModelCircleSettings = {
    glass: {
        textureSize: number
        translucency: number
        rimFeatherFraction: number
        fallbackColors: string[]
        brandColorAdjust: ColorAdjustment
        brandColorStops: { targetColor: string; amount: number }[]
        material: GlassMaterialStyle
        discMaterial: Partial<CircularGlassMaterialStyle>
    }
    texture: {
        fallbackColor: string
        fillOpacity: number
        brandColorMix: { targetColor: string; amount: number }
    }
}

// The component chooses the Lixpi color treatment. Color math and SVG encoding
// remain generic utilities; the source texture remains UI-kit artwork.
export class BranchMediaModelCircleStyles {
    private readonly glassImages = new Map<string, string>()
    private readonly textureImages = new Map<string, string>()

    constructor(private readonly settings: BranchMediaModelCircleSettings) {}

    getGlassImage(modelColor: string | null): string {
        const glass = this.settings.glass
        const normalized = normalizeHexColor(modelColor)
        const adjusted = normalized ? adjustHexColor(normalized, glass.brandColorAdjust, '#53616C') : null
        const colors = adjusted
            ? glass.brandColorStops.map(stop => mixHexColors(adjusted, stop.targetColor, stop.amount, '#53616C'))
            : glass.fallbackColors
        const key = JSON.stringify([colors, glass.textureSize, glass.translucency, glass.rimFeatherFraction, glass.material, glass.discMaterial])
        const cached = this.glassImages.get(key)
        if (cached !== undefined) return cached
        const dataUrl = new CircularGlassMaterial(colors, 0, glass.material, {
            size: glass.textureSize,
            translucency: glass.translucency,
            rimFeatherFraction: glass.rimFeatherFraction,
            discStyle: glass.discMaterial,
        }).bakeDataUrl()
        const image = dataUrl ? `url(${dataUrl})` : ''
        this.glassImages.set(key, image)
        return image
    }

    getTextureImage(modelColor: string | null): string {
        const texture = this.settings.texture
        const normalized = normalizeHexColor(modelColor)
        const color = normalized
            ? mixHexColors(normalized, texture.brandColorMix.targetColor, texture.brandColorMix.amount, '#53616C')
            : texture.fallbackColor
        const key = `${color}|${texture.fillOpacity}`
        const cached = this.textureImages.get(key)
        if (cached !== undefined) return cached
        const svg = tPatternSvgTexture.replace('<path ', `<path fill="${color}" fill-opacity="${texture.fillOpacity}" `)
        const image = svgToCssImageUrl(svg)
        this.textureImages.set(key, image)
        return image
    }

    clear(): void {
        this.glassImages.clear()
        this.textureImages.clear()
    }
}
