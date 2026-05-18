import type { CanvasNode, CanvasState, WorkspaceEdge } from '@lixpi/constants'
import type { ViewportSnapshot } from '$src/infographics/workspace/workspaceViewportStatePlan.ts'

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

function getEdgeStructureKey(edges: WorkspaceEdge[]): string {
    return edges.map((edge: WorkspaceEdge) => [
        edge.edgeId,
        edge.sourceNodeId,
        edge.targetNodeId,
        edge.sourceHandle ?? '',
        edge.targetHandle ?? '',
    ].join(':')).join('|')
}

export function getNodeStructureKey(canvasState: CanvasStateVisualFields | null): string {
    if (!canvasState) return ''
    return canvasState.nodes.map((node: CanvasNode) => `${node.nodeId}:${node.type}:${node.parentId ?? ''}`).join(',')
}

export function getCanvasVisualStructureKey(canvasState: CanvasStateVisualFields | null): string {
    if (!canvasState) return ''
    return `${getNodeStructureKey(canvasState)}::${getEdgeStructureKey(canvasState.edges)}`
}

export function getCanvasVisualSyncKey(canvasState: CanvasStateVisualFields | null): string {
    if (!canvasState) return ''
    const nodeKey = canvasState.nodes.map((node: CanvasNode) => [
        node.nodeId,
        node.type,
        node.parentId ?? '',
        node.position.x,
        node.position.y,
        node.dimensions.width,
        node.dimensions.height,
        node.type === 'image' ? node.fileId : '',
        node.type === 'image' ? node.src : '',
    ].join(':')).join('|')
    const edgeKey = canvasState.edges.map((edge: WorkspaceEdge) => [
        edge.edgeId,
        edge.sourceNodeId,
        edge.targetNodeId,
        edge.sourceHandle ?? '',
        edge.targetHandle ?? '',
        edge.sourceMessageId ?? '',
        edge.pathType ?? '',
    ].join(':')).join('|')

    return `${nodeKey}::${edgeKey}`
}

export function createPendingCanvasVisualCommit(state: CanvasState): PendingCanvasVisualCommit {
    return {
        state,
        visualSyncKey: getCanvasVisualSyncKey(state),
    }
}

export function updatePendingCanvasVisualCommitViewport(
    pendingVisualCommit: PendingCanvasVisualCommit | null,
    viewport: ViewportSnapshot,
): PendingCanvasVisualCommit | null {
    if (!pendingVisualCommit) return null
    return {
        ...pendingVisualCommit,
        state: {
            ...pendingVisualCommit.state,
            viewport,
        },
    }
}

export function mergeIncomingCanvasStateWithPendingVisualCommit(input: RenderStatePlanInput): RenderStatePlan {
    const { incomingState, pendingVisualCommit } = input
    if (!incomingState || !pendingVisualCommit) {
        return {
            state: incomingState,
            pendingVisualCommit,
            usedPendingVisualState: false,
            acknowledgedPendingVisualState: false,
        }
    }

    const incomingVisualSyncKey = getCanvasVisualSyncKey(incomingState)
    if (incomingVisualSyncKey === pendingVisualCommit.visualSyncKey) {
        return {
            state: incomingState,
            pendingVisualCommit: null,
            usedPendingVisualState: false,
            acknowledgedPendingVisualState: true,
        }
    }

    const sameVisualStructure = getCanvasVisualStructureKey(incomingState) === getCanvasVisualStructureKey(pendingVisualCommit.state)
    if (!sameVisualStructure) {
        return {
            state: incomingState,
            pendingVisualCommit: null,
            usedPendingVisualState: false,
            acknowledgedPendingVisualState: false,
        }
    }

    return {
        state: {
            ...incomingState,
            nodes: pendingVisualCommit.state.nodes,
            edges: pendingVisualCommit.state.edges,
        },
        pendingVisualCommit,
        usedPendingVisualState: true,
        acknowledgedPendingVisualState: false,
    }
}

export type { PendingCanvasVisualCommit, RenderStatePlan, RenderStatePlanInput }