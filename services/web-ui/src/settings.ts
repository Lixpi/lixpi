import {
    mediaGenerationLayoutSettings,
    workspacePersistenceSettings,
} from '@lixpi/constants'
import {
    type BoundedZoomScalingOptions,
} from '@lixpi/canvas-engine/shared'
import {
    type UiKitSlidingDropdownStyles,
} from '@lixpi/ui-kit'
import {
    createLixpiCanvasSettings,
    type LixpiCanvasSettings,
} from '@lixpi/canvas-components-lixpi-specific/frontend/settings'

export type {
    BoundedZoomScalingSettings,
    ConnectorSettings,
    GenerationBorderGlassMaterialSettings,
    CanvasBubbleMenuSettings,
    CanvasChromeSettings,
    SelectionSettings,
    MediaNodeSettings,
    WorkspaceLoadingOutlineSettings,
    MediaBranchLineageColorMixSettings,
    MediaBranchLineageColorAdjustSettings,
    MediaBranchLineageMediaModelCircleSettings,
    MediaBranchLineageSettings,
} from '@lixpi/canvas-components-lixpi-specific/frontend/settings'

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

export type SlidingDropdownSettings = {
    styles: UiKitSlidingDropdownStyles
}

export type AiModelControlsSettings = {
    styles: {
        modelDropdown: {
            width: number
            height: number
            valueFontSize: number
            horizontalPadding: number
            iconSize: number
            iconLabelGap: number
        }
        dimensionsDropdown: {
            width: number
            height: number
            valueFontSize: number
            horizontalPadding: number
            glyphColumnWidth: number
            glyphValueGap: number
            contentCenterYRatio: number
        }
        dimensionsGlyph: {
            targetArea: number
            maxDimension: number
            adaptiveSize: number
            cornerRadius: number
            strokeWidth: number
            adaptiveLabelFontSize: number
            adaptiveLabelFontWeight: number
        }
    }
}

export type GradientSettings = {
    styles: {
        shiftingColors: [string, string, string, string]
    }
}

export type HelpTooltipSettings = {
    interactiveHideDelayMs: number
    providerShowDelayMs: number
}

export type HoverSettings = {
    transitionDurationMs: number
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
    typography: {
        contentFontSize: number
        tagPillFontSize: number
        tagPillFontWeight: number
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

export type RightPanelModeSwitchSettings = {
    height: number
    transitionDurationMs: number
    transitionMinDurationMs: number
    transitionDistanceSpeedupFactor: number
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
    panelSwitch: RightPanelModeSwitchSettings
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
        controlLabelFontSize: string
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

export type VideoControlsSettings = import('@lixpi/ui-kit/components/video-controls').VideoControlsSettings & {
    canvas: {
        horizontalInset: number
        compactHorizontalInset: number
        compactWidthThreshold: number
        bottomInset: number
        zoomScaling: BoundedZoomScalingOptions
    }
    chat: {
        horizontalInset: number
        bottomInset: number
        controlsScale: number
        minWidth: number
        fallbackWidth: number
    }
}

export type MediaLibrarySettings = {
    panelWidthFraction: number
}

export type ContentDescriptorSettings = {
    editDebounceMs: number
    minTextLength: number
}

export type Settings = LixpiCanvasSettings & {
    modelSelectorDropdown: ModelSelectorDropdownSettings

    dropdown: DropdownSettings

    slidingDropdown: SlidingDropdownSettings

    aiModelControls: AiModelControlsSettings

    gradient: GradientSettings

    helpTooltip: HelpTooltipSettings

    hover: HoverSettings

    rightSidePanel: RightSidePanelSettings

    navigationSidePanel: NavigationSidePanelSettings

    aiChatThread: AiChatThreadSettings

    aiPromptInput: AiPromptInputSettings

    videoControls: VideoControlsSettings

    mediaLibrary: MediaLibrarySettings

    contentDescriptor: ContentDescriptorSettings
}

export const settings: Settings = {
    ...createLixpiCanvasSettings(colorPalette),
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

    // Expanded sliding-dropdown surface settings.
    slidingDropdown: {
        styles: {
            surface: {
                // Background behind the selected row while collapsed. Keep this transparent to remove the outer ring created by the indicator inset.
                closedBackgroundColor: 'transparent',
                // Background of the full option tape while expanded.
                openBackgroundColor: 'rgb(241, 242, 244)',
            },
            indicator: {
                // Fill of the selected row in both collapsed and expanded states.
                backgroundColor: 'rgba(255, 255, 255, 0.72)',
                // SVG drop-shadow parameters for the selected row. Use `none` to disable its independent shadow.
                boxShadow: 'none',
                insetShadow: {
                    // Highlight color along the selected row's upper edge.
                    topColor: 'rgba(255, 255, 255, 0.86)',
                    // Shadow color along the selected row's lower edge. Use a transparent color to disable the lower inset shadow.
                    bottomColor: 'rgba(0, 0, 0, 0)',
                },
                // Border color around the selected row while collapsed. This is ignored visually when `closedBorderWidth` is zero.
                closedBorderColor: 'rgba(105, 115, 133, 0.1)',
                // Border width around the selected row while collapsed. Zero removes the closed-state border.
                closedBorderWidth: 0,
                // Border color around the selected row while the option tape is expanded.
                openBorderColor: 'rgba(105, 115, 133, 0.07)',
                // Border width around the selected row while the option tape is expanded.
                openBorderWidth: 1,
            },
            option: {
                // Text and glyph color for unselected options.
                textColor: 'rgba(49, 59, 78, 0.68)',
                // Text and glyph color for the selected or hovered option.
                activeTextColor: '#1a2744',
                // Text and glyph color for disabled options.
                disabledTextColor: 'rgba(49, 59, 78, 0.32)',
                // Option-label font size in SVG user units.
                fontSize: 12,
                // Font weight for unselected option labels.
                fontWeight: 400,
                // Font weight for the selected option label.
                selectedFontWeight: 400,
            },
            openShadow: {
                // Color of the separate shadow behind the expanded tape.
                color: '#000000',
                // Shadow opacity from zero (invisible) to one (fully opaque).
                opacity: 0.09,
                // Horizontal shadow offset in SVG user units. Positive values move it right.
                offsetX: 0,
                // Vertical shadow offset in SVG user units. Positive values move it down.
                offsetY: 2,
                // CSS-style blur radius. Larger values make the shadow softer and extend it farther.
                blurRadius: 6,
                // Distance the shadow shape expands before blurring. Larger values increase its footprint without increasing density.
                spreadRadius: 3,
            },
        },
    },

    // Model-specific controls rendered inside the shared dropdown primitives.
    aiModelControls: {
        styles: {
            modelDropdown: {
                // Initial width before the sliding dropdown measures the selected model name.
                width: 190,
                // Height of each model selector row in SVG user units.
                height: 38,
                // Font size of model names in SVG user units.
                valueFontSize: 12,
                // Minimum visible gap between the indicator border and model content.
                horizontalPadding: 7,
                // Size of provider icons in SVG user units.
                iconSize: 14,
                // Gap between the provider icon and model name.
                iconLabelGap: 7,
            },
            dimensionsDropdown: {
                // Initial layout width used before a media configuration dropdown can measure its option content.
                width: 68,
                // Height of a closed media configuration dropdown in SVG user units.
                height: 38,
                // Font size of the media configuration value in SVG user units.
                valueFontSize: 12,
                // Minimum visible gap between the indicator border and option content.
                horizontalPadding: 5,
                // Width of the first layout column. Every glyph is centered in this column so values share one left edge.
                glyphColumnWidth: 20,
                // Gap between the glyph and value, matching the model tag pill's icon gap.
                glyphValueGap: 3,
                // Shared vertical center of the glyph and value, as a fraction of the option height.
                contentCenterYRatio: 0.5,
            },
            dimensionsGlyph: {
                // Target rectangle area in square SVG user units. Equal area keeps image sizes and aspect ratios at comparable visual weight.
                targetArea: 169,
                // Maximum width or height in SVG user units. This prevents extreme ratios from overflowing their option row.
                maxDimension: 20,
                // Width and height of the dashed Auto glyph in SVG user units.
                adaptiveSize: 12,
                // Corner radius of image-size and aspect-ratio rectangles in SVG user units.
                cornerRadius: 2,
                // Outline width of image-size and aspect-ratio rectangles in SVG user units.
                strokeWidth: 1.5,
                // Font size of the A inside the dashed Auto glyph in SVG user units.
                adaptiveLabelFontSize: 7,
                // Font weight of the A inside the dashed Auto glyph.
                adaptiveLabelFontWeight: 700,
            },
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
        // Delay before the delegated provider shows simple ARIA-backed tooltips.
        providerShowDelayMs: 1000,
    },

    // Shared hover-state motion used by interactive Web UI controls.
    hover: {
        transitionDurationMs: 150,
    },

    // Right side panel surface, resize, toggle, and slide settings.
    rightSidePanel: {
        defaultDimensions: {
            // Screen-pixel width before the user has resized the panel.
            width: 494,
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
        typography: {
            // Screen-pixel size shared by regular messages and generation-trace content.
            contentFontSize: 14,
            // Screen-pixel typography for execution-trace tag pills in the sidebar timeline.
            tagPillFontSize: 12,
            tagPillFontWeight: 400,
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

    // Right side panel mode switch and generated-output detail context previews.
    aiChatThread: {
        panelSwitch: {
            // Screen-pixel height for the right panel mode switch.
            height: 28,
            // Base active-tab slide duration.
            transitionDurationMs: 160,
            // Lower bound when jumping across distant modes.
            transitionMinDurationMs: 100,
            // Per-mode distance speedup. Higher values compress long jumps more.
            transitionDistanceSpeedupFactor: 0.28,
        },

        // Theming for the AI Chat panel's context-preview tray chips and hover popover. Verified single-use: these tokens only feed the `--workspace-ai-chat-panel-context-*` CSS variables, applied to the panel element in WorkspaceCanvas.applyAiChatPanelContextPreviewSettings. The shared components/contextPreview tile renderer is reused by generated-output details but does not read these tokens, so the settings stay panel-scoped here rather than in a standalone section.
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
                // Minimum width of the model-settings surface. Its content can expand the surface up to the viewport-aware CSS cap.
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
                // Font size used by Model, Models, Aspect ratio, Resolution, and other control labels.
                controlLabelFontSize: '12px',
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
                helpTooltipBoxShadow: '0 6px 18px rgba(0, 0, 0, 0.18)',
                helpTooltipColor: '#fff',
            },
        },
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

    // Document / chat-thread descriptor generation (the text "meta" the workspace relevance engine ranks on).
    contentDescriptor: {
        // Quiet period (ms) before a text node descriptor seed/refresh runs.
        // Kept aligned with workspace persistence so document-derived workspace metadata settles on the same cadence.
        editDebounceMs: workspacePersistenceSettings.debounceMs,
        // Minimum trimmed plain-text length before a document/thread is worth describing. Below this we skip the model call (nothing meaningful to summarize).
        minTextLength: 16,
    },
}
