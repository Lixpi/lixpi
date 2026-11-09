import {
    canvasThemeConnectorSettings,
    createCanvasTheme,
    resolveCanvasThemeColors,
    type CanvasTheme,
} from '@lixpi/canvas-components/theme'
import {
    type LixpiCanvasSettings,
} from '../settings/types.ts'
import {
    type WorkspaceCanvasAppearance,
} from './workspace-canvas-host.ts'

const baseTheme = createCanvasTheme()

// Maps one semantic theme to DOM properties, connector settings and GPU material inputs.
export const resolveLixpiCanvasTheme = <Settings extends LixpiCanvasSettings>(
    theme: CanvasTheme,
    settings: Settings,
): Settings => {
    const next = structuredClone(settings)
    const property = (
        name: string,
        fallback: string,
    ): string => theme.properties?.[`--canvas-lixpi-${name}`] ?? fallback
    const effects = resolveCanvasThemeColors(theme, theme.effects)
    const outline = effects.generationOutline
    next.connector = canvasThemeConnectorSettings(theme)
    next.selection.styles = resolveCanvasThemeColors(
        theme,
        {
            marqueeBorderColor: theme.selection.border,
            marqueeBackgroundColor: theme.selection.fill,
            overlayBorderColor: theme.selection.overlayBorder,
            overlayBackgroundColor: theme.selection.overlayFill,
        },
    )
    next.mediaNode.styles = {
        defaultBoxShadow: 'var(--canvas-shadow)',
        selectedBoxShadow: 'var(--canvas-selected-shadow)',
        borderRadius: theme.shape.mediaRadius,
        backgroundColor: theme.colors.surface,
    }
    next.canvasChrome.glassBorder = effects.glassBorder
    next.mediaNode.inProgressOutlineAnimation = {
        ...next.mediaNode.inProgressOutlineAnimation,
        radius: outline.radius,
        gap: outline.gap,
        snakeWidth: outline.snakeHeadWidth,
        snakeTailWidthFraction: outline.snakeTailWidthFraction,
        snakeTailThinLengthFraction: outline.snakeTailThinLengthFraction,
        snakeWidthTaperPower: outline.snakeWidthTaperPower,
        snakeLengthFraction: outline.snakeLengthFraction,
        snakeHeadRoundLengthFraction: outline.snakeHeadRoundLengthFraction,
        animationDurationMs: outline.durationMs,
        styles: {
            snakeColors: outline.colors,
            snakeTailAlpha: outline.tailAlpha,
            glassMaterial: outline.glassMaterial,
        },
    }
    next.workspaceLoadingOutline = {
        diameter: effects.loadingOutline.diameter,
        animationDurationMs: effects.loadingOutline.durationMs,
        spinCycle: { ...effects.loadingOutline.spinCycle },
        snakeLengthFraction: effects.loadingOutline.snakeLengthFraction,
    }
    next.mediaBranchLineage.mediaModelCircle.glass = effects.circularGlass
    next.mediaBranchLineage.mediaModelCircle.styles = {
        ...next.mediaBranchLineage.mediaModelCircle.styles,
        iconColor: property('model-circle-icon', next.mediaBranchLineage.mediaModelCircle.styles.iconColor),
        backgroundColor: property('model-circle-background', next.mediaBranchLineage.mediaModelCircle.styles.backgroundColor),
        boxShadow: property('model-circle-shadow', next.mediaBranchLineage.mediaModelCircle.styles.boxShadow),
    }
    next.mediaBranchLineage.branchOrigin.styles = {
        ...next.mediaBranchLineage.branchOrigin.styles,
        backgroundColor: property('branch-background', next.mediaBranchLineage.branchOrigin.styles.backgroundColor),
        borderColor: property('branch-border', next.mediaBranchLineage.branchOrigin.styles.borderColor),
        iconColor: property('branch-icon', next.mediaBranchLineage.branchOrigin.styles.iconColor),
        boxShadow: property('branch-shadow', next.mediaBranchLineage.branchOrigin.styles.boxShadow),
        separatorGradient: property('branch-separator', next.mediaBranchLineage.branchOrigin.styles.separatorGradient),
    }
    next.mediaNode.generatedMediaChrome.styles = {
        ...next.mediaNode.generatedMediaChrome.styles,
        modelBadgeProviderColor: property('badge-provider', next.mediaNode.generatedMediaChrome.styles.modelBadgeProviderColor),
        modelBadgeModelColor: property('badge-model', next.mediaNode.generatedMediaChrome.styles.modelBadgeModelColor),
        modelBadgeNameFontSize: 'var(--canvas-font-size)',
        modelBadgeNameLineHeight: theme.typography.lineHeight,
        infoButtonColor: property('media-info', next.mediaNode.generatedMediaChrome.styles.infoButtonColor),
        infoButtonHoverColor: property('media-info-hover', next.mediaNode.generatedMediaChrome.styles.infoButtonHoverColor),
    }

    const textScale = theme.typography.fontSize / baseTheme.typography.fontSize
    const lineScale = theme.typography.lineHeight / baseTheme.typography.lineHeight
    const markerText = next.mediaBranchLineage.marker.text
    markerText.messageFontSize *= textScale
    markerText.responseFontSize *= textScale
    markerText.messageLineHeight *= lineScale
    markerText.responseLineHeight *= lineScale

    return next
}

export const resolveWorkspaceCanvasTheme = <Settings extends WorkspaceCanvasAppearance>(
    theme: CanvasTheme,
    settings: Settings,
): Settings => {
    const next = resolveLixpiCanvasTheme(theme, settings)
    const property = (
        name: string,
        fallback: string,
    ): string => theme.properties?.[`--canvas-lixpi-${name}`] ?? fallback
    next.aiChatThread.styles = {
        nodeBorder: property('chat-border', 'var(--canvas-node-border-width) solid var(--canvas-border)'),
        nodeBoxShadow: property('chat-shadow', 'var(--canvas-shadow)'),
        panelSectionDividerBorder: property('chat-divider', 'var(--canvas-node-border-width) solid var(--canvas-border)'),
    }
    next.aiChatThread.contextPreview.styles = Object.fromEntries(
        Object.entries(next.aiChatThread.contextPreview.styles).map(
            ([name, value]) => [
                name,
                property(`context-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value),
            ],
        ),
    )

    const controlScale = theme.controls.height / baseTheme.controls.height
    const textScale = theme.typography.fontSize / baseTheme.typography.fontSize
    next.videoControls.height *= controlScale
    next.videoControls.typography.timeFontSize *= textScale
    next.aiChatThread.panelSwitch.height *= controlScale

    for (const [name, value] of Object.entries(next.videoControls.styles)) {
        const role = `video-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`

        if (typeof value === 'string')
            Reflect.set(
                next.videoControls.styles,
                name,
                property(role, value),
            )
        else if (typeof value === 'number')
            Reflect.set(
                next.videoControls.styles,
                name,
                Number(
                    property(
                        role,
                        String(value),
                    ),
                ),
            )
    }

    next.dropdown.styles.popoverBoxShadow = 'var(--canvas-shadow)'
    next.gradient.styles.shiftingColors = resolveCanvasThemeColors(
        theme,
        [
            property('gradient-first', theme.colors.surface),
            property('gradient-second', theme.colors.raised),
            property('gradient-third', theme.colors.hover),
            property('gradient-fourth', theme.colors.accent),
        ],
    )

    return next
}

// Preserve references held by mounted components while replacing serializable settings.
export const updateWorkspaceCanvasSettings = <Value extends object>(
    target: Value,
    source: Value,
): void => {
    for (const key of Object.keys(source) as Array<keyof Value>) {
        const next = source[key]
        const current = target[key]

        if (
            current
            && next
            && typeof current === 'object'
            && typeof next === 'object'
            && !Array.isArray(current)
            && !Array.isArray(next)
        )
            updateWorkspaceCanvasSettings(current, next)
        else
            target[key] = structuredClone(next)
    }
}
