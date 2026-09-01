import {
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type BranchOriginCanvasNode,
    type CanvasNode,
    type CanvasState,
} from '@lixpi/constants'

type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode

export type PreflightBranchMarkerSettlement = {
    state: CanvasState
    removedNodeIds: string[]
}

function isPreflightBranchMarkerForThread(node: CanvasNode, threadId: string): boolean {
    if (node.type !== 'branchOrigin' && node.type !== 'branchFork' && node.type !== 'branchLine') return false
    return node.conversationAssetId === threadId && node.pendingState?.phase === 'preflight'
}

export function removePreflightBranchMarkersForThread(
    state: CanvasState,
    threadId: string,
): PreflightBranchMarkerSettlement {
    const removedNodeIds = state.nodes
        .filter(node => isPreflightBranchMarkerForThread(node, threadId))
        .map(node => node.nodeId)
    if (removedNodeIds.length === 0) return { state, removedNodeIds }

    const removedNodeIdSet = new Set(removedNodeIds)
    return {
        state: {
            ...state,
            nodes: state.nodes.filter(node => !removedNodeIdSet.has(node.nodeId)),
            edges: state.edges.filter(edge => (
                !removedNodeIdSet.has(edge.sourceNodeId) && !removedNodeIdSet.has(edge.targetNodeId)
            )),
        },
        removedNodeIds,
    }
}

export function getSupersededBranchMarkerNodeIdsForAuthoritativePlan(args: {
    state: CanvasState
    plannedMarkers: readonly BranchMarkerNode[]
    generationRequestId: string
}): string[] {
    const authoritativeMarkers = args.plannedMarkers.filter(marker => marker.generationRequestId === args.generationRequestId)
    if (authoritativeMarkers.length === 0) return []

    const authoritativeNodeIds = new Set(authoritativeMarkers.map(marker => marker.nodeId))
    const authoritativeThreadIds = new Set(authoritativeMarkers.flatMap(marker => marker.conversationAssetId ? [marker.conversationAssetId] : []))
    return args.state.nodes.flatMap(node => {
        if (node.type !== 'branchOrigin' && node.type !== 'branchFork' && node.type !== 'branchLine') return []
        if (authoritativeNodeIds.has(node.nodeId)) return []
        const isProvisionalPlanMarker = node.generationRequestId === args.generationRequestId
        const isInitialPreflightMarker = node.pendingState?.phase === 'preflight'
            && Boolean(node.conversationAssetId)
            && authoritativeThreadIds.has(node.conversationAssetId!)
            && node.generationRequestId === node.conversationAssetId
        return isProvisionalPlanMarker || isInitialPreflightMarker ? [node.nodeId] : []
    })
}
