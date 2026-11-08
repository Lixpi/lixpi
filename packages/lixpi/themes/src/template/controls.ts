// Complete appearance values for these component domains. No defaults are supplied here.
export type ControlTheme = {
    dropdown: {
        menu: {
            trigger: {
                height: string
                fontSize: string
                fontWeight: number
                radius: string
                letterSpacing: string
                hoverOpacity: number
                pressedOpacity: number
            }
            item: {
                fontSize: string
                compactFontSize: string
                popoverFontSize: string
                fontWeight: number
                selectedFontWeight: number
                radius: string
                headerRadius: string
                letterSpacing: string
                headerLineHeight: number
                metaFontSize: string
                metaFontWeight: number
                metaOpacity: number
                metaAlpha: number
                background: string
                highlightGradient: string
            }
            filter: {
                fontSize: string
                fontWeight: number
                titleLetterSpacing: string
                letterSpacing: string
                borderWidth: string
                radius: string
                background: string
                indicatorFontSize: string
                indicatorLineHeight: number
                titleAlpha: number
                borderAlpha: number
                hoverBorderAlpha: number
                activeBorderAlpha: number
                feedbackAlpha: number
            }
            defaults: {
                surfaceBackground: string
                surfaceForeground: string
                itemIcon: string
                stateLayer: string
                hoverLightnessAdjustment: string
                borderLightnessAdjustment: string
                accent: string
            }
            light: {
                glyphBase: string
                triggerBackground: string
                surfaceBackground: string
                surfaceForeground: string
                itemIcon: string
                stateLayer: string
                filterForeground: string
                accent: string
                hoverLightnessAdjustment: string
            }
            dark: {
                glyphBase: string
                triggerBackground: string
                surfaceBackground: string
                surfaceForeground: string
                itemIcon: string
                stateLayer: string
                filterForeground: string
                accent: string
                hoverLightnessAdjustment: string
            }
        }
        popover: {
            popoverBoxShadow: string
        }
    }
    slidingDropdown: {
        workspace: {
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
        standalone: {
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
    }
    tagPill: {
        variants: {
            neutral: {
                fill: string
                fillActive: string
                fillHover: string
                stroke: string
                strokeActive: string
                text: string
                closeHover: string
            }
            explicit: {
                fill: string
                fillActive: string
                fillHover: string
                stroke: string
                strokeActive: string
                text: string
                closeHover: string
            }
            auto: {
                fill: string
                fillActive: string
                fillHover: string
                stroke: string
                strokeActive: string
                text: string
                closeHover: string
            }
        }
        contentHoverFill: string
        fontSize: number
        fontWeight: number
    }
    toggleSwitch: {
        activeFill: string
        activeStroke: string
        inactiveFill: string
        inactiveStroke: string
        knobFill: string
        knobStroke: string
        checkmarkColor: string
        strokeWidth: number
        disabledOpacity: number
    }
    slider: {
        colors: {
            rail: string
            railActive: string
            thumb: string
            thumbHalo: string
            valueBubble: string
            valueText: string
        }
        fontSize: number
        fontWeight: number
    }
    videoControls: {
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
        typography: {
            timeFontSize: number
            timeFontWeight: number
        }
    }
    shiftingGradient: {
        shiftingColors: [string, string, string, string]
    }
}
