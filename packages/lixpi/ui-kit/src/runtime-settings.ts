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
}

export type UiKitSettingsOverrides = {
    [Key in keyof UiKitRuntimeSettings]?: UiKitRuntimeSettings[Key]
}

const components = structuredClone(lixpiLightTheme.components)

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
}

// Hosts call this once at startup. Every section they omit keeps the ui-kit
// default above, so a service only names what it deliberately changes.
export const configureUiKit = (overrides: UiKitSettingsOverrides): void => {
    uiKitSettings.modelSelectorDropdown = overrides.modelSelectorDropdown ?? uiKitSettings.modelSelectorDropdown
    uiKitSettings.dropdown = overrides.dropdown ?? uiKitSettings.dropdown
    uiKitSettings.slidingDropdown = overrides.slidingDropdown ?? uiKitSettings.slidingDropdown
    uiKitSettings.sidePanel = overrides.sidePanel ?? uiKitSettings.sidePanel
}
