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
import { lixpiLightTheme } from '@lixpi/themes'
import { createLixpiCanvasSettings } from './canvas-settings.ts'
import {
    type LixpiCanvasSettings,
} from './types.ts'

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
    overlay: {
        enabled: boolean
        closeOnPointerDown: boolean
        fill: string
        fillOpaque: string
        opacity: number
    }
    // Slide timing and swipe thresholds come from `uiKitSettings.sidePanel`.
    drag: {
        enabled: boolean
    }
    styles: {
        backdropFill: string
        backdropFillOpaque: string
        toggleColor: string
        toggleHoverColor: string
    }
}

export type NavigationSidePanelSettings = Omit<RightSidePanelSettings, 'layout' | 'typography'>

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
    mediaModeSwitch: {
        styles: {
            trackBackgroundColor: string
            indicatorBackgroundColor: string
            unselectedOptionColor: string
            hoveredOptionColor: string
            selectedOptionColor: string
            indicatorBoxShadow: string
        }
    }
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

export const createLixpiUiSettings = (): Settings => {
    const components = structuredClone(lixpiLightTheme.components)
    const rightPanel = components.rightPanel.geometry
    const navigation = components.navigation.geometry

    return {
        ...createLixpiCanvasSettings(),
        // Shared by startup, workspace switches, and pending document/artifact content.
        workspaceLoadingOutline: {
            // Screen-pixel diameter of the loading circle.
            diameter: 100,
            // How long one full 360° turn of the spinner takes, in
            // milliseconds, during the first fast turns. Lower spins faster.
            // Later cycles add their slowdown on top of this.
            animationDurationMs: 400,
            // The spinner turns in repeating cycles: a few fast turns, then
            // one slow turn. With the values below, one cycle is
            // fast, fast, slow. Each cycle after the first makes all of its
            // turns slower by the same amount at once.
            spinCycle: {
                // How many fast turns each cycle starts with before its slow
                // turn. 2 gives fast, fast, slow.
                fastTurns: 2,
                // How long the slow turn takes compared with a fast turn in
                // the same cycle. 1.75 makes a 300ms fast turn's slow turn
                // take 525ms.
                slowTurnDurationFactor: 1.3,
                // Milliseconds added to every turn when the second cycle
                // starts. 0 turns the slowdown off and repeats the first
                // cycle forever.
                firstSlowdownMs: 40,
                // Decay rate: how much bigger each cycle's slowdown is than
                // the previous one. 2 adds 40ms, then 80ms, then 160ms.
                // 1 adds 40ms every cycle. Higher slows down harder.
                slowdownGrowthFactor: 2,
                // The slowest a slow turn may get, in milliseconds. When the
                // next cycle would pass it, the current cycle repeats forever.
                maxSlowTurnDurationMs: 2400,
            },
            // Fraction of the circle's circumference occupied by the trail.
            snakeLengthFraction: 0.6,
        },
        // Model selector dropdown behavior settings.
        modelSelectorDropdown: {
            // Hide or reveal modality filter chips inside model selector dropdowns.
            useModalityFilter: false,
        },

        // Shared dropdown surface settings.
        dropdown: {
            errorState: {
                fallbackTitle: 'Error state',
                textColor: lixpiLightTheme.feedback.danger,
            },
            styles: components.dropdown.popover,
        },

        // Expanded sliding-dropdown surface settings.
        slidingDropdown: {
            styles: components.slidingDropdown.workspace,
        },

        // Model-specific controls rendered inside the shared dropdown primitives.
        aiModelControls: {
            styles: components.composer.modelControls,
        },

        // Shared generated-gradient settings.
        gradient: {
            styles: components.shiftingGradient,
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
                width: rightPanel.defaultWidth,
            },
            dimensions: {
                // Minimum screen-pixel width while resizing.
                minWidth: rightPanel.minWidth,
                // Remaining pane width kept visible when computing the dynamic max width.
                maxPaneMargin: rightPanel.maxPaneMargin,
            },
            layout: {
                // Inner horizontal inset for the panel content column.
                contentInset: rightPanel.contentInset,
            },
            typography: {
                // Screen-pixel size shared by regular messages and generation-trace content.
                contentFontSize: Number.parseFloat(lixpiLightTheme.typography.panel.fontSize),
                // Screen-pixel typography for execution-trace tag pills in the sidebar timeline.
                tagPillFontSize: Number.parseFloat(lixpiLightTheme.typography.control.fontSize),
                tagPillFontWeight: lixpiLightTheme.typography.control.fontWeight,
            },
            resizeHandle: {
                ...components.sidePanel.resizeHandle,
                styles: {
                    // Background gradient painted on the visible resize-handle line.
                    gradient: lixpiLightTheme.panel.resizeHandle.gradient,
                    // Visible line width; this does not change the draggable hit target.
                    width: lixpiLightTheme.panel.resizeHandle.width,
                },
            },
            toggle: {
                openAriaLabel: 'Collapse right side panel',
                closedAriaLabel: 'Open right side panel',
                // Position when the panel is open.
                openOffset: `calc(var(--workspace-right-side-panel-width) + ${rightPanel.toggle.openOffset}px)`,
                // Travel distance used when the panel is closed.
                closedTravel: `calc(var(--workspace-right-side-panel-width) - ${rightPanel.toggle.closedTravelInset}px)`,
                top: rightPanel.toggle.top,
                size: rightPanel.toggle.size,
            },
            overlay: {
                // Full-canvas dark glass tint layer behind the side panel.
                enabled: false,
                closeOnPointerDown: true,
                ...components.sidePanel.overlay,
            },
            drag: {
                // Vaul-style horizontal swipe-to-close gesture for pointer/touch input.
                enabled: true,
            },
            styles: {
                backdropFill: lixpiLightTheme.panel.background,
                backdropFillOpaque: lixpiLightTheme.panel.opaqueBackground,
                toggleColor: lixpiLightTheme.panel.toggle.color,
                toggleHoverColor: lixpiLightTheme.panel.toggle.hover,
            },
        },

        // Navigation side panel (workspace list) surface, resize, toggle, and slide settings.
        navigationSidePanel: {
            defaultDimensions: {
                // Screen-pixel width before the user has resized the panel.
                width: navigation.defaultWidth,
            },
            dimensions: {
                // Minimum screen-pixel width while resizing.
                minWidth: navigation.minWidth,
                // Remaining pane width kept visible when computing the dynamic max width.
                maxPaneMargin: navigation.maxPaneMargin,
            },
            resizeHandle: {
                ...components.sidePanel.resizeHandle,
                styles: {
                    // Background gradient painted on the visible resize-handle line.
                    gradient: lixpiLightTheme.panel.resizeHandle.gradient,
                    // Visible line width; this does not change the draggable hit target.
                    // The theme sets it to zero because the sidebar shadow marks the boundary.
                    width: lixpiLightTheme.navigation.sidebar.resizeHandleWidth,
                },
            },
            toggle: {
                openAriaLabel: 'Collapse navigation side panel',
                closedAriaLabel: 'Open navigation side panel',
                // Keep the navigation toggle anchored; the panel opens underneath
                // it instead of pushing the button to the panel edge.
                motion: 'fixed',
                ...navigation.toggle,
            },
            overlay: {
                // The visual overlay is disabled so the workspace list does not dim
                // the canvas. `closeOnPointerDown` still collapses the panel from
                // document-level outside clicks.
                enabled: false,
                closeOnPointerDown: true,
                ...components.sidePanel.overlay,
            },
            drag: {
                // Vaul-style horizontal swipe-to-close gesture for pointer/touch input.
                enabled: true,
            },
            styles: {
                backdropFill: lixpiLightTheme.navigation.sidebar.backdrop,
                backdropFillOpaque: lixpiLightTheme.navigation.sidebar.opaqueBackdrop,
                toggleColor: lixpiLightTheme.panel.toggle.color,
                toggleHoverColor: lixpiLightTheme.panel.toggle.hover,
            },
        },

        // Right side panel mode switch and generated-output detail context previews.
        aiChatThread: {
            panelSwitch: {
                // Screen-pixel height for the right panel mode switch before the canvas theme is bound.
                height: rightPanel.modeSwitchHeight,
                // Base active-tab slide duration.
                transitionDurationMs: 160,
                // Lower bound when jumping across distant modes.
                transitionMinDurationMs: 100,
                // Per-mode distance speedup. Higher values compress long jumps more.
                transitionDistanceSpeedupFactor: 0.28,
            },

            // Theming for the AI Chat panel's context-preview tray chips and hover popover. Verified single-use: these tokens only feed the `--workspace-ai-chat-panel-context-*` CSS variables, applied to the panel element in WorkspaceCanvas.applyAiChatPanelContextPreviewSettings. The shared components/contextPreview tile renderer is reused by generated-output details but does not read these tokens, so the settings stay panel-scoped here rather than in a standalone section.
            contextPreview: {
                styles: components.contextPreview.styles,
            },

            styles: components.chat.panel,
        },

        // Floating AI prompt input settings.
        aiPromptInput: {
            // Enable the shifting gradient background on floating prompt input nodes.
            useShiftingGradientBackground: true,
            // Image/video generation mode switch appearance.
            mediaModeSwitch: {
                styles: components.composer.modeSwitch,
            },
            // Model settings menu presentation. The infoBubble shadow is configured separately from dropdown popovers.
            modelMenu: {
                styles: components.composer.modelMenu,
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
            typography: components.videoControls.typography,
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
            styles: components.videoControls.styles,
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
}

export const settings = createLixpiUiSettings()
