import type { WorkspaceEdgePathType } from '@lixpi/constants'

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

export type AiPromptInputSettings = {
    useShiftingGradientBackground: boolean
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

const brandColors = {
    steelBlue: '#5d656d'
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
    },

    // Canvas edge and node-connection interaction settings.
    connector: {
        // Default color for connector lines between nodes.
        lineDefaultColor: brandColors.steelBlue,
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
        // Canvas-unit horizontal gap between consecutive generated images in the same branch lineage. Increasing it stretches image-to-image branch spacing.
        imageToImageGap: 192,
    },

    // Document / chat-thread descriptor generation (the text "meta" the workspace relevance engine ranks on).
    contentDescriptor: {
        // Quiet period (ms) after the last edit before a text node's descriptor is regenerated. Increasing it batches more typing into one describe call; decreasing it refreshes the descriptor sooner.
        editDebounceMs: 2500,
        // Minimum trimmed plain-text length before a document/thread is worth describing. Below this we skip the model call (nothing meaningful to summarize).
        minTextLength: 16,
    },
}
