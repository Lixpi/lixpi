export type WebUiSettings = {
    useModalityFilterOnModelSelectorDropdown: boolean
    useShiftingGradientBackgroundOnAiChatThreadNode: boolean
    useShiftingGradientBackgroundOnAiUserInputNode: boolean
    renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem: boolean
    showHeaderOnAiChatThreadNodes: boolean
    proximityConnectThreshold: number
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
    // When false, the document title (h1) is hidden inside AI chat thread nodes on the workspace canvas.
    showHeaderOnAiChatThreadNodes: false,
    // Maximum distance (in renderer-coordinate pixels) at which dragging an unconnected
    // node near an AI chat thread node triggers the proximity-connect ghost edge.
    proximityConnectThreshold: 500,
}
