// Connector / Infographics System
// Shared path math and data shapes for drawing connections between visual nodes.

export {
    computePath,
    computeLabelPosition,
    applyOffset,
} from './paths.ts'
export * from './connector-renderer.ts'
export * from './connector-datum.ts'
export * from './connector-spread.ts'
export * from './connection-types.ts'
export * from './connection-manager.ts'

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
    ComputedPath,
} from './types.ts'
