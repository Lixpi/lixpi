// Connector / Infographics System
// Reusable abstractions for drawing connections between visual nodes using XYFlow and D3

export { createConnectorRenderer } from '$src/infographics/connectors/renderer.ts'
export { createMarkers, getMarkerUrl, collectMarkerTypes } from '$src/infographics/connectors/markers.ts'
export { computePath, computeLabelPosition, applyOffset } from '$src/infographics/connectors/paths.ts'

export type {
    AnchorPosition,
    PathType,
    MarkerType,
    EdgeAnchor,
    EdgeConfig,
    NodeContent,
    NodeConfig,
    NodeAnchors,
    ConnectorConfig,
    ConnectorState,
    ConnectorRenderer,
    ComputedPath
} from '$src/infographics/connectors/types.ts'
