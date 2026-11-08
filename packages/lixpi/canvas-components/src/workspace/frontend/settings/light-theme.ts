import {
    lixpiLightTheme,
    type ApplicationTheme,
} from '@lixpi/themes'
import {
    createCanvasDefaultsFromPreset,
    createCanvasThemeFromCss,
    mergeCanvasTheme,
    type CanvasTheme,
} from '@lixpi/canvas-components/theme'
import { createLixpiUiSettings } from './ui-settings.ts'

const componentStyleProperties = (preset: ApplicationTheme = lixpiLightTheme): Record<`--${string}`, string> => {
    const settings = createLixpiUiSettings()
    const appearance = preset.components
    const branch = settings.mediaBranchLineage.branchOrigin.styles
    const circle = settings.mediaBranchLineage.mediaModelCircle.styles
    const properties: Record<`--${string}`, string> = {
        '--canvas-lixpi-chat-ink': appearance.chat.thread.ink,
        '--canvas-lixpi-chat-response-text': appearance.chat.thread.responseForeground,
        '--canvas-lixpi-chat-strong-text': appearance.chat.thread.strongForeground,
        '--canvas-lixpi-chat-user-background': appearance.chat.thread.userMessageBubbleColor,
        '--canvas-lixpi-chat-user-tail': appearance.chat.thread.userMessageBubbleSolidColor,
        '--canvas-lixpi-chat-user-text': appearance.chat.thread.userMessageTextColor,
        '--canvas-lixpi-editor-code': preset.editor.inlineCode.foreground,
        '--canvas-lixpi-editor-placeholder': preset.editor.placeholder.foreground,
        '--canvas-lixpi-branch-background': branch.backgroundColor,
        '--canvas-lixpi-branch-border': branch.borderColor,
        '--canvas-lixpi-branch-icon': branch.iconColor,
        '--canvas-lixpi-branch-shadow': branch.boxShadow,
        '--canvas-lixpi-branch-separator': branch.separatorGradient,
        '--canvas-lixpi-model-circle-background': circle.backgroundColor,
        '--canvas-lixpi-model-circle-icon': circle.iconColor,
        '--canvas-lixpi-model-circle-shadow': circle.boxShadow,
    }

    for (const [name, value] of Object.entries(settings.videoControls.styles))
        if (
            typeof value === 'string'
            || typeof value === 'number'
        )
            properties[`--canvas-lixpi-video-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`] = String(value)

    for (const [name, value] of Object.entries(settings.aiChatThread.contextPreview.styles))
        properties[`--canvas-lixpi-context-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`] = value

    return properties
}

const semanticProperties = (): Record<`--${string}`, string> => ({
    ...componentStyleProperties(),
    '--canvas-lixpi-chat-ink': 'var(--canvas-text)',
    '--canvas-lixpi-chat-response-text': 'var(--canvas-text)',
    '--canvas-lixpi-chat-strong-text': 'var(--canvas-text)',
    '--canvas-lixpi-editor-code': 'var(--canvas-danger)',
    '--canvas-lixpi-editor-placeholder': 'var(--canvas-text-muted)',
    '--canvas-lixpi-context-controls-color': 'var(--canvas-text-muted)',
    '--canvas-lixpi-context-tooltip-background': 'var(--canvas-surface)',
    '--canvas-lixpi-context-tooltip-color': 'var(--canvas-text)',
    '--canvas-lixpi-context-document-color': 'var(--canvas-text)',
    '--canvas-lixpi-context-document-skeleton-line-background': 'var(--canvas-surface-hover)',
    '--canvas-lixpi-context-document-icon-color': 'var(--canvas-text-muted)',
    '--canvas-lixpi-context-document-text-color': 'var(--canvas-text)',
    '--canvas-lixpi-context-popover-title-color': 'var(--canvas-text)',
    '--canvas-lixpi-context-popover-text-color': 'var(--canvas-text-muted)',
    '--canvas-lixpi-context-remove-button-background': 'var(--canvas-surface)',
    '--canvas-lixpi-context-remove-button-color': 'var(--canvas-text-muted)',
    '--canvas-lixpi-badge-provider': 'var(--canvas-text-muted)',
    '--canvas-lixpi-badge-model': 'var(--canvas-text)',
    '--canvas-lixpi-media-info': 'var(--canvas-text-muted)',
    '--canvas-lixpi-media-info-hover': 'var(--canvas-text)',
    '--canvas-lixpi-gradient-first': 'var(--canvas-surface)',
    '--canvas-lixpi-gradient-second': 'var(--canvas-surface-raised)',
    '--canvas-lixpi-gradient-third': 'var(--canvas-surface-hover)',
    '--canvas-lixpi-gradient-fourth': 'var(--canvas-accent)',
    '--canvas-lixpi-composer-radius': 'var(--canvas-panel-radius)',
    '--canvas-lixpi-rail-radius': 'var(--canvas-control-radius)',
    '--canvas-lixpi-prompt-radius': 'var(--canvas-panel-radius)',
    '--canvas-lixpi-prompt-inner-radius': 'var(--canvas-control-radius)',
    '--canvas-lixpi-prompt-background': 'var(--canvas-surface-raised)',
    '--canvas-lixpi-prompt-shadow': 'var(--canvas-shadow)',
    '--canvas-lixpi-prompt-inner-shadow': 'var(--canvas-shadow)',
    '--canvas-lixpi-prompt-text': 'var(--canvas-text)',
    '--canvas-lixpi-prompt-placeholder': 'var(--canvas-text-muted)',
    '--canvas-lixpi-prompt-line-height': 'var(--canvas-line-height)',
    '--canvas-lixpi-switch-track': 'var(--canvas-surface-hover)',
    '--canvas-lixpi-switch-indicator': 'var(--canvas-surface)',
    '--canvas-lixpi-switch-option': 'var(--canvas-text-muted)',
    '--canvas-lixpi-switch-selected': 'var(--canvas-text)',
    '--canvas-lixpi-switch-hover': 'var(--canvas-text)',
    '--canvas-lixpi-switch-surface': 'var(--canvas-surface-raised)',
    '--canvas-lixpi-switch-radius': 'var(--canvas-control-radius)',
    '--canvas-lixpi-menu-trigger': 'var(--canvas-text-muted)',
    '--canvas-lixpi-menu-trigger-active': 'var(--canvas-text)',
    '--canvas-lixpi-menu-hover': 'var(--canvas-surface-hover)',
    '--canvas-lixpi-menu-background': 'var(--canvas-surface-raised)',
    '--canvas-lixpi-menu-shadow': 'var(--canvas-shadow)',
    '--canvas-lixpi-menu-text': 'var(--canvas-text)',
    '--canvas-lixpi-menu-divider': 'linear-gradient(var(--canvas-border), var(--canvas-border))',
    '--canvas-lixpi-menu-title': 'var(--canvas-text)',
    '--canvas-lixpi-menu-title-size': 'var(--canvas-title-font-size)',
    '--canvas-lixpi-menu-label-size': 'var(--canvas-font-size)',
    '--canvas-lixpi-menu-label': 'var(--canvas-text-muted)',
    '--canvas-lixpi-chat-border': 'var(--canvas-node-border-width) solid var(--canvas-border)',
    '--canvas-lixpi-chat-shadow': 'var(--canvas-shadow)',
    '--canvas-lixpi-chat-divider': 'var(--canvas-node-border-width) solid var(--canvas-border)',
    '--canvas-lixpi-panel-switch-scale': '0.7',
    '--canvas-lixpi-dropdown-height-offset': '2px',
    '--canvas-lixpi-dropdown-font-size': 'var(--canvas-font-size)',
    '--canvas-lixpi-dropdown-track': 'var(--canvas-surface-raised)',
    '--canvas-lixpi-dropdown-indicator': 'var(--canvas-surface)',
    '--canvas-lixpi-dropdown-option': 'var(--canvas-text-muted)',
    '--canvas-lixpi-dropdown-selected': 'var(--canvas-text)',
    '--canvas-lixpi-dropdown-disabled': 'var(--canvas-text-muted)',
    '--canvas-lixpi-navigation-backdrop': 'var(--canvas-surface-raised)',
    '--canvas-lixpi-navigation-backdrop-opaque': 'var(--canvas-surface-raised)',
    '--canvas-panel-resize-handle-gradient': 'linear-gradient(var(--canvas-border), var(--canvas-border))',
    '--canvas-panel-resize-handle-width': '3px',
    '--canvas-panel-toggle-color': 'var(--canvas-text-muted)',
    '--canvas-panel-toggle-hover': 'var(--canvas-text)',
    '--canvas-lixpi-panel-backdrop': 'var(--canvas-surface-raised)',
    '--canvas-lixpi-panel-backdrop-opaque': 'var(--canvas-surface-raised)',
})

// Both presets expose the same component roles to a shared theme editor and store.
// Branch and model-circle roles retain their product defaults unless explicitly overridden.
export const createLixpiCanvasTheme = (theme: CanvasTheme): CanvasTheme =>
    mergeCanvasTheme(
        theme,
        { properties: {
            ...semanticProperties(),
            ...theme.properties,
        } },
    )

// Established production presentation, independent of application services and stores.
export const createLixpiLightCanvasTheme = (preset: ApplicationTheme = lixpiLightTheme): CanvasTheme => {
    const settings = createLixpiUiSettings()
    const appearance = preset.components
    const menu = settings.aiPromptInput.modelMenu.styles
    const modeSwitch = settings.aiPromptInput.mediaModeSwitch.styles
    const badge = settings.mediaNode.generatedMediaChrome.styles
    const outline = settings.mediaNode.inProgressOutlineAnimation
    const controls = preset.control

    return createLixpiCanvasTheme(
        mergeCanvasTheme(
            createCanvasDefaultsFromPreset(preset),
            {
                shape: { mediaRadius: settings.mediaNode.styles.borderRadius },
                shadows: {
                    node: settings.mediaNode.styles.defaultBoxShadow,
                    selected: settings.mediaNode.styles.selectedBoxShadow,
                },
                selection: {
                    border: settings.selection.styles.marqueeBorderColor,
                    fill: settings.selection.styles.marqueeBackgroundColor,
                    overlayBorder: settings.selection.styles.overlayBorderColor,
                    overlayFill: settings.selection.styles.overlayBackgroundColor,
                },
                effects: {
                    glassBorder: settings.canvasChrome.glassBorder,
                    circularGlass: settings.mediaBranchLineage.mediaModelCircle.glass,
                    generationOutline: {
                        radius: outline.radius,
                        gap: outline.gap,
                        snakeHeadWidth: outline.snakeWidth,
                        snakeTailWidthFraction: outline.snakeTailWidthFraction,
                        snakeTailThinLengthFraction: outline.snakeTailThinLengthFraction,
                        snakeWidthTaperPower: outline.snakeWidthTaperPower,
                        snakeLengthFraction: outline.snakeLengthFraction,
                        snakeHeadRoundLengthFraction: outline.snakeHeadRoundLengthFraction,
                        durationMs: outline.animationDurationMs,
                        colors: outline.styles.snakeColors,
                        tailAlpha: outline.styles.snakeTailAlpha,
                        glassMaterial: outline.styles.glassMaterial,
                    },
                    loadingOutline: {
                        diameter: settings.workspaceLoadingOutline.diameter,
                        durationMs: settings.workspaceLoadingOutline.animationDurationMs,
                        snakeLengthFraction: settings.workspaceLoadingOutline.snakeLengthFraction,
                    },
                },
                properties: {
                    ...componentStyleProperties(preset),
                    '--canvas-lixpi-badge-provider': badge.modelBadgeProviderColor,
                    '--canvas-lixpi-badge-model': badge.modelBadgeModelColor,
                    '--canvas-lixpi-media-info': badge.infoButtonColor,
                    '--canvas-lixpi-media-info-hover': badge.infoButtonHoverColor,
                    '--canvas-lixpi-gradient-first': settings.gradient.styles.shiftingColors[0],
                    '--canvas-lixpi-gradient-second': settings.gradient.styles.shiftingColors[1],
                    '--canvas-lixpi-gradient-third': settings.gradient.styles.shiftingColors[2],
                    '--canvas-lixpi-gradient-fourth': settings.gradient.styles.shiftingColors[3],
                    '--canvas-lixpi-composer-radius': appearance.composer.workspace.workspaceCanvasGlobalComposer.base.borderRadius,
                    '--canvas-lixpi-rail-radius': appearance.composer.workspace.inputWrapper.base.borderRadius,
                    '--canvas-lixpi-prompt-radius': appearance.composer.input.inputFloating.base.borderRadius,
                    '--canvas-lixpi-prompt-inner-radius': appearance.composer.input.inputWrapper.base.borderRadius,
                    '--canvas-lixpi-prompt-background': appearance.composer.input.inputWrapper.base.background,
                    '--canvas-lixpi-prompt-shadow': appearance.composer.input.inputFloating.base.shadow,
                    '--canvas-lixpi-prompt-inner-shadow': appearance.composer.input.inputWrapper.base.shadow,
                    '--canvas-lixpi-prompt-text': appearance.composer.input.inputContent.base.foreground,
                    '--canvas-lixpi-prompt-placeholder': appearance.composer.input.inputContentUnderlay.base.foreground,
                    '--canvas-lixpi-prompt-line-height': appearance.composer.input.inputContent.base.lineHeight,
                    '--canvas-lixpi-switch-track': modeSwitch.trackBackgroundColor,
                    '--canvas-lixpi-switch-indicator': modeSwitch.indicatorBackgroundColor,
                    '--canvas-lixpi-switch-option': modeSwitch.unselectedOptionColor,
                    '--canvas-lixpi-switch-selected': modeSwitch.selectedOptionColor,
                    '--canvas-lixpi-switch-hover': modeSwitch.hoveredOptionColor,
                    '--canvas-lixpi-switch-surface': appearance.composer.controls.mediaModeSwitch.base.background,
                    '--canvas-lixpi-switch-radius': appearance.composer.controls.mediaModeSwitch.base.borderRadius,
                    '--canvas-lixpi-menu-trigger': menu.triggerColor,
                    '--canvas-lixpi-menu-trigger-active': menu.triggerActiveColor,
                    '--canvas-lixpi-menu-hover': menu.triggerActiveBackground,
                    '--canvas-lixpi-menu-background': menu.infoBubbleBackground,
                    '--canvas-lixpi-menu-shadow': menu.infoBubbleBoxShadow,
                    '--canvas-lixpi-menu-text': menu.infoBubbleColor,
                    '--canvas-lixpi-menu-divider': menu.sectionDividerGradient,
                    '--canvas-lixpi-menu-title': menu.sectionTitleColor,
                    '--canvas-lixpi-menu-title-size': appearance.composer.controls.modelMenuSectionTitle.base.fontSize,
                    '--canvas-lixpi-menu-label-size': menu.controlLabelFontSize,
                    '--canvas-lixpi-menu-label': menu.controlLabelColor,
                    '--canvas-lixpi-chat-border': settings.aiChatThread.styles.nodeBorder,
                    '--canvas-lixpi-chat-shadow': settings.aiChatThread.styles.nodeBoxShadow,
                    '--canvas-lixpi-chat-divider': settings.aiChatThread.styles.panelSectionDividerBorder,
                    '--canvas-lixpi-dropdown-font-size': preset.typography.control.fontSize,
                    '--canvas-lixpi-dropdown-track': controls.dropdown.background,
                    '--canvas-lixpi-dropdown-indicator': controls.dropdown.indicator,
                    '--canvas-lixpi-dropdown-option': controls.dropdown.inactive,
                    '--canvas-lixpi-dropdown-selected': controls.dropdown.selected,
                    '--canvas-lixpi-dropdown-disabled': controls.dropdown.disabled,
                    '--canvas-lixpi-navigation-backdrop': preset.navigation.sidebar.backdrop,
                    '--canvas-lixpi-navigation-backdrop-opaque': preset.navigation.sidebar.opaqueBackdrop,
                    '--canvas-panel-resize-handle-gradient': preset.panel.resizeHandle.gradient,
                    '--canvas-panel-resize-handle-width': preset.panel.resizeHandle.width,
                    '--canvas-panel-toggle-color': preset.panel.toggle.color,
                    '--canvas-panel-toggle-hover': preset.panel.toggle.hover,
                    '--canvas-lixpi-panel-backdrop': preset.panel.background,
                    '--canvas-lixpi-panel-backdrop-opaque': preset.panel.opaqueBackground,
                },
            },
        ),
    )
}

export const createLixpiCanvasThemeFromPreset = (preset: ApplicationTheme): CanvasTheme => {
    if (preset.name === lixpiLightTheme.name)
        return createLixpiLightCanvasTheme(preset)

    return createLixpiCanvasTheme(
        mergeCanvasTheme(
            createCanvasDefaultsFromPreset(preset),
            {
                connectors: {
                    styles: {
                        lineDefaultColor: 'var(--canvas-text-muted)',
                        lineFocusColor: 'var(--canvas-accent)',
                    },
                },
            },
        ),
    )
}

export const createLixpiCanvasThemeFromCss = (
    root: HTMLElement,
    options?: {
        inheritPageBackground?: boolean
    },
): CanvasTheme => {
    const theme = createCanvasThemeFromCss(root, options)

    if (theme.name === lixpiLightTheme.name)
        return mergeCanvasTheme(
            createLixpiLightCanvasTheme(),
            {
                colors: theme.colors,
                controls: theme.controls,
                typography: theme.typography,
            },
        )

    return createLixpiCanvasTheme(theme)
}
