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
    errorState: {
        fallbackTitle: string
        textColor: string
    }
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

export type GenerationBorderGlassMaterialSettings = {
    shadowColor: string
    tailOpacityPower: number
    tailFadeFraction: number
    minTailOpacity: number
    edgeFeatherFraction: number
    edgeFeatherPower: number
    lensCorePower: number
    upperSpecularCenter: number
    upperSpecularDrift: number
    upperSpecularWidth: number
    upperSpecularFadeStart: number
    upperSpecularFadeEnd: number
    upperSpecularStrength: number
    headSpecularProgressCenter: number
    headSpecularProgressWidth: number
    headSpecularCrossSectionCenter: number
    headSpecularCrossSectionWidth: number
    headSpecularStrength: number
    lowerEdgeShadowCenter: number
    lowerEdgeShadowWidth: number
    lowerEdgeShadowStrength: number
    upperEdgeShadowCenter: number
    upperEdgeShadowWidth: number
    upperEdgeShadowStrength: number
    edgeShadowPower: number
    edgeShadowStrength: number
    lensHighlightStrength: number
    highlightWhiteMixMax: number
    shadowMixMax: number
    materialAlphaBase: number
    materialAlphaMax: number
    lensAlphaStrength: number
    upperSpecularAlphaStrength: number
    headSpecularAlphaStrength: number
}

export type MediaNodeSettings = {
    // Shared across all media types (image, video, …).
    styles: {
        defaultBoxShadow: string
        selectedBoxShadow: string
        borderRadius: number
    }
    generatedMediaChrome: {
        iconSize: number
        topGap: number
        chatScale: number
        modelBadgeSeparator: string
        zoomScaling: BoundedZoomScalingSettings
        styles: {
            modelBadgeIconGap: string
            modelBadgeProviderColor: string
            modelBadgeModelColor: string
            modelBadgeNameFontSize: string
            modelBadgeNameFontWeight: number
            modelBadgeNameLineHeight: number
            infoButtonColor: string
            infoButtonHoverColor: string
        }
    }
    useZoomCompensatedResizeHandleScaling: boolean
    resizeHandle: {
        size: number
        offset: number
        minSize: number
        zoomScaling: BoundedZoomScalingSettings
    }
    inProgressOutlineAnimation: {
        radius: number
        gap: number
        preFrameCircleScale: number
        snakeWidth: number
        snakeTailWidthFraction: number
        snakeTailThinLengthFraction: number
        snakeWidthTaperPower: number
        snakeLengthFraction: number
        snakeHeadRoundLengthFraction: number
        animationDurationMs: number
        zoomScaling: BoundedZoomScalingSettings
        developmentFlags: {
            alwaysOn: boolean
        }
        styles: {
            snakeTailAlpha: number
            snakeColors: string[]
            glassMaterial: GenerationBorderGlassMaterialSettings
        }
    }
    // Image-specific.
    image: {
        defaultInsertionWidth: number
    }
}

export type VideoControlsSettings = {
    height: number
    canvas: {
        horizontalInset: number
        compactHorizontalInset: number
        compactWidthThreshold: number
        bottomInset: number
        zoomScaling: BoundedZoomScalingSettings
    }
    chat: {
        horizontalInset: number
        bottomInset: number
        controlsScale: number
        minWidth: number
        fallbackWidth: number
    }
    layout: {
        padding: number
        gap: number
        buttonSize: number
        iconSize: number
        barRadius: number
        buttonRadius: number
        railHeight: number
        scrubberHandleRadius: number
        volumeHandleRadius: number
        backgroundHighlightInset: number
        timeWidth: number
        speedSliderWidth: number
        compactSpeedSliderWidth: number
        speedSliderMinWidth: number
        speedValueWidth: number
        speedValueSliderGap: number
        volumeSliderWidth: number
        volumeSliderMinWidth: number
        minSeekWidth: number
        speedScaleTickHeight: number
    }
    typography: {
        timeFontSize: number
        timeFontWeight: number
    }
    speed: {
        minRate: number
        maxRate: number
        pointerStep: number
        keyboardStep: number
        displayPrecision: number
        defaultRate: number
        guideRate: number
        guideRates: number[]
    }
    responsive: {
        speedSliderMinResponsiveWidth: number
        speedSliderFullResponsiveWidth: number
        volumeSliderMinResponsiveWidth: number
        volumeSliderFullResponsiveWidth: number
    }
    styles: {
        hostBorderRadius: string
        hostDropShadow: string
        hostBackdropFilter: string
        hostReducedTransparencyBackground: string
        background: string
        backgroundStroke: string
        backgroundStrokeWidth: number
        glassHighlight: string
        glassHighlightStrokeWidth: number
        buttonHover: string
        icon: string
        iconMuted: string
        text: string
        textSubtle: string
        rail: string
        buffered: string
        progress: string
        speedScaleTick: string
        speedScaleTickWidth: number
        liquidGlassFilter: {
            displacementScale: number
            baseFrequency: string
            numOctaves: number
            seed: number
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

    videoControls: VideoControlsSettings

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
        errorState: {
            fallbackTitle: 'Error state',
            textColor: colorPalette.red,
        },
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
            strokeWidth: 3,
            // Base screen-pixel arrowhead size at 100% and higher zoom.
            markerSize: 23,
            // Base screen-pixel gap between a connector endpoint and the node it
            // attaches to, at 100% and higher zoom. This is the pure node↔line gap
            // and is identical for both ends; it carries NO arrowhead knowledge —
            // WorkspaceConnectionManager adds the arrowhead's own length only on
            // ends that actually draw an arrow.
            markerOffset: { source: 15, target: 15 },
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

        styles: {
            // Box shadow applied to media nodes in their default state. Keep this subtler than the selected shadow so selection remains the stronger visual state.
            defaultBoxShadow: '0 1px 6px rgba(0, 0, 0, 0.15)',
            // Box shadow applied when a media node is selected. Increasing this makes selected media read as more prominent on the canvas.
            selectedBoxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
            // Canvas-unit corner radius for media pixels and browser-composited media surfaces on the workspace canvas.
            borderRadius: 30,
        },

        // Provenance/descriptor icon strip below a media node. The strip is screen-space chrome projected from media node bounds and uses bounded zoom compensation; the expandable info panel is rendered separately and does not inherit this transform.
        generatedMediaChrome: {
            // Base screen-pixel icon/button size at 100% and higher zoom.
            iconSize: 28,
            // Base screen-pixel gap at 100% and higher zoom between the media node's bottom edge and the chrome strip.
            topGap: 8,
            // Scale applied to generated-media badges rendered inside AI chat history cards.
            chatScale: 0.72,
            // Separator between the provider brand and model title in the model badge, e.g. "OpenAI : GPT Image 2". Includes its own surrounding spacing so it can be tuned freely (" : ", " — ", " / ", …).
            modelBadgeSeparator: ' : ',
            // Lower zoom breakpoint for generated-media icon chrome. Runtime call
            // sites opt this config into the shared adaptive low-zoom curve,
            // which defaults to 0.45 unless this object provides `lowZoomPower`.
            zoomScaling: { minZoom: 0.4 },
            // Theme tokens for the model badge + info button, surfaced as CSS custom properties.
            styles: {
                // Gap between the provider icon and the provider/model name.
                modelBadgeIconGap: '3px',
                // Provider brand + separator color (the model title overrides with the darker value below so it reads as primary).
                modelBadgeProviderColor: '#4d5963',
                // Model title color — darker than the provider for emphasis.
                modelBadgeModelColor: '#181e23',
                modelBadgeNameFontSize: '15px',
                modelBadgeNameFontWeight: 400,
                modelBadgeNameLineHeight: 1.5,
                // Info button: muted by default, full color on hover.
                infoButtonColor: '#81878d',
                infoButtonHoverColor: '#4d5963',
            },
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

        // PIXI-rendered animated outline shown while media work is in progress.
        inProgressOutlineAnimation: {
            // Fallback rounded-corner radius for the snake path when a media-specific clip radius is unavailable.
            radius: 10,
            // Empty screen-pixel gap between the media node edge and the inside edge of the snake at 100% zoom.
            gap: 3,
            // Diameter of the pre-first-frame generation circle as a fraction of the pending media node's shortest side.
            preFrameCircleScale: 1 / 3,
            // Screen-pixel width of the snake head at 100% zoom. The body tapers from this value toward the tail.
            snakeWidth: 9,
            // Tail width as a fraction of `snakeWidth`; lower values make the tail taper to a finer point.
            snakeTailWidthFraction: 0.14,
            // Fraction of the snake path held near the minimum tail width before the body starts widening.
            snakeTailThinLengthFraction: 0.1,
            // Power curve for the tail-to-head width ramp. Higher values keep the trail thin longer without changing total snake length.
            snakeWidthTaperPower: 0.86,
            // Fraction of the rounded media perimeter occupied by the visible snake.
            snakeLengthFraction: 0.24,
            // Rounded head length as a fraction of the feather-expanded snake width. Higher values make the endpoint softer without protruding past the head.
            snakeHeadRoundLengthFraction: 0.5,
            // Milliseconds for one complete lap around the media node.
            animationDurationMs: 3200,
            // Lower zoom breakpoint for the PIXI generation outline stroke widths. Runtime call sites opt this config into the shared adaptive low-zoom curve.
            zoomScaling: { minZoom: 0 },
            developmentFlags: {
                // Shows the outline on every media node for visual tuning.
                alwaysOn: false,
            },
            styles: {
                // Tail fade preference. The glass renderer keeps a material-opacity floor so the tail fades without turning into mist.
                snakeTailAlpha: 0,
                // Tail-to-head colors inspired by the shifting gradient and model menu divider, with a bright iridescent amethyst tail.
                snakeColors: ['#ff0084', '#ff39b0', '#fc75c6', '#eba0f5', '#f1c2e9', '#e0d6ff', '#eaeaff', '#DAD7F1', '#E8E4F6'],
                glassMaterial: {
                    // Dark tint mixed into the soft lower rim of the glass.
                    shadowColor: '#4E5B6C',
                    // Exponent for tail-to-head opacity growth. Lower values make the tail become visible sooner.
                    tailOpacityPower: 0.72,
                    // Fraction of snake length used to fade the tail in from fully transparent.
                    tailFadeFraction: 0.08,
                    // Minimum opacity floor after the tail fade finishes.
                    minTailOpacity: 0.62,
                    // Extra transparent feather width as a fraction of the visible snake width. Higher values blur outward without shrinking the core.
                    edgeFeatherFraction: 0.1,
                    // Exponent applied to the feather mask. Higher values make the fade more gradual at the outer edge.
                    edgeFeatherPower: 1.18,
                    // Cross-section lens exponent. Lower values spread the rounded glass body farther toward the edges.
                    lensCorePower: 0.42,
                    // Vertical center of the main specular highlight, from top edge 0 to bottom edge 1.
                    upperSpecularCenter: 0.32,
                    // How far the main specular highlight drifts across the width as it travels along the snake.
                    upperSpecularDrift: 0.035,
                    // Width of the main specular highlight across the snake body.
                    upperSpecularWidth: 0.16,
                    // Tail progress where the main specular highlight starts fading in.
                    upperSpecularFadeStart: 0.1,
                    // Tail progress where the main specular highlight reaches full strength.
                    upperSpecularFadeEnd: 0.32,
                    // Brightness contribution from the main specular highlight.
                    upperSpecularStrength: 0.24,
                    // Longitudinal center of the head glint, from tail 0 to head 1.
                    headSpecularProgressCenter: 0.91,
                    // Longitudinal width of the head glint.
                    headSpecularProgressWidth: 0.22,
                    // Cross-section center of the head glint, from top edge 0 to bottom edge 1.
                    headSpecularCrossSectionCenter: 0.48,
                    // Cross-section width of the head glint.
                    headSpecularCrossSectionWidth: 0.26,
                    // Brightness contribution from the head glint.
                    headSpecularStrength: 0.18,
                    // Cross-section center of the lower glass shadow rim.
                    lowerEdgeShadowCenter: 0.88,
                    // Width of the lower glass shadow rim.
                    lowerEdgeShadowWidth: 0.2,
                    // Darkness contribution from the lower glass shadow rim.
                    lowerEdgeShadowStrength: 0.16,
                    // Cross-section center of the upper glass shadow rim.
                    upperEdgeShadowCenter: 0.1,
                    // Width of the upper glass shadow rim.
                    upperEdgeShadowWidth: 0.2,
                    // Darkness contribution from the upper glass shadow rim.
                    upperEdgeShadowStrength: 0.07,
                    // Power curve for the broad edge shadow. Higher values push shadow closer to the edge.
                    edgeShadowPower: 2.2,
                    // Darkness contribution from the broad edge shadow.
                    edgeShadowStrength: 0.04,
                    // Brightness contribution from the rounded lens core.
                    lensHighlightStrength: 0.08,
                    // Maximum amount of white mixed into highlights.
                    highlightWhiteMixMax: 0.3,
                    // Maximum amount of shadow color mixed into edge shadows.
                    shadowMixMax: 0.14,
                    // Baseline material opacity before cross-section highlights are added.
                    materialAlphaBase: 0.72,
                    // Maximum material opacity before the feathered edge mask is applied.
                    materialAlphaMax: 0.94,
                    // Opacity contribution from the rounded lens core.
                    lensAlphaStrength: 0.16,
                    // Opacity contribution from the main specular highlight.
                    upperSpecularAlphaStrength: 0.04,
                    // Opacity contribution from the head glint.
                    headSpecularAlphaStrength: 0.03,
                },
            },
        },

        // ── Image-specific ──
        image: {
            // Canvas-unit width for manually inserted image nodes. Height is derived from the image aspect ratio; failed dimension probes use this as a square fallback.
            defaultInsertionWidth: 600,
        },
    },

    // Shared SVG video player controls used by canvas video nodes and in-chat generated videos.
    videoControls: {
        // Screen-pixel height of the control bar and host.
        height: 40,
        // Canvas video-node mount geometry.
        canvas: {
            // Horizontal inset for normal-width video nodes.
            horizontalInset: 0,
            // Horizontal inset for compact video nodes.
            compactHorizontalInset: 0,
            // Node width below which the compact horizontal inset is used.
            compactWidthThreshold: 260,
            // Vertical gap between the video node edge and the external controls strip.
            bottomInset: 8,
            // Bounded zoom scaling for the canvas control strip.
            zoomScaling: { minZoom: 1.2 },
        },
        // In-chat generated-video mount geometry.
        chat: {
            // Left and right inset for the external chat controls row.
            horizontalInset: 0,
            // Vertical gap between the chat video surface and the external controls row.
            bottomInset: 0,
            // Visual scale applied to the shared controls inside chat history cards.
            controlsScale: 0.72,
            // Minimum SVG viewBox width used when the host is narrow or not measured.
            minWidth: 300,
            // Fallback width before ResizeObserver measurement is available.
            fallbackWidth: 520,
        },
        // Internal SVG geometry. These are supported sizing knobs, not CSS layout mechanics.
        layout: {
            padding: 9,
            gap: 6,
            buttonSize: 30,
            iconSize: 18,
            barRadius: 99,
            buttonRadius: 99,
            railHeight: 5,
            scrubberHandleRadius: 5.5,
            volumeHandleRadius: 4,
            backgroundHighlightInset: 1,
            timeWidth: 48,
            speedSliderWidth: 96,
            compactSpeedSliderWidth: 78,
            speedSliderMinWidth: 64,
            speedValueWidth: 34,
            speedValueSliderGap: 7,
            volumeSliderWidth: 62,
            volumeSliderMinWidth: 28,
            minSeekWidth: 36,
            speedScaleTickHeight: 10,
        },
        typography: {
            timeFontSize: 13,
            timeFontWeight: 600,
        },
        // Continuous playback-speed slider settings. Guide rates render as scale marks only.
        speed: {
            minRate: 0.5,
            maxRate: 2,
            pointerStep: 0.01,
            keyboardStep: 0.05,
            displayPrecision: 2,
            defaultRate: 1,
            guideRate: 1,
            guideRates: [0.75, 1, 1.5],
        },
        // Responsive rail sizing thresholds.
        responsive: {
            speedSliderMinResponsiveWidth: 430,
            speedSliderFullResponsiveWidth: 520,
            volumeSliderMinResponsiveWidth: 330,
            volumeSliderFullResponsiveWidth: 520,
        },
        styles: {
            hostBorderRadius: '99px',
            hostDropShadow: 'drop-shadow(0 12px 30px rgba(0, 0, 0, 0.30))',
            hostBackdropFilter: 'blur(22px) saturate(155%) contrast(108%)',
            hostReducedTransparencyBackground: 'rgba(24, 28, 34, 0.70)',
            background: 'rgba(24, 28, 34, 0.24)',
            backgroundStroke: 'rgba(255, 255, 255, 0.22)',
            backgroundStrokeWidth: 1,
            glassHighlight: 'rgba(255, 255, 255, 0.10)',
            glassHighlightStrokeWidth: 1,
            buttonHover: 'rgba(255, 255, 255, 0.14)',
            icon: 'rgba(255, 255, 255, 0.95)',
            iconMuted: 'rgba(255, 255, 255, 0.58)',
            text: 'rgba(255, 255, 255, 0.92)',
            textSubtle: 'rgba(255, 255, 255, 0.76)',
            rail: 'rgba(255, 255, 255, 0.24)',
            buffered: 'rgba(255, 255, 255, 0.34)',
            progress: '#ffffff',
            speedScaleTick: 'rgba(255, 255, 255, 0.42)',
            speedScaleTickWidth: 1,
            liquidGlassFilter: {
                displacementScale: 2.4,
                baseFrequency: '0.012 0.08',
                numOctaves: 2,
                seed: 7,
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
            // Canvas-unit height for branch lineage markers; width is derived in WorkspaceCanvas.
            size: 96,
            // Canvas-unit base size for the branch icon inside marker labels.
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
