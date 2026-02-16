export type WebUiSettings = {
    useModalityFilterOnModelSelectorDropdown: boolean
    useShiftingGradientBackgroundOnAiChatThreadNode: boolean
    useShiftingGradientBackgroundOnAiUserInputNode: boolean
    renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem: boolean
}

export const webUiSettings: WebUiSettings = {
    // Temporarily disabled: hide the modality filter chips in the model selector dropdown.
    useModalityFilterOnModelSelectorDropdown: false,
    // Shifting gradient background on the AI chat thread canvas node itself.
    useShiftingGradientBackgroundOnAiChatThreadNode: false,
    // Shifting gradient background on the floating AI user input (prompt) nodes.
    useShiftingGradientBackgroundOnAiUserInputNode: true,
    // When false, AI-generated images overlap the thread node instead of being placed beside it with a connector line.
    renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem: false,
}
