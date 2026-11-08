// Complete appearance values for these component domains. No defaults are supplied here.
export type PanelTheme = {
    contextPreview: {
        elements: {
            image: {
                base: {
                    borderRadius: string
                }
            }
            videoGlyph: {
                base: {
                    borderRadius: string
                }
            }
            artifact: {
                base: {
                    foreground: string
                }
            }
            artifactTitle: {
                base: {
                    fontWeight: string
                }
            }
            documentTitle: {
                base: {
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            documentText: {
                base: {
                    fontSize: string
                    lineHeight: string
                }
            }
            expandedDocumentText: {
                base: {
                    fontSize: string
                }
            }
            inlinePopover: {
                base: {
                    borderRadius: string
                    background: string
                    shadow: string
                    foreground: string
                }
            }
            popoverTitle: {
                base: {
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            popoverText: {
                base: {
                    fontSize: string
                    lineHeight: string
                }
            }
            capabilityDescriptionPopover: {
                base: {
                    border: string
                }
            }
            descriptionBody: {
                base: {
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            descriptionTitle: {
                base: {
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            descriptionSectionTitle: {
                base: {
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            descriptionTermDivider: {
                base: {
                    borderTop: string
                }
            }
            descriptionTerm: {
                base: {
                    fontWeight: string
                }
            }
            descriptionMeta: {
                base: {
                    foreground: string
                    fontSize: string
                    fontWeight: string
                    letterSpacing: string
                }
            }
            capabilityDescriptionStatus: {
                base: {
                    foreground: string
                    fontSize: string
                }
            }
            capabilityDescriptionRetry: {
                base: {
                    border: string
                    borderRadius: string
                    background: string
                }
            }
        }
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
    sidePanel: {
        resizeHandle: {
            offset: number
            grabWidth: number
        }
        animation: {
            durationMs: number
            openEasing: string
            closeEasing: string
        }
        elements: {
            overlay: {
                base: {
                    backdropFilter: string
                    webkitBackdropFilter: string
                }
            }
            backdrop: {
                base: {
                    backdropFilter: string
                    webkitBackdropFilter: string
                }
            }
            resizeHandleLineUnderlay: {
                base: {
                    borderRadius: string
                }
            }
        }
        overlay: {
            fill: string
            fillOpaque: string
            opacity: number
        }
    }
    navigation: {
        geometry: {
            defaultWidth: number
            minWidth: number
            maxPaneMargin: number
            toggle: {
                openOffset: string
                top: string
                size: string
            }
        }
        header: {
            base: {
                padding: string
            }
        }
        list: {
            base: {
                gap: string
                paddingBlock: string
                paddingInline: string
            }
        }
        row: {
            base: {
                padding: string
            }
        }
        rowTags: {
            base: {
                gap: string
                marginBottom: string
            }
        }
        footer: {
            base: {
                padding: string
            }
        }
        sectionGroup: {
            base: {
                marginBottom: string
            }
        }
        sectionHeading: {
            base: {
                fontSize: string
                fontWeight: string
                lineHeight: string
                letterSpacing: string
                textTransform: string
                paddingInline: string
                paddingBlock: string
                margin: string
            }
        }
        toggle: {
            base: {
                borderRadius: string
            }
        }
        toggleUnderlay: {
            base: {
                inset: string
                borderRadius: string
            }
        }
        headerOverlay: {
            base: {
                inlineInset: string
                bottom: string
                height: string
                borderRadius: string
            }
        }
        newWorkspaceButton: {
            base: {
                size: string
                iconSize: string
                borderRadius: string
            }
        }
        footerSeparator: {
            base: {
                width: string
                height: string
                margin: string
                borderRadius: string
            }
        }
        avatarInitial: {
            base: {
                size: string
                lineHeight: string
            }
        }
    }
    rightPanel: {
        floatingPanel: {
            base: {
                borderRadius: string
            }
        }
        geometry: {
            defaultWidth: number
            minWidth: number
            maxPaneMargin: number
            contentInset: number
            modeSwitchHeight: number
            toggle: {
                openOffset: number
                closedTravelInset: number
                top: string
                size: string
            }
        }
        libraryGeometry: {
            stageMinWidth: number
            stageMinWidthWithParameters: number
            parametersDefaultWidth: number
            parametersMinWidth: number
            themeDefaultWidth: number
            themeMinWidth: number
            toggleGap: string
            themeToggleTop: string
        }
    }
    blockCards: {
        blockCardTilesList: {
            base: {
                borderBottom: string
            }
        }
        listTitle: {
            base: {
                foreground: string
                fontSize: string
                fontWeight: string
                letterSpacing: string
            }
        }
        empty: {
            base: {
                foreground: string
                fontSize: string
                lineHeight: string
            }
        }
        blockCardTile: {
            base: {
                borderRadius: string
            }
            hover: {
                backgroundImage: string
            }
        }
        open: {
            base: {
                foreground: string
            }
        }
        marker: {
            base: {
                borderRadius: string
                background: string
                shadow: string
            }
        }
        tileTitle: {
            base: {
                foreground: string
                fontSize: string
                fontWeight: string
                lineHeight: string
            }
        }
        primaryMeta: {
            base: {
                foreground: string
                fontSize: string
                lineHeight: string
            }
        }
        secondaryMeta: {
            base: {
                foreground: string
                fontSize: string
                lineHeight: string
            }
        }
        action: {
            base: {
                borderRadius: string
                foreground: string
            }
        }
        actionUnderlay: {
            base: {
                borderRadius: string
            }
        }
    }
    authPanel: {
        brandGradient: [string, string, string, string]
        authPanel: {
            base: {
                foreground: string
                background: string
                fontFamily: string
                lineHeight: string
            }
        }
        eyebrow: {
            base: {
                foreground: string
                fontSize: string
                fontWeight: string
                letterSpacing: string
            }
        }
        title: {
            base: {
                foreground: string
                fontSize: string
                fontWeight: string
                letterSpacing: string
                lineHeight: string
            }
        }
        description: {
            base: {
                foreground: string
                fontSize: string
                lineHeight: string
            }
        }
        notice: {
            base: {
                border: string
                borderRadius: string
                background: string
                foreground: string
                fontSize: string
                lineHeight: string
            }
        }
        buttonButton: {
            base: {
                border: string
                borderRadius: string
                background: string
                foreground: string
                fontSize: string
                fontWeight: string
            }
        }
        button: {
            hover: {
                background: string
                borderColor: string
            }
        }
        buttonSecondaryButton: {
            base: {
                foreground: string
                borderColor: string
            }
        }
        buttonSecondary: {
            hover: {
                background: string
                borderColor: string
            }
        }
        footer: {
            base: {
                fontSize: string
                foreground: string
            }
        }
        brand: {
            base: {
                foreground: string
                background: string
            }
        }
        brandUnderlay: {
            base: {
                background: string
            }
        }
        brandOverlay: {
            base: {
                shadow: string
            }
        }
        brandContent: {
            base: {
                fontSize: string
            }
        }
        wordmark: {
            base: {
                fontFamily: string
                fontSize: string
                fontWeight: string
                foreground: string
                letterSpacing: string
                lineHeight: string
            }
        }
        brandCaption: {
            base: {
                foreground: string
                fontSize: string
                fontWeight: string
                letterSpacing: string
            }
        }
        mobileBrand: {
            compact: {
                fontFamily: string
                fontSize: string
                fontWeight: string
                letterSpacing: string
            }
        }
    }
}
