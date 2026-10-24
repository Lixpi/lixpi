// The appearance a workspace host supplies to the Lixpi canvas package. The
// canvas presets come from createLixpiCanvasSettings and the shared constants;
// the panel, preview and composer values mirror the web-ui settings so the
// owners render the way they do in the workspace.

import { mediaGenerationLayoutSettings } from '@lixpi/constants'
import { createLixpiCanvasSettings } from '@lixpi/canvas-components-lixpi-specific/frontend/settings'
import {
    type WorkspaceCanvasAppearance,
    type WorkspaceCanvasChromeSettings,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import { createDefaultVideoControlsSettings } from '@lixpi/ui-kit/components/video-controls'
import { DEFAULT_SHIFTING_GRADIENT_COLORS } from '@lixpi/ui-primitives/gradients'

const RIGHT_PANEL_STYLES = {
    backdropFill: 'rgba(248, 250, 253, 0.84)',
    backdropFillOpaque: '#f8fafd',
    toggleColor: '#4b5563',
    toggleHoverColor: '#1f2937',
}

export const createWorkspaceAppearance = (): WorkspaceCanvasAppearance => ({
    ...createLixpiCanvasSettings(),
    aiChatThread: {
        contextPreview: {
            styles: {
                chipBackground: 'transparent',
                controlsColor: '#39455d',
                documentColor: '#243045',
                documentIconColor: '#697388',
                documentSkeletonLineBackground: 'rgba(105, 115, 136, 0.32)',
                documentSkeletonLineBorderRadius: '999px',
                documentTextColor: 'rgba(57, 69, 93, 0.76)',
                popoverTextColor: 'rgba(57, 69, 93, 0.82)',
                popoverTitleColor: '#1a3a47',
                previewBorderRadius: '6px',
                removeButtonBackground: '#fff',
                removeButtonBoxShadow: '0 0 4px rgba(0, 0, 0, 0.32)',
                removeButtonColor: '#39455d',
                tooltipBackground: '#fff',
                tooltipBorder: 'none',
                tooltipBorderRadius: '8px',
                tooltipBoxShadow: '0 16px 38px rgba(57, 69, 93, 0.18), 0 2px 8px rgba(57, 69, 93, 0.12)',
                tooltipColor: '#1a3a47',
                triggerBorderRadius: '6px',
                videoBackground: '#0f1721',
                videoGlyphBackground: 'rgba(255, 255, 255, 0.84)',
                videoGlyphColor: '#1a3a47',
            },
        },
        panelSwitch: {
            height: 28,
            transitionDistanceSpeedupFactor: 0.28,
            transitionDurationMs: 160,
            transitionMinDurationMs: 100,
        },
        styles: {
            nodeBorder: 'none',
            nodeBoxShadow: 'none',
            panelSectionDividerBorder: '1px solid rgba(26, 39, 68, 0.09)',
        },
    },
    aiPromptInput: { useShiftingGradientBackground: true },
    dropdown: { styles: { popoverBoxShadow: '0 2px 12px rgb(0 0 0 / 10%)' } },
    gradient: { styles: { shiftingColors: [...DEFAULT_SHIFTING_GRADIENT_COLORS] } },
    helpTooltip: { interactiveHideDelayMs: 80 },
    rightSidePanel: {
        animation: {
            closeEasing: 'cubic-bezier(0.64, 0, 0.78, 0)',
            durationMs: 100,
            openEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
        defaultDimensions: { width: 494 },
        dimensions: {
            maxPaneMargin: 64,
            minWidth: 320,
        },
        drag: {
            closeThreshold: 0.25,
            enabled: true,
            pointerSwipeStartThreshold: 2,
            touchSwipeStartThreshold: 10,
            velocityThreshold: 0.4,
        },
        layout: { contentInset: 10 },
        overlay: {
            closeOnPointerDown: true,
            enabled: false,
            fill: 'rgba(15, 23, 42, 0.18)',
            fillOpaque: 'rgba(15, 23, 42, 0.22)',
            opacity: 1,
        },
        resizeHandle: {
            grabWidth: 20,
            offset: 0,
            styles: {
                gradient: 'linear-gradient(135deg, #F5EFF9 0%, #E6E9F6 100%)',
                width: '3px',
            },
        },
        toggle: {
            closedAriaLabel: 'Open right side panel',
            closedTravel: 'calc(var(--workspace-right-side-panel-width) - 10px)',
            openAriaLabel: 'Collapse right side panel',
            openOffset: 'calc(var(--workspace-right-side-panel-width) + 5px)',
            size: '15px',
            top: '15px',
        },
    },
    videoControls: {
        ...createDefaultVideoControlsSettings(),
        canvas: {
            bottomInset: mediaGenerationLayoutSettings.generatedMediaChrome.videoControlsBottomInset,
            compactHorizontalInset: 0,
            compactWidthThreshold: 260,
            horizontalInset: 0,
            zoomScaling: { minZoom: 1.2 },
        },
        height: mediaGenerationLayoutSettings.generatedMediaChrome.videoControlsHeight,
    },
})

export const createWorkspaceChromeSettings = (appearance: WorkspaceCanvasAppearance): WorkspaceCanvasChromeSettings => ({
    modelMenuHoverBackground: '#eef0f4',
    palette: {
        nightBlue: '#42494f',
        offWhite: '#f5f3f3',
        steelBlue: '#5d656d',
    },
    panel: {
        defaultDimensions: appearance.rightSidePanel.defaultDimensions,
        dimensions: { maxPaneMargin: appearance.rightSidePanel.dimensions.maxPaneMargin },
        layout: appearance.rightSidePanel.layout,
        styles: RIGHT_PANEL_STYLES,
        typography: {
            contentFontSize: 14,
            tagPillFontSize: 12,
            tagPillFontWeight: 400,
        },
    },
})
