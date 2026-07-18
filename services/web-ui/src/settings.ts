import {
    mediaGenerationLayoutSettings,
    workspaceCollisionSettings,
    workspacePersistenceSettings,
    type WorkspaceEdgePathType,
    type WorkspaceCollisionFlowSettings,
    type WorkspaceCollisionNodeTypeSettings,
    type WorkspaceCollisionSettings,
    type WorkspacePersistenceSettings,
} from '@lixpi/constants'
import type { CircularGlassMaterialStyle } from '@lixpi/canvas-engine'

export const colorPalette = {
    nightBlue: '#42494f',
    steelBlue: '#5d656d',
    aiGreen: '#56967c',
    selectionBlue: '#5f8fcf',
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

export type HoverSettings = {
    transitionDurationMs: number
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

export type RightSidePanelSettings = {
    defaultDimensions: {
        width: number
    }
    dimensions: {
        minWidth: number
        maxPaneMargin: number
    }
    layout: {
        contentInset: number
    }
    resizeHandle: {
        offset: number
        grabWidth: number
        styles: {
            gradient: string
            width: string
        }
    }
    toggle: {
        motion?: 'slide' | 'fixed'
        openAriaLabel: string
        closedAriaLabel: string
        openOffset: string
        closedTravel?: string
        top: string
        size: string
    }
    animation: {
        durationMs: number
        easing?: string
        openEasing?: string
        closeEasing?: string
    }
    overlay: {
        enabled: boolean
        closeOnPointerDown: boolean
        fill: string
        fillOpaque: string
        opacity: number
    }
    drag: {
        enabled: boolean
        closeThreshold: number
        velocityThreshold: number
        pointerSwipeStartThreshold: number
        touchSwipeStartThreshold: number
    }
    styles: {
        backdropFill: string
        backdropFillOpaque: string
        toggleColor: string
        toggleHoverColor: string
    }
}

export type NavigationSidePanelSettings = Omit<RightSidePanelSettings, 'layout'>

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
    panelTabs: AiChatThreadPanelTabsSettings
    sessionHistory: AiChatThreadSessionHistorySettings
    contextPreview: AiChatThreadContextPreviewSettings
    styles: {
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

export type CanvasChromeSettings = {
    glassBorder: {
        enabled: boolean
        widthPx: number
        displacementScalePx: number
        displacementMapMaxDimensionPx: number
        edgeRefractionStrength: number
        surfaceWaveStrength: number
        causticBandStrength: number
        displacementFrequencyX: number
        displacementFrequencyY: number
        bodyColor: string
        bodyAlpha: number
        highlightColor: string
        highlightAlpha: number
        shadowColor: string
        shadowAlpha: number
        materialColors: string[]
        materialTailAlpha: number
        glassMaterial: GenerationBorderGlassMaterialSettings
    }
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
    // Vertical auto-alignment of a connector's anchor along the target node's left edge.
    autoAlign: {
        // Minimum target-node height (px) before connector anchors can slide away from the vertical center.
        minSlideHeight: number
        // Fractional top/bottom margin where the sliding anchor stops, snapping to the nearest corner.
        edgeMargin: number
    }
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
        gap: number
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
    generatedMediaInfoPanel: {
        widthMultiplier: number
        minWidth: number
        maxWidth: number | null
        horizontalOffset: number
        branchMarkerTopOffset: number
        layerZIndex: number
        styles: {
            background: string
            border: string
            borderRadius: string
            boxShadow: string
            color: string
            overflow: string
            padding: string
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

export type WorkspaceLoadingOutlineSettings = {
    // Diameter of the workspace-switch loading circle relative to the generated-media pending circle.
    diameterScale: number
}

export type MediaBranchLineageColorMixSettings = {
    targetColor: string
    amount: number
}

export type MediaBranchLineageColorAdjustSettings = {
    saturationMultiplier: number
    minSaturation: number
    maxSaturation: number
    lightnessMultiplier: number
    minLightness: number
    maxLightness: number
}

export type MediaBranchLineageMediaModelCircleSettings = {
    size: number
    iconSize: number
    mainGap: number
    stackGap: number
    styles: {
        iconColor: string
        backgroundColor: string
        boxShadow: string
    }
    glass: {
        textureSize: number
        translucency: number
        rimFeatherFraction: number
        fallbackColors: string[]
        brandColorAdjust: MediaBranchLineageColorAdjustSettings
        brandColorStops: MediaBranchLineageColorMixSettings[]
        material: GenerationBorderGlassMaterialSettings
        discMaterial: CircularGlassMaterialStyle
    }
    texture: {
        fallbackColor: string
        brandColorMix: MediaBranchLineageColorMixSettings
        fillOpacity: number
        inset: number
        opacity: number
        backgroundSizePercent: number
    }
}

export type MediaBranchLineageSettings = {
    generatedMediaSize: number
    nodeGap: number
    rootToFirstMediaGap: number
    branchRowGap: number
    mediaToMediaGap: number
    branchOriginToFirstMediaGap: number
    branchFanoutExtraGap: number
    pendingMarkerInputGap: number
    pendingMarkerMoveDurationMs: number
    branchOrigin: {
        size: number
        iconSize: number
        styles: {
            backgroundColor: string
            borderColor: string
            iconColor: string
            boxShadow: string
            separatorGradient: string
        }
    }
    mediaModelCircle: MediaBranchLineageMediaModelCircleSettings
    marker: {
        minWidthMultiplier: number
        maxWidthGrowth: number
        screenFixedMaxWidthGrowth: number
        screenFixedMaxWidthFraction: number
        // Text sizing for the marker's user-message and AI-response preview lines.
        // Kept in sync with the floating detail panel so a marker reads at the same
        // size as the expanded thread it represents.
        text: {
            // Pixel font size of the user-message preview line (the bold prompt text).
            messageFontSize: number
            // Unitless line-height multiplier applied to the user-message preview.
            messageLineHeight: number
            // Pixel font size of the AI-response preview line below the separator.
            responseFontSize: number
            // Unitless line-height multiplier applied to the AI-response preview.
            responseLineHeight: number
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

    hover: HoverSettings

    canvasBubbleMenu: CanvasBubbleMenuSettings

    canvasChrome: CanvasChromeSettings

    rightSidePanel: RightSidePanelSettings

    navigationSidePanel: NavigationSidePanelSettings

    aiChatThread: AiChatThreadSettings

    aiPromptInput: AiPromptInputSettings

    connector: ConnectorSettings

    selection: SelectionSettings

    workspaceCollision: WorkspaceCollisionSettings

    mediaNode: MediaNodeSettings

    workspaceLoadingOutline: WorkspaceLoadingOutlineSettings

    videoControls: VideoControlsSettings

    mediaBranchLineage: MediaBranchLineageSettings

    mediaLibrary: MediaLibrarySettings

    workspacePersistence: WorkspacePersistenceSettings

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

    // Shared hover-state motion used by interactive Web UI controls.
    hover: {
        transitionDurationMs: 150,
    },

    // Canvas bubble menu zoom scaling settings.
    canvasBubbleMenu: {
        // Lower zoom breakpoint for canvas bubble-menu chrome. Runtime call sites
        // opt this config into the shared adaptive low-zoom curve, which defaults
        // to 0.45 unless this object provides `lowZoomPower`.
        zoomScaling: { minZoom: 0.4 },
    },

    // Screen-fixed canvas chrome shared by the bottom composer and adjacent action panels.
    canvasChrome: {
        // Pixi glass border for bottom canvas controls.
        glassBorder: {
            // Enables the Pixi render-texture refraction border around composer controls.
            enabled: true,
            // Width of the refractive ring in screen pixels.
            widthPx: 10,
            // Pixel offset strength used by the Pixi displacement filter that refracts captured canvas content.
            displacementScalePx: 34,
            // Upper bound for the generated screen-space displacement map.
            displacementMapMaxDimensionPx: 1600,
            // Normal-direction edge pinch strength. Higher values pull pixels harder across the glass edge.
            edgeRefractionStrength: 0.95,
            // Tangential wave strength for the liquid smear inside the ring.
            surfaceWaveStrength: 0.26,
            // Secondary bright-band distortion strength along the border thickness.
            causticBandStrength: 0.34,
            // Horizontal wave frequency for the procedural liquid displacement.
            displacementFrequencyX: 4.8,
            // Vertical wave frequency for the procedural liquid displacement.
            displacementFrequencyY: 3.9,
            // Transparent body tint drawn only inside the ring.
            bodyColor: '#ffffff',
            // Body tint alpha inside the ring.
            bodyAlpha: 0.035,
            // Specular rim color.
            highlightColor: '#ffffff',
            // Specular rim alpha.
            highlightAlpha: 0.2,
            // Subtle inner-shadow rim color.
            shadowColor: '#415061',
            // Subtle inner-shadow rim alpha.
            shadowAlpha: 0.1,
            // Baked Pixi glass material colors for the closed border mesh.
            materialColors: ['#ffffff', '#f7fbff', '#edf4ff', '#ffffff'],
            // Closed border meshes do not tail-fade; this stays fully present before material alpha is applied.
            materialTailAlpha: 1,
            glassMaterial: {
                // Dark tint mixed into the soft lower rim of the glass.
                shadowColor: '#415061',
                // Kept for shared material compatibility; closed strip opacity is forced by the material subclass.
                tailOpacityPower: 1,
                // Disabled so the rounded-rectangle border has no tail seam.
                tailFadeFraction: 0,
                // Closed strip minimum opacity.
                minTailOpacity: 1,
                // Extra transparent feather width as a fraction of the visible border width.
                edgeFeatherFraction: 0.22,
                // Exponent applied to the feather mask.
                edgeFeatherPower: 1.34,
                // Cross-section lens exponent.
                lensCorePower: 0.5,
                // Vertical center of the main specular highlight, from outer edge 0 to inner edge 1.
                upperSpecularCenter: 0.24,
                // Subtle drift along the closed outline path.
                upperSpecularDrift: 0.02,
                // Width of the main specular highlight across the border body.
                upperSpecularWidth: 0.18,
                // Closed strips have no tail, so the highlight is present immediately.
                upperSpecularFadeStart: 0,
                // Closed strips have no tail, so the highlight is present immediately.
                upperSpecularFadeEnd: 0.01,
                // Brightness contribution from the main specular highlight.
                upperSpecularStrength: 0.13,
                // Longitudinal center of the inherited head glint.
                headSpecularProgressCenter: 0.52,
                // Longitudinal width of the inherited head glint.
                headSpecularProgressWidth: 0.42,
                // Cross-section center of the inherited head glint.
                headSpecularCrossSectionCenter: 0.48,
                // Cross-section width of the inherited head glint.
                headSpecularCrossSectionWidth: 0.28,
                // Brightness contribution from the inherited head glint.
                headSpecularStrength: 0.04,
                // Cross-section center of the lower glass shadow rim.
                lowerEdgeShadowCenter: 0.86,
                // Width of the lower glass shadow rim.
                lowerEdgeShadowWidth: 0.22,
                // Darkness contribution from the lower glass shadow rim.
                lowerEdgeShadowStrength: 0.12,
                // Cross-section center of the upper glass shadow rim.
                upperEdgeShadowCenter: 0.08,
                // Width of the upper glass shadow rim.
                upperEdgeShadowWidth: 0.18,
                // Darkness contribution from the upper glass shadow rim.
                upperEdgeShadowStrength: 0.05,
                // Power curve for the broad edge shadow.
                edgeShadowPower: 2.1,
                // Darkness contribution from the broad edge shadow.
                edgeShadowStrength: 0.035,
                // Brightness contribution from the rounded lens core.
                lensHighlightStrength: 0.06,
                // Maximum amount of white mixed into highlights.
                highlightWhiteMixMax: 0.24,
                // Maximum amount of shadow color mixed into edge shadows.
                shadowMixMax: 0.1,
                // Baseline material opacity before cross-section highlights are added.
                materialAlphaBase: 0.018,
                // Maximum material opacity before the feathered edge mask is applied.
                materialAlphaMax: 0.14,
                // Opacity contribution from the rounded lens core.
                lensAlphaStrength: 0.05,
                // Opacity contribution from the main specular highlight.
                upperSpecularAlphaStrength: 0.035,
                // Opacity contribution from the inherited head glint.
                headSpecularAlphaStrength: 0.016,
            },
        },
    },

    // Right side panel surface, resize, toggle, and slide settings.
    rightSidePanel: {
        defaultDimensions: {
            // Screen-pixel width before the user has resized the panel.
            width: 380,
        },
        dimensions: {
            // Minimum screen-pixel width while resizing.
            minWidth: 320,
            // Remaining pane width kept visible when computing the dynamic max width.
            maxPaneMargin: 64,
        },
        layout: {
            // Inner horizontal inset for the panel content column.
            contentInset: 10,
        },
        resizeHandle: {
            // Horizontal offset in pixels from the panel's left edge to the resize handle center.
            offset: 0,
            // Screen-pixel width of the invisible resize hit target.
            grabWidth: 20,
            styles: {
                // Background gradient painted on the visible resize-handle line.
                gradient: 'linear-gradient(135deg, #F5EFF9 0%, #E6E9F6 100%)',
                // Visible line width; this does not change the draggable hit target.
                width: '3px',
            },
        },
        toggle: {
            openAriaLabel: 'Collapse right side panel',
            closedAriaLabel: 'Open right side panel',
            // Position when the panel is open.
            openOffset: 'calc(var(--workspace-right-side-panel-width) + 5px)',
            // Travel distance used when the panel is closed.
            closedTravel: 'calc(var(--workspace-right-side-panel-width) - 10px)',
            top: '15px',
            size: '15px',
        },
        animation: {
            // Drawer-style slide duration.
            durationMs: 100,
            // Opening decelerates into place; closing accelerates away.
            openEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            closeEasing: 'cubic-bezier(0.64, 0, 0.78, 0)',
        },
        overlay: {
            // Full-canvas dark glass tint layer behind the side panel.
            enabled: true,
            closeOnPointerDown: true,
            fill: 'rgba(15, 23, 42, 0.18)',
            fillOpaque: 'rgba(15, 23, 42, 0.22)',
            opacity: 1,
        },
        drag: {
            // Vaul-style horizontal swipe-to-close gesture for pointer/touch input.
            enabled: true,
            closeThreshold: 0.25,
            velocityThreshold: 0.4,
            pointerSwipeStartThreshold: 2,
            touchSwipeStartThreshold: 10,
        },
        styles: {
            backdropFill: 'rgba(248, 250, 253, 0.84)',
            backdropFillOpaque: '#f8fafd',
            toggleColor: '#4b5563',
            toggleHoverColor: '#1f2937',
        },
    },

    // Navigation side panel (workspace list) surface, resize, toggle, and slide settings.
    navigationSidePanel: {
        defaultDimensions: {
            // Screen-pixel width before the user has resized the panel.
            width: 280,
        },
        dimensions: {
            // Minimum screen-pixel width while resizing.
            minWidth: 220,
            // Remaining pane width kept visible when computing the dynamic max width.
            maxPaneMargin: 64,
        },
        resizeHandle: {
            // Horizontal offset in pixels from the panel's right edge to the resize handle center.
            offset: 0,
            // Screen-pixel width of the invisible resize hit target.
            grabWidth: 20,
            styles: {
                // Background gradient painted on the visible resize-handle line.
                gradient: 'linear-gradient(135deg, #F5EFF9 0%, #E6E9F6 100%)',
                // Visible line width; this does not change the draggable hit target.
                width: '3px',
            },
        },
        toggle: {
            openAriaLabel: 'Collapse navigation side panel',
            closedAriaLabel: 'Open navigation side panel',
            // Keep the navigation toggle anchored; the panel opens underneath
            // it instead of pushing the button to the panel edge.
            motion: 'fixed',
            openOffset: '20px',
            top: '20px',
            size: '20px',
        },
        animation: {
            // Drawer-style slide duration.
            durationMs: 100,
            // Opening decelerates into place; closing accelerates away.
            openEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            closeEasing: 'cubic-bezier(0.64, 0, 0.78, 0)',
        },
        overlay: {
            // The visual overlay is disabled so the workspace list does not dim
            // the canvas. `closeOnPointerDown` still collapses the panel from
            // document-level outside clicks.
            enabled: false,
            closeOnPointerDown: true,
            fill: 'rgba(15, 23, 42, 0.18)',
            fillOpaque: 'rgba(15, 23, 42, 0.22)',
            opacity: 1,
        },
        drag: {
            // Vaul-style horizontal swipe-to-close gesture for pointer/touch input.
            enabled: true,
            closeThreshold: 0.25,
            velocityThreshold: 0.4,
            pointerSwipeStartThreshold: 2,
            touchSwipeStartThreshold: 10,
        },
        styles: {
            backdropFill: 'rgba(248, 250, 253, 0.94)',
            backdropFillOpaque: '#f8fafd',
            toggleColor: '#4b5563',
            toggleHoverColor: '#1f2937',
        },
    },

    // AI chat thread panel presentation and interaction settings. The thread is a
    // read-only transcript hosted in the right side panel; there is no on-canvas
    // thread node.
    aiChatThread: {
        // Hide or show the thread title inside the AI chat panel.
        showHeader: false,

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

        // Theming for the AI Chat panel's context-preview tray chips and hover popover. Verified single-use: these tokens only feed the `--workspace-ai-chat-panel-context-*` CSS variables, applied to the panel element in WorkspaceCanvas.applyAiChatPanelContextPreviewSettings. The shared components/contextPreview tile renderer is reused elsewhere (e.g. generated-media info panels) but does not read these tokens, so the settings stay panel-scoped here rather than in a standalone section.
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

        styles: {
            // Box shadow around the AI chat panel surface. Use `none` for a flat panel surface.
            nodeBoxShadow: 'none',
            // Border around the AI chat panel surface. Use `none` to remove the browser-default border.
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
                sectionDividerGradient: 'linear-gradient(90deg, rgba(247, 247, 253, 0) 0%, #F7F7FD 10%, #F3E4F2 26%, #C5C0EE 50%, #E6E9F6 74%, #F7F7FD 90%, rgba(247, 247, 253, 0) 100%)',
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
        // Vertical auto-alignment of a connector's anchor along the target node's left edge.
        autoAlign: {
            // Minimum target-node height in pixels before the anchor can slide away from the vertical center.
            minSlideHeight: 120,
            // Fractional top/bottom margin where the sliding anchor stops, snapping to the nearest corner.
            edgeMargin: 0.065,
        },
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

    // Shared API/WebUI collision settings. Tune in @lixpi/constants only.
    workspaceCollision: workspaceCollisionSettings,

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
            // Base screen-pixel icon/button size at 100% and higher zoom. Shared with the API collision boxes via @lixpi/constants.
            iconSize: mediaGenerationLayoutSettings.generatedMediaChrome.iconSize,
            // Base screen-pixel gap at 100% and higher zoom on both sides of the icon strip: media-to-icons and icons-to-info-panel. Shared with the API collision boxes via @lixpi/constants.
            gap: mediaGenerationLayoutSettings.generatedMediaChrome.topGap,
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
                // Interactive chrome icons match the provider icon at rest and darken on hover.
                infoButtonColor: '#4d5963',
                infoButtonHoverColor: '#181e23',
            },
        },

        // Expanded provenance/descriptor panel opened from generated-media chrome and branch-lineage markers.
        generatedMediaInfoPanel: {
            // Panel width as a proportion of the media/lineage width that anchors it.
            widthMultiplier: 1,
            // Minimum canvas-unit panel width after widthMultiplier is applied. Use 0 to keep the anchor width as the floor.
            minWidth: 0,
            // Optional maximum canvas-unit panel width after widthMultiplier is applied. Use null for no cap.
            maxWidth: null,
            // Canvas-unit horizontal offset from the anchor's left edge.
            horizontalOffset: 0,
            // Canvas-unit vertical offset below a branch-lineage marker.
            branchMarkerTopOffset: 10,
            // Stacking level for the viewport-transformed info panel layer.
            layerZIndex: 5,
            styles: {
                background: '#fff',
                border: '1px solid rgba(34, 40, 49, 0.08)',
                borderRadius: '20px',
                // Twice the prior intensity (alpha doubled 0.14 → 0.28, with a deeper spread) so the floating detail modal reads as clearly lifted above the canvas.
                boxShadow: '0 16px 44px rgba(20, 24, 30, 0.28)',
                color: '#252b33',
                overflow: 'visible',
                padding: '0.55rem 0.75rem',
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
            preFrameCircleScale: mediaGenerationLayoutSettings.preFrameCircleScale,
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

    workspaceLoadingOutline: {
        // Relative to the generated-media pending circle. 0.6 makes the workspace-switch spinner 40% smaller in diameter.
        diameterScale: 0.6,
    },

    // Shared SVG video player controls used by canvas video nodes and in-chat generated videos.
    videoControls: {
        // Screen-pixel height of the control bar and host. Shared with the API collision boxes via @lixpi/constants.
        height: mediaGenerationLayoutSettings.generatedMediaChrome.videoControlsHeight,
        // Canvas video-node mount geometry.
        canvas: {
            // Horizontal inset for normal-width video nodes.
            horizontalInset: 0,
            // Horizontal inset for compact video nodes.
            compactHorizontalInset: 0,
            // Node width below which the compact horizontal inset is used.
            compactWidthThreshold: 260,
            // Vertical gap between the video node edge and the external controls strip. Shared with the API collision boxes via @lixpi/constants.
            bottomInset: mediaGenerationLayoutSettings.generatedMediaChrome.videoControlsBottomInset,
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
    // Fraction of the canvas space remaining after any open right side panel is reserved.
        panelWidthFraction: 2 / 3,
    },

    // Generated media branch-lineage placement settings for image and video nodes.
    // The dimensions and gaps come from the shared mediaGenerationLayoutSettings in
    // @lixpi/constants: the API canvas projection persists node geometry with the
    // same values, so editing them here-and-there separately is what caused nodes
    // to jump or overlap. Tune them in @lixpi/constants only.
    mediaBranchLineage: {
        // Canvas-unit base width and height for new generated media nodes. Increasing it makes each generated branch artifact larger when inserted.
        generatedMediaSize: mediaGenerationLayoutSettings.generatedMediaSize,
        // Canvas-unit minimum empty space reserved around every branchOrigin, branchFork, and branchLine marker during placement, drag release, and branch-tree rebalance.
        nodeGap: mediaGenerationLayoutSettings.nodeGap,
        // Canvas-unit horizontal gap between a chat root or reference group and the first generated media node in that branch.
        rootToFirstMediaGap: mediaGenerationLayoutSettings.rootToFirstMediaGap,
        // Canvas-unit vertical gap between separate branch rows spawned from the same chat root. Increasing it moves new branches farther below the previous branch.
        branchRowGap: mediaGenerationLayoutSettings.branchRowGap,
        // Canvas-unit base horizontal gap between consecutive generated media nodes in the same branch lineage.
        mediaToMediaGap: mediaGenerationLayoutSettings.mediaToMediaGap,
        // Canvas-unit horizontal gap from a temporary branchOrigin marker to its first generated media node.
        branchOriginToFirstMediaGap: mediaGenerationLayoutSettings.branchOriginToFirstMediaGap,
        // Canvas-unit extra horizontal gap added for each extra generated media node when a lineage forks. Increasing it gives large branch fans more curve room.
        branchFanoutExtraGap: mediaGenerationLayoutSettings.branchFanoutExtraGap,
        // Vertical gap between stacked screen-fixed pending branch markers.
        pendingMarkerInputGap: mediaGenerationLayoutSettings.pendingMarkerInputGap,
        // Milliseconds for moving and scaling a pending branch marker from its screen-fixed preflight position to its API-planned canvas position.
        pendingMarkerMoveDurationMs: mediaGenerationLayoutSettings.pendingMarkerMoveDurationMs,
        // Temporary root marker used when a fresh multi-model branch has no real source node.
        branchOrigin: {
            // Canvas-unit base size for branch lineage markers; final width and height derive from the shared marker sizing in @lixpi/constants.
            size: mediaGenerationLayoutSettings.marker.baseSize,
            // Canvas-unit base size for the branch icon inside marker labels.
            iconSize: 52,
            styles: {
                backgroundColor: colorPalette.steelBlue,
                borderColor: colorPalette.steelBlue,
                iconColor: colorPalette.offWhite,
                boxShadow: '0 8px 24px rgba(42, 48, 57, 0.22)',
                separatorGradient: 'linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.18) 10%, rgba(255, 255, 255, 0.34) 26%, rgba(255, 255, 255, 0.62) 50%, rgba(255, 255, 255, 0.34) 74%, rgba(255, 255, 255, 0.18) 90%, rgba(255, 255, 255, 0) 100%)',
            },
        },
        // Stacked translucent glass circles that identify which media models produced lineage children.
        mediaModelCircle: {
            // Screen-pixel diameter of each model circle.
            size: 32,
            // Screen-pixel size of the provider/model SVG icon above the glass.
            iconSize: 18,
            // Screen-pixel horizontal gap between the branch lineage node body and the media-model circle stack.
            mainGap: 8,
            // Screen-pixel vertical gap between stacked media-model circles.
            stackGap: 2,
            // CSS-facing theme tokens for the circle shell and foreground icon.
            styles: {
                // Color applied to the model SVG icon rendered over the glass.
                iconColor: colorPalette.nightBlue,
                // Base circle background behind the baked glass image. Keep transparent unless a fallback fill is needed.
                backgroundColor: 'transparent',
                // CSS box-shadow for the circle shell, including any inset rim shadow and external lift shadow.
                boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.1), inset 0 -4px 8px rgba(3, 7, 11, 0.07), 0 7px 18px rgba(18, 24, 31, 0.16)',
            },
            // Baked circular glass image settings and brand-color remapping.
            glass: {
                // Baked once per color at this resolution; reused as a CSS background.
                textureSize: 128,
                // Dense translucent body with enough transmission for internal caustic light.
                translucency: 0.97,
                // Soft round rim so the disc edge fades instead of aliasing.
                rimFeatherFraction: 0.04,
                // Fallback cool glass tint for models without synced brand colors.
                fallbackColors: ['#06133A', '#0A49A7', '#1768D9', '#55A7FF'],
                // Brand-color transform applied before glass stops are mixed, forcing deep saturated color instead of pastel brand tints.
                brandColorAdjust: {
                    // Multiplier applied to the model brand color's HSL saturation before stop mixing.
                    saturationMultiplier: 2.1,
                    // Minimum HSL saturation for the adjusted model color so lower-saturation brand colors still read as strong color.
                    minSaturation: 0.72,
                    // Maximum HSL saturation for the adjusted model color so glass stays rich without turning neon.
                    maxSaturation: 0.9,
                    // Multiplier applied to the model brand color's HSL lightness before stop mixing.
                    lightnessMultiplier: 0.72,
                    // Minimum HSL lightness for the adjusted model color so dark brands do not collapse to black.
                    minLightness: 0.36,
                    // Maximum HSL lightness for the adjusted model color so light brands stay deep and saturated.
                    maxLightness: 0.46,
                },
                // Model brand color is remixed into the glass gradient through these stops.
                brandColorStops: [
                    {
                        // Target color mixed into the first, darkest glass stop.
                        targetColor: '#020714',
                        // Blend amount from the model brand color to the first stop target.
                        amount: 0.28,
                    },
                    {
                        // Target color mixed into the second, saturated body stop.
                        targetColor: '#000000',
                        // Blend amount from the model brand color to the second stop target.
                        amount: 0.02,
                    },
                    {
                        // Target color mixed into the third, bright transmitted-light stop.
                        targetColor: '#FFFFFF',
                        // Blend amount from the model brand color to the third stop target.
                        amount: 0.16,
                    },
                    {
                        // Target color mixed into the fourth, near-white highlight stop.
                        targetColor: '#FFFFFF',
                        // Blend amount from the model brand color to the fourth stop target.
                        amount: 0.34,
                    },
                ],
                // Shared glass shader style reused by the circular material baker.
                material: {
                    // Dark tint color mixed into shadowed glass regions.
                    shadowColor: '#03070B',
                    // Exponent for tail-to-head opacity growth in the shared material sampler.
                    tailOpacityPower: 0.54,
                    // Fraction of material progress used to fade the start from transparent.
                    tailFadeFraction: 0.05,
                    // Minimum material opacity once the fade-in is complete.
                    minTailOpacity: 0.56,
                    // Extra transparent feather width at the material cross-section edge.
                    edgeFeatherFraction: 0.0,
                    // Exponent applied to the edge feather mask.
                    edgeFeatherPower: 1.04,
                    // Cross-section lens exponent controlling how broad the glass core highlight is.
                    lensCorePower: 0.58,
                    // Cross-section center of the upper specular band.
                    upperSpecularCenter: 0.18,
                    // Amount the upper specular band drifts as material progress changes.
                    upperSpecularDrift: 0.02,
                    // Cross-section width of the upper specular band.
                    upperSpecularWidth: 0.08,
                    // Progress value where the upper specular band starts fading in.
                    upperSpecularFadeStart: 0.03,
                    // Progress value where the upper specular band reaches full strength.
                    upperSpecularFadeEnd: 0.14,
                    // Brightness contribution from the upper specular band.
                    upperSpecularStrength: 0.46,
                    // Progress center of the head glint in the shared material model.
                    headSpecularProgressCenter: 0.78,
                    // Progress width of the head glint.
                    headSpecularProgressWidth: 0.22,
                    // Cross-section center of the head glint.
                    headSpecularCrossSectionCenter: 0.34,
                    // Cross-section width of the head glint.
                    headSpecularCrossSectionWidth: 0.18,
                    // Brightness contribution from the head glint.
                    headSpecularStrength: 0.34,
                    // Cross-section center of the lower edge shadow.
                    lowerEdgeShadowCenter: 0.9,
                    // Cross-section width of the lower edge shadow.
                    lowerEdgeShadowWidth: 0.18,
                    // Darkness contribution from the lower edge shadow.
                    lowerEdgeShadowStrength: 0.22,
                    // Cross-section center of the upper edge shadow.
                    upperEdgeShadowCenter: 0.08,
                    // Cross-section width of the upper edge shadow.
                    upperEdgeShadowWidth: 0.14,
                    // Darkness contribution from the upper edge shadow.
                    upperEdgeShadowStrength: 0.13,
                    // Power curve for broad edge darkening.
                    edgeShadowPower: 1.8,
                    // Darkness contribution from broad edge darkening.
                    edgeShadowStrength: 0.09,
                    // Brightness contribution from the rounded lens core.
                    lensHighlightStrength: 0.14,
                    // Maximum amount of white mixed into highlights.
                    highlightWhiteMixMax: 0.3,
                    // Maximum amount of shadow color mixed into dark regions.
                    shadowMixMax: 0.16,
                    // Baseline material alpha before lens/specular additions.
                    materialAlphaBase: 0.9,
                    // Maximum material alpha before circular masking and translucency.
                    materialAlphaMax: 0.98,
                    // Alpha contribution from the rounded lens core.
                    lensAlphaStrength: 0.12,
                    // Alpha contribution from the upper specular band.
                    upperSpecularAlphaStrength: 0.05,
                    // Alpha contribution from the head glint.
                    headSpecularAlphaStrength: 0.04,
                },
                // Circular-disc-only sampler and lighting coefficients.
                discMaterial: {
                    // Amount that disc body volume darkens the sampled glass color.
                    absorptionVolumeStrength: 0.035,
                    // Amount that rim fresnel darkens the sampled glass color.
                    absorptionFresnelStrength: 0.2,
                    // Amount that internal shadows darken the sampled glass color.
                    absorptionInnerShadowStrength: 0.22,
                    // Amount that caustic bands brighten transmitted glass color.
                    causticLightStrength: 0.54,
                    // Amount that specular regions brighten transmitted glass color.
                    specularLightStrength: 0.66,
                    // Baseline multiplier applied to the shared material alpha.
                    alphaBaseMultiplier: 0.92,
                    // Additional alpha contributed by disc body volume.
                    alphaVolumeStrength: 0.12,
                    // Additional alpha contributed by specular regions.
                    specularAlphaStrength: 0.022,
                    // Additional alpha contributed by caustic regions.
                    causticAlphaStrength: 0.014,
                    // Maximum final alpha for the baked disc pixels.
                    alphaMax: 0.98,
                    // Normalized radius where rim-thickness shading starts.
                    rimThicknessStart: 0.56,
                    // Normalized radius where rim-thickness shading reaches full strength.
                    rimThicknessEnd: 1,
                    // Vertical center of the upper meniscus shadow band.
                    upperMeniscusShadowCenterY: -0.42,
                    // Vertical width of the upper meniscus shadow band.
                    upperMeniscusShadowWidthY: 0.08,
                    // Horizontal center of the upper meniscus shadow band.
                    upperMeniscusShadowCenterX: 0.02,
                    // Horizontal width of the upper meniscus shadow band.
                    upperMeniscusShadowWidthX: 0.68,
                    // Vertical center of the lower meniscus depth band.
                    lowerMeniscusDepthCenterY: 0.64,
                    // Vertical width of the lower meniscus depth band.
                    lowerMeniscusDepthWidthY: 0.18,
                    // Horizontal center of the lower meniscus depth band.
                    lowerMeniscusDepthCenterX: -0.02,
                    // Horizontal width of the lower meniscus depth band.
                    lowerMeniscusDepthWidthX: 0.64,
                    // Vertical center of the lower transmitted-light band.
                    lowerTransmittedLightCenterY: 0.5,
                    // Vertical width of the lower transmitted-light band.
                    lowerTransmittedLightWidthY: 0.16,
                    // Horizontal center of the lower transmitted-light band.
                    lowerTransmittedLightCenterX: -0.1,
                    // Horizontal width of the lower transmitted-light band.
                    lowerTransmittedLightWidthX: 0.5,
                    // Vertical center of the top reflection.
                    topReflectionCenterY: -0.28,
                    // Vertical width of the top reflection.
                    topReflectionWidthY: 0.1,
                    // Horizontal center of the top reflection.
                    topReflectionCenterX: -0.24,
                    // Horizontal width of the top reflection.
                    topReflectionWidthX: 0.26,
                    // Horizontal center of the left-edge reflection.
                    leftEdgeReflectionCenterX: -0.48,
                    // Horizontal width of the left-edge reflection.
                    leftEdgeReflectionWidthX: 0.08,
                    // Vertical center of the left-edge reflection.
                    leftEdgeReflectionCenterY: -0.08,
                    // Vertical width of the left-edge reflection.
                    leftEdgeReflectionWidthY: 0.46,
                    // Horizontal center of the small internal glint.
                    smallGlintCenterX: -0.18,
                    // Horizontal width of the small internal glint.
                    smallGlintWidthX: 0.04,
                    // Vertical center of the small internal glint.
                    smallGlintCenterY: -0.02,
                    // Vertical width of the small internal glint.
                    smallGlintWidthY: 0.06,
                    // Horizontal frequency of the broad internal wave used for striations.
                    horizontalWaveFrequencyX: 3.6,
                    // Vertical frequency of the broad internal wave used for striations.
                    horizontalWaveFrequencyY: 0.7,
                    // Phase offset for the broad internal wave.
                    horizontalWavePhase: 0.15,
                    // Horizontal frequency of the fine internal wave used for striations.
                    fineWaveFrequencyX: 8.2,
                    // Vertical frequency of the fine internal wave used for striations.
                    fineWaveFrequencyY: -1.4,
                    // Phase offset for the fine internal wave.
                    fineWavePhase: 0.35,
                    // Vertical center of the upper internal striation band.
                    upperStriationCenterY: -0.16,
                    // Vertical width of the upper internal striation band.
                    upperStriationWidthY: 0.18,
                    // Baseline opacity of the upper internal striation band.
                    upperStriationBase: 0.42,
                    // Broad-wave contribution to the upper internal striation band.
                    upperStriationHorizontalWaveStrength: 0.4,
                    // Fine-wave contribution to the upper internal striation band.
                    upperStriationFineWaveStrength: 0.1,
                    // Vertical center of the lower internal striation band.
                    lowerStriationCenterY: 0.34,
                    // Vertical width of the lower internal striation band.
                    lowerStriationWidthY: 0.18,
                    // Horizontal center of the lower internal striation band.
                    lowerStriationCenterX: 0.16,
                    // Horizontal width of the lower internal striation band.
                    lowerStriationWidthX: 0.56,
                    // Vertical center of the soft internal veil.
                    internalVeilCenterY: 0.02,
                    // Vertical width of the soft internal veil.
                    internalVeilWidthY: 0.38,
                    // Baseline opacity of the soft internal veil.
                    internalVeilBase: 0.32,
                    // Broad-wave contribution to the soft internal veil.
                    internalVeilHorizontalWaveStrength: 0.22,
                    // Baseline slab thickness used for non-spherical glass shading.
                    flatThicknessBase: 0.48,
                    // Rim contribution to slab thickness.
                    flatThicknessRimStrength: 0.28,
                    // Lower-depth contribution to slab thickness.
                    flatThicknessLowerDepthStrength: 0.18,
                    // Internal-veil contribution to slab thickness.
                    flatThicknessInternalVeilStrength: 0.08,
                    // Vertical coordinate where extra slab depth starts ramping in.
                    flatThicknessVerticalDepthStartY: -0.12,
                    // Vertical coordinate where extra slab depth reaches full strength.
                    flatThicknessVerticalDepthEndY: 0.9,
                    // Strength of the vertical slab-depth ramp.
                    flatThicknessVerticalDepthStrength: 0.1,
                    // Baseline directional light value before local bands adjust it.
                    directionalLightBase: 0.24,
                    // Directional-light contribution from the lower transmitted-light band.
                    directionalLightLowerTransmittedStrength: 0.26,
                    // Directional-light contribution from the top reflection.
                    directionalLightTopReflectionStrength: 0.22,
                    // Directional-light contribution from the left-edge reflection.
                    directionalLightLeftEdgeStrength: 0.1,
                    // Directional-light contribution from the upper striation band.
                    directionalLightUpperStriationStrength: 0.06,
                    // Directional-light contribution from the lower striation band.
                    directionalLightLowerStriationStrength: 0.08,
                    // Directional-light subtraction from the upper meniscus shadow.
                    directionalLightUpperMeniscusShadowStrength: 0.12,
                    // Directional-light subtraction from rim thickness.
                    directionalLightRimShadowStrength: 0.1,
                    // Baseline cross-section coordinate passed into the shared material shader.
                    crossSectionBase: 0.5,
                    // Vertical contribution to the shared material cross-section coordinate.
                    crossSectionYStrength: 0.58,
                    // Horizontal skew contribution to the shared material cross-section coordinate.
                    crossSectionXStrength: 0.035,
                    // Baseline opacity multiplier for the circular alpha mask.
                    lensAlphaBase: 0.84,
                    // Alpha-mask contribution from slab thickness.
                    lensAlphaThicknessStrength: 0.12,
                    // Alpha-mask contribution from the lower-depth band.
                    lensAlphaLowerDepthStrength: 0.04,
                    // Baseline progress coordinate passed into the shared material shader.
                    progressBase: 0.14,
                    // Directional-light contribution to shared material progress.
                    progressLightStrength: 0.64,
                    // Caustic contribution from the lower transmitted-light band.
                    causticLowerLightStrength: 0.58,
                    // Caustic contribution from the lower striation band.
                    causticLowerStriationStrength: 0.18,
                    // Specular contribution from the top reflection.
                    specularTopReflectionStrength: 0.68,
                    // Specular contribution from the left-edge reflection.
                    specularLeftEdgeStrength: 0.48,
                    // Specular contribution from the small internal glint.
                    specularSmallGlintStrength: 0.9,
                    // Internal-shadow contribution from the upper meniscus shadow.
                    innerShadowUpperMeniscusStrength: 0.76,
                    // Internal-shadow contribution from rim thickness.
                    innerShadowRimStrength: 0.16,
                    // Internal-shadow contribution from the soft internal veil.
                    innerShadowVeilStrength: 0.1,
                },
            },
            // SVG texture settings for the clipped pattern layer under the icon and over the glass.
            texture: {
                // Fallback texture color when model metadata has no valid brand color.
                fallbackColor: '#4B5D70',
                // Brand-color remap used to tint the SVG pattern toward a lighter glass-readable color.
                brandColorMix: {
                    // Target color mixed into the model brand color for the pattern fill.
                    targetColor: colorPalette.nightBlue,
                    // Blend amount from model brand color to the pattern target color.
                    amount: 0.32,
                },
                // SVG path fill opacity baked into the generated pattern data URL.
                fillOpacity: 0.36,
                // Screen-pixel inset from glass edge to the clipped texture circle.
                inset: 4,
                // CSS opacity applied to the clipped pattern layer.
                opacity: 0.9,
                // Percent background-size applied to the SVG pattern inside the clipped circle.
                backgroundSizePercent: 142,
            },
        },
        // Width sizing for the branch marker pill that hugs a user message. The
        // sizing metrics come from the shared mediaGenerationLayoutSettings.marker
        // so the API layout estimates marker dimensions with identical values —
        // tune them in @lixpi/constants only.
        marker: {
            // Multiplier on branchOrigin.size for the marker's comfortable minimum width (the pill never shrinks below this).
            minWidthMultiplier: mediaGenerationLayoutSettings.marker.minWidthMultiplier,
            // Multiplier on the minimum width capping how wide an on-canvas (already-placed) marker may grow before its preview wraps to a second line and truncates. Lower it to keep long placed messages more compact.
            maxWidthGrowth: mediaGenerationLayoutSettings.marker.maxWidthGrowth,
            // Multiplier on the minimum width capping the screen-fixed preflight pose. Kept wider than maxWidthGrowth so long prompts stay on one line while still being assessed; once the marker lands on the canvas it tightens to maxWidthGrowth.
            screenFixedMaxWidthGrowth: mediaGenerationLayoutSettings.marker.screenFixedMaxWidthGrowth,
            // Hard cap on the screen-fixed preflight pose's on-screen width as a fraction of the prompt input field width. The pill hugs its content but never grows past this share of the input; longer messages truncate with an ellipsis.
            screenFixedMaxWidthFraction: mediaGenerationLayoutSettings.marker.screenFixedMaxWidthFraction,
            // Text sizing for the marker's preview lines. Matches the floating detail panel's body text (1rem / 16px) so a marker reads at the same size as the thread it represents.
            text: mediaGenerationLayoutSettings.marker.text,
        },
    },

    // Shared workspace/document persistence timing, sourced from @lixpi/constants
    // so browser fallback saves and API settled snapshots use the same delay.
    workspacePersistence: workspacePersistenceSettings,

    // Document / chat-thread descriptor generation (the text "meta" the workspace relevance engine ranks on).
    contentDescriptor: {
        // Quiet period (ms) before a text node descriptor seed/refresh runs.
        // Kept aligned with workspace persistence so document-derived workspace metadata settles on the same cadence.
        editDebounceMs: workspacePersistenceSettings.debounceMs,
        // Minimum trimmed plain-text length before a document/thread is worth describing. Below this we skip the model call (nothing meaningful to summarize).
        minTextLength: 16,
    },
}
