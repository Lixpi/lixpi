// Complete appearance values for these component domains. No defaults are supplied here.
export type ContentTheme = {
    composer: {
        input: {
            inputFloating: {
                base: {
                    borderRadius: string
                    shadow: string
                }
            }
            inputWrapper: {
                base: {
                    background: string
                    backdropFilter: string
                    borderRadius: string
                    shadow: string
                }
            }
            sendIcon: {
                base: {
                    fill: string
                }
            }
            dotsDropdownMenuButton: {
                base: {
                    foreground: string
                }
            }
            inputContentUnderlay: {
                base: {
                    foreground: string
                    fontSize: string
                    lineHeight: string
                }
            }
            inputContent: {
                base: {
                    foreground: string
                    fontSize: string
                    lineHeight: string
                }
            }
            mediaConfigToggle: {
                base: {
                    foreground: string
                }
            }
            mediaConfigDescription: {
                base: {
                    foreground: string
                    fontSize: string
                    lineHeight: string
                }
            }
            modelConfigAdd: {
                base: {
                    foreground: string
                }
            }
            modelConfigAddLabel: {
                base: {
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            modelConfigAddIcon: {
                base: {
                    borderRadius: string
                    backgroundColor: string
                    fill: string
                }
            }
            modelConfigRemove: {
                base: {
                    borderRadius: string
                }
                hover: {
                    background: string
                }
            }
            emptyNodePlaceholderUnderlay: {
                base: {
                    foreground: string
                    fontSize: string
                }
            }
        }
        controls: {
            submitButton: {
                base: {
                    borderRadius: string
                }
            }
            sendIcon: {
                base: {
                    fill: string
                    foreground: string
                }
                hover: {
                    fill: string
                    foreground: string
                }
            }
            modelMenuTrigger: {
                base: {
                    borderRadius: string
                    background: string
                }
            }
            modelMenuTriggerSummary: {
                base: {
                    foreground: string
                    fontSize: string
                    fontWeight: string
                }
            }
            mediaModeSwitch: {
                base: {
                    borderRadius: string
                    background: string
                    backdropFilter: string
                    shadow: string
                }
            }
            bubbleMenuContent: {
                base: {
                    shadow: string
                }
            }
            modelMenuSectionTitle: {
                base: {
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            modelMenuControlLabel: {
                base: {
                    foreground: string
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
        }
        references: {
            picker: {
                base: {
                    border: string
                    borderRadius: string
                    background: string
                    shadow: string
                    foreground: string
                    backdropFilter: string
                    webkitBackdropFilter: string
                }
            }
            pickerHeader: {
                base: {
                    background: string
                }
            }
            pickerItem: {
                base: {
                    borderRadius: string
                    background: string
                }
                hover: {
                    background: string
                }
            }
            pickerThumbnail: {
                base: {
                    borderRadius: string
                }
            }
            pickerGlyph: {
                base: {
                    background: string
                    foreground: string
                    fontSize: string
                    fontWeight: string
                }
            }
            pickerGlyphCapabilityModule: {
                base: {
                    background: string
                    foreground: string
                }
            }
            pickerGlyphSkill: {
                base: {
                    background: string
                    foreground: string
                }
            }
            pickerGlyphCapabilityArtifact: {
                base: {
                    background: string
                    foreground: string
                }
            }
            pickerCopyStrong: {
                base: {
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            pickerCopyHint: {
                base: {
                    foreground: string
                    fontSize: string
                    lineHeight: string
                }
            }
            pickerBadge: {
                base: {
                    foreground: string
                    fontSize: string
                    fontWeight: string
                    letterSpacing: string
                }
            }
            pickerBadgeCapabilityModule: {
                base: {
                    foreground: string
                }
            }
            pickerBadgeSkill: {
                base: {
                    foreground: string
                }
            }
            pickerStatus: {
                base: {
                    foreground: string
                    fontSize: string
                }
            }
            pickerLoadMore: {
                base: {
                    borderRadius: string
                }
                hover: {
                    background: string
                }
            }
            chip: {
                base: {
                    lineHeight: string
                }
            }
            chipName: {
                base: {
                    fontWeight: string
                }
            }
        }
        workspace: {
            panelContextChipRemove: {
                base: {
                    borderRadius: string
                }
            }
            workspaceCanvasGlobalComposer: {
                base: {
                    borderRadius: string
                }
            }
            inputWrapper: {
                base: {
                    borderRadius: string
                }
            }
            conversation: {
                borderChannels: string
                backgroundChannels: string
                foregroundChannels: string
            }
            workspaceConversationPanel: {
                base: {
                    borderRadius: string
                    shadow: string
                }
            }
            workspaceConversationPanelButton: {
                base: {
                    borderRadius: string
                }
            }
            workspaceConversationState: {
                base: {
                    fontSize: string
                }
            }
        }
        modelControls: {
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
        modeSwitch: {
            trackBackgroundColor: string
            indicatorBackgroundColor: string
            unselectedOptionColor: string
            hoveredOptionColor: string
            selectedOptionColor: string
            indicatorBoxShadow: string
        }
        modelMenu: {
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
    chat: {
        animation: {
            loadingSpinner: {
                base: {
                    border: string
                    borderTopColor: string
                    borderRadius: string
                }
            }
        }
        thread: {
            generationPrompt: {
                base: {
                    borderLeft: string
                    borderRadius: string
                    background: string
                    fontSize: string
                    fontStyle: string
                    lineHeight: string
                }
            }
            strongForeground: string
            userMessageBubbleColor: string
            userMessageBubbleSolidColor: string
            userMessageTextColor: string
            generatedVideoControlsHost: {
                base: {
                    borderRadius: string
                    backdropFilter: string
                    webkitBackdropFilter: string
                }
                opaque: {
                    background: string
                }
            }
            ink: string
            generatedVideoContainer: {
                base: {
                    borderRadius: string
                }
            }
            generatedVideoPlaceholder: {
                base: {
                    background: string
                    fontSize: string
                    lineHeight: string
                }
            }
            responseForeground: string
            userMessage: {
                base: {
                    borderRadius: string
                    lineHeight: string
                }
            }
            submitButton: {
                base: {
                    borderRadius: string
                }
            }
            sendIcon: {
                base: {
                    fill: string
                }
            }
            generatedMediaRunPill: {
                base: {
                    borderRadius: string
                    background: string
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            lineageEvent: {
                base: {
                    foreground: string
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            lineageEventIcon: {
                base: {
                    border: string
                    borderRadius: string
                    background: string
                    foreground: string
                }
            }
            reasoningSectionSpinner: {
                selected: {
                    borderRadius: string
                }
            }
            generatedImageContainer: {
                base: {
                    borderRadius: string
                }
            }
            generatedImageContent: {
                base: {
                    filter: string
                }
            }
            spinnerRing: {
                base: {
                    border: string
                    borderTopColor: string
                    borderRadius: string
                }
            }
            spinnerText: {
                base: {
                    fontSize: string
                    foreground: string
                }
            }
            generatedImageActionsButton: {
                base: {
                    borderRadius: string
                    fontSize: string
                    fontWeight: string
                }
            }
            addToCanvasBtn: {
                base: {
                    background: string
                    foreground: string
                }
                hover: {
                    background: string
                }
            }
            editInThreadBtn: {
                base: {
                    background: string
                    foreground: string
                    backdropFilter: string
                }
                hover: {
                    background: string
                }
            }
            generatedImagePrompt: {
                base: {
                    fontSize: string
                    foreground: string
                    background: string
                    borderTop: string
                    fontStyle: string
                    lineHeight: string
                }
            }
            generatedMediaSectionTitle: {
                base: {
                    fontSize: string
                    fontStyle: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            generationTraceBlock: {
                base: {
                    fontSize: string
                }
            }
            generationTraceContent: {
                base: {
                    fontSize: string
                    fontStyle: string
                    lineHeight: string
                }
            }
            generationTraceContentParagraph: {
                base: {
                    fontSize: string
                    fontStyle: string
                }
            }
            toolPromptTextParagraph: {
                base: {
                    fontSize: string
                    fontStyle: string
                    lineHeight: string
                }
            }
            imageGenerationSectionLabel: {
                base: {
                    fontSize: string
                    fontStyle: string
                    fontWeight: string
                }
            }
            imageGenerationToolPromptSectionUnderlay: {
                base: {
                    borderRadius: string
                }
            }
            capabilityMediaReviewSummary: {
                base: {
                    fontSize: string
                    lineHeight: string
                }
            }
            capabilityMediaReviewStep: {
                base: {
                    borderRadius: string
                }
            }
            capabilityMediaReviewStepTitle: {
                base: {
                    fontSize: string
                    fontWeight: string
                }
            }
            capabilityMediaReviewStepStatus: {
                base: {
                    fontSize: string
                }
            }
            capabilityMediaReviewStepIssues: {
                base: {
                    foreground: string
                    fontSize: string
                    lineHeight: string
                }
            }
            capabilityGenerationMetadata: {
                base: {
                    fontSize: string
                    lineHeight: string
                    fontWeight: string
                }
            }
            capabilityGenerationStep: {
                base: {
                    borderRadius: string
                }
            }
            capabilityGenerationStepTitle: {
                base: {
                    fontSize: string
                    fontWeight: string
                }
            }
            capabilityGenerationStepStatus: {
                base: {
                    fontSize: string
                }
            }
            capabilityGenerationStepSummary: {
                base: {
                    fontSize: string
                    lineHeight: string
                }
            }
            capabilityGenerationStepError: {
                base: {
                    foreground: string
                }
            }
            imageGenerationReferenceThumb: {
                base: {
                    borderRadius: string
                }
            }
            imageGenerationReferenceUnavailable: {
                base: {
                    fontSize: string
                    fontStyle: string
                }
            }
            imageGenerationReferenceLabel: {
                base: {
                    fontStyle: string
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            imageGenerationReferenceRole: {
                base: {
                    fontSize: string
                    lineHeight: string
                }
            }
            imageGenerationResolverSummary: {
                base: {
                    fontSize: string
                    fontWeight: string
                    lineHeight: string
                }
            }
            imageGenerationResolverRationale: {
                base: {
                    fontSize: string
                    lineHeight: string
                }
            }
            imageGenerationExcludedReference: {
                base: {
                    borderRadius: string
                }
            }
            imageGenerationExcludedLabel: {
                base: {
                    fontSize: string
                    fontWeight: string
                }
            }
            imageGenerationExcludedNode: {
                base: {
                    fontSize: string
                }
            }
            imageGenerationExcludedReason: {
                base: {
                    fontSize: string
                    lineHeight: string
                }
            }
        }
        messageBubbles: {
            pointer: {
                fill: string
            }
            speechTail: {
                fill: string
            }
        }
        panel: {
            nodeBoxShadow: string
            nodeBorder: string
            panelSectionDividerBorder: string
        }
    }
    capabilityRun: {
        formField: {
            base: {
                padding: string
                border: string
                borderRadius: string
                background: string
            }
        }
        formFieldHint: {
            base: {
                foreground: string
            }
        }
        formErrors: {
            base: {
                foreground: string
            }
        }
    }
    editorImage: {
        imageSelectionColor: string
        generatingPlaceholder: {
            base: {
                border: string
                borderRadius: string
                background: string
                shadow: string
            }
        }
        generatingDot: {
            base: {
                borderRadius: string
                background: string
            }
        }
    }
}
