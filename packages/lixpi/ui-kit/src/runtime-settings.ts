import { lixpiLightTheme } from '@lixpi/themes'

export type UiKitSlidingDropdownStyles = {
    surface: {
        closedBackgroundColor: string
        openBackgroundColor: string
    }
    indicator: {
        backgroundColor: string
        boxShadow: string
        insetShadow: {
            topColor: string
            bottomColor: string
        }
        closedBorderColor: string
        closedBorderWidth: number
        openBorderColor: string
        openBorderWidth: number
    }
    option: {
        textColor: string
        activeTextColor: string
        disabledTextColor: string
        fontSize: number
        fontWeight: number
        selectedFontWeight: number
    }
    openShadow: {
        color: string
        opacity: number
        offsetX: number
        offsetY: number
        blurRadius: number
        spreadRadius: number
    }
}

// `overlay` draws an open panel on top of the content beside it. `push` gives
// the panel its own space, so the content shrinks while the panel is open.
export type UiKitSidePanelPlacement = 'overlay' | 'push'

// The one look every application panel shares, on either side of the screen:
// web-ui's navigation and conversation panels and the documentation's
// navigation and inspector. Hosts choose only a side, a placement and, for
// wide content, a default width.
export type UiKitApplicationPanelSettings = {
    placement: UiKitSidePanelPlacement
    dimensions: {
        defaultWidth: number
        minWidth: number
        // Pane width kept visible beside the panel at its widest.
        maxPaneMargin: number
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
        motion: 'slide' | 'fixed'
        // Gap between the open panel's edge and its toggle.
        gap: string
        top: string
        // Distance of a closed toggle from its screen edge. The left toggle
        // clears the desktop app's traffic lights while its title bar shows.
        closedLeft: string
        closedRight: string
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
    }
    backdrop: {
        fill: string
        fillOpaque: string
    }
}

export type UiKitRuntimeSettings = {
    modelSelectorDropdown: {
        useModalityFilter: boolean
    }
    dropdown: {
        errorState: {
            fallbackTitle: string
            textColor: string
        }
        styles: {
            popoverBoxShadow: string
        }
    }
    slidingDropdown: {
        styles: UiKitSlidingDropdownStyles
    }
    // Motion every SidePanel uses unless a host passes its own override.
    sidePanel: {
        placement: UiKitSidePanelPlacement
        animation: {
            durationMs: number
            openEasing: string
            closeEasing: string
        }
        overlay: {
            opacity: number
        }
        drag: {
            // Fraction of the panel width a swipe must travel to close it.
            closeThreshold: number
            // Swipe speed in px/ms that closes the panel regardless of distance.
            velocityThreshold: number
            pointerSwipeStartThreshold: number
            touchSwipeStartThreshold: number
        }
    }
    applicationPanel: UiKitApplicationPanelSettings
}

// The application panel look is not configurable per host: every application
// shows the same panel.
export type UiKitSettingsOverrides = {
    [Key in Exclude<keyof UiKitRuntimeSettings, 'applicationPanel'>]?: UiKitRuntimeSettings[Key]
}

const components = structuredClone(lixpiLightTheme.components)

// The desktop app's title bar row puts the traffic lights where a closed left
// toggle would sit. `--window-title-bar-active` is 1 while that row shows.
const inWindowTitleBar = (
    browser: string,
    titleBar: string,
): string => `calc(${browser} * (1 - var(--window-title-bar-active, 0)) + ${titleBar} * var(--window-title-bar-active, 0))`

const TOGGLE_TOP = 'var(--window-title-bar-control-top)'

export const uiKitSettings: UiKitRuntimeSettings = {
    modelSelectorDropdown: {
        useModalityFilter: false,
    },
    dropdown: {
        errorState: {
            fallbackTitle: 'Error state',
            textColor: lixpiLightTheme.feedback.danger,
        },
        styles: components.dropdown.popover,
    },
    slidingDropdown: {
        styles: components.slidingDropdown.standalone,
    },
    sidePanel: {
        placement: 'overlay',
        animation: components.sidePanel.animation,
        overlay: {
            opacity: components.sidePanel.overlay.opacity,
        },
        drag: {
            closeThreshold: 0.25,
            velocityThreshold: 0.4,
            pointerSwipeStartThreshold: 2,
            touchSwipeStartThreshold: 10,
        },
    },
    applicationPanel: {
        placement: 'push',
        dimensions: {
            defaultWidth: components.navigation.geometry.defaultWidth,
            minWidth: components.navigation.geometry.minWidth,
            maxPaneMargin: components.navigation.geometry.maxPaneMargin,
        },
        resizeHandle: {
            ...components.sidePanel.resizeHandle,
            styles: {
                gradient: 'var(--theme-panel-resize-handle-gradient)',
                // The theme sets the line to zero: the panel shadow marks the edge.
                width: 'var(--theme-navigation-resize-handle-width)',
            },
        },
        toggle: {
            motion: 'slide',
            gap: '12px',
            top: TOGGLE_TOP,
            closedLeft: inWindowTitleBar(TOGGLE_TOP, 'var(--window-title-bar-toggle-left, 0px)'),
            closedRight: TOGGLE_TOP,
        },
        overlay: {
            enabled: false,
            closeOnPointerDown: false,
            ...components.sidePanel.overlay,
        },
        drag: {
            enabled: true,
        },
        backdrop: {
            fill: 'var(--theme-navigation-backdrop)',
            fillOpaque: 'var(--theme-navigation-backdrop-opaque)',
        },
    },
}

// Hosts call this once at startup. Every section they omit keeps the ui-kit
// default above, so a service only names what it deliberately changes.
export const configureUiKit = (overrides: UiKitSettingsOverrides): void => {
    uiKitSettings.modelSelectorDropdown = overrides.modelSelectorDropdown ?? uiKitSettings.modelSelectorDropdown
    uiKitSettings.dropdown = overrides.dropdown ?? uiKitSettings.dropdown
    uiKitSettings.slidingDropdown = overrides.slidingDropdown ?? uiKitSettings.slidingDropdown
    uiKitSettings.sidePanel = overrides.sidePanel ?? uiKitSettings.sidePanel
}
