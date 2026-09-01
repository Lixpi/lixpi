import {
    type CanvasState,
} from '@lixpi/constants'

export type CanvasMembershipStateRebaseInput = {
    requestedState: CanvasState
    currentState: CanvasState | null | undefined
    operation: 'attach' | 'detach'
    removedNodeIds?: readonly string[]
}

export function rebaseCanvasMembershipState({
    requestedState,
    currentState,
    operation,
    removedNodeIds = [],
}: CanvasMembershipStateRebaseInput): CanvasState {
    if (!currentState) return requestedState

    const removedNodeIdSet = new Set(removedNodeIds)
    const requestedNodeIds = new Set(requestedState.nodes.map((node) => node.nodeId))
    const nodes = [
        ...requestedState.nodes,
        ...currentState.nodes.filter((node) => (
            !requestedNodeIds.has(node.nodeId)
            && !(operation === 'detach' && removedNodeIdSet.has(node.nodeId))
        )),
    ]
    const requestedEdgeIds = new Set(requestedState.edges.map((edge) => edge.edgeId))
    const edges = [
        ...requestedState.edges,
        ...currentState.edges.filter((edge) => (
            !requestedEdgeIds.has(edge.edgeId)
            && !(operation === 'detach' && (
                removedNodeIdSet.has(edge.sourceNodeId)
                || removedNodeIdSet.has(edge.targetNodeId)
            ))
        )),
    ]

    return { ...requestedState, nodes, edges }
}
