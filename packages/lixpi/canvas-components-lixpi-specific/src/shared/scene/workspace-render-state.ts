import {
    type CanvasNode,
    type CanvasState,
    type WorkspaceEdge,
} from '@lixpi/constants'
import {
    getGeneratedMediaRunIdentity,
    isCompletedGeneratedMediaCanvasNode,
    isPendingGeneratedMediaCanvasNode,
} from '../canvas-node/generated-media-node.ts'
import {
    getSceneNodeStructureKey,
    planVisualState,
    type ViewportSnapshot,
} from '@lixpi/canvas-engine/shared'

type CanvasStateVisualFields = {
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
}

type PendingCanvasVisualCommit = {
    state: CanvasState
    visualSyncKey: string
}

type RenderStatePlanInput = {
    incomingState: CanvasState | null
    pendingVisualCommit: PendingCanvasVisualCommit | null
}

type RenderStatePlan = {
    state: CanvasState | null
    pendingVisualCommit: PendingCanvasVisualCommit | null
    usedPendingVisualState: boolean
    acknowledgedPendingVisualState: boolean
}

const getEdgeStructureKey = (edges: WorkspaceEdge[]): string => {
    return edges.map(
        (edge: WorkspaceEdge) =>
            [
                edge.edgeId,
                edge.sourceNodeId,
                edge.targetNodeId,
                edge.sourceHandle ?? '',
                edge.targetHandle ?? '',
            ].join(':'),
    ).join('|')
}

const getNodeStructureSignature = (node: CanvasNode): string => [node.type, node.parentId ?? ''].join(':')

const getEdgeStructureSignature = (edge: WorkspaceEdge): string => {
    return [
        edge.sourceNodeId,
        edge.targetNodeId,
        edge.sourceHandle ?? '',
        edge.targetHandle ?? '',
    ].join(':')
}

const buildCompletedGeneratedMediaNodeIdsByIdentity = (nodes: CanvasNode[]): Map<string, string[]> => {
    const nodeIdsByIdentity = new Map<string, string[]>()

    for (const node of nodes) {
        if (!isCompletedGeneratedMediaCanvasNode(node))
            continue

        const identity = getGeneratedMediaRunIdentity(node)

        if (!identity)
            continue

        const nodeIds = nodeIdsByIdentity.get(identity) ?? []
        nodeIds.push(node.nodeId)
        nodeIdsByIdentity.set(identity, nodeIds)
    }

    return nodeIdsByIdentity
}

const buildStalePendingGeneratedMediaNodeReplacements = (
    incomingNodes: CanvasNode[],
    pendingNodes: CanvasNode[],
): Map<string, string[]> => {
    const completedNodeIdsByIdentity = buildCompletedGeneratedMediaNodeIdsByIdentity(pendingNodes)
    const replacements = new Map<string, string[]>()

    for (const node of incomingNodes) {
        if (!isPendingGeneratedMediaCanvasNode(node))
            continue

        const identity = getGeneratedMediaRunIdentity(node)

        if (!identity)
            continue

        const replacementNodeIds = completedNodeIdsByIdentity.get(identity)

        if (replacementNodeIds?.length)
            replacements.set(node.nodeId, replacementNodeIds)
    }

    return replacements
}

const getReplacementNodeIds = (
    nodeId: string,
    replacements: Map<string, string[]>,
): string[] => replacements.get(nodeId) ?? [nodeId]

const edgeEndpointsMatchWithGeneratedMediaReplacement = (
    incomingEdge: WorkspaceEdge,
    pendingEdge: WorkspaceEdge,
    replacements: Map<string, string[]>,
): boolean => {
    const sourceNodeIds = getReplacementNodeIds(incomingEdge.sourceNodeId, replacements)
    const targetNodeIds = getReplacementNodeIds(incomingEdge.targetNodeId, replacements)

    return sourceNodeIds.includes(pendingEdge.sourceNodeId)
        && targetNodeIds.includes(pendingEdge.targetNodeId)
        && (incomingEdge.sourceHandle ?? '') === (pendingEdge.sourceHandle ?? '')
        && (incomingEdge.targetHandle ?? '') === (pendingEdge.targetHandle ?? '')
}

const isIncomingVisualStructureCoveredByPendingCommit = (
    incomingState: CanvasState,
    pendingState: CanvasState,
): boolean => {
    const pendingNodeStructures = new Map(
        pendingState.nodes.map((node: CanvasNode) => [node.nodeId, getNodeStructureSignature(node)]),
    )
    const stalePendingGeneratedMediaReplacements = buildStalePendingGeneratedMediaNodeReplacements(incomingState.nodes, pendingState.nodes)

    for (const node of incomingState.nodes) {
        if (pendingNodeStructures.get(node.nodeId) === getNodeStructureSignature(node))
            continue

        if (stalePendingGeneratedMediaReplacements.has(node.nodeId))
            continue

        return false
    }

    const pendingEdgeStructures = new Map(
        pendingState.edges.map((edge: WorkspaceEdge) => [edge.edgeId, getEdgeStructureSignature(edge)]),
    )

    for (const edge of incomingState.edges) {
        if (pendingEdgeStructures.get(edge.edgeId) === getEdgeStructureSignature(edge))
            continue

        const replacedEdgeIsCovered = pendingState.edges.some(
            pendingEdge => edgeEndpointsMatchWithGeneratedMediaReplacement(
                edge,
                pendingEdge,
                stalePendingGeneratedMediaReplacements,
            ),
        )

        if (!replacedEdgeIsCovered)
            return false
    }

    return true
}

export const getNodeStructureKey = (canvasState: CanvasStateVisualFields | null): string => {
    if (!canvasState)
        return ''

    return getSceneNodeStructureKey(canvasState.nodes)
}

export const getCanvasVisualStructureKey = (canvasState: CanvasStateVisualFields | null): string => {
    if (!canvasState)
        return ''

    return `${getNodeStructureKey(canvasState)}::${getEdgeStructureKey(canvasState.edges)}`
}

const getNodeDescriptorSyncKey = (node: CanvasNode): string => ('assetId' in node ? (node.assetId ?? '') : '')

export const getCanvasVisualSyncKey = (canvasState: CanvasStateVisualFields | null): string => {
    if (!canvasState)
        return ''

    const nodeKey = canvasState.nodes.map(
        (node: CanvasNode) =>
            [
                node.nodeId,
                node.type,
                node.parentId ?? '',
                node.position.x,
                node.position.y,
                node.dimensions.width,
                node.dimensions.height,
                'assetId' in node ? node.assetId : '',
                getNodeDescriptorSyncKey(node),
            ].join(':'),
    ).join('|')
    const edgeKey = canvasState.edges.map(
        (edge: WorkspaceEdge) =>
            [
                edge.edgeId,
                edge.sourceNodeId,
                edge.targetNodeId,
                edge.sourceHandle ?? '',
                edge.targetHandle ?? '',
                edge.sourceMessageId ?? '',
                edge.pathType ?? '',
            ].join(':'),
    ).join('|')

    return `${nodeKey}::${edgeKey}`
}

export const createPendingCanvasVisualCommit = (state: CanvasState): PendingCanvasVisualCommit => {
    return {
        state,
        visualSyncKey: getCanvasVisualSyncKey(state),
    }
}

export const updatePendingCanvasVisualCommitViewport = (
    pendingVisualCommit: PendingCanvasVisualCommit | null,
    viewport: ViewportSnapshot,
): PendingCanvasVisualCommit | null => {
    if (!pendingVisualCommit)
        return null

    return {
        ...pendingVisualCommit,
        state: {
            ...pendingVisualCommit.state,
            viewport,
        },
    }
}

export const mergeIncomingCanvasStateWithPendingVisualCommit = (input: RenderStatePlanInput): RenderStatePlan => {
    return planVisualState({
        ...input,
        getSyncKey: getCanvasVisualSyncKey,
        coversIncoming: isIncomingVisualStructureCoveredByPendingCommit,
        preserveVisuals: (incoming, pending) => ({
            ...incoming,
            nodes: pending.nodes,
            edges: pending.edges,
        }),
    })
}

export type {
    PendingCanvasVisualCommit,
    RenderStatePlan,
    RenderStatePlanInput,
}
