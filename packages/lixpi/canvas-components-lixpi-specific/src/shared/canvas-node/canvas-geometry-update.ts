'use strict'

import { applyNodeGeometry } from '@lixpi/canvas-engine/shared'
import type {
    CanvasGeometryUpdate,
    CanvasNode,
    CanvasState,
    WorkspaceEdge,
} from '@lixpi/constants'
import {
    getGeneratedMediaRunIdentity,
    isCompletedGeneratedMediaCanvasNode,
    isGeneratedMediaCanvasNode,
    isPendingGeneratedMediaCanvasNode,
} from './generated-media-node.ts'

export type ApplyCanvasGeometryUpdateResult = {
    state: CanvasState
    changed: boolean
    initialMatchedGeometryNodeCount: number
    matchedGeometryNodeCount: number
    missingGeometryNodeIds: string[]
    upsertedNodeIds: string[]
    updatedNodeIds: string[]
    removedNodeIds: string[]
    upsertedEdgeIds: string[]
    removedEdgeIds: string[]
    appliedGeometryNodeIds: string[]
    fullyApplied: boolean
}

function edgeTouchesAnyNode(edge: WorkspaceEdge, nodeIds: Set<string>): boolean {
    return nodeIds.has(edge.sourceNodeId) || nodeIds.has(edge.targetNodeId)
}

function buildCompletedGeneratedMediaRunIdentities(nodes: CanvasNode[]): Set<string> {
    const identities = new Set<string>()
    for (const node of nodes) {
        if (!isCompletedGeneratedMediaCanvasNode(node)) continue
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

function canvasNodesMatch(left: CanvasNode, right: CanvasNode): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
}

function isApiOwnedCanvasSnapshotNode(node: CanvasNode): boolean {
    return isGeneratedMediaCanvasNode(node)
        || node.type === 'branchOrigin'
        || node.type === 'branchFork'
        || node.type === 'branchLine'
}

function isEmptyGeneratedMediaSnapshotStaleForExistingFrame(existing: CanvasNode, snapshot: CanvasNode): boolean {
    if (!isGeneratedMediaCanvasNode(existing) || !isPendingGeneratedMediaCanvasNode(snapshot)) return false
    return isCompletedGeneratedMediaCanvasNode(existing)
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
                if (!isPendingGeneratedMediaCanvasNode(snapshot)) return false
                const identity = getGeneratedMediaRunIdentity(snapshot)
                return Boolean(identity && completedGeneratedMediaRunIdentities.has(identity))
            })
            .map((snapshot) => snapshot.nodeId),
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

    const upsertedNodeIds: string[] = []
    const updatedNodeIds: string[] = []
    const snapshotNodes = update.nodeSnapshots ?? []
    const snapshotNodesById = new Map(snapshotNodes.map(snapshot => [snapshot.nodeId, snapshot]))
    if (snapshotNodesById.size > 0) {
        nodes = nodes.map((node) => {
            const snapshot = snapshotNodesById.get(node.nodeId)
            if (
                !snapshot
                || requestedRemovedNodeIds.has(snapshot.nodeId)
                || stalePendingSnapshotNodeIds.has(snapshot.nodeId)
                || !isApiOwnedCanvasSnapshotNode(snapshot)
                || isEmptyGeneratedMediaSnapshotStaleForExistingFrame(node, snapshot)
            ) {
                return node
            }
            if (canvasNodesMatch(node, snapshot)) return node
            updatedNodeIds.push(snapshot.nodeId)
            changed = true
            return snapshot
        })
    }
    const nodeIds = new Set(nodes.map((node) => node.nodeId))
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
        const result = applyNodeGeometry(node, {
            position: geometry.position,
            dimensions: geometry.dimensions,
            parentId: geometry.parentNodeId,
        })
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
        updatedNodeIds,
        removedNodeIds,
        upsertedEdgeIds,
        removedEdgeIds,
        appliedGeometryNodeIds,
        fullyApplied: missingGeometryNodeIds.length === 0,
    }
}
