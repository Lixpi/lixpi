import type { WorkspaceEdgePathType } from '@lixpi/constants'

export const colorPalette = {
    nightBlue: '#42494f',
    steelBlue: '#5d656d',
    aiGreen: '#56967c',
    darkPastelGreen: '#55967c',
    lightGrey: '#aeaeae',
    offWhite: '#f5f3f3',
    offWhiteMuted: '#bfbfbf',
    claudeAi: '#D97757',
    gptBrandColor: '#5bbf97',
    googleGemini: '#4285F4',
    red: '#be4e1a',
    pink: '#ff8ea2',
    redPink: '#ec6079',
    darkAsphalt: '#42494f',
    darkAsphaltWet: '#5c656d',
    almostBlack: '#23292d',
    perfectLightGreen: '#d5e2cb',
    yetAnotherLightGreen: '#cedbb8',
    perfectLightBlue: 'linear-gradient(to right, #cfe8f473, #e6f0f8, #e5f1f9)',
    codeRed: '#db4545',
    codeRedHover: '#fce8e2',
    codeYellow: '#edde3f',
    codeYellowHover: '#faf6db',
    codeGreen: '#39aa56',
    codeGreenHover: '#deecdc',
    codeGrey: '#666666',
    codeGreyHover: '#f1f1f1',
}

// Keep legacy Sass variables in sync during the gradual migration.
// New configurable UI work should read colors from colorPalette in this file.

export type ModelSelectorDropdownSettings = {
    useModalityFilter: boolean
}

export type DropdownSettings = {
    popoverBoxShadow: string
}

export type GradientSettings = {
    shiftingColors: [string, string, string, string]
}

export type AiChatThreadRailSettings = {
    gradient: string
    width: string
    offset: number
    edgeMargin: number
    minSlideHeight: number
    boundaryCircleColors: [string, string, string]
    dragGrabWidth: number
}

export type AiChatThreadSettings = {
    responseMessageBubbleColor: string
    nodeBoxShadow: string
    nodeBorder: string
    showHeader: boolean
    useShiftingGradientBackground: boolean
    defaultDimensions: { width: number; height: number }
    adjacentNodeGap: number
    rail: AiChatThreadRailSettings
}

export type AiPromptInputModelMenuSettings = {
    openPromptZIndex: string
    infoBubbleZIndex: string
    triggerSize: string
    triggerIconSize: string
    triggerColor: string
    triggerActiveColor: string
    triggerActiveBackground: string
    triggerFocusOutline: string
    triggerFocusOutlineOffset: string
    triggerTransition: string
    infoBubbleWidth: string
    infoBubbleMaxWidth: string
    infoBubbleMobileMaxWidth: string
    infoBubblePadding: string
    infoBubbleBorderRadius: string
    infoBubbleBackground: string
    infoBubbleBoxShadow: string
    infoBubbleColor: string
    contentGap: string
    sectionGap: string
    sectionDividerPaddingTop: string
    sectionDividerWidth: string
    sectionDividerHeight: string
    sectionDividerGradient: string
    sectionDividerBorderRadius: string
    sectionHeadingGap: string
    sectionHeadingJustifyContent: string
    sectionTitleColor: string
    sectionTitleFontSize: string
    sectionTitleFontWeight: string
    sectionTitleLineHeight: string
    controlsGridTemplateColumns: string
    controlsMobileGridTemplateColumns: string
    controlsGap: string
    controlsMaxWidth: string
    controlsMobileMaxWidth: string
    controlGap: string
    controlLabelColor: string
    controlLabelInset: string
    controlLabelFontSize: string
    controlLabelFontWeight: string
    controlLabelLineHeight: string
    dropdownButtonMaxWidth: string
    dropdownButtonMobileMaxWidth: string
    nestedDropdownGap: string
    helpTooltipTriggerSize: string
    helpTooltipTriggerBorder: string
    helpTooltipTriggerBackground: string
    helpTooltipTriggerColor: string
    helpTooltipTriggerHoverBackground: string
    helpTooltipTriggerHoverColor: string
    helpTooltipIconSize: string
    helpTooltipTriggerFocusOutline: string
    helpTooltipTriggerFocusOutlineOffset: string
    helpTooltipOffset: string
    helpTooltipViewportMargin: string
    helpTooltipWidth: string
    helpTooltipMaxWidth: string
    helpTooltipPadding: string
    helpTooltipBackground: string
    helpTooltipBorder: string
    helpTooltipBorderRadius: string
    helpTooltipBoxShadow: string
    helpTooltipColor: string
    helpTooltipFontSize: string
    helpTooltipFontWeight: string
    helpTooltipLineHeight: string
    helpTooltipContentZIndex: string
}

export type AiPromptInputSettings = {
    useShiftingGradientBackground: boolean
    modelMenu: AiPromptInputModelMenuSettings
}

export type ConnectorSettings = {
    lineDefaultColor: string
    lineFocusColor: string
    lineCurve: WorkspaceEdgePathType
    lineClickAreaWidth: number
    useZoomCompensatedScaling: boolean
    proximityConnectThreshold: number
    menuConnectionSnapRadius: number
}

export type SelectionSettings = {
    marqueeBorderColor: string
    marqueeBackgroundColor: string
    overlayBorderColor: string
    overlayBackgroundColor: string
    outlineColor: string
}

export type ImageNodeSettings = {
    defaultBoxShadow: string
    selectedBoxShadow: string
    defaultInsertionWidth: number
    borderRadius: number
    generationBorder: {
        radius: number
        trackWidth: number
        trackColor: string
        trackAlpha: number
        snakeWidth: number
        snakeLengthFraction: number
        snakeTailAlpha: number
        snakeSegmentCount: number
        snakeColors: [string, string, string, string, string]
        animationDurationMs: number
    }
    modelBadgeBoxShadow: string
    useZoomCompensatedResizeHandleScaling: boolean
}

export type ImageBranchLineageSettings = {
    generatedImageSize: number
    rootOutputGap: number
    branchToBranchGap: number
    imageToImageGap: number
    branchFanoutDepthGap: number
}

export type MediaLibrarySettings = {
    panelWidthFraction: number
}

export type ContentDescriptorSettings = {
    editDebounceMs: number
    minTextLength: number
}

export type Settings = {
    modelSelectorDropdown: ModelSelectorDropdownSettings

    dropdown: DropdownSettings

    gradient: GradientSettings

    aiChatThread: AiChatThreadSettings

    aiPromptInput: AiPromptInputSettings

    connector: ConnectorSettings

    selection: SelectionSettings

    imageNode: ImageNodeSettings

    imageBranchLineage: ImageBranchLineageSettings

    mediaLibrary: MediaLibrarySettings

    contentDescriptor: ContentDescriptorSettings
}

export const settings: Settings = {
    // Model selector dropdown behavior settings.
    modelSelectorDropdown: {
        // Hide or reveal modality filter chips inside model selector dropdowns.
        useModalityFilter: false,
    },

    // Shared dropdown surface settings.
    dropdown: {
        // Shadow for dropdown popover menus. Increasing it raises menus visually from their backdrop.
        popoverBoxShadow: '0 2px 12px rgba(0, 0, 0, 0.1)',
    },

    // Shared generated-gradient settings.
    gradient: {
        // Colors used by shifting backgrounds and animated border overlays. Editing them changes the shared pastel palette.
        shiftingColors: ['#FFF5FA', '#F5EFF9', '#E6E9F6', '#F3E4F2'],
    },

    // AI chat thread presentation and interaction settings.
    aiChatThread: {
        // Background color for AI response message bubbles and their pigtail.
        responseMessageBubbleColor: '#f7f7fd',
        // Box shadow around the AI chat thread canvas node. Use `none` for a flat panel surface.
        nodeBoxShadow: 'none',
        // Border around the AI chat thread canvas node. Use `none` to remove the browser-default border.
        nodeBorder: 'none',
        // Hide or show the document title inside AI chat thread nodes on the workspace canvas.
        showHeader: false,
        // Enable the shifting gradient background on AI chat thread canvas nodes.
        useShiftingGradientBackground: false,
        // Default canvas-unit size for newly created AI chat thread nodes.
        defaultDimensions: { width: 640, height: 480 },
        // Canvas-unit gap when a new AI chat thread is placed next to a source media node.
        adjacentNodeGap: 50,

        // Vertical rail presentation and hit-target settings for AI chat threads.
        rail: {
            // Background gradient painted on the visible rail line.
            gradient: 'linear-gradient(135deg, #F5EFF9 0%, #E6E9F6 100%)',
            // Visible line width; this does not change the draggable hit target.
            width: '3px',
            // Horizontal offset in pixels from the thread node's left edge.
            offset: -2,
            // Fractional top and bottom margin where connector anchors stop sliding along the rail.
            edgeMargin: 0.065,
            // Minimum rail height in pixels before connectors can slide away from the center.
            minSlideHeight: 120,
            // Colors for the boundary circle's outer fill, ring, and inner fill.
            boundaryCircleColors: ['#F3E4F2', '#C5C0EE', 'rgb(202, 180, 201)'],
            // Screen-pixel width of the invisible rail drag hit target. Lower values require a more precise grab.
            dragGrabWidth: 20,
        },
    },

    // Floating AI prompt input settings.
    aiPromptInput: {
        // Enable the shifting gradient background on floating prompt input nodes.
        useShiftingGradientBackground: true,
        // Model settings menu presentation. The infoBubble shadow is configured separately from dropdown popovers.
        modelMenu: {
            openPromptZIndex: '10000',
            infoBubbleZIndex: '10080',
            triggerSize: '32px',
            triggerIconSize: '18px',
            triggerColor: colorPalette.steelBlue,
            triggerActiveColor: colorPalette.nightBlue,
            triggerActiveBackground: '#eef0f4',
            triggerFocusOutline: '2px solid #b8bec8',
            triggerFocusOutlineOffset: '2px',
            triggerTransition: 'background 150ms ease, color 150ms ease',
            infoBubbleWidth: 'max-content',
            infoBubbleMaxWidth: 'min(640px, calc(100vw - 20px))',
            infoBubbleMobileMaxWidth: 'calc(100vw - 16px)',
            infoBubblePadding: '12px 14px',
            infoBubbleBorderRadius: '12px',
            infoBubbleBackground: '#fff',
            infoBubbleBoxShadow: '0 14px 32px rgba(66, 73, 79, 0.12), 0 2px 10px rgba(66, 73, 79, 0.08), inset 0 0 1px 1px rgba(66, 73, 79, 0.2)',
            infoBubbleColor: colorPalette.nightBlue,
            contentGap: '12px',
            sectionGap: '8px',
            sectionDividerPaddingTop: '14px',
            sectionDividerWidth: '92%',
            sectionDividerHeight: '2px',
            sectionDividerGradient: 'linear-gradient(90deg, #fff 0%, #F7F7FD 10%, #F3E4F2 26%, #C5C0EE 50%, #E6E9F6 74%, #F7F7FD 90%, #fff 100%)',
            sectionDividerBorderRadius: '999px',
            sectionHeadingGap: '6px',
            sectionHeadingJustifyContent: 'space-between',
            sectionTitleColor: '#59626b',
            sectionTitleFontSize: '13px',
            sectionTitleFontWeight: '700',
            sectionTitleLineHeight: '1.2',
            controlsGridTemplateColumns: 'repeat(4, max-content)',
            controlsMobileGridTemplateColumns: 'repeat(2, max-content)',
            controlsGap: '8px',
            controlsMaxWidth: 'min(612px, calc(100vw - 48px))',
            controlsMobileMaxWidth: 'calc(100vw - 36px)',
            controlGap: '3px',
            controlLabelColor: '#9299a1',
            controlLabelInset: '7px',
            controlLabelFontSize: '10px',
            controlLabelFontWeight: '600',
            controlLabelLineHeight: '1.2',
            dropdownButtonMaxWidth: '190px',
            dropdownButtonMobileMaxWidth: '150px',
            nestedDropdownGap: '8px',
            helpTooltipTriggerSize: '14px',
            helpTooltipTriggerBorder: 'none',
            helpTooltipTriggerBackground: 'transparent',
            helpTooltipTriggerColor: '#8d949d',
            helpTooltipTriggerHoverBackground: 'transparent',
            helpTooltipTriggerHoverColor: '#59626b',
            helpTooltipIconSize: '12px',
            helpTooltipTriggerFocusOutline: '2px solid #b8bec8',
            helpTooltipTriggerFocusOutlineOffset: '2px',
            helpTooltipOffset: '8px',
            helpTooltipViewportMargin: '8px',
            helpTooltipWidth: '240px',
            helpTooltipMaxWidth: 'min(260px, calc(100vw - 48px))',
            helpTooltipPadding: '8px 10px',
            helpTooltipBackground: colorPalette.steelBlue,
            helpTooltipBorder: 'none',
            helpTooltipBorderRadius: '8px',
            // Outer shadow value intentionally duplicates dropdown.popoverBoxShadow; keep this setting separate.
            helpTooltipBoxShadow: `0 2px 12px rgba(0, 0, 0, 0.1), 0 10px 26px rgba(35, 41, 45, 0.22), inset 0 0 1px 1px rgba(0, 0, 0, 0.1)`,
            helpTooltipColor: colorPalette.offWhite,
            helpTooltipFontSize: '11px',
            helpTooltipFontWeight: '500',
            helpTooltipLineHeight: '1.35',
            helpTooltipContentZIndex: '10120',
        },
    },

    // Canvas edge and node-connection interaction settings.
    connector: {
        // Default color for connector lines between nodes.
        lineDefaultColor: colorPalette.steelBlue,
        // Focus and selection color for connector lines.
        lineFocusColor: '#000',
        // Default curve used for connector lines between nodes.
        lineCurve: 'horizontal-bezier',
        // Screen-pixel width of the invisible selection hit area around connector lines.
        lineClickAreaWidth: 24,
        // Keep connector stroke, marker, and hit-area sizes usable as the canvas zoom changes.
        useZoomCompensatedScaling: true,
        // Renderer-coordinate distance at which dragging a node near a thread shows a proximity connection.
        proximityConnectThreshold: 700,
        // Renderer-coordinate distance at which menu-driven connection placement snaps to a target.
        menuConnectionSnapRadius: 110,
    },

    // Canvas selection overlay settings.
    selection: {
        // Border color for the drag-to-select marquee rectangle.
        marqueeBorderColor: 'rgba(176, 173, 224, 0.88)',
        // Fill color for the drag-to-select marquee rectangle.
        marqueeBackgroundColor: 'rgba(230, 233, 246, 0.38)',
        // Border color for the persistent multi-selection overlay.
        overlayBorderColor: 'rgba(197, 192, 238, 0.62)',
        // Fill color for the persistent multi-selection overlay.
        overlayBackgroundColor: 'rgba(230, 233, 246, 0.42)',
        // Outline color for a selected thread's floating prompt input.
        outlineColor: 'rgba(197, 192, 238, 0.75)',
    },

    // Canvas image node settings. These values style image-node chrome and selection states.
    imageNode: {
        // Box shadow applied to image nodes in their default state. Keep this subtler than the selected shadow so selection remains the stronger visual state.
        defaultBoxShadow: '0 1px 6px rgba(0, 0, 0, 0.15)',
        // Box shadow applied when an image node is selected. Increasing this makes selected images read as more prominent on the canvas.
        selectedBoxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
        // Canvas-unit width for manually inserted image nodes. Height is derived from the image aspect ratio; failed dimension probes use this as a square fallback.
        defaultInsertionWidth: 600,
        // Canvas-unit corner radius for image pixels on the workspace canvas. Increasing it rounds PIXI-rendered image pixels more strongly.
        borderRadius: 8,

        // PIXI-rendered animated outline shown only while an AI-generated image is receiving partials.
        generationBorder: {
            radius: 10,
            trackWidth: 3,
            trackColor: '#D0D6E1',
            trackAlpha: 0.72,
            snakeWidth: 4,
            snakeLengthFraction: 0.24,
            snakeTailAlpha: 0.25,
            snakeSegmentCount: 72,
            snakeColors: ['#1D57CB', '#2474FF', '#7C4DFF', '#D63FF0', '#FF9933'],
            animationDurationMs: 3200,
        },

        // Shadow behind the generated-image model badge. Increasing it improves badge separation on busy image pixels.
        modelBadgeBoxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
        // Keep resize corner handles at a stable apparent size as the canvas zoom changes.
        useZoomCompensatedResizeHandleScaling: true,
    },

    // Media Library panel layout settings.
    mediaLibrary: {
        // Fraction of the canvas space remaining after any open AI chat panel is reserved.
        panelWidthFraction: 2 / 3,
    },

    // Image branch lineage placement settings. These values control where newly generated image nodes appear in relation to their chat root and previous branch images.
    imageBranchLineage: {
        // Canvas-unit width and height for new generated image nodes. Increasing it makes each generated branch image larger when inserted.
        generatedImageSize: 800,
        // Canvas-unit horizontal gap between a chat root and the first generated image in that branch. Increasing it moves first outputs farther right.
        rootOutputGap: 384,
        // Canvas-unit vertical gap between separate branch rows spawned from the same chat root. Increasing it moves new branches farther below the previous branch.
        branchToBranchGap: 160,
        // Canvas-unit base horizontal gap between consecutive generated images in the same branch lineage. Increasing it stretches every image-to-image branch step.
        imageToImageGap: 512,
        // Canvas-unit extra horizontal gap added for each child after the first when a generated-media node forks. Increasing it gives large branch fans more curve room.
        branchFanoutDepthGap: 96,
    },

    // Document / chat-thread descriptor generation (the text "meta" the workspace relevance engine ranks on).
    contentDescriptor: {
        // Quiet period (ms) after the last edit before a text node's descriptor is regenerated. Increasing it batches more typing into one describe call; decreasing it refreshes the descriptor sooner.
        editDebounceMs: 2500,
        // Minimum trimmed plain-text length before a document/thread is worth describing. Below this we skip the model call (nothing meaningful to summarize).
        minTextLength: 16,
    },
}
