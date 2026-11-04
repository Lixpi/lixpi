import {
    type LixpiCanvasSettings,
} from './types.ts'

type WorkspaceCanvasThemeSettings = Pick<LixpiCanvasSettings, 'connector' | 'selection' | 'mediaNode' | 'mediaBranchLineage'>

export const applyWorkspaceCanvasTheme = (
    pane: HTMLElement,
    settings: WorkspaceCanvasThemeSettings,
): void => {
    const connector = settings.connector.styles
    const selection = settings.selection.styles
    const mediaNode = settings.mediaNode.styles
    const branchOrigin = settings.mediaBranchLineage.branchOrigin
    const modelCircle = settings.mediaBranchLineage.mediaModelCircle
    const markerText = settings.mediaBranchLineage.marker.text
    const properties: Record<`--${string}`, string> = {
        '--connector-line-default-color': connector.lineDefaultColor,
        '--connector-line-focus-color': connector.lineFocusColor,
        '--selection-marquee-border-color': selection.marqueeBorderColor,
        '--selection-marquee-background-color': selection.marqueeBackgroundColor,
        '--selection-overlay-border-color': selection.overlayBorderColor,
        '--selection-overlay-background-color': selection.overlayBackgroundColor,
        '--selection-outline-color': selection.outlineColor,
        '--workspace-media-node-default-box-shadow': mediaNode.defaultBoxShadow,
        '--workspace-media-node-selected-box-shadow': mediaNode.selectedBoxShadow,
        '--workspace-media-node-border-radius': `${mediaNode.borderRadius}px`,
        '--workspace-branch-origin-icon-size': `${branchOrigin.iconSize}px`,
        '--workspace-branch-origin-background-color': branchOrigin.styles.backgroundColor,
        '--workspace-branch-origin-border-color': branchOrigin.styles.borderColor,
        '--workspace-branch-origin-icon-color': branchOrigin.styles.iconColor,
        '--workspace-branch-origin-box-shadow': branchOrigin.styles.boxShadow,
        '--canvas-node-footer-separator-gradient': branchOrigin.styles.separatorGradient,
        '--workspace-branch-marker-media-model-circle-size': `${modelCircle.size}px`,
        '--workspace-branch-marker-media-model-icon-size': `${modelCircle.iconSize}px`,
        '--workspace-branch-marker-media-model-main-gap': `${modelCircle.mainGap}px`,
        '--workspace-branch-marker-media-model-stack-gap': `${modelCircle.stackGap}px`,
        '--workspace-branch-marker-media-model-icon-color': modelCircle.styles.iconColor,
        '--workspace-branch-marker-media-model-circle-background-color': modelCircle.styles.backgroundColor,
        '--workspace-branch-marker-media-model-circle-box-shadow': modelCircle.styles.boxShadow,
        '--workspace-branch-marker-media-model-texture-inset': `${modelCircle.texture.inset}px`,
        '--workspace-branch-marker-media-model-texture-opacity': `${modelCircle.texture.opacity}`,
        '--workspace-branch-marker-media-model-texture-background-size': `${modelCircle.texture.backgroundSizePercent}% ${modelCircle.texture.backgroundSizePercent}%`,
        '--workspace-branch-marker-message-font-size': `${markerText.messageFontSize}px`,
        '--workspace-branch-marker-message-line-height': `${markerText.messageLineHeight}`,
        '--workspace-branch-marker-response-font-size': `${markerText.responseFontSize}px`,
        '--workspace-branch-marker-response-line-height': `${markerText.responseLineHeight}`,
    }

    for (const [name, value] of Object.entries(properties))
        pane.style.setProperty(name, value)
}
