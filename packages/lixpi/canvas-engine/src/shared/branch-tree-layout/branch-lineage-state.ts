'use strict'

import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    CanvasNode,
    CapabilityArtifactCanvasNode,
    ImageCanvasNode,
    MediaRunLineageAssignment,
    OperationStatusCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'

export type BranchLineageMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
export type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
export type GeneratedOutputNode = ImageCanvasNode | VideoCanvasNode | CapabilityArtifactCanvasNode
export type FailedMediaGenerationOutputNode = OperationStatusCanvasNode & {
    operation: 'media-generation'
    status: 'failed'
    lineageAssignment: MediaRunLineageAssignment
}
export type BranchLineageOutputNode = GeneratedOutputNode | FailedMediaGenerationOutputNode
export type StartedLineageMarkerState = {
    markerIdsWithGeneratedChildren: Set<string>
    parentIdsWithStartedMarkerChildren: Set<string>
}

// Renderable generated outputs stay distinct from terminal error leaves so
// media-only callers do not accidentally treat a recovery card as pixels.
export function isGeneratedMediaNode(node: CanvasNode): node is GeneratedOutputNode {
    return node.type === 'image' || node.type === 'video' || node.type === 'capabilityArtifact'
}

export function isFailedMediaGenerationOutputNode(
    node: CanvasNode,
): node is FailedMediaGenerationOutputNode {
    return node.type === 'operationStatus'
        && node.operation === 'media-generation'
        && node.status === 'failed'
        && Boolean(node.lineageAssignment?.branchId)
}

// Branch topology outlives provider success. Failed recovery cards carry the
// replaced reservation's assignment and therefore remain real output leaves.
export function isBranchLineageOutputNode(node: CanvasNode): node is BranchLineageOutputNode {
    return isGeneratedMediaNode(node) || isFailedMediaGenerationOutputNode(node)
}

export function getBranchLineageAssignment(
    node: BranchLineageOutputNode,
): MediaRunLineageAssignment | undefined {
    if (isFailedMediaGenerationOutputNode(node)) return node.lineageAssignment
    return node.type === 'image' || node.type === 'video'
        ? node.generationProgress?.lineageAssignment
        : undefined
}

// Branch markers affect drag behavior, connector anchoring, tree membership,
// and pending-stack layout. A single guard keeps those surfaces aligned when a
// marker type is added or renamed.
export function isBranchLineageMarkerNode(node: CanvasNode | undefined): node is BranchLineageMarkerNode {
    return node?.type === 'branchOrigin' || node?.type === 'branchFork' || node?.type === 'branchLine'
}

// A generated media node can reference several marker roles at once: the origin
// that owns the branch plus the midpoint fork/line marker that rendered the
// prompt. State derivation needs the complete set so started markers are not
// accidentally reflowed as if they were still pending.
export function getGeneratedMediaLineageMarkerIds(node: BranchLineageOutputNode): string[] {
    const assignment = getBranchLineageAssignment(node)
    const generatedBy = isFailedMediaGenerationOutputNode(node) ? undefined : node.generatedBy
    const markerIds = [
        generatedBy?.branchOriginNodeId ?? assignment?.branchOriginNodeId,
        generatedBy?.branchForkNodeId ?? assignment?.branchForkNodeId,
        generatedBy?.branchLineNodeId ?? assignment?.branchLineNodeId,
    ].filter((markerId: string | undefined): markerId is string => Boolean(markerId))
    return [...new Set(markerIds)]
}

// Only fork/line markers sit on the connector midpoint. Branch origins are
// structural parents, so midpoint positioning must ignore them even though they
// are part of the same lineage marker state.
export function getGeneratedMediaMidpointMarkerId(node: BranchLineageOutputNode): string | undefined {
    const assignment = getBranchLineageAssignment(node)
    const generatedBy = isFailedMediaGenerationOutputNode(node) ? undefined : node.generatedBy
    return generatedBy?.branchForkNodeId
        ?? assignment?.branchForkNodeId
        ?? generatedBy?.branchLineNodeId
        ?? assignment?.branchLineNodeId
}

// Rebalance and render refresh both need to know which pending markers have
// already produced media. Once a marker has generated children, stale pending
// projection data must not pull it away from its connector midpoint.
export function getStartedLineageMarkerState(nodes: CanvasNode[]): StartedLineageMarkerState {
    const nodesById = new Map(nodes.map((node: CanvasNode) => [node.nodeId, node]))
    const markerIdsWithGeneratedChildren = new Set<string>()
    const parentIdsWithStartedMarkerChildren = new Set<string>()

    for (const node of nodes) {
        if (!isBranchLineageOutputNode(node)) continue
        for (const markerId of getGeneratedMediaLineageMarkerIds(node)) {
            markerIdsWithGeneratedChildren.add(markerId)

            const markerNode = nodesById.get(markerId)
            if ((markerNode?.type === 'branchFork' || markerNode?.type === 'branchLine') && markerNode.parentBranchNodeId) {
                parentIdsWithStartedMarkerChildren.add(markerNode.parentBranchNodeId)
            }
        }
    }

    return { markerIdsWithGeneratedChildren, parentIdsWithStartedMarkerChildren }
}
