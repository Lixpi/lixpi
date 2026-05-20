import type { WorkspaceEdgePathType } from '@lixpi/constants'

export type WebUiSettings = {
    useModalityFilterOnModelSelectorDropdown: boolean
    useShiftingGradientBackgroundOnAiChatThreadNode: boolean
    useShiftingGradientBackgroundOnAiUserInputNode: boolean
    showHeaderOnAiChatThreadNodes: boolean
    proximityConnectThreshold: number
    menuConnectionSnapRadius: number
    aiChatThreadRailDragGrabWidth: number
    nodesConnectorLineCurve: WorkspaceEdgePathType
    nodesConnectorLineClickAreaWidth: number
    useZoomCompensatedConnectorScaling: boolean
    useZoomCompensatedResizeHandleScaling: boolean
}

export const webUiSettings: WebUiSettings = {
    // Temporarily disabled: hide the modality filter chips in the model selector dropdown.
    useModalityFilterOnModelSelectorDropdown: false,
    // Shifting gradient background on the AI chat thread canvas node itself.
    useShiftingGradientBackgroundOnAiChatThreadNode: false,
    // Shifting gradient background on the floating AI user input (prompt) nodes.
    useShiftingGradientBackgroundOnAiUserInputNode: true,
    // When false, the document title (h1) is hidden inside AI chat thread nodes on the workspace canvas.
    showHeaderOnAiChatThreadNodes: false,
    // Maximum distance (in renderer-coordinate pixels) at which dragging an unconnected
    // node near an AI chat thread node triggers the proximity-connect ghost edge.
    proximityConnectThreshold: 700,
    // Maximum distance (in renderer-coordinate pixels) at which the menu-driven
    // "Connect to node" interaction snaps to a target handle/rail.
    menuConnectionSnapRadius: 110,
    // Width (in pixels) of the invisible drag hit area around the vertical rail line.
    // The visible rail line width is controlled separately by aiChatThreadRailWidth in
    // webUiThemeSettings.ts — this only affects how wide the grabbable zone is.
    aiChatThreadRailDragGrabWidth: 90,
    // Default curve for connector lines between nodes.
    //   'horizontal-bezier' — smooth S-curve connecting left/right handles (default)
    //   'orthogonal'        — 3-point circuit board style with rounded corners
    //   'bezier'            — standard bezier curve (can loop back on itself)
    //   'straight'          — direct straight line between points
    //   'smoothstep'        — stepped line with rounded corners (similar to orthogonal but simpler)
    nodesConnectorLineCurve: 'horizontal-bezier',
    // Width (in pixels) of the invisible click area around connector lines.
    // Makes it easier to select thin lines.
    nodesConnectorLineClickAreaWidth: 24,
    // When true, connector line stroke width, marker sizes, marker offsets, and
    // hit areas use bounded adaptive scaling so they remain usable across zoom.
    useZoomCompensatedConnectorScaling: true,
    // When true, resize corner handles are inversely scaled based on zoom level so
    // they appear at constant visual size. When false, handles use fixed base sizes.
    useZoomCompensatedResizeHandleScaling: true,
}
