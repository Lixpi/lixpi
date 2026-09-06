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
}

export const uiKitSettings: UiKitRuntimeSettings = {
    modelSelectorDropdown: {
        useModalityFilter: false,
    },
    dropdown: {
        errorState: {
            fallbackTitle: 'Error state',
            textColor: '#be4e1a',
        },
        styles: {
            popoverBoxShadow: '0 2px 12px rgb(0 0 0 / 10%)',
        },
    },
    slidingDropdown: {
        styles: {
            surface: {
                closedBackgroundColor: 'transparent',
                openBackgroundColor: 'rgb(241, 242, 244)',
            },
            indicator: {
                backgroundColor: 'rgba(255, 255, 255, 0.72)',
                boxShadow: 'none',
                insetShadow: {
                    topColor: 'rgba(255, 255, 255, 0.86)',
                    bottomColor: 'rgba(0, 0, 0, 0)',
                },
                closedBorderColor: 'rgba(105, 115, 133, 0.1)',
                closedBorderWidth: 0,
                openBorderColor: 'rgba(105, 115, 133, 0.07)',
                openBorderWidth: 1.5,
            },
            option: {
                textColor: 'rgba(49, 59, 78, 0.68)',
                activeTextColor: '#1a2744',
                disabledTextColor: 'rgba(49, 59, 78, 0.32)',
                fontSize: 12,
                fontWeight: 400,
                selectedFontWeight: 400,
            },
            openShadow: {
                color: '#000000',
                opacity: 0.09,
                offsetX: 0,
                offsetY: 2,
                blurRadius: 6,
                spreadRadius: 3,
            },
        },
    },
}

export const configureUiKit = (settings: UiKitRuntimeSettings): void => {
    uiKitSettings.modelSelectorDropdown = settings.modelSelectorDropdown
    uiKitSettings.dropdown = settings.dropdown
    uiKitSettings.slidingDropdown = settings.slidingDropdown
}
