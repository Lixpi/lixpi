import {
    createCanvasSidePorts,
    type CanvasGraphEdgeKind,
    type CanvasGraphLayoutOptions,
    type CanvasGraphSpacing,
    type EngineEdge,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    mediaGenerationLayoutSettings,
    workspaceCollisionSettings,
} from '@lixpi/constants'
import { estimateBranchMarkerDimensions } from './marker-dimensions.ts'

// A branch marker drawn from text alone. It uses the workspace pill and its
// measurements without generation, conversation or model state.
export const BRANCH_MARKER_NODE_TYPE = 'branch-marker'

export type BranchMarkerRole = 'origin' | 'fork' | 'continuation'

export type BranchMarkerNodeData = {
    prompt: string
    response?: string
    role: BranchMarkerRole
}

export type BranchMarkerEdgeData = {
    kind?: CanvasGraphEdgeKind
}

export const createBranchMarkerNode = (
    nodeId: string,
    data: BranchMarkerNodeData,
): EngineNode<BranchMarkerNodeData> => {
    const dimensions = estimateBranchMarkerDimensions(
        data.prompt,
        {
            responseLine: Boolean(data.response),
            responseText: data.response,
        },
    )

    return {
        nodeId,
        type: BRANCH_MARKER_NODE_TYPE,
        position: {
            x: 0,
            y: 0,
        },
        dimensions,
        ports: createCanvasSidePorts(dimensions),
        data,
    }
}

export const createBranchMarkerEdge = (
    edgeId: string,
    source: string,
    target: string,
    kind: CanvasGraphEdgeKind = 'forward',
): EngineEdge<BranchMarkerEdgeData> => ({
    edgeId,
    source: {
        nodeId: source,
        portId: 'right',
    },
    target: {
        nodeId: target,
        portId: 'left',
    },
    path: kind === 'forward' ? 'horizontal-bezier' : 'orthogonal',
    data: { kind },
})

// Marker clearance, sibling spacing and collision policy match the workspace's
// own branch tree. Media-to-media spacing does not apply to marker-only graphs.
const collision = workspaceCollisionSettings.branchTree.nodeTypes.branchOrigin

export const branchMarkerGraphSpacing: CanvasGraphSpacing = {
    nodeGap: mediaGenerationLayoutSettings.nodeGap,
    siblingGap: mediaGenerationLayoutSettings.branchRowGap,
    collisionIterations: collision.iterations,
    overlapThreshold: collision.overlapThreshold,
}

export const branchMarkerEdgeKind = (edge: EngineEdge): CanvasGraphEdgeKind => (edge.data as BranchMarkerEdgeData | null)?.kind ?? 'forward'

export const createBranchMarkerGraphLayout = (stages?: CanvasGraphLayoutOptions['stages']): CanvasGraphLayoutOptions => ({
    ...(stages ? { stages } : {}),
    edgeKind: branchMarkerEdgeKind,
    spacing: branchMarkerGraphSpacing,
})
