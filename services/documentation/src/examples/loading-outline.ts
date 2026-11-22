import { TravelingSnakeGlassMaterial } from '@lixpi/canvas-components/effects/glass'
import {
    type LoadingOverlayOptions,
} from '@lixpi/canvas-components/loading'
import {
    resolveCanvasThemeColors,
    type CanvasTheme,
} from '@lixpi/canvas-components/theme'

export const outlineAppearance = (theme: CanvasTheme) => {
    const settings = resolveCanvasThemeColors(theme, theme.effects.generationOutline)

    return {
        texture: new TravelingSnakeGlassMaterial(
            settings.colors,
            settings.tailAlpha,
            settings.glassMaterial,
        ).bake(),
        style: {
            ...settings,
            edgeFeatherFraction: settings.glassMaterial.edgeFeatherFraction,
        },
    }
}

export const loadingOutline = (theme: CanvasTheme): LoadingOverlayOptions['outline'] => ({
    ...outlineAppearance(theme),
    size: theme.effects.loadingOutline.diameter,
    durationMs: theme.effects.loadingOutline.durationMs,
    spinCycle: theme.effects.loadingOutline.spinCycle,
    snakeLengthFraction: theme.effects.loadingOutline.snakeLengthFraction,
})
