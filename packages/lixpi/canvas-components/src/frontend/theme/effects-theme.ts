import {
    createCircularGlassMaterialStyle,
    type CircularGlassMaterialStyle,
    type GlassMaterialStyle,
} from '../effects/glass/glass-material.ts'
import {
    type GlassBorderStyle,
} from '../effects/glass/glass-border-geometry.ts'
import {
    type TravelingOutlineStyle,
} from '../effects/outline/outline-geometry.ts'

export type CanvasEffectsPalette = {
    surface: string
    text: string
    muted: string
    border: string
    accent: string
}

export type CanvasGlassBorderTheme = Omit<GlassBorderStyle, 'edgeFeatherFraction'> & {
    materialColors: string[]
    materialTailAlpha: number
    glassMaterial: GlassMaterialStyle
}

export type CanvasGenerationOutlineTheme = Omit<TravelingOutlineStyle, 'edgeFeatherFraction'> & {
    colors: string[]
    tailAlpha: number
    glassMaterial: GlassMaterialStyle
}

export type CanvasLoadingOutlineTheme = {
    diameter: number
    durationMs: number
    snakeLengthFraction: number
}

export type CanvasGlassColorMix = {
    targetColor: string
    amount: number
}

export type CanvasGlassColorAdjust = {
    saturationMultiplier: number
    minSaturation: number
    maxSaturation: number
    lightnessMultiplier: number
    minLightness: number
    maxLightness: number
}

export type CanvasCircularGlassTheme = {
    textureSize: number
    translucency: number
    rimFeatherFraction: number
    fallbackColors: string[]
    brandColorAdjust: CanvasGlassColorAdjust
    brandColorStops: CanvasGlassColorMix[]
    material: GlassMaterialStyle
    discMaterial: CircularGlassMaterialStyle
}

export type CanvasEffectsTheme = {
    glassBorder: CanvasGlassBorderTheme
    generationOutline: CanvasGenerationOutlineTheme
    loadingOutline: CanvasLoadingOutlineTheme
    circularGlass: CanvasCircularGlassTheme
}

// A fresh result can be edited by one canvas without changing another owner.
// Resolve semantic color references through the canvas theme before invoking a material baker.
export const createCanvasEffectsTheme = (palette: Partial<CanvasEffectsPalette> = {}): CanvasEffectsTheme => ({
    glassBorder: {
        enabled: true,
        widthPx: 10,
        displacementScalePx: 34,
        displacementMapMaxDimensionPx: 1600,
        edgeRefractionStrength: 0.95,
        surfaceWaveStrength: 0.26,
        causticBandStrength: 0.34,
        displacementFrequencyX: 4.8,
        displacementFrequencyY: 3.9,
        bodyColor: palette.surface ?? 'var(--canvas-surface)',
        bodyAlpha: 0.035,
        highlightColor: palette.surface ?? 'var(--canvas-surface)',
        highlightAlpha: 0.2,
        shadowColor: palette.muted ?? 'var(--canvas-text-muted)',
        shadowAlpha: 0.1,
        materialColors: [
            palette.surface ?? 'var(--canvas-surface)',
            palette.surface ?? 'var(--canvas-surface-raised)',
            palette.surface ?? 'var(--canvas-surface-hover)',
            palette.surface ?? 'var(--canvas-surface)',
        ],
        materialTailAlpha: 1,
        glassMaterial: {
            shadowColor: palette.muted ?? 'var(--canvas-text-muted)',
            tailOpacityPower: 1,
            tailFadeFraction: 0,
            minTailOpacity: 1,
            edgeFeatherFraction: 0.22,
            edgeFeatherPower: 1.34,
            lensCorePower: 0.5,
            upperSpecularCenter: 0.24,
            upperSpecularDrift: 0.02,
            upperSpecularWidth: 0.18,
            upperSpecularFadeStart: 0,
            upperSpecularFadeEnd: 0.01,
            upperSpecularStrength: 0.13,
            headSpecularProgressCenter: 0.52,
            headSpecularProgressWidth: 0.42,
            headSpecularCrossSectionCenter: 0.48,
            headSpecularCrossSectionWidth: 0.28,
            headSpecularStrength: 0.04,
            lowerEdgeShadowCenter: 0.86,
            lowerEdgeShadowWidth: 0.22,
            lowerEdgeShadowStrength: 0.12,
            upperEdgeShadowCenter: 0.08,
            upperEdgeShadowWidth: 0.18,
            upperEdgeShadowStrength: 0.05,
            edgeShadowPower: 2.1,
            edgeShadowStrength: 0.035,
            lensHighlightStrength: 0.06,
            highlightWhiteMixMax: 0.24,
            shadowMixMax: 0.1,
            materialAlphaBase: 0.018,
            materialAlphaMax: 0.14,
            lensAlphaStrength: 0.05,
            upperSpecularAlphaStrength: 0.035,
            headSpecularAlphaStrength: 0.016,
        },
    },
    generationOutline: {
        radius: 10,
        gap: 3,
        snakeHeadWidth: 9,
        snakeTailWidthFraction: 0.14,
        snakeTailThinLengthFraction: 0.1,
        snakeWidthTaperPower: 0.86,
        snakeLengthFraction: 0.24,
        snakeHeadRoundLengthFraction: 0.5,
        durationMs: 3200,
        colors: [
            palette.accent ?? 'var(--canvas-accent)',
            palette.surface ?? 'var(--canvas-surface-raised)',
            palette.accent ?? 'var(--canvas-accent)',
        ],
        tailAlpha: 0,
        glassMaterial: {
            shadowColor: palette.muted ?? 'var(--canvas-text-muted)',
            tailOpacityPower: 0.72,
            tailFadeFraction: 0.08,
            minTailOpacity: 0.62,
            edgeFeatherFraction: 0.1,
            edgeFeatherPower: 1.18,
            lensCorePower: 0.42,
            upperSpecularCenter: 0.32,
            upperSpecularDrift: 0.035,
            upperSpecularWidth: 0.16,
            upperSpecularFadeStart: 0.1,
            upperSpecularFadeEnd: 0.32,
            upperSpecularStrength: 0.24,
            headSpecularProgressCenter: 0.91,
            headSpecularProgressWidth: 0.22,
            headSpecularCrossSectionCenter: 0.48,
            headSpecularCrossSectionWidth: 0.26,
            headSpecularStrength: 0.18,
            lowerEdgeShadowCenter: 0.88,
            lowerEdgeShadowWidth: 0.2,
            lowerEdgeShadowStrength: 0.16,
            upperEdgeShadowCenter: 0.1,
            upperEdgeShadowWidth: 0.2,
            upperEdgeShadowStrength: 0.07,
            edgeShadowPower: 2.2,
            edgeShadowStrength: 0.04,
            lensHighlightStrength: 0.08,
            highlightWhiteMixMax: 0.3,
            shadowMixMax: 0.14,
            materialAlphaBase: 0.72,
            materialAlphaMax: 0.94,
            lensAlphaStrength: 0.16,
            upperSpecularAlphaStrength: 0.04,
            headSpecularAlphaStrength: 0.03,
        },
    },
    loadingOutline: {
        diameter: 100,
        durationMs: 600,
        snakeLengthFraction: 0.6,
    },
    circularGlass: {
        textureSize: 128,
        translucency: 0.97,
        rimFeatherFraction: 0.04,
        fallbackColors: [
            palette.accent ?? 'var(--canvas-accent)',
            palette.accent ?? 'var(--canvas-accent)',
            palette.surface ?? 'var(--canvas-surface-raised)',
            palette.surface ?? 'var(--canvas-surface)',
        ],
        brandColorAdjust: {
            saturationMultiplier: 2.1,
            minSaturation: 0.72,
            maxSaturation: 0.9,
            lightnessMultiplier: 0.72,
            minLightness: 0.36,
            maxLightness: 0.46,
        },
        brandColorStops: [
            {
                targetColor: '#020714',
                amount: 0.28,
            },
            {
                targetColor: '#000000',
                amount: 0.02,
            },
            {
                targetColor: '#FFFFFF',
                amount: 0.16,
            },
            {
                targetColor: '#FFFFFF',
                amount: 0.34,
            },
        ],
        material: {
            shadowColor: palette.text ?? 'var(--canvas-text)',
            tailOpacityPower: 0.54,
            tailFadeFraction: 0.05,
            minTailOpacity: 0.56,
            edgeFeatherFraction: 0,
            edgeFeatherPower: 1.04,
            lensCorePower: 0.58,
            upperSpecularCenter: 0.18,
            upperSpecularDrift: 0.02,
            upperSpecularWidth: 0.08,
            upperSpecularFadeStart: 0.03,
            upperSpecularFadeEnd: 0.14,
            upperSpecularStrength: 0.46,
            headSpecularProgressCenter: 0.78,
            headSpecularProgressWidth: 0.22,
            headSpecularCrossSectionCenter: 0.34,
            headSpecularCrossSectionWidth: 0.18,
            headSpecularStrength: 0.34,
            lowerEdgeShadowCenter: 0.9,
            lowerEdgeShadowWidth: 0.18,
            lowerEdgeShadowStrength: 0.22,
            upperEdgeShadowCenter: 0.08,
            upperEdgeShadowWidth: 0.14,
            upperEdgeShadowStrength: 0.13,
            edgeShadowPower: 1.8,
            edgeShadowStrength: 0.09,
            lensHighlightStrength: 0.14,
            highlightWhiteMixMax: 0.3,
            shadowMixMax: 0.16,
            materialAlphaBase: 0.9,
            materialAlphaMax: 0.98,
            lensAlphaStrength: 0.12,
            upperSpecularAlphaStrength: 0.05,
            headSpecularAlphaStrength: 0.04,
        },
        discMaterial: createCircularGlassMaterialStyle({
            absorptionVolumeStrength: 0.035,
            absorptionFresnelStrength: 0.2,
            absorptionInnerShadowStrength: 0.22,
            causticLightStrength: 0.54,
            specularLightStrength: 0.66,
            alphaBaseMultiplier: 0.92,
            alphaMax: 0.98,
            directionalLightLowerTransmittedStrength: 0.26,
            directionalLightTopReflectionStrength: 0.22,
            causticLowerLightStrength: 0.58,
            causticLowerStriationStrength: 0.18,
            specularTopReflectionStrength: 0.68,
            specularLeftEdgeStrength: 0.48,
            specularSmallGlintStrength: 0.9,
        }),
    },
})
