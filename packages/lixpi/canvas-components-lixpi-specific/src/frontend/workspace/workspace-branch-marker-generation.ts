import {
    getBranchMarkerThreadId,
    getPendingGeneratedMediaNodeId,
    type BranchMarkerNode,
    type PendingGeneratedMediaTracker,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    type CanvasGeometryUpdate,
    type CanvasNode,
    type CanvasState,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type WorkspaceEdge,
} from '@lixpi/constants'

type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode

export type WorkspaceBranchMarkerGenerationPorts = {
    canAct: () => boolean
    getState: () => CanvasState | null
    getScene: () => {
        workspaceId: string
        sceneKey: string
    }
    isCurrentScene: (
        workspaceId: string,
        sceneKey: string,
    ) => boolean
    imageTrackers: ReadonlyMap<string, PendingGeneratedMediaTracker>
    videoTrackers: ReadonlyMap<string, PendingGeneratedMediaTracker>
    isWaitingForFrame: (node: CanvasNode) => boolean
    pruneTrackers: (nodeIds: Iterable<string>) => void
    removeSelection: (nodeId: string) => void
    commit: (state: CanvasState) => void
    removeNodes: (nodeIds: Iterable<string>) => void
    syncConnections: () => void
    cancelledRequests: Set<string>
    settleRequest: (
        threadId: string,
        generationRequestId: string,
        options: { preserveGeometry: boolean },
    ) => void
    clearPlacements: (threadId: string) => void
    settleMarkers: (
        generationRequestId: string,
        options: { preserveGeometry: boolean },
    ) => void
    settleConversation: (threadId: string) => void
    scheduleTeardown: (threadId: string) => void
    refreshMarkers: (threadId: string) => void
    stopConversation: (request: {
        workspaceId: string
        conversationAssetId: string
        generationRequestId?: string
    }) => Promise<{ canvasGeometry?: CanvasGeometryUpdate }>
    applyGeometry: (geometry: CanvasGeometryUpdate) => void
    refreshConversation: (threadId: string) => Promise<unknown>
    reportError: (
        message: string,
        detail: unknown,
    ) => void
}

export class WorkspaceBranchMarkerGeneration {
    constructor(private readonly ports: WorkspaceBranchMarkerGenerationPorts) {}

    stop = async (node: BranchMarkerNode): Promise<void> => {
        if (!this.ports.canAct())
            return

        const scene = this.ports.getScene()
        const threadId = getBranchMarkerThreadId(node)

        if (!threadId)
            return

        const projectionGenerationRequestId = node.generationRequestId || undefined
        const generationRequestId = projectionGenerationRequestId
            && !projectionGenerationRequestId.startsWith('canvas-')
            ? projectionGenerationRequestId
            : undefined

        if (generationRequestId)
            this.ports.cancelledRequests.add(generationRequestId)

        this.removeActiveMedia(node)

        if (generationRequestId)
            this.ports.settleRequest(
                threadId,
                generationRequestId,
                { preserveGeometry: true },
            )
        else {
            this.ports.clearPlacements(threadId)
            this.ports.settleMarkers(node.generationRequestId, { preserveGeometry: true })
            this.ports.settleConversation(threadId)
            this.ports.scheduleTeardown(threadId)
            this.ports.refreshMarkers(threadId)
        }

        try {
            const result = await this.ports.stopConversation({
                workspaceId: scene.workspaceId,
                conversationAssetId: threadId,
                ...(projectionGenerationRequestId ? { generationRequestId: projectionGenerationRequestId } : {}),
            })

            if (!this.ports.isCurrentScene(scene.workspaceId, scene.sceneKey))
                return

            if (result.canvasGeometry)
                this.ports.applyGeometry(result.canvasGeometry)

            if (!this.ports.isCurrentScene(scene.workspaceId, scene.sceneKey))
                return

            await this.ports.refreshConversation(threadId)
        } catch (error) {
            this.ports.reportError(
                '[CANVAS] failed to stop branch-marker generation',
                {
                    nodeId: node.nodeId,
                    threadId,
                    error,
                },
            )
        }
    }

    private belongsToMarker(
        mediaNode: GeneratedMediaNode,
        markerNodeId: string,
    ): boolean {
        return mediaNode.generatedBy?.branchOriginNodeId === markerNodeId
            || mediaNode.generatedBy?.branchForkNodeId === markerNodeId
            || mediaNode.generatedBy?.branchLineNodeId === markerNodeId
            || mediaNode.generatedBy?.lineageParentNodeId === markerNodeId
    }

    private isProjectedPending(node: GeneratedMediaNode): boolean {
        const generatedBy = node.generatedBy

        if (!generatedBy?.generationRequestId)
            return false

        return (
            getPendingGeneratedMediaNodeId({
                generationRequestId: generatedBy.generationRequestId,
                ...(generatedBy.reasoningRunId ? { reasoningRunId: generatedBy.reasoningRunId } : {}),
                ...(generatedBy.mediaRunId ? { mediaRunId: generatedBy.mediaRunId } : {}),
                ...(generatedBy.mediaModelId ? { mediaModelId: generatedBy.mediaModelId } : {}),
                mediaType: generatedBy.mediaType ?? node.type,
                ...(generatedBy.mediaIndex !== undefined ? { mediaIndex: generatedBy.mediaIndex } : {}),
                ...(generatedBy.reasoningIndex !== undefined ? { reasoningIndex: generatedBy.reasoningIndex } : {}),
            }) === node.nodeId
        )
    }

    private trackerBelongsToMarker(
        tracker: PendingGeneratedMediaTracker,
        markerNodeId: string,
    ): boolean {
        if (tracker.sourceNodeId === markerNodeId)
            return true

        const mediaNode = this.ports.getState()?.nodes.find(
            (node: CanvasNode): node is GeneratedMediaNode => (
                node.nodeId === tracker.nodeId && (node.type === 'image' || node.type === 'video')
            ),
        )

        return Boolean(mediaNode && this.belongsToMarker(mediaNode, markerNodeId))
    }

    private getActiveMediaNodeIds(node: BranchMarkerNode): Set<string> {
        const state = this.ports.getState()
        const nodeIds = new Set<string>()
        const trackerNodeIds = new Set<string>([
            ...Array.from(
                this.ports.imageTrackers.values(),
                tracker => tracker.nodeId,
            ),
            ...Array.from(
                this.ports.videoTrackers.values(),
                tracker => tracker.nodeId,
            ),
        ])
        const generationRequestId = node.generationRequestId
            && !node.generationRequestId.startsWith('canvas-')
            ? node.generationRequestId
            : ''

        for (const tracker of this.ports.imageTrackers.values()) {
            if (this.trackerBelongsToMarker(tracker, node.nodeId))
                nodeIds.add(tracker.nodeId)
        }

        for (const tracker of this.ports.videoTrackers.values()) {
            if (this.trackerBelongsToMarker(tracker, node.nodeId))
                nodeIds.add(tracker.nodeId)
        }

        const directlyConnectedNodeIds = new Set(
            (state?.edges ?? []).filter((edge: WorkspaceEdge) => edge.sourceNodeId === node.nodeId).map((edge: WorkspaceEdge) => edge.targetNodeId),
        )

        for (const candidate of state?.nodes ?? []) {
            if (
                candidate.type !== 'image'
                && candidate.type !== 'video'
            )
                continue

            if (
                !trackerNodeIds.has(candidate.nodeId)
                && !this.ports.isWaitingForFrame(candidate)
                && !this.isProjectedPending(candidate)
            )
                continue

            const matchesGenerationRequest = Boolean(generationRequestId && candidate.generatedBy?.generationRequestId === generationRequestId)

            if (
                matchesGenerationRequest
                || directlyConnectedNodeIds.has(candidate.nodeId)
                || this.belongsToMarker(candidate, node.nodeId)
            )
                nodeIds.add(candidate.nodeId)
        }

        return nodeIds
    }

    private removeActiveMedia(node: BranchMarkerNode): void {
        const state = this.ports.getState()

        if (!state)
            return

        const nodeIds = this.getActiveMediaNodeIds(node)

        if (nodeIds.size === 0)
            return

        this.ports.pruneTrackers(nodeIds)

        for (const nodeId of nodeIds) this.ports.removeSelection(nodeId)

        this.ports.commit({
            ...state,
            nodes: state.nodes.filter(candidate => !nodeIds.has(candidate.nodeId)),
            edges: state.edges.filter(edge => !nodeIds.has(edge.sourceNodeId) && !nodeIds.has(edge.targetNodeId)),
        })
        this.ports.removeNodes(nodeIds)
        this.ports.syncConnections()
    }
}
