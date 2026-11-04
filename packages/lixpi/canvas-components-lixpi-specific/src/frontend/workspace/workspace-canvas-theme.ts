import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'

type WorkspaceCanvasSettings = WorkspaceCanvasHost['settings']

export const getWorkspaceRightPanelCssProperties = (settings: WorkspaceCanvasSettings): Record<`--${string}`, string> => {
    const preview = settings.aiChatThread.contextPreview.styles

    return {
        '--ai-chat-thread-node-box-shadow': settings.aiChatThread.styles.nodeBoxShadow,
        '--ai-chat-thread-node-border': settings.aiChatThread.styles.nodeBorder,
        '--workspace-ai-chat-panel-divider-border': settings.aiChatThread.styles.panelSectionDividerBorder,
        '--workspace-ai-chat-panel-context-controls-color': preview.controlsColor,
        '--workspace-ai-chat-panel-context-chip-background': preview.chipBackground,
        '--context-preview-trigger-border-radius': preview.triggerBorderRadius,
        '--context-preview-border-radius': preview.previewBorderRadius,
        '--context-preview-tooltip-background': preview.tooltipBackground,
        '--context-preview-tooltip-border': preview.tooltipBorder,
        '--context-preview-tooltip-border-radius': preview.tooltipBorderRadius,
        '--context-preview-tooltip-box-shadow': preview.tooltipBoxShadow,
        '--context-preview-tooltip-color': preview.tooltipColor,
        '--context-preview-video-background': preview.videoBackground,
        '--context-preview-video-glyph-background': preview.videoGlyphBackground,
        '--context-preview-video-glyph-color': preview.videoGlyphColor,
        '--context-preview-document-color': preview.documentColor,
        '--context-preview-document-skeleton-line-border-radius': preview.documentSkeletonLineBorderRadius,
        '--context-preview-document-skeleton-line-background': preview.documentSkeletonLineBackground,
        '--context-preview-document-icon-color': preview.documentIconColor,
        '--context-preview-document-text-color': preview.documentTextColor,
        '--context-preview-popover-title-color': preview.popoverTitleColor,
        '--context-preview-popover-text-color': preview.popoverTextColor,
        '--workspace-ai-chat-panel-context-chip-remove-background': preview.removeButtonBackground,
        '--workspace-ai-chat-panel-context-chip-remove-color': preview.removeButtonColor,
        '--workspace-ai-chat-panel-context-chip-remove-box-shadow': preview.removeButtonBoxShadow,
    }
}
