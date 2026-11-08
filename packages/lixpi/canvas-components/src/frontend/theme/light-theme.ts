import {
    lixpiLightTheme,
    type ApplicationTheme,
} from '@lixpi/themes'
import {
    type CanvasTheme,
} from './canvas-theme.ts'
import { createCanvasConnectorSettings } from '../connectors/connector-settings.ts'
import { createCanvasEffectsTheme } from './effects-theme.ts'

const createLightEffects = () => {
    const effects = createCanvasEffectsTheme()

    effects.glassBorder.bodyColor = '#ffffff'
    effects.glassBorder.highlightColor = '#ffffff'
    effects.glassBorder.shadowColor = '#415061'
    effects.glassBorder.materialColors = ['#ffffff', '#f7fbff', '#edf4ff', '#ffffff']
    effects.glassBorder.glassMaterial.shadowColor = '#415061'
    effects.generationOutline.colors = ['#ff0084', '#ff39b0', '#fc75c6', '#eba0f5', '#f1c2e9', '#e0d6ff', '#eaeaff', '#DAD7F1', '#E8E4F6']
    effects.generationOutline.glassMaterial.shadowColor = '#4E5B6C'
    effects.circularGlass.fallbackColors = ['#06133A', '#0A49A7', '#1768D9', '#55A7FF']
    effects.circularGlass.material.shadowColor = '#03070B'

    return effects
}

export const createCanvasDefaultsFromPreset = (preset: ApplicationTheme): CanvasTheme => {
    const {
        fontFamily,
        fontSize,
    } = preset.typography.body
    // Canvas geometry is in pixels. Resolve rem against the CSS initial size for headless rendering.
    const sizeInPixels = Number.parseFloat(fontSize) * (fontSize.endsWith('rem') ? 16 : 1)

    return {
        name: preset.name,
        colorScheme: preset.colorScheme,
        colors: {
            background: 'transparent',
            surface: preset.surface.card,
            raised: preset.surface.inset,
            hover: preset.surface.hover,
            text: preset.text.body,
            muted: preset.text.muted,
            border: preset.border.default,
            accent: preset.accent.primary,
            onAccent: preset.accent.foreground,
            success: preset.feedback.success,
            warning: preset.feedback.warning,
            danger: preset.feedback.danger,
        },
        typography: {
            fontFamily,
            fontSize: sizeInPixels,
            lineHeight: 1.5,
            titleFontSize: 13,
            titleFontWeight: 700,
            panelFontSize: Number.parseFloat(preset.typography.panel.fontSize),
            panelLineHeight: preset.typography.panel.lineHeight,
        },
        shape: {
            nodeRadius: 12,
            mediaRadius: 30,
            panelRadius: 12,
            controlRadius: 10,
            borderWidth: 0,
        },
        controls: {
            typography: {
                fontSize: Number.parseFloat(preset.typography.control.fontSize),
                fontWeight: preset.typography.control.fontWeight,
            },
            slidingSwitch: { ...preset.control.slidingSwitch },
            height: 40,
            padding: 7,
        },
        shadows: {
            node: preset.shadow.card,
            selected: '0 2px 12px rgba(0, 0, 0, 0.3)',
        },
        states: {
            disabledOpacity: 0.5,
            // A white frost over the blurred workspace while it loads.
            loadingScrim: 'rgba(255, 255, 255, 0.9)',
        },
        selection: {
            border: 'rgba(176, 173, 224, 0.88)',
            fill: 'rgba(230, 233, 246, 0.38)',
            overlayBorder: 'rgba(197, 192, 238, 0.62)',
            overlayFill: 'rgba(230, 233, 246, 0.42)',
        },
        effects: preset.name === lixpiLightTheme.name ? createLightEffects() : createCanvasEffectsTheme(),
        connectors: createCanvasConnectorSettings({
            lineDefaultColor: preset.text.muted,
        }),
    }
}

export const createLixpiLightCanvasThemeDefaults = (): CanvasTheme => createCanvasDefaultsFromPreset(lixpiLightTheme)
