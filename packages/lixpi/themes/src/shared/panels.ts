import {
    type PanelTheme,
} from '../template/panels.ts'
import { lixpiPalette as palette } from '../palettes/lixpi.ts'

export const panelValues: PanelTheme = {
    contextPreview: {
        elements: {
            image: {
                base: {
                    borderRadius: "6px",
                },
            },
            videoGlyph: {
                base: {
                    borderRadius: "50%",
                },
            },
            artifact: {
                base: {
                    foreground: palette.steelSlate,
                },
            },
            artifactTitle: {
                base: {
                    fontWeight: "700",
                },
            },
            documentTitle: {
                base: {
                    fontSize: "11px",
                    fontWeight: "700",
                    lineHeight: "1.2",
                },
            },
            documentText: {
                base: {
                    fontSize: "10px",
                    lineHeight: "1.25",
                },
            },
            expandedDocumentText: {
                base: {
                    fontSize: "11px",
                },
            },
            inlinePopover: {
                base: {
                    borderRadius: "8px",
                    background: palette.white,
                    shadow: `0 16px 38px ${palette.blueSlate18}, 0 2px 8px ${palette.blueSlate12}`,
                    foreground: palette.deepPetrol,
                },
            },
            popoverTitle: {
                base: {
                    fontSize: "12px",
                    fontWeight: "700",
                    lineHeight: "1.25",
                },
            },
            popoverText: {
                base: {
                    fontSize: "11px",
                    lineHeight: "1.3",
                },
            },
            capabilityDescriptionPopover: {
                base: {
                    border: palette.stormBlue20,
                },
            },
            descriptionBody: {
                base: {
                    fontSize: "11px",
                    fontWeight: "500",
                    lineHeight: "1.3",
                },
            },
            descriptionTitle: {
                base: {
                    fontSize: "12px",
                    fontWeight: "700",
                    lineHeight: "1.25",
                },
            },
            descriptionSectionTitle: {
                base: {
                    fontSize: "11px",
                    fontWeight: "700",
                    lineHeight: "1.25",
                },
            },
            descriptionTermDivider: {
                base: {
                    borderTop: palette.stormBlue14,
                },
            },
            descriptionTerm: {
                base: {
                    fontWeight: "700",
                },
            },
            descriptionMeta: {
                base: {
                    foreground: palette.blueSlate68,
                    fontSize: "10px",
                    fontWeight: "600",
                    letterSpacing: "0.03em",
                },
            },
            capabilityDescriptionStatus: {
                base: {
                    foreground: palette.blueSlate,
                    fontSize: "12px",
                },
            },
            capabilityDescriptionRetry: {
                base: {
                    border: palette.blueSlate28,
                    borderRadius: "6px",
                    background: palette.white,
                },
            },
        },
        styles: {
            controlsColor: palette.blueSlate,
            chipBackground: palette.transparent,
            triggerBorderRadius: "6px",
            previewBorderRadius: "6px",
            tooltipBackground: palette.white,
            tooltipBorder: "none",
            tooltipBorderRadius: "8px",
            tooltipBoxShadow: `0 16px 38px ${palette.blueSlate18}, 0 2px 8px ${palette.blueSlate12}`,
            tooltipColor: palette.deepPetrol,
            videoBackground: palette.midnightNavy,
            videoGlyphBackground: palette.white84,
            videoGlyphColor: palette.deepPetrol,
            documentColor: palette.darkSlateBlue,
            documentSkeletonLineBorderRadius: "999px",
            documentSkeletonLineBackground: palette.steelSlate32,
            documentIconColor: palette.steelSlate,
            documentTextColor: palette.blueSlate76,
            popoverTitleColor: palette.deepPetrol,
            popoverTextColor: palette.blueSlate82,
            removeButtonBackground: palette.white,
            removeButtonColor: palette.blueSlate,
            removeButtonBoxShadow: `0 0 4px ${palette.black32}`,
        },
    },
    sidePanel: {
        resizeHandle: {
            offset: 0,
            grabWidth: 20,
        },
        animation: {
            durationMs: 100,
            openEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            closeEasing: 'cubic-bezier(0.64, 0, 0.78, 0)',
        },
        elements: {
            overlay: {
                base: {
                    backdropFilter: "blur(4px) saturate(108%)",
                    webkitBackdropFilter: "blur(4px) saturate(108%)",
                },
            },
            backdrop: {
                base: {
                    backdropFilter: "blur(24px) saturate(145%)",
                    webkitBackdropFilter: "blur(24px) saturate(145%)",
                },
            },
            resizeHandleLineUnderlay: {
                base: {
                    borderRadius: "2px",
                },
            },
        },
        overlay: {
            fill: palette.midnightBlue18,
            fillOpaque: palette.midnightBlue22,
            opacity: 1,
        },
    },
    navigation: {
        geometry: {
            defaultWidth: 280,
            minWidth: 220,
            maxPaneMargin: 64,
            toggle: {
                openOffset: '20px',
                top: '20px',
                size: '20px',
            },
        },
        header: {
            base: {
                padding: '12px 12px 0',
            },
        },
        list: {
            base: {
                gap: '8px',
                paddingBlock: '15px 12px',
                paddingInline: '12px',
            },
        },
        row: {
            base: {
                padding: '4px 4px 4px 12px',
            },
        },
        rowTags: {
            base: {
                gap: '4px',
                marginBottom: '8px',
            },
        },
        footer: {
            base: {
                padding: '0 12px 8px',
            },
        },
        sectionGroup: {
            base: {
                marginBottom: '2px',
            },
        },
        sectionHeading: {
            base: {
                fontSize: '14px',
                fontWeight: '500',
                lineHeight: '1.5',
                letterSpacing: 'normal',
                textTransform: 'none',
                paddingInline: '20px',
                paddingBlock: '16px 4px',
                margin: '0',
            },
        },
        toggle: {
            base: {
                borderRadius: "999px",
            },
        },
        toggleUnderlay: {
            base: {
                inset: '-8px',
                borderRadius: "999px",
            },
        },
        headerOverlay: {
            base: {
                inlineInset: '4%',
                bottom: '-8px',
                height: '1px',
                borderRadius: "999px",
            },
        },
        newWorkspaceButton: {
            base: {
                size: '36px',
                iconSize: '22px',
                borderRadius: "999px",
            },
        },
        footerSeparator: {
            base: {
                width: '92%',
                height: '1px',
                margin: '0 auto 8px',
                borderRadius: "999px",
            },
        },
        avatarInitial: {
            base: {
                size: '25px',
                lineHeight: "25px",
            },
        },
    },
    rightPanel: {
        floatingPanel: {
            base: {
                borderRadius: "10px",
            },
        },
        geometry: {
            defaultWidth: 494,
            minWidth: 320,
            maxPaneMargin: 64,
            contentInset: 10,
            modeSwitchHeight: 28,
            toggle: {
                openOffset: 5,
                closedTravelInset: 10,
                top: '15px',
                size: '15px',
            },
        },
        libraryGeometry: {
            stageMinWidth: 160,
            stageMinWidthWithParameters: 240,
            parametersDefaultWidth: 416,
            parametersMinWidth: 260,
            themeDefaultWidth: 320,
            themeMinWidth: 280,
            toggleGap: '8px',
            themeToggleTop: '42px',
        },
    },
    blockCards: {
        blockCardTilesList: {
            base: {
                borderBottom: `1px solid ${palette.navy09}`,
            },
        },
        listTitle: {
            base: {
                foreground: palette.steelSlate,
                fontSize: "11px",
                fontWeight: "650",
                letterSpacing: "0.05em",
            },
        },
        empty: {
            base: {
                foreground: palette.slateLavender,
                fontSize: "11.5px",
                lineHeight: "1.25",
            },
        },
        blockCardTile: {
            base: {
                borderRadius: "8px",
            },
            hover: {
                backgroundImage: `linear-gradient(135deg, ${palette.blueIce} 0%, ${palette.lavenderIce} 100%)`,
            },
        },
        open: {
            base: {
                foreground: palette.blueSlate,
            },
        },
        marker: {
            base: {
                borderRadius: "50%",
                background: palette.cornflowerBlue,
                shadow: `0 0 0 3px ${palette.cornflowerBlue14}`,
            },
        },
        tileTitle: {
            base: {
                foreground: palette.blueSlate,
                fontSize: "13px",
                fontWeight: "620",
                lineHeight: "1.25",
            },
        },
        primaryMeta: {
            base: {
                foreground: palette.steelSlate,
                fontSize: "11.5px",
                lineHeight: "1.25",
            },
        },
        secondaryMeta: {
            base: {
                foreground: palette.slateLavender,
                fontSize: "11.5px",
                lineHeight: "1.25",
            },
        },
        action: {
            base: {
                borderRadius: "50%",
                foreground: palette.dustySlate,
            },
        },
        actionUnderlay: {
            base: {
                borderRadius: "50%",
            },
        },
    },
    authPanel: {
        brandGradient: [palette.fernSage, palette.mossSage, palette.mutedFernSage, palette.lightFernSage],
        authPanel: {
            base: {
                foreground: palette.nightBlue,
                background: palette.warmChalk,
                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif",
                lineHeight: "1.5",
            },
        },
        eyebrow: {
            base: {
                foreground: palette.steelBlue,
                fontSize: "10px",
                fontWeight: "650",
                letterSpacing: "2px",
            },
        },
        title: {
            base: {
                foreground: palette.nightBlue,
                fontSize: "clamp(30px, 3vw, 42px)",
                fontWeight: "550",
                letterSpacing: "-1.4px",
                lineHeight: "1.15",
            },
        },
        description: {
            base: {
                foreground: palette.steelBlue,
                fontSize: "15px",
                lineHeight: "1.7",
            },
        },
        notice: {
            base: {
                border: `1px solid ${palette.sageMist}`,
                borderRadius: "10px",
                background: palette.sageWhite,
                foreground: palette.deepSage,
                fontSize: "13px",
                lineHeight: "1.6",
            },
        },
        buttonButton: {
            base: {
                border: `1px solid ${palette.nightBlue}`,
                borderRadius: "12px",
                background: palette.nightBlue,
                foreground: palette.white,
                fontSize: "14px",
                fontWeight: "550",
            },
        },
        button: {
            hover: {
                background: palette.steelBlue,
                borderColor: palette.steelBlue,
            },
        },
        buttonSecondaryButton: {
            base: {
                foreground: palette.nightBlue,
                borderColor: palette.sageGray,
            },
        },
        buttonSecondary: {
            hover: {
                background: palette.paleSageWhite,
                borderColor: palette.sageSilver,
            },
        },
        footer: {
            base: {
                fontSize: "12px",
                foreground: palette.mutedSage,
            },
        },
        brand: {
            base: {
                foreground: palette.nightBlue,
                background: palette.leafSage,
            },
        },
        brandUnderlay: {
            base: {
                background: `radial-gradient(ellipse 80% 60% at 50% 50%, ${palette.white06} 0%, ${palette.white00} 100%)`,
            },
        },
        brandOverlay: {
            base: {
                shadow: `inset 0 1px 2px ${palette.white28}, inset 0 -1px 2px ${palette.white14}`,
            },
        },
        brandContent: {
            base: {
                fontSize: "16px",
            },
        },
        wordmark: {
            base: {
                fontFamily: "\"Herculanum LT Pro\", sans-serif",
                fontSize: "clamp(57.6px, 7.5vw, 88px)",
                fontWeight: "500",
                foreground: palette.white72,
                letterSpacing: "0.08em",
                lineHeight: "1",
            },
        },
        brandCaption: {
            base: {
                foreground: palette.white78,
                fontSize: "clamp(16px, 2.5vw, 19.2px)",
                fontWeight: "400",
                letterSpacing: "0.015em",
            },
        },
        mobileBrand: {
            compact: {
                fontFamily: "\"Herculanum LT Pro\", sans-serif",
                fontSize: "28px",
                fontWeight: "500",
                letterSpacing: "0.08em",
            },
        },
    },
}
