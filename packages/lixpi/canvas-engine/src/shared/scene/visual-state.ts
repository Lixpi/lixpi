export type PendingVisualCommit<State> = { state: State; visualSyncKey: string }
export type VisualStatePlan<State> = {
    state: State | null
    pendingVisualCommit: PendingVisualCommit<State> | null
    usedPendingVisualState: boolean
    acknowledgedPendingVisualState: boolean
}
export type VisualStatePlanOptions<State> = {
    incomingState: State | null
    pendingVisualCommit: PendingVisualCommit<State> | null
    getSyncKey: (state: State) => string
    coversIncoming: (incoming: State, pending: State) => boolean
    preserveVisuals: (incoming: State, pending: State) => State
}

export function planVisualState<State>(options: VisualStatePlanOptions<State>): VisualStatePlan<State> {
    const { incomingState, pendingVisualCommit } = options
    if (!incomingState || !pendingVisualCommit) return { state: incomingState, pendingVisualCommit, usedPendingVisualState: false, acknowledgedPendingVisualState: false }
    if (options.getSyncKey(incomingState) === pendingVisualCommit.visualSyncKey) return { state: incomingState, pendingVisualCommit: null, usedPendingVisualState: false, acknowledgedPendingVisualState: true }
    if (!options.coversIncoming(incomingState, pendingVisualCommit.state)) return { state: incomingState, pendingVisualCommit: null, usedPendingVisualState: false, acknowledgedPendingVisualState: false }
    return { state: options.preserveVisuals(incomingState, pendingVisualCommit.state), pendingVisualCommit, usedPendingVisualState: true, acknowledgedPendingVisualState: false }
}

export function getSceneNodeStructureKey(nodes: readonly { nodeId: string; type: string; parentId?: string }[]): string {
    return nodes.map(node => `${node.nodeId}:${node.type}:${node.parentId ?? ''}`).join(',')
}
