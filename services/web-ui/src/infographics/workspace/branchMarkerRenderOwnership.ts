'use strict'

import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
} from '@lixpi/constants'

type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode

export type BranchMarkerRenderOwnership = {
    suppressedNodeIds: Set<string>
    visibleOwnerBySuppressedNodeId: Map<string, string>
}

export type PreflightBranchMarkerScreenOwnership = {
    visiblePreflightNodes: BranchMarkerNode[]
    supersededPreflightNodeIds: Set<string>
}

function getReasoningIndex(node: BranchMarkerNode): number | undefined {
    if (node.pendingState?.reasoningIndex != null) return node.pendingState.reasoningIndex
    if (node.type === 'branchFork' || node.type === 'branchLine') return node.reasoningIndex
    return undefined
}

function getReasoningModelId(node: BranchMarkerNode): string {
    if (node.pendingState?.reasoningModelId) return node.pendingState.reasoningModelId
    if (node.type === 'branchFork' || node.type === 'branchLine') {
        return node.reasoningModelId ?? node.provenance?.reasoningModelId ?? ''
    }
    return ''
}

function selectPlannedOwner(
    preflightNode: BranchMarkerNode,
    plannedNodes: BranchMarkerNode[],
    preflightCount: number,
): BranchMarkerNode | undefined {
    const reasoningIndex = getReasoningIndex(preflightNode)
    if (reasoningIndex != null) {
        const indexMatches = plannedNodes.filter(node => getReasoningIndex(node) === reasoningIndex)
        if (indexMatches.length === 1) return indexMatches[0]
    }

    const reasoningModelId = getReasoningModelId(preflightNode)
    if (reasoningModelId) {
        const modelMatches = plannedNodes.filter(node => getReasoningModelId(node) === reasoningModelId)
        if (modelMatches.length === 1) return modelMatches[0]
    }

    return preflightCount === 1 && plannedNodes.length === 1 ? plannedNodes[0] : undefined
}

export function resolveBranchMarkerRenderOwnership(
    nodes: BranchMarkerNode[],
    startedPlannedNodeIds: ReadonlySet<string>,
): BranchMarkerRenderOwnership {
    const suppressedNodeIds = new Set<string>()
    const visibleOwnerBySuppressedNodeId = new Map<string, string>()
    const threadIds = new Set(
        nodes
            .map(node => node.conversationAssetId)
            .filter((threadId): threadId is string => Boolean(threadId)),
    )

    for (const threadId of threadIds) {
        const threadNodes = nodes.filter(node => node.conversationAssetId === threadId)
        const preflightNodes = threadNodes.filter(node => node.pendingState?.phase === 'preflight')
        const plannedNodes = threadNodes.filter(node => node.pendingState?.phase !== 'preflight')
        for (const preflightNode of preflightNodes) {
            const plannedOwner = selectPlannedOwner(preflightNode, plannedNodes, preflightNodes.length)
            if (!plannedOwner) continue

            const visibleOwner = startedPlannedNodeIds.has(plannedOwner.nodeId)
                ? plannedOwner
                : preflightNode
            const suppressedNode = visibleOwner === plannedOwner
                ? preflightNode
                : plannedOwner
            suppressedNodeIds.add(suppressedNode.nodeId)
            visibleOwnerBySuppressedNodeId.set(suppressedNode.nodeId, visibleOwner.nodeId)
        }
    }

    return { suppressedNodeIds, visibleOwnerBySuppressedNodeId }
}

export function resolvePreflightBranchMarkerScreenOwnership(
    nodes: BranchMarkerNode[],
    startedPlannedNodeIds: ReadonlySet<string>,
): PreflightBranchMarkerScreenOwnership {
    const ownership = resolveBranchMarkerRenderOwnership(nodes, startedPlannedNodeIds)
    const preflightNodes = nodes.filter(node => node.pendingState?.phase === 'preflight')
    const supersededPreflightNodeIds = new Set(
        preflightNodes
            .filter(node => ownership.suppressedNodeIds.has(node.nodeId))
            .map(node => node.nodeId),
    )
    return {
        visiblePreflightNodes: preflightNodes.filter(node => !supersededPreflightNodeIds.has(node.nodeId)),
        supersededPreflightNodeIds,
    }
}
