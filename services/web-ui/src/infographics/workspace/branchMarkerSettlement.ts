'use strict'

import type { CanvasNode, CanvasState } from '@lixpi/constants'

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
