import {
    type ConnectionPolicy,
} from '@lixpi/canvas-engine/frontend/connectors'
import {
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    type BranchMarkerEdgeData,
    type BranchMarkerNodeData,
} from '../../shared/branch-tree-layout/branch-marker-node.ts'

// Fork and continuation markers sit on a lineage connector rather than
// terminating it. Relations and feedback retain arrows regardless of the
// target's lineage role. Every canvas shares the native artwork.
export const getBranchConnectionTargetMarker = (
    role: 'origin' | 'fork' | 'continuation' | undefined,
    selected: boolean,
    kind: 'forward' | 'relation' | 'feedback' = 'forward',
): 'none' | 'arrowhead' | 'arrowhead-selected' =>
    kind === 'forward'
        && (role === 'fork' || role === 'continuation')
        ? 'none'
        : selected
            ? 'arrowhead-selected'
            : 'arrowhead'

// Connector policy for canvases that draw branch-marker nodes: centered
// lineage ports, left-side targets and the workspace arrow rules.
export const createBranchMarkerConnectionPolicy = (): Partial<ConnectionPolicy<EngineNode>> => ({
    isCentered: () => true,
    defaultTargetHandle: () => 'left',
    targetMarker: (
        node,
        selected,
        edge,
    ) => getBranchConnectionTargetMarker(
        (node?.data as BranchMarkerNodeData | undefined)?.role,
        selected,
        (edge.data as BranchMarkerEdgeData | undefined)?.kind,
    ),
})
