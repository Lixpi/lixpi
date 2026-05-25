// Connector / Infographics System
// Shared path math and data shapes for drawing connections between visual nodes.

export { computePath, computeLabelPosition, applyOffset } from '$src/infographics/connectors/paths.ts'

export type {
    AnchorPosition,
    PathType,
    MarkerType,
    EdgeAnchor,
    EdgeConfig,
    NodeContent,
    NodeConfig,
    NodeShape,
    NodeAnchorOverride,
    ComputedPath
} from '$src/infographics/connectors/types.ts'
