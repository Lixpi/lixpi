'use strict'

import type { CanvasGeometryUpdate, CanvasNode, CanvasNodeGeometry, CanvasState, WorkspaceEdge } from '@lixpi/constants'

export type ApplyCanvasGeometryUpdateResult = {
    state: CanvasState
    changed: boolean
    initialMatchedGeometryNodeCount: number
    matchedGeometryNodeCount: number
    missingGeometryNodeIds: string[]
    upsertedNodeIds: string[]
    removedNodeIds: string[]
    upsertedEdgeIds: string[]
    removedEdgeIds: string[]
    appliedGeometryNodeIds: string[]
    fullyApplied: boolean
}

function edgeTouchesAnyNode(edge: WorkspaceEdge, nodeIds: Set<string>): boolean {
    return nodeIds.has(edge.sourceNodeId) || nodeIds.has(edge.targetNodeId)
}

type GeneratedMediaCanvasNode = Extract<CanvasNode, { type: 'image' | 'video' }>

function isGeneratedMediaNode(node: CanvasNode): node is GeneratedMediaCanvasNode {
    return (node.type === 'image' || node.type === 'video') && Boolean(node.generatedBy)
}

function isPendingGeneratedMediaNode(node: CanvasNode): boolean {
    if (!isGeneratedMediaNode(node)) return false
    if (node.type === 'image') return !node.fileId && !node.src
    return !node.fileId && !node.posterFileId && !node.src && !node.posterSrc
}

function getGeneratedMediaRunIdentity(node: CanvasNode): string {
    if (!isGeneratedMediaNode(node)) return ''
    const generatedBy = node.generatedBy
    if (!generatedBy) return ''
    if (generatedBy.mediaRunId) return `${node.type}:media-run:${generatedBy.mediaRunId}`
    const requestId = generatedBy.generationRequestId
    if (!requestId) return ''
    return [
        node.type,
        requestId,
        generatedBy.reasoningRunId ?? '',
        generatedBy.mediaModelId ?? '',
        generatedBy.mediaIndex ?? '',
        generatedBy.variantIndex ?? '',
        generatedBy.branchForkNodeId ?? '',
        generatedBy.branchLineNodeId ?? '',
    ].join(':')
}

function buildCompletedGeneratedMediaRunIdentities(nodes: CanvasNode[]): Set<string> {
    const identities = new Set<string>()
    for (const node of nodes) {
        if (!isGeneratedMediaNode(node) || isPendingGeneratedMediaNode(node)) continue
        const identity = getGeneratedMediaRunIdentity(node)
        if (identity) identities.add(identity)
    }
    return identities
}

function workspaceEdgesMatch(left: WorkspaceEdge, right: WorkspaceEdge): boolean {
    return left.edgeId === right.edgeId
        && left.sourceNodeId === right.sourceNodeId
        && left.targetNodeId === right.targetNodeId
        && left.sourceHandle === right.sourceHandle
        && left.targetHandle === right.targetHandle
        && left.sourceT === right.sourceT
        && left.targetT === right.targetT
        && left.sourceMessageId === right.sourceMessageId
        && left.pathType === right.pathType
}

function applyGeometryToNode(node: CanvasNode, geometry: CanvasNodeGeometry): { node: CanvasNode; changed: boolean } {
    const positionChanged = node.position.x !== geometry.position.x || node.position.y !== geometry.position.y
    const dimensionsChanged = node.dimensions.width !== geometry.dimensions.width || node.dimensions.height !== geometry.dimensions.height
    const parentChanged = geometry.parentNodeId !== undefined && node.parentId !== geometry.parentNodeId
    if (!positionChanged && !dimensionsChanged && !parentChanged) return { node, changed: false }

    return {
        node: {
            ...node,
            position: { x: geometry.position.x, y: geometry.position.y },
            dimensions: { width: geometry.dimensions.width, height: geometry.dimensions.height },
            ...(geometry.parentNodeId !== undefined ? { parentId: geometry.parentNodeId } : {}),
        } as CanvasNode,
        changed: true,
    }
}

export function applyCanvasGeometryUpdateToState(
    state: CanvasState,
    update: CanvasGeometryUpdate,
): ApplyCanvasGeometryUpdateResult {
    const geometryByNodeId = new Map(update.nodes.map((geometry) => [geometry.nodeId, geometry]))
    const requestedRemovedNodeIds = new Set(update.removedNodeIds ?? [])
    const requestedRemovedEdgeIds = new Set(update.removedEdgeIds ?? [])
    const completedGeneratedMediaRunIdentities = buildCompletedGeneratedMediaRunIdentities(state.nodes)
    const stalePendingSnapshotNodeIds = new Set(
        (update.nodeSnapshots ?? [])
            .filter((snapshot) => {
                if (!isPendingGeneratedMediaNode(snapshot)) return false
                const identity = getGeneratedMediaRunIdentity(snapshot)
                return Boolean(identity && completedGeneratedMediaRunIdentities.has(identity))
            })
            .map((snapshot) => snapshot.nodeId)
    )
    const initialNodeIds = new Set(state.nodes.map((node) => node.nodeId))
    const initialMatchedGeometryNodeCount = update.nodes.filter((geometry) => initialNodeIds.has(geometry.nodeId)).length

    let changed = false
    const removedNodeIds: string[] = []
    const removedEdgeIds: string[] = []
    let nodes = state.nodes
    let edges = state.edges

    if (requestedRemovedNodeIds.size > 0) {
        nodes = state.nodes.filter((node) => {
            if (!requestedRemovedNodeIds.has(node.nodeId)) return true
            removedNodeIds.push(node.nodeId)
            return false
        })
        changed = removedNodeIds.length > 0
    }

    if (requestedRemovedNodeIds.size > 0 || requestedRemovedEdgeIds.size > 0) {
        edges = state.edges.filter((edge) => {
            const removeEdge = requestedRemovedEdgeIds.has(edge.edgeId) || edgeTouchesAnyNode(edge, requestedRemovedNodeIds)
            if (removeEdge) removedEdgeIds.push(edge.edgeId)
            return !removeEdge
        })
        changed = changed || removedEdgeIds.length > 0
    }

    const nodeIds = new Set(nodes.map((node) => node.nodeId))
    const upsertedNodeIds: string[] = []
    const snapshotNodes = update.nodeSnapshots ?? []
    for (const snapshot of snapshotNodes) {
        if (requestedRemovedNodeIds.has(snapshot.nodeId) || stalePendingSnapshotNodeIds.has(snapshot.nodeId) || nodeIds.has(snapshot.nodeId)) continue
        nodes = [...nodes, snapshot]
        nodeIds.add(snapshot.nodeId)
        upsertedNodeIds.push(snapshot.nodeId)
        changed = true
    }

    const appliedGeometryNodeIds: string[] = []
    const resolvedNodes = nodes.map((node) => {
        const geometry = geometryByNodeId.get(node.nodeId)
        if (!geometry) return node
        appliedGeometryNodeIds.push(node.nodeId)
        const result = applyGeometryToNode(node, geometry)
        changed = changed || result.changed
        return result.node
    })

    const resolvedNodeIds = new Set(resolvedNodes.map((node) => node.nodeId))
    const missingGeometryNodeIds = update.nodes
        .filter((geometry) => !resolvedNodeIds.has(geometry.nodeId))
        .map((geometry) => geometry.nodeId)

    const upsertedEdgeIds: string[] = []
    let resolvedEdges = edges
    const edgesById = new Map(resolvedEdges.map((edge) => [edge.edgeId, edge]))
    for (const snapshot of update.edgeSnapshots ?? []) {
        if (
            requestedRemovedEdgeIds.has(snapshot.edgeId)
            || edgeTouchesAnyNode(snapshot, requestedRemovedNodeIds)
            || edgeTouchesAnyNode(snapshot, stalePendingSnapshotNodeIds)
            || !resolvedNodeIds.has(snapshot.sourceNodeId)
            || !resolvedNodeIds.has(snapshot.targetNodeId)
        ) {
            continue
        }

        const existing = edgesById.get(snapshot.edgeId)
        if (existing && workspaceEdgesMatch(existing, snapshot)) continue

        resolvedEdges = existing
            ? resolvedEdges.map((edge) => edge.edgeId === snapshot.edgeId ? snapshot : edge)
            : [...resolvedEdges, snapshot]
        edgesById.set(snapshot.edgeId, snapshot)
        upsertedEdgeIds.push(snapshot.edgeId)
        changed = true
    }

    return {
        state: changed ? { ...state, nodes: resolvedNodes, edges: resolvedEdges } : state,
        changed,
        initialMatchedGeometryNodeCount,
        matchedGeometryNodeCount: update.nodes.length - missingGeometryNodeIds.length,
        missingGeometryNodeIds,
        upsertedNodeIds,
        removedNodeIds,
        upsertedEdgeIds,
        removedEdgeIds,
        appliedGeometryNodeIds,
        fullyApplied: missingGeometryNodeIds.length === 0,
    }
}
