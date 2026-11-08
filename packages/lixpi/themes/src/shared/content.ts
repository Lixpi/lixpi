import {
    type ContentTheme,
} from '../template/content.ts'
import { lixpiPalette as palette } from '../palettes/lixpi.ts'

export const contentValues: ContentTheme = {
    composer: {
        input: {
            inputFloating: {
                base: {
                    borderRadius: "12px",
                    shadow: `0 4px 24px ${palette.black15}, 0 1px 4px ${palette.black10}`,
                },
            },
            inputWrapper: {
                base: {
                    background: palette.white90,
                    backdropFilter: "blur(10px)",
                    borderRadius: "10px",
                    shadow: `0 2px 10px ${palette.black04}`,
                },
            },
            sendIcon: {
                base: {
                    fill: palette.nightBlue,
                },
            },
            dotsDropdownMenuButton: {
                base: {
                    foreground: palette.steelBlue,
                },
            },
            inputContentUnderlay: {
                base: {
                    foreground: palette.black40,
                    fontSize: "15px",
                    lineHeight: "1.5",
                },
            },
            inputContent: {
                base: {
                    foreground: palette.nearBlack,
                    fontSize: "15px",
                    lineHeight: "1.6",
                },
            },
            mediaConfigToggle: {
                base: {
                    foreground: palette.smokeSlate,
                },
            },
            mediaConfigDescription: {
                base: {
                    foreground: palette.navySlate52,
                    fontSize: "10px",
                    lineHeight: "1.35",
                },
            },
            modelConfigAdd: {
                base: {
                    foreground: palette.smokeSlate,
                },
            },
            modelConfigAddLabel: {
                base: {
                    fontSize: "10px",
                    fontWeight: "600",
                    lineHeight: "1.2",
                },
            },
            modelConfigAddIcon: {
                base: {
                    borderRadius: "50%",
                    backgroundColor: palette.nightBlue,
                    fill: palette.white,
                },
            },
            modelConfigRemove: {
                base: {
                    borderRadius: "50%",
                },
                hover: {
                    background: palette.stormIndigo08,
                },
            },
            emptyNodePlaceholderUnderlay: {
                base: {
                    foreground: palette.black40,
                    fontSize: "15px",
                },
            },
        },
        controls: {
            submitButton: {
                base: {
                    borderRadius: "50%",
                },
            },
            sendIcon: {
                base: {
                    fill: palette.black50,
                    foreground: palette.black50,
                },
                hover: {
                    fill: palette.black80,
                    foreground: palette.black80,
                },
            },
            modelMenuTrigger: {
                base: {
                    borderRadius: "10px",
                    background: palette.coolSlate06,
                },
            },
            modelMenuTriggerSummary: {
                base: {
                    foreground: palette.navy68,
                    fontSize: "12px",
                    fontWeight: "500",
                },
            },
            mediaModeSwitch: {
                base: {
                    borderRadius: "9999px",
                    background: palette.white90,
                    backdropFilter: "blur(10px)",
                    shadow: `0 4px 24px ${palette.black15}, 0 1px 4px ${palette.black10}`,
                },
            },
            bubbleMenuContent: {
                base: {
                    shadow: `0 14px 32px ${palette.nightBlue12}, 0 2px 10px ${palette.nightBlue08}, inset 0 0 0 1px ${palette.silver}`,
                },
            },
            modelMenuSectionTitle: {
                base: {
                    fontSize: "13px",
                    fontWeight: "700",
                    lineHeight: "1.2",
                },
            },
            modelMenuControlLabel: {
                base: {
                    foreground: palette.smokeSlate,
                    fontSize: "10px",
                    fontWeight: "600",
                    lineHeight: "1.2",
                },
            },
        },
        references: {
            picker: {
                base: {
                    border: `1px solid ${palette.navy12}`,
                    borderRadius: "14px",
                    background: palette.white96,
                    shadow: `0 20px 60px ${palette.navy18}, 0 1px 0 ${palette.white75} inset`,
                    foreground: palette.navy,
                    backdropFilter: "blur(18px)",
                    webkitBackdropFilter: "blur(18px)",
                },
            },
            pickerHeader: {
                base: {
                    background: palette.white96,
                },
            },
            pickerItem: {
                base: {
                    borderRadius: "9px",
                    background: palette.cornflowerBlue05,
                },
                hover: {
                    background: palette.cornflowerBlue12,
                },
            },
            pickerThumbnail: {
                base: {
                    borderRadius: "8px",
                },
            },
            pickerGlyph: {
                base: {
                    background: palette.cornflowerBlue12,
                    foreground: palette.denimBlue92,
                    fontSize: "13px",
                    fontWeight: "850",
                },
            },
            pickerGlyphCapabilityModule: {
                base: {
                    background: palette.warmOrange14,
                    foreground: palette.copper,
                },
            },
            pickerGlyphSkill: {
                base: {
                    background: palette.amethyst12,
                    foreground: palette.amethyst,
                },
            },
            pickerGlyphCapabilityArtifact: {
                base: {
                    background: palette.warmOrange14,
                    foreground: palette.copper,
                },
            },
            pickerCopyStrong: {
                base: {
                    fontSize: "13px",
                    fontWeight: "800",
                    lineHeight: "1.3",
                },
            },
            pickerCopyHint: {
                base: {
                    foreground: palette.navy58,
                    fontSize: "11px",
                    lineHeight: "1.35",
                },
            },
            pickerBadge: {
                base: {
                    foreground: palette.denimBlue90,
                    fontSize: "9px",
                    fontWeight: "800",
                    letterSpacing: "0.04em",
                },
            },
            pickerBadgeCapabilityModule: {
                base: {
                    foreground: palette.copper,
                },
            },
            pickerBadgeSkill: {
                base: {
                    foreground: palette.amethyst,
                },
            },
            pickerStatus: {
                base: {
                    foreground: palette.navy58,
                    fontSize: "12px",
                },
            },
            pickerLoadMore: {
                base: {
                    borderRadius: "9px",
                },
                hover: {
                    background: palette.cornflowerBlue09,
                },
            },
            chip: {
                base: {
                    lineHeight: "1",
                },
            },
            chipName: {
                base: {
                    fontWeight: "500",
                },
            },
        },
        workspace: {
            panelContextChipRemove: {
                base: {
                    borderRadius: "50%",
                },
            },
            workspaceCanvasGlobalComposer: {
                base: {
                    borderRadius: "9999px",
                },
            },
            inputWrapper: {
                base: {
                    borderRadius: "9999px",
                },
            },
            conversation: {
                borderChannels: palette.blueSilverHslChannels,
                backgroundChannels: palette.whiteHslChannels,
                foregroundChannels: palette.blueCharcoalHslChannels,
            },
            workspaceConversationPanel: {
                base: {
                    borderRadius: "14px",
                    shadow: `0 6px 24px ${palette.black0706}`,
                },
            },
            workspaceConversationPanelButton: {
                base: {
                    borderRadius: "5px",
                },
            },
            workspaceConversationState: {
                base: {
                    fontSize: "11px",
                },
            },
        },
        modelControls: {
            modelDropdown: {
                width: 190,
                height: 38,
                valueFontSize: 12,
                horizontalPadding: 7,
                iconSize: 14,
                iconLabelGap: 7,
            },
            dimensionsDropdown: {
                width: 68,
                height: 38,
                valueFontSize: 12,
                horizontalPadding: 5,
                glyphColumnWidth: 20,
                glyphValueGap: 3,
                contentCenterYRatio: 0.5,
            },
            dimensionsGlyph: {
                targetArea: 169,
                maxDimension: 20,
                adaptiveSize: 12,
                cornerRadius: 2,
                strokeWidth: 1.5,
                adaptiveLabelFontSize: 7,
                adaptiveLabelFontWeight: 700,
            },
        },
        modeSwitch: {
            trackBackgroundColor: palette.cornflowerBlue14,
            indicatorBackgroundColor: palette.cornflowerBlue24,
            unselectedOptionColor: palette.nightBlue62,
            hoveredOptionColor: palette.nightBlue,
            selectedOptionColor: palette.black,
            indicatorBoxShadow: "none",
        },
        modelMenu: {
            triggerColor: palette.steelBlue,
            triggerActiveColor: palette.nightBlue,
            triggerActiveBackground: palette.cloud,
            triggerFocusOutline: "none",
            infoBubbleWidth: "410px",
            infoBubbleBorderRadius: "12px",
            infoBubbleBackground: palette.white,
            infoBubbleBoxShadow: `0 14px 32px ${palette.nightBlue12}, 0 2px 10px ${palette.nightBlue08}, inset 0 0 1px 1px ${palette.nightBlue20}`,
            infoBubbleColor: palette.nightBlue,
            sectionDividerGradient: `linear-gradient(90deg, ${palette.lilacWhite00} 0%, ${palette.lilacWhite} 10%, ${palette.roseMist} 26%, ${palette.lilac} 50%, ${palette.periwinkleFog} 74%, ${palette.lilacWhite} 90%, ${palette.lilacWhite00} 100%)`,
            sectionDividerHeight: "2px",
            sectionDividerBorderRadius: "999px",
            sectionTitleColor: palette.stoneBlue,
            controlLabelColor: palette.pewter,
            controlLabelFontSize: "12px",
            selectedModelTagTextColor: palette.nightBlue,
            selectedModelTagIconColor: palette.nightBlue,
            helpTooltipTriggerBorder: "none",
            helpTooltipTriggerBackground: palette.transparent,
            helpTooltipTriggerColor: palette.ashBlue,
            helpTooltipTriggerHoverBackground: palette.transparent,
            helpTooltipTriggerHoverColor: palette.stoneBlue,
            helpTooltipTriggerFocusOutline: "none",
            helpTooltipBackground: palette.steelBlue,
            helpTooltipBorder: "none",
            helpTooltipBorderRadius: "8px",
            helpTooltipBoxShadow: `0 6px 18px ${palette.black18}`,
            helpTooltipColor: palette.white,
        },
    },
    chat: {
        animation: {
            loadingSpinner: {
                base: {
                    border: `2px solid ${palette.graphiteBlack15}`,
                    borderTopColor: palette.graphiteBlack55,
                    borderRadius: "50%",
                },
            },
        },
        thread: {
            generationPrompt: {
                base: {
                    borderLeft: `2px solid ${palette.amethyst34}`,
                    borderRadius: "0 4px 4px 0",
                    background: palette.amethyst06,
                    fontSize: "0.76rem",
                    fontStyle: "normal",
                    lineHeight: "1.5",
                },
            },
            strongForeground: palette.navy,
            userMessageBubbleColor: `linear-gradient(135deg, ${palette.slateBlueGray} 0%, ${palette.blueGray} 100%)`,
            userMessageBubbleSolidColor: palette.grayBlue,
            userMessageTextColor: palette.white,
            generatedVideoControlsHost: {
                base: {
                    borderRadius: "18px",
                    backdropFilter: "blur(22px) saturate(155%) contrast(108%)",
                    webkitBackdropFilter: "blur(22px) saturate(155%) contrast(108%)",
                },
                opaque: {
                    background: palette.deepCharcoal88,
                },
            },
            ink: palette.black,
            generatedVideoContainer: {
                base: {
                    borderRadius: "8px",
                },
            },
            generatedVideoPlaceholder: {
                base: {
                    background: palette.deepCharcoal05,
                    fontSize: "0.78rem",
                    lineHeight: "1.3",
                },
            },
            responseForeground: palette.graphiteBlack,
            userMessage: {
                base: {
                    borderRadius: "18px 18px 12px 18px",
                    lineHeight: "1.5",
                },
            },
            submitButton: {
                base: {
                    borderRadius: "50%",
                },
            },
            sendIcon: {
                base: {
                    fill: palette.nightBlue,
                },
            },
            generatedMediaRunPill: {
                base: {
                    borderRadius: "999px",
                    background: palette.white74,
                    fontSize: "0.68rem",
                    fontWeight: "700",
                    lineHeight: "1",
                },
            },
            lineageEvent: {
                base: {
                    foreground: palette.stormSlate,
                    fontSize: "0.78rem",
                    fontWeight: "600",
                    lineHeight: "1.2",
                },
            },
            lineageEventIcon: {
                base: {
                    border: palette.deepBlueGray,
                    borderRadius: "999px",
                    background: palette.deepBlueGray,
                    foreground: palette.white,
                },
            },
            reasoningSectionSpinner: {
                selected: {
                    borderRadius: "50%",
                },
            },
            generatedImageContainer: {
                base: {
                    borderRadius: "12px",
                },
            },
            generatedImageContent: {
                base: {
                    filter: "blur(8px)",
                },
            },
            spinnerRing: {
                base: {
                    border: palette.nightBlue,
                    borderTopColor: palette.nightBlue,
                    borderRadius: "50%",
                },
            },
            spinnerText: {
                base: {
                    fontSize: "0.875rem",
                    foreground: palette.nightBlue,
                },
            },
            generatedImageActionsButton: {
                base: {
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                    fontWeight: "500",
                },
            },
            addToCanvasBtn: {
                base: {
                    background: palette.white,
                    foreground: palette.nightBlue,
                },
                hover: {
                    background: palette.paleGray,
                },
            },
            editInThreadBtn: {
                base: {
                    background: palette.white20,
                    foreground: palette.white,
                    backdropFilter: "blur(4px)",
                },
                hover: {
                    background: palette.white30,
                },
            },
            generatedImagePrompt: {
                base: {
                    fontSize: "0.8rem",
                    foreground: palette.nightBlue,
                    background: palette.nightBlue,
                    borderTop: palette.nightBlue,
                    fontStyle: "italic",
                    lineHeight: "1.4",
                },
            },
            generatedMediaSectionTitle: {
                base: {
                    fontSize: "0.68rem",
                    fontStyle: "normal",
                    fontWeight: "700",
                    lineHeight: "1.2",
                },
            },
            generationTraceBlock: {
                base: {
                    fontSize: "0.875rem",
                },
            },
            generationTraceContent: {
                base: {
                    fontSize: "0.78rem",
                    fontStyle: "italic",
                    lineHeight: "1.5",
                },
            },
            generationTraceContentParagraph: {
                base: {
                    fontSize: "0.78rem",
                    fontStyle: "italic",
                },
            },
            toolPromptTextParagraph: {
                base: {
                    fontSize: "0.76rem",
                    fontStyle: "normal",
                    lineHeight: "1.5",
                },
            },
            imageGenerationSectionLabel: {
                base: {
                    fontSize: "0.68rem",
                    fontStyle: "normal",
                    fontWeight: "700",
                },
            },
            imageGenerationToolPromptSectionUnderlay: {
                base: {
                    borderRadius: "999px",
                },
            },
            capabilityMediaReviewSummary: {
                base: {
                    fontSize: "0.72rem",
                    lineHeight: "1.4",
                },
            },
            capabilityMediaReviewStep: {
                base: {
                    borderRadius: "6px",
                },
            },
            capabilityMediaReviewStepTitle: {
                base: {
                    fontSize: "0.72rem",
                    fontWeight: "650",
                },
            },
            capabilityMediaReviewStepStatus: {
                base: {
                    fontSize: "0.68rem",
                },
            },
            capabilityMediaReviewStepIssues: {
                base: {
                    foreground: palette.brickRed,
                    fontSize: "0.7rem",
                    lineHeight: "1.35",
                },
            },
            capabilityGenerationMetadata: {
                base: {
                    fontSize: "0.74rem",
                    lineHeight: "1.4",
                    fontWeight: "650",
                },
            },
            capabilityGenerationStep: {
                base: {
                    borderRadius: "6px",
                },
            },
            capabilityGenerationStepTitle: {
                base: {
                    fontSize: "0.72rem",
                    fontWeight: "650",
                },
            },
            capabilityGenerationStepStatus: {
                base: {
                    fontSize: "0.68rem",
                },
            },
            capabilityGenerationStepSummary: {
                base: {
                    fontSize: "0.7rem",
                    lineHeight: "1.35",
                },
            },
            capabilityGenerationStepError: {
                base: {
                    foreground: palette.brickRed,
                },
            },
            imageGenerationReferenceThumb: {
                base: {
                    borderRadius: "6px",
                },
            },
            imageGenerationReferenceUnavailable: {
                base: {
                    fontSize: "0.7rem",
                    fontStyle: "normal",
                },
            },
            imageGenerationReferenceLabel: {
                base: {
                    fontStyle: "normal",
                    fontSize: "0.68rem",
                    fontWeight: "600",
                    lineHeight: "1.2",
                },
            },
            imageGenerationReferenceRole: {
                base: {
                    fontSize: "0.64rem",
                    lineHeight: "1.2",
                },
            },
            imageGenerationResolverSummary: {
                base: {
                    fontSize: "0.74rem",
                    fontWeight: "600",
                    lineHeight: "1.35",
                },
            },
            imageGenerationResolverRationale: {
                base: {
                    fontSize: "0.74rem",
                    lineHeight: "1.4",
                },
            },
            imageGenerationExcludedReference: {
                base: {
                    borderRadius: "6px",
                },
            },
            imageGenerationExcludedLabel: {
                base: {
                    fontSize: "0.72rem",
                    fontWeight: "700",
                },
            },
            imageGenerationExcludedNode: {
                base: {
                    fontSize: "0.64rem",
                },
            },
            imageGenerationExcludedReason: {
                base: {
                    fontSize: "0.7rem",
                    lineHeight: "1.35",
                },
            },
        },
        messageBubbles: {
            pointer: {
                fill: palette.brightApricot,
            },
            speechTail: {
                fill: palette.silverLilac,
            },
        },
        panel: {
            nodeBoxShadow: "none",
            nodeBorder: "none",
            panelSectionDividerBorder: `1px solid ${palette.navy09}`,
        },
    },
    capabilityRun: {
        formField: {
            base: {
                padding: '8px 10px',
                border: `1px solid ${palette.white14}`,
                borderRadius: "8px",
                background: palette.black16,
            },
        },
        formFieldHint: {
            base: {
                foreground: palette.white58,
            },
        },
        formErrors: {
            base: {
                foreground: palette.rosePink,
            },
        },
    },
    editorImage: {
        imageSelectionColor: palette.cornflowerBlue,
        generatingPlaceholder: {
            base: {
                border: `1px solid ${palette.steelGray18}`,
                borderRadius: "4px",
                background: palette.white90,
                shadow: `0 2px 8px ${palette.charcoalBlue08}`,
            },
        },
        generatingDot: {
            base: {
                borderRadius: "50%",
                background: palette.steelGray42,
            },
        },
    },
}
