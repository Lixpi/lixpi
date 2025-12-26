// Connector / Infographics System
// Reusable abstractions for drawing connections between visual nodes using XYFlow and D3

export { createConnectorRenderer } from './renderer.ts'
export { createMarkers, getMarkerUrl, collectMarkerTypes } from './markers.ts'
export { computePath, computeLabelPosition, applyOffset } from './paths.ts'

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
} from './types.ts'
