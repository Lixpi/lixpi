export type WebUiSettings = {
    useModalityFilterOnModelSelectorDropdown: boolean
    useShiftingGradientBackgroundOnAiChatThreadNode: boolean
    useShiftingGradientBackgroundOnAiUserInputNode: boolean
    renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem: boolean
    showHeaderOnAiChatThreadNodes: boolean
    proximityConnectThreshold: number
    aiChatContextTraversalDepth: 'direct' | 'full'
    aiChatThreadRailDragGrabWidth: number
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
    proximityConnectThreshold: 300,
    // Controls how deeply the system traverses node connections when extracting
    // context for AI chat threads.
    //   'direct' — include content only from nodes with a direct incoming edge
    //              into the AI chat thread (one hop). Best when each thread
    //              should see only its immediate inputs.
    //   'full'   — recursively follow all incoming edges, gathering content from
    //              every reachable upstream node in the graph (transitive closure).
    //              Use when chains like DocA → DocB → ChatThread should pass
    //              DocA's content through to the chat.
    aiChatContextTraversalDepth: 'direct',
    // Width (in pixels) of the invisible drag hit area around the vertical rail line.
    // The visible rail line width is controlled separately by aiChatThreadRailWidth in
    // webUiThemeSettings.ts — this only affects how wide the grabbable zone is.
    aiChatThreadRailDragGrabWidth: 90,
}
