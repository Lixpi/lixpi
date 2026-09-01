'use strict'

import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    CanvasNode,
    MediaBranchLineagePlan,
} from '@lixpi/constants'

type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode

export type BranchMarkerRenderOwnership = {
    suppressedNodeIds: Set<string>
    visibleOwnerBySuppressedNodeId: Map<string, string>
}

type PlannedBranchMarkerIdentity = {
    nodeId: string
    type: BranchMarkerNode['type']
    generationRequestId: string
}

function isBranchMarkerNode(node: CanvasNode): node is BranchMarkerNode {
    return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
}

function getPlannedBranchMarkerIdentities(
    lineagePlan: MediaBranchLineagePlan,
): PlannedBranchMarkerIdentity[] {
    return [
        ...(lineagePlan.branchOrigin
            ? [{
                nodeId: lineagePlan.branchOrigin.nodeId,
                type: 'branchOrigin' as const,
                generationRequestId: lineagePlan.branchOrigin.generationRequestId,
            }]
            : []),
        ...lineagePlan.branchForks.map(marker => ({
            nodeId: marker.nodeId,
            type: 'branchFork' as const,
            generationRequestId: marker.generationRequestId,
        })),
        ...lineagePlan.branchLines.map(marker => ({
            nodeId: marker.nodeId,
            type: 'branchLine' as const,
            generationRequestId: marker.generationRequestId,
        })),
    ]
}

export function hasCompletePlannedBranchMarkerGeometry(
    nodes: CanvasNode[],
    lineagePlan: MediaBranchLineagePlan,
): boolean {
    const plannedMarkers = getPlannedBranchMarkerIdentities(lineagePlan)
    if (plannedMarkers.length === 0) return false

    return plannedMarkers.every(plannedMarker =>
        nodes.some(node =>
            isBranchMarkerNode(node)
            && node.nodeId === plannedMarker.nodeId
            && node.type === plannedMarker.type
            && node.generationRequestId === plannedMarker.generationRequestId
            && node.pendingState?.phase !== 'preflight'
        )
    )
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

function getPreflightSlotKey(node: BranchMarkerNode): string {
    const reasoningIndex = getReasoningIndex(node)
    if (reasoningIndex != null) return `reasoning-index:${reasoningIndex}`
    const reasoningModelId = getReasoningModelId(node)
    if (reasoningModelId) return `reasoning-model:${reasoningModelId}`
    return `generation-request:${node.generationRequestId}`
}

function selectPlannedOwner(
    preflightNode: BranchMarkerNode,
    plannedNodes: BranchMarkerNode[],
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

    return plannedNodes.length === 1 ? plannedNodes[0] : undefined
}

export function getSupersededPreflightNodeIdsForPlannedOwner(
    nodes: BranchMarkerNode[],
    plannedOwner: BranchMarkerNode,
): string[] {
    if (plannedOwner.pendingState?.phase === 'preflight' || !plannedOwner.conversationAssetId) return []

    const threadNodes = nodes.filter(node => node.conversationAssetId === plannedOwner.conversationAssetId)
    const preflightNodes = threadNodes.filter(node => node.pendingState?.phase === 'preflight')
    const plannedNodes = [
        ...threadNodes.filter(node => node.pendingState?.phase !== 'preflight' && node.nodeId !== plannedOwner.nodeId),
        plannedOwner,
    ]
    return preflightNodes
        .filter(preflightNode => selectPlannedOwner(preflightNode, plannedNodes)?.nodeId === plannedOwner.nodeId)
        .map(node => node.nodeId)
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
        const preflightOwnerByNodeId = new Map(
            preflightNodes.map(preflightNode => [
                preflightNode.nodeId,
                selectPlannedOwner(preflightNode, plannedNodes),
            ]),
        )
        for (const plannedOwner of plannedNodes) {
            const matchingPreflightNodes = preflightNodes.filter(preflightNode => preflightOwnerByNodeId.get(preflightNode.nodeId)?.nodeId === plannedOwner.nodeId)
            if (matchingPreflightNodes.length === 0) continue

            const visibleOwner = startedPlannedNodeIds.has(plannedOwner.nodeId)
                ? plannedOwner
                : matchingPreflightNodes[0]!
            for (const candidate of [plannedOwner, ...matchingPreflightNodes]) {
                if (candidate.nodeId === visibleOwner.nodeId) continue
                suppressedNodeIds.add(candidate.nodeId)
                visibleOwnerBySuppressedNodeId.set(candidate.nodeId, visibleOwner.nodeId)
            }
        }

        const unmatchedPreflightGroups = new Map<string, BranchMarkerNode[]>()
        for (const preflightNode of preflightNodes) {
            if (preflightOwnerByNodeId.get(preflightNode.nodeId)) continue
            const slotKey = getPreflightSlotKey(preflightNode)
            const slotNodes = unmatchedPreflightGroups.get(slotKey) ?? []
            slotNodes.push(preflightNode)
            unmatchedPreflightGroups.set(slotKey, slotNodes)
        }
        for (const slotNodes of unmatchedPreflightGroups.values()) {
            const visibleOwner = slotNodes[0]
            if (!visibleOwner) continue
            for (const duplicateNode of slotNodes.slice(1)) {
                suppressedNodeIds.add(duplicateNode.nodeId)
                visibleOwnerBySuppressedNodeId.set(duplicateNode.nodeId, visibleOwner.nodeId)
            }
        }
    }

    return { suppressedNodeIds, visibleOwnerBySuppressedNodeId }
}
