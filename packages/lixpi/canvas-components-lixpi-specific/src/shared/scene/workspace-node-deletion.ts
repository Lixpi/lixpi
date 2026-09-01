import type {
    Asset,
    CanvasNode,
    CanvasState,
    OperationStatusCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'
import { isGeneratedOutputCanvasNode } from '../canvas-node/generated-media-node.ts'
import { isGeneratedOutputRejectableForCanvas } from '../review/generated-output-review-state.ts'

type Scope = { workspaceId: string; sceneKey: string }
export type WorkspaceNodeDeletionPorts = {
    readScope: () => Scope | null
    readState: () => CanvasState | null
    getAsset: (assetId: string) => Asset | undefined
    clearSelection: () => void
    resolveTree: (nodes: CanvasNode[], edges: WorkspaceEdge[]) => Pick<CanvasState, 'nodes' | 'edges'>
    rejectOutput: (scope: 'output-node' | 'branch-lineage', nodeId: string) => Promise<'applied' | 'not-found' | 'failed'>
    getRequest: (request: { workspaceId: string; generationRequestId: string }) => Promise<{ request?: { revision: number } }>
    cancelRequest: (request: { workspaceId: string; generationRequestId: string; requestRevision: number }) => Promise<unknown>
    removeOperation: (nodeId: string, operation: OperationStatusCanvasNode['operation']) => void
    detachAsset?: (request: { assetId: string; nodeId: string; removedNodeIds: string[]; canvasState: CanvasState }) => Promise<CanvasState>
    commitTransient: (state: CanvasState) => void
    commit: (state: CanvasState) => void
    removeContextChips: (nodeIds: readonly string[]) => void
    reportError: (message: string, detail: unknown) => void
    warn: (message: string, detail: unknown) => void
}

function isBranchMarkerNode(node: CanvasNode): boolean {
    return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
}

function getRemovedCanvasNodeIds(previous: CanvasState, next: CanvasState): string[] {
    const retainedNodeIds = new Set(next.nodes.map(node => node.nodeId))
    return previous.nodes.map(node => node.nodeId).filter(nodeId => !retainedNodeIds.has(nodeId))
}

function pruneCanvasContextChips(state: CanvasState, removedNodeIds: readonly string[]): CanvasState {
    if (!state.aiChatPanel || removedNodeIds.length === 0) return state
    const removed = new Set(removedNodeIds)
    const contextChips = state.aiChatPanel.contextChips.filter(nodeId => !removed.has(nodeId))
    return contextChips.length === state.aiChatPanel.contextChips.length ? state : {
        ...state,
        aiChatPanel: { ...state.aiChatPanel, contextChips },
    }
}

function isMissingAssetDetachError(error: unknown): boolean {
    return error instanceof Error && error.message === 'NOT_FOUND'
}

export class WorkspaceNodeDeletion {
    private active: Scope | null = null
    private closed = false

    constructor(private readonly ports: WorkspaceNodeDeletionPorts) {}

    clear(): void {
        this.active = null
    }
    destroy(): void {
        this.closed = true
        this.clear()
    }

    async deleteCanvasNodes(nodeIds: ReadonlySet<string>): Promise<void> {
        const current = this.ports.readScope()
        if (this.closed || !current || !this.ports.readState() || nodeIds.size === 0) return
        if (this.active && this.isCurrent(this.active)) return
        const scope = { ...current }
        const requestedNodeIds = [...nodeIds]
        this.active = scope
        const undeletedNodeIds: string[] = []
        try {
            this.ports.clearSelection()
            for (const nodeId of requestedNodeIds) {
                if (!this.isCurrent(scope)) return
                const node = this.ports.readState()?.nodes.find(candidate => candidate.nodeId === nodeId)
                if (!node) continue
                try {
                    if (node.type === 'operationStatus') {
                        if (node.operation === 'media-generation' && node.generationRequestId && node.requestRevision !== undefined) {
                            await this.ports.cancelRequest({
                                generationRequestId: node.generationRequestId,
                                workspaceId: scope.workspaceId,
                                requestRevision: node.requestRevision,
                            })
                        }
                        if (!this.isCurrent(scope)) return
                        this.ports.removeOperation(node.nodeId, node.operation)
                        continue
                    }
                    const reviewScope = isBranchMarkerNode(node)
                        ? 'branch-lineage' as const
                        : this.isRejectableGeneratedOutputNode(node)
                        ? 'output-node' as const
                        : null
                    if (!this.isCurrent(scope)) return
                    if (reviewScope) {
                        const result = await this.ports.rejectOutput(reviewScope, node.nodeId)
                        if (!this.isCurrent(scope)) return
                        if (result === 'applied') continue
                    }
                    if (await this.cancelOwningMediaGenerationRun(node, scope)) continue
                    if (!this.isCurrent(scope)) return
                    await this.detachCanvasNode(node.nodeId, scope)
                } catch (error) {
                    if (!this.isCurrent(scope)) return
                    undeletedNodeIds.push(node.nodeId)
                    this.ports.reportError('[CANVAS][node-deletion] Skipping a node that could not be deleted:', { nodeId: node.nodeId, error })
                }
            }
        } catch (error) {
            if (this.isCurrent(scope)) this.ports.reportError('[CANVAS][node-deletion] Unable to delete canvas selection:', error)
        } finally {
            const current = this.isCurrent(scope)
            if (this.active === scope) this.active = null
            if (current && undeletedNodeIds.length) {
                this.ports.reportError('[CANVAS][node-deletion] Some nodes in the selection remain:', undeletedNodeIds)
            }
        }
    }

    private isCurrent(scope: Scope): boolean {
        if (this.closed || this.active !== scope || !this.ports.readState()) return false
        const current = this.ports.readScope()
        return current?.workspaceId === scope.workspaceId && current.sceneKey === scope.sceneKey
    }

    private isRejectableGeneratedOutputNode(node: CanvasNode): boolean {
        if (!isGeneratedOutputCanvasNode(node)) return false
        const state = this.ports.readState()
        return isGeneratedOutputRejectableForCanvas({
            node,
            asset: this.ports.getAsset(node.assetId),
            nodes: state?.nodes ?? [],
            edges: state?.edges ?? [],
        })
    }

    private async cancelOwningMediaGenerationRun(node: CanvasNode, scope: Scope): Promise<boolean> {
        if (node.type !== 'image' && node.type !== 'video') return false
        const mediaRunId = node.generationProgress?.mediaRunId
        const generationRequestId = node.generationProgress?.generationRequestId ?? node.generatedBy?.generationRequestId
        const operation = (this.ports.readState()?.nodes ?? []).find((candidate): candidate is OperationStatusCanvasNode => (
            candidate.type === 'operationStatus'
            && candidate.operation === 'media-generation'
            && Boolean(candidate.generationRequestId)
            && candidate.requestRevision !== undefined
            && (candidate.outputNodeId === node.nodeId
                || (Boolean(mediaRunId) && candidate.mediaRunId === mediaRunId)
                || (Boolean(generationRequestId) && candidate.generationRequestId === generationRequestId))
        ))
        const cancelRequestId = operation?.generationRequestId ?? generationRequestId
        if (!cancelRequestId || cancelRequestId.startsWith('canvas-')) return false
        const requestRevision = operation?.requestRevision
            ?? (await this.ports.getRequest({ generationRequestId: cancelRequestId, workspaceId: scope.workspaceId })).request?.revision
        if (!this.isCurrent(scope) || requestRevision === undefined) return false
        await this.ports.cancelRequest({ generationRequestId: cancelRequestId, workspaceId: scope.workspaceId, requestRevision })
        if (this.isCurrent(scope) && operation) this.ports.removeOperation(operation.nodeId, 'media-generation')
        return true
    }

    private async detachCanvasNode(nodeId: string, scope: Scope): Promise<void> {
        if (!this.isCurrent(scope)) return
        const previousState = this.ports.readState()
        if (!previousState) return
        const deletedNode = previousState.nodes.find(node => node.nodeId === nodeId)
        if (!deletedNode) return
        const remainingNodes = previousState.nodes.filter(node => node.nodeId !== nodeId)
        const updatedEdges = previousState.edges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId)
        const resolvedTreeState = (isGeneratedOutputCanvasNode(deletedNode) && Boolean(deletedNode.generatedBy?.branchId)) || isBranchMarkerNode(deletedNode)
            ? this.ports.resolveTree(remainingNodes, updatedEdges)
            : { nodes: remainingNodes, edges: updatedEdges }
        if (!this.isCurrent(scope)) return
        const unprunedNextState: CanvasState = { ...previousState, ...resolvedTreeState }
        const removedNodeIds = getRemovedCanvasNodeIds(previousState, unprunedNextState)
        const nextState = pruneCanvasContextChips(unprunedNextState, removedNodeIds)
        const assetId = 'assetId' in deletedNode ? deletedNode.assetId : undefined
        if (assetId && this.ports.detachAsset) {
            try {
                const committedState = await this.ports.detachAsset({ assetId, nodeId, removedNodeIds, canvasState: nextState })
                if (!this.isCurrent(scope)) return
                this.ports.commitTransient(committedState)
                if (!this.isCurrent(scope)) return
                this.ports.removeContextChips(removedNodeIds)
                return
            } catch (error) {
                if (!this.isCurrent(scope)) return
                if (!isMissingAssetDetachError(error)) throw error
                this.ports.warn('[CANVAS][node-deletion] Detaching a node whose Asset no longer exists:', { nodeId, assetId })
            }
        }
        if (!this.isCurrent(scope)) return
        this.ports.commit(nextState)
        if (!this.isCurrent(scope)) return
        this.ports.removeContextChips(removedNodeIds)
    }
}
