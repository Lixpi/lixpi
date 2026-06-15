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
    styles: {
        popoverBoxShadow: string
    }
}

export type GradientSettings = {
    styles: {
        shiftingColors: [string, string, string, string]
    }
}

export type HelpTooltipSettings = {
    interactiveHideDelayMs: number
}

export type BoundedZoomScalingSettings = {
    // Lower zoom breakpoint where inverse world-size compensation stops.
    minZoom: number
    // Optional perceptual low-zoom curve power. Runtime call sites can add a
    // default, currently 0.45 for canvas chrome, when they need adaptive shrink
    // instead of plain bounded constant size.
    lowZoomPower?: number
}

export type CanvasBubbleMenuSettings = {
    zoomScaling: BoundedZoomScalingSettings
}

export type AiChatThreadRailSettings = {
    offset: number
    edgeMargin: number
    minSlideHeight: number
    dragGrabWidth: number
    styles: {
        gradient: string
        width: string
        boundaryCircleColors: [string, string, string]
    }
}

export type AiChatThreadPanelTabsSettings = {
    minTabWidth: number
    height: number
    transitionDurationMs: number
    transitionMinDurationMs: number
    transitionDistanceSpeedupFactor: number
    styles: {
        activeTabBoxShadow: string
        activeTabInsetShadow: {
            topColor: string
            bottomColor: string
        }
    }
}

export type AiChatThreadSessionHistorySettings = {
    styles: {
        controlColor: string
        controlHoverColor: string
        historyToggleHoverBackground: string
        actionHoverBackground: string
        actionHoverColor: string
        deleteColor: string
        hoverBackgroundImage: string
        threadMarkerBackground: string
        threadMarkerBoxShadow: string
    }
}

export type AiChatThreadContextPreviewSettings = {
    styles: {
        controlsColor: string
        chipBackground: string
        triggerBorderRadius: string
        previewBorderRadius: string
        tooltipBackground: string
        tooltipBorder: string
        tooltipBorderRadius: string
        tooltipBoxShadow: string
        tooltipColor: string
        videoBackground: string
        videoGlyphBackground: string
        videoGlyphColor: string
        documentColor: string
        documentSkeletonLineBorderRadius: string
        documentSkeletonLineBackground: string
        documentIconColor: string
        documentTextColor: string
        popoverTitleColor: string
        popoverTextColor: string
        removeButtonBackground: string
        removeButtonColor: string
        removeButtonBoxShadow: string
    }
}

export type AiChatThreadSettings = {
    showHeader: boolean
    useShiftingGradientBackground: boolean
    defaultDimensions: { width: number; height: number }
    adjacentNodeGap: number
    panelTabs: AiChatThreadPanelTabsSettings
    sessionHistory: AiChatThreadSessionHistorySettings
    contextPreview: AiChatThreadContextPreviewSettings
    rail: AiChatThreadRailSettings
    styles: {
        responseMessageBubbleColor: string
        nodeBoxShadow: string
        nodeBorder: string
        panelSectionDividerBorder: string
    }
}

export type AiPromptInputModelMenuSettings = {
    styles: {
        triggerColor: string
        triggerActiveColor: string
        triggerActiveBackground: string
        triggerFocusOutline: string
        infoBubbleWidth: string
        infoBubbleBorderRadius: string
        infoBubbleBackground: string
        infoBubbleBoxShadow: string
        infoBubbleColor: string
        sectionDividerGradient: string
        sectionDividerHeight: string
        sectionDividerBorderRadius: string
        sectionTitleColor: string
        controlLabelColor: string
        selectedModelTagTextColor: string
        selectedModelTagIconColor: string
        helpTooltipTriggerBorder: string
        helpTooltipTriggerBackground: string
        helpTooltipTriggerColor: string
        helpTooltipTriggerHoverBackground: string
        helpTooltipTriggerHoverColor: string
        helpTooltipTriggerFocusOutline: string
        helpTooltipBackground: string
        helpTooltipBorder: string
        helpTooltipBorderRadius: string
        helpTooltipBoxShadow: string
        helpTooltipColor: string
    }
}

export type AiPromptInputSettings = {
    useShiftingGradientBackground: boolean
    modelMenu: AiPromptInputModelMenuSettings
}

export type ConnectorSettings = {
    lineCurve: WorkspaceEdgePathType
    useZoomCompensatedScaling: boolean
    scaling: {
        strokeWidth: number
        markerSize: number
        markerOffset: { source: number; target: number }
        clickAreaWidth: number
        zoomScaling: BoundedZoomScalingSettings
    }
    proximityConnectThreshold: number
    menuConnectionSnapRadius: number
    styles: {
        lineDefaultColor: string
        lineFocusColor: string
    }
}

export type SelectionSettings = {
    styles: {
        marqueeBorderColor: string
        marqueeBackgroundColor: string
        overlayBorderColor: string
        overlayBackgroundColor: string
        outlineColor: string
    }
}

export type MediaNodeSettings = {
    // Shared across all media types (image, video, …).
    generatedMediaChrome: {
        iconSize: number
        topGap: number
        zoomScaling: BoundedZoomScalingSettings
    }
    useZoomCompensatedResizeHandleScaling: boolean
    resizeHandle: {
        size: number
        offset: number
        minSize: number
        zoomScaling: BoundedZoomScalingSettings
    }
    generationBorder: {
        radius: number
        trackWidth: number
        snakeWidth: number
        snakeLengthFraction: number
        snakeSegmentCount: number
        animationDurationMs: number
        styles: {
            trackColor: string
            trackAlpha: number
            snakeTailAlpha: number
            snakeColors: [string, string, string, string, string]
        }
    }
    // Image-specific.
    image: {
        defaultInsertionWidth: number
        styles: {
            defaultBoxShadow: string
            selectedBoxShadow: string
            borderRadius: number
        }
    }
}

export type ImageBranchLineageSettings = {
    generatedImageSize: number
    rootOutputGap: number
    branchToBranchGap: number
    imageToImageGap: number
    branchFanoutDepthGap: number
    branchOrigin: {
        size: number
        iconSize: number
        styles: {
            backgroundColor: string
            borderColor: string
            iconColor: string
            boxShadow: string
        }
    }
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

    helpTooltip: HelpTooltipSettings

    canvasBubbleMenu: CanvasBubbleMenuSettings

    aiChatThread: AiChatThreadSettings

    aiPromptInput: AiPromptInputSettings

    connector: ConnectorSettings

    selection: SelectionSettings

    mediaNode: MediaNodeSettings

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
        styles: {
            // Shadow for dropdown popover menus. Increasing it raises menus visually from their backdrop.
            popoverBoxShadow: '0 2px 12px rgba(0, 0, 0, 0.1)',
        },
    },

    // Shared generated-gradient settings.
    gradient: {
        styles: {
            // Colors used by shifting backgrounds and animated border overlays. Editing them changes the shared pastel palette.
            shiftingColors: ['#FFF5FA', '#F5EFF9', '#E6E9F6', '#F3E4F2'],
        },
    },

    // Shared TypeScript-html tooltip settings.
    helpTooltip: {
        // Delay before an interactive tooltip closes after the pointer leaves its trigger/content.
        interactiveHideDelayMs: 80,
    },

    // Canvas bubble menu zoom scaling settings.
    canvasBubbleMenu: {
        // Lower zoom breakpoint for canvas bubble-menu chrome. Runtime call sites
        // opt this config into the shared adaptive low-zoom curve, which defaults
        // to 0.45 unless this object provides `lowZoomPower`.
        zoomScaling: { minZoom: 0.4 },
    },

    // AI chat thread presentation and interaction settings.
    aiChatThread: {
        // Hide or show the document title inside AI chat thread nodes on the workspace canvas.
        showHeader: false,
        // Enable the shifting gradient background on AI chat thread canvas nodes.
        useShiftingGradientBackground: false,
        // Default canvas-unit size for newly created AI chat thread nodes.
        defaultDimensions: { width: 640, height: 480 },
        // Canvas-unit gap when a new AI chat thread is placed next to a source media node.
        adjacentNodeGap: 50,

        // AI Chat panel tab switch geometry.
        panelTabs: {
            // Minimum screen-pixel width for each tab before the tab strip scrolls horizontally.
            minTabWidth: 96,
            // Screen-pixel height for the AI Chat panel tab switch.
            height: 28,
            // Base active-tab slide duration.
            transitionDurationMs: 160,
            // Lower bound when jumping across distant tabs.
            transitionMinDurationMs: 100,
            // Per-tab distance speedup. Higher values compress long jumps more.
            transitionDistanceSpeedupFactor: 0.28,
            styles: {
                // Active tab outer shadow. Keep this setting isolated from dropdown shadows.
                activeTabBoxShadow: 'none',
                // Active tab inset shadow overlay. Keep this setting isolated from dropdown shadows.
                activeTabInsetShadow: {
                    topColor: 'rgba(255, 255, 255, 0.86)',
                    bottomColor: 'rgba(0, 0, 0, 0)',
                },
            },
        },

        // AI Chat panel session history presentation.
        sessionHistory: {
            styles: {
                // Default color for panel session controls.
                controlColor: '#697388',
                // Hover/focus color for panel session controls.
                controlHoverColor: '#39455d',
                // Hover/focus background for the session-history toggle.
                historyToggleHoverBackground: 'rgba(105, 115, 136, 0.1)',
                // Shared prominent hover background for destructive session actions.
                actionHoverBackground: colorPalette.steelBlue,
                // Shared prominent hover fill/color for destructive session action icons.
                actionHoverColor: colorPalette.offWhite,
                // Default color for session delete controls.
                deleteColor: '#7a8497',
                // Hover/focus gradient for session rows. Uses the dropdown hover structure with light blue stops.
                hoverBackgroundImage: 'linear-gradient(135deg, #e8f2ff 0%, #eaf1ff 100%)',
                // Dot color for submitted chat sessions in the history list.
                threadMarkerBackground: '#5f8fcf',
                // Ring around the submitted chat session dot.
                threadMarkerBoxShadow: '0 0 0 3px rgba(95, 143, 207, 0.14)',
            },
        },

        // AI Chat panel composer context-preview tray and popover presentation.
        contextPreview: {
            styles: {
                // Color for the top context controls row.
                controlsColor: '#39455d',
                // Background for compact context preview chip surfaces.
                chipBackground: 'transparent',
                // Radius for context preview triggers.
                triggerBorderRadius: '6px',
                // Radius for context preview media/document surfaces.
                previewBorderRadius: '6px',
                // Context preview popover surface.
                tooltipBackground: '#fff',
                tooltipBorder: 'none',
                tooltipBorderRadius: '8px',
                tooltipBoxShadow: '0 16px 38px rgba(57, 69, 93, 0.18), 0 2px 8px rgba(57, 69, 93, 0.12)',
                tooltipColor: '#1a3a47',
                // Video preview colors.
                videoBackground: '#0f1721',
                videoGlyphBackground: 'rgba(255, 255, 255, 0.84)',
                videoGlyphColor: '#1a3a47',
                // Document/thread preview colors and skeleton styling.
                documentColor: '#243045',
                documentSkeletonLineBorderRadius: '999px',
                documentSkeletonLineBackground: 'rgba(105, 115, 136, 0.32)',
                documentIconColor: '#697388',
                documentTextColor: 'rgba(57, 69, 93, 0.76)',
                // Popover metadata colors.
                popoverTitleColor: '#1a3a47',
                popoverTextColor: 'rgba(57, 69, 93, 0.82)',
                // Remove-context button presentation.
                removeButtonBackground: '#fff',
                removeButtonColor: '#39455d',
                removeButtonBoxShadow: '0 0 4px rgba(0, 0, 0, 0.32)',
            },
        },

        // Vertical rail presentation and hit-target settings for AI chat threads.
        rail: {
            // Horizontal offset in pixels from the thread node's left edge.
            offset: -2,
            // Fractional top and bottom margin where connector anchors stop sliding along the rail.
            edgeMargin: 0.065,
            // Minimum rail height in pixels before connectors can slide away from the center.
            minSlideHeight: 120,
            // Screen-pixel width of the invisible rail drag hit target. Lower values require a more precise grab.
            dragGrabWidth: 20,
            styles: {
                // Background gradient painted on the visible rail line.
                gradient: 'linear-gradient(135deg, #F5EFF9 0%, #E6E9F6 100%)',
                // Visible line width; this does not change the draggable hit target.
                width: '3px',
                // Colors for the boundary circle's outer fill, ring, and inner fill.
                boundaryCircleColors: ['#F3E4F2', '#C5C0EE', 'rgb(202, 180, 201)'],
            },
        },

        styles: {
            // Background color for AI response message bubbles and their pigtail.
            responseMessageBubbleColor: '#f7f7fd',
            // Box shadow around the AI chat thread canvas node. Use `none` for a flat panel surface.
            nodeBoxShadow: 'none',
            // Border around the AI chat thread canvas node. Use `none` to remove the browser-default border.
            nodeBorder: 'none',
            // Border used by AI Chat panel section dividers.
            panelSectionDividerBorder: '1px solid rgba(26, 39, 68, 0.09)',
        },
    },

    // Floating AI prompt input settings.
    aiPromptInput: {
        // Enable the shifting gradient background on floating prompt input nodes.
        useShiftingGradientBackground: true,
        // Model settings menu presentation. The infoBubble shadow is configured separately from dropdown popovers.
        modelMenu: {
            styles: {
                triggerColor: colorPalette.steelBlue,
                triggerActiveColor: colorPalette.nightBlue,
                triggerActiveBackground: '#eef0f4',
                triggerFocusOutline: '2px solid #b8bec8',
                infoBubbleWidth: '410px',
                infoBubbleBorderRadius: '12px',
                infoBubbleBackground: '#fff',
                infoBubbleBoxShadow: '0 14px 32px rgba(66, 73, 79, 0.12), 0 2px 10px rgba(66, 73, 79, 0.08), inset 0 0 1px 1px rgba(66, 73, 79, 0.2)',
                infoBubbleColor: colorPalette.nightBlue,
                sectionDividerGradient: 'linear-gradient(90deg, #fff 0%, #F7F7FD 10%, #F3E4F2 26%, #C5C0EE 50%, #E6E9F6 74%, #F7F7FD 90%, #fff 100%)',
                sectionDividerHeight: '2px',
                sectionDividerBorderRadius: '999px',
                sectionTitleColor: '#59626b',
                controlLabelColor: '#9299a1',
                // Text and icon share one color, matching the dropdown value text (the menu panel foreground).
                selectedModelTagTextColor: colorPalette.nightBlue,
                selectedModelTagIconColor: colorPalette.nightBlue,
                helpTooltipTriggerBorder: 'none',
                helpTooltipTriggerBackground: 'transparent',
                helpTooltipTriggerColor: '#8d949d',
                helpTooltipTriggerHoverBackground: 'transparent',
                helpTooltipTriggerHoverColor: '#59626b',
                helpTooltipTriggerFocusOutline: '2px solid #b8bec8',
                helpTooltipBackground: colorPalette.steelBlue,
                helpTooltipBorder: 'none',
                helpTooltipBorderRadius: '8px',
                // Outer shadow value intentionally duplicates dropdown.popoverBoxShadow; keep this setting separate.
                helpTooltipBoxShadow: `0 2px 12px rgba(0, 0, 0, 0.1), 0 10px 26px rgba(35, 41, 45, 0.22), inset 0 0 1px 1px rgba(0, 0, 0, 0.1)`,
                helpTooltipColor: colorPalette.offWhite,
            },
        },
    },

    // Canvas edge and node-connection interaction settings.
    connector: {
        // Default curve used for connector lines between nodes.
        lineCurve: 'horizontal-bezier',
        // Keep connector stroke, marker, and hit-area sizes usable as the canvas zoom changes.
        useZoomCompensatedScaling: true,
        // Connector screen-space base sizes and zoom breakpoint.
        scaling: {
            // Base screen-pixel connector stroke width at 100% and higher zoom.
            strokeWidth: 2,
            // Base screen-pixel arrowhead size at 100% and higher zoom.
            markerSize: 16,
            // Base screen-pixel source/target marker offsets at 100% and higher zoom.
            markerOffset: { source: 6, target: 19 },
            // Screen-pixel width of the invisible selection hit area around connector lines.
            clickAreaWidth: 24,
            // Lower zoom breakpoint for connector chrome. Runtime call sites opt
            // this config into the shared adaptive low-zoom curve, which defaults
            // to 0.45 unless this object provides `lowZoomPower`.
            zoomScaling: { minZoom: 0.4 },
        },
        // Renderer-coordinate distance at which dragging a node near a thread shows a proximity connection.
        proximityConnectThreshold: 700,
        // Renderer-coordinate distance at which menu-driven connection placement snaps to a target.
        menuConnectionSnapRadius: 110,
        styles: {
            // Default color for connector lines between nodes.
            lineDefaultColor: colorPalette.steelBlue,
            // Focus and selection color for connector lines.
            lineFocusColor: '#000',
        },
    },

    // Canvas selection overlay settings.
    selection: {
        styles: {
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
    },

    // Canvas media node settings. Shared values style the chrome, resize handles, generation outline, and selection states common to every media node (image, video, …); per-type subcategories hold values specific to one media type.
    mediaNode: {
        // ── Shared across all media types (image, video, …) ──

        // Provenance/descriptor icon strip below a media node. The strip is screen-space chrome projected from media node bounds and uses bounded zoom compensation; the expandable info panel is rendered separately and does not inherit this transform.
        generatedMediaChrome: {
            // Base screen-pixel icon/button size at 100% and higher zoom.
            iconSize: 34,
            // Base screen-pixel gap at 100% and higher zoom between the media node's bottom edge and the chrome strip.
            topGap: 6,
            // Lower zoom breakpoint for generated-media icon chrome. Runtime call
            // sites opt this config into the shared adaptive low-zoom curve,
            // which defaults to 0.45 unless this object provides `lowZoomPower`.
            zoomScaling: { minZoom: 0.4 },
        },

        // Keep resize corner handles at a stable apparent size as the canvas zoom changes.
        useZoomCompensatedResizeHandleScaling: true,
        // Resize-handle base sizes and zoom breakpoint, shared by image and video resize.
        resizeHandle: {
            // Base screen-pixel size of each resize handle at 100% and higher zoom.
            size: 24,
            // Base screen-pixel offset from the node corner at 100% and higher zoom.
            offset: 6,
            // Minimum handle size in canvas units after zoom compensation.
            minSize: 10,
            // Lower zoom breakpoint for resize handles. Runtime call sites opt
            // this config into the shared adaptive low-zoom curve, which defaults
            // to 0.45 unless this object provides `lowZoomPower`.
            zoomScaling: { minZoom: 0.4 },
        },

        // PIXI-rendered animated outline shown while AI-generated media (image or video) is receiving partials.
        generationBorder: {
            radius: 10,
            trackWidth: 3,
            snakeWidth: 4,
            snakeLengthFraction: 0.24,
            snakeSegmentCount: 72,
            animationDurationMs: 3200,
            styles: {
                trackColor: '#D0D6E1',
                trackAlpha: 0.72,
                snakeTailAlpha: 0.25,
                snakeColors: ['#1D57CB', '#2474FF', '#7C4DFF', '#D63FF0', '#FF9933'],
            },
        },

        // ── Image-specific ──
        image: {
            // Canvas-unit width for manually inserted image nodes. Height is derived from the image aspect ratio; failed dimension probes use this as a square fallback.
            defaultInsertionWidth: 600,
            styles: {
                // Box shadow applied to image nodes in their default state. Keep this subtler than the selected shadow so selection remains the stronger visual state.
                defaultBoxShadow: '0 1px 6px rgba(0, 0, 0, 0.15)',
                // Box shadow applied when an image node is selected. Increasing this makes selected images read as more prominent on the canvas.
                selectedBoxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
                // Canvas-unit corner radius for image pixels on the workspace canvas. Increasing it rounds PIXI-rendered image pixels more strongly.
                borderRadius: 8,
            },
        },
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
        // Temporary root marker used when a fresh multi-model branch has no real source node.
        branchOrigin: {
            // Canvas-unit diameter of the branch-origin circle.
            size: 96,
            // Canvas-unit size for the centered branch icon.
            iconSize: 52,
            styles: {
                backgroundColor: colorPalette.steelBlue,
                borderColor: colorPalette.steelBlue,
                iconColor: colorPalette.offWhite,
                boxShadow: '0 8px 24px rgba(42, 48, 57, 0.22)',
            },
        },
    },

    // Document / chat-thread descriptor generation (the text "meta" the workspace relevance engine ranks on).
    contentDescriptor: {
        // Quiet period (ms) after the last edit before a text node's descriptor is regenerated. Increasing it batches more typing into one describe call; decreasing it refreshes the descriptor sooner.
        editDebounceMs: 2500,
        // Minimum trimmed plain-text length before a document/thread is worth describing. Below this we skip the model call (nothing meaningful to summarize).
        minTextLength: 16,
    },
}
