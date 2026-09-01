import type {
    CanvasState,
    CanvasNode,
    ImageCanvasNode,
    VideoCanvasNode,
    WorkspaceEdge,
    MediaGenerationRunMeta,
} from '@lixpi/constants'
import type { WorkspaceGenerationPlacements } from './workspace-generation-placements.ts'

type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
type TrackerScope = { workspaceId: string; sceneKey: string }

export type PendingGeneratedMediaTracker = {
    nodeId: string
    assetId: string
    sourceNodeId?: string
    placementKey: string
    hasReceivedFrame: boolean
}

export function pruneGeneratedMediaTrackerAliases(trackerMap: Map<string, PendingGeneratedMediaTracker>, runKey: string, nodeId: string): void {
    for (const [existingRunKey, existingTracker] of trackerMap) {
        if (existingRunKey !== runKey && existingTracker.nodeId === nodeId) trackerMap.delete(existingRunKey)
    }
}

export function setGeneratedMediaTracker(trackerMap: Map<string, PendingGeneratedMediaTracker>, runKey: string, tracker: PendingGeneratedMediaTracker): void {
    pruneGeneratedMediaTrackerAliases(trackerMap, runKey, tracker.nodeId)
    trackerMap.set(runKey, tracker)
}

export type WorkspaceMediaTrackersPorts = {
    readScope: () => TrackerScope | null
    readCanvasState: () => CanvasState | null
    placements: WorkspaceGenerationPlacements
    hasDecodedFrame: (nodeId: string) => boolean
    hasReadyOriginal: (assetId: string) => boolean
    forgetDecodedFrame: (nodeId: string) => void
    clearCompletion: (nodeId: string) => void
    debug: (event: string, details: Record<string, unknown>) => void
}

export class WorkspaceMediaTrackers {
    readonly images = new Map<string, PendingGeneratedMediaTracker>()
    readonly videos = new Map<string, PendingGeneratedMediaTracker>()
    private closed = false

    constructor(private readonly ports: WorkspaceMediaTrackersPorts) {}

    clear(): void {
        this.images.clear()
        this.videos.clear()
    }

    destroy(): void {
        this.closed = true
        this.clear()
    }

    private get currentCanvasState(): CanvasState | null {
        return this.closed ? null : this.ports.readCanvasState()
    }

    private isCurrent(scope: TrackerScope): boolean {
        const current = this.closed ? null : this.ports.readScope()
        return current?.workspaceId === scope.workspaceId && current.sceneKey === scope.sceneKey
    }

    generatedMediaNodeMatchesGenerationRun(
        node: CanvasNode,
        mediaType: 'image' | 'video',
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): node is ImageCanvasNode | VideoCanvasNode {
        if ((node.type !== 'image' && node.type !== 'video') || node.type !== mediaType) return false
        const generatedBy = node.generatedBy
        if (!generationRun || !generatedBy || generatedBy.conversationAssetId !== threadId) return false
        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)
        const mediaRunId = generationRun.mediaRunId ?? lineageAssignment?.mediaRunId
        if (mediaRunId && generatedBy.mediaRunId === mediaRunId) return true

        if (generatedBy.generationRequestId !== generationRun.generationRequestId) return false
        if (generationRun.mediaType && generationRun.mediaType !== mediaType) return false
        if (lineageAssignment?.mediaType && lineageAssignment.mediaType !== mediaType) return false
        if (generationRun.reasoningRunId && generatedBy.reasoningRunId && generatedBy.reasoningRunId !== generationRun.reasoningRunId) return false

        const mediaModelId = generationRun.mediaModelId ?? lineageAssignment?.mediaModelId
        if (mediaModelId) return generatedBy.mediaModelId === mediaModelId

        const branchLineNodeId = generationRun.lineageAssignment?.branchLineNodeId ?? lineageAssignment?.branchLineNodeId
        if (branchLineNodeId) return generatedBy.branchLineNodeId === branchLineNodeId

        return Boolean(generatedBy.reasoningRunId && generatedBy.reasoningRunId === generationRun.reasoningRunId)
    }

    getGeneratedMediaNodeRunKey(node: GeneratedMediaNode): string {
        const generatedBy = node.generatedBy
        if (!generatedBy) return ''
        if (generatedBy.mediaRunId) return `mediaRun:${generatedBy.conversationAssetId}:${generatedBy.mediaRunId}`
        let modelId = generatedBy.mediaModelId
        if (!modelId) {
            modelId = node.type === 'image'
                ? node.generatedBy?.aiModel
                : node.generatedBy?.videoModel
        }
        return [
            generatedBy.conversationAssetId,
            generatedBy.generationRequestId ?? '',
            generatedBy.reasoningRunId ?? '',
            modelId ?? '',
            generatedBy.branchForkNodeId ?? '',
            generatedBy.branchLineNodeId ?? '',
            generatedBy.branchOriginNodeId ?? '',
        ].join(':')
    }

    generatedMediaNodesRepresentSameRun(a: GeneratedMediaNode, b: GeneratedMediaNode): boolean {
        if (a.type !== b.type || !a.generatedBy || !b.generatedBy) return false
        const aRunKey = this.getGeneratedMediaNodeRunKey(a)
        const bRunKey = this.getGeneratedMediaNodeRunKey(b)
        return Boolean(aRunKey && aRunKey === bRunKey)
    }

    findGeneratedMediaRunInState(
        state: CanvasState,
        node: GeneratedMediaNode,
        tracker: PendingGeneratedMediaTracker,
    ): { nodeId: string; assetId: string; reason: 'node-id' | 'asset-id' | 'generated-by-run' } | undefined {
        for (const candidate of state.nodes) {
            if (candidate.type !== node.type) continue
            const mediaNode = candidate as GeneratedMediaNode
            if (mediaNode.nodeId === node.nodeId) {
                return { nodeId: mediaNode.nodeId, assetId: mediaNode.assetId, reason: 'node-id' }
            }
            if (tracker.assetId && mediaNode.assetId === tracker.assetId) {
                return { nodeId: mediaNode.nodeId, assetId: mediaNode.assetId, reason: 'asset-id' }
            }
            if (this.generatedMediaNodesRepresentSameRun(node, mediaNode)) {
                return { nodeId: mediaNode.nodeId, assetId: mediaNode.assetId, reason: 'generated-by-run' }
            }
        }
        return undefined
    }

    preserveActiveGeneratedMediaTrackerInState(
        state: CanvasState,
        runKey: string,
        tracker: PendingGeneratedMediaTracker,
        mediaType: 'image' | 'video',
    ): CanvasState {
        if (!this.currentCanvasState) {
            this.ports.debug('skip-preserve-active-tracker-no-current-state', {
                runKey,
                mediaType,
                nodeId: tracker.nodeId,
                sourceNodeId: tracker.sourceNodeId ?? '',
                assetId: tracker.assetId,
                hasReceivedFrame: tracker.hasReceivedFrame,
            })
            return state
        }
        const currentNode = this.currentCanvasState.nodes.find((node: CanvasNode): node is GeneratedMediaNode => node.nodeId === tracker.nodeId && node.type === mediaType)
        if (!currentNode) {
            this.ports.debug('skip-preserve-active-tracker-missing-node', {
                runKey,
                mediaType,
                nodeId: tracker.nodeId,
                sourceNodeId: tracker.sourceNodeId ?? '',
                assetId: tracker.assetId,
                hasReceivedFrame: tracker.hasReceivedFrame,
                incomingNodeCount: state.nodes.length,
            })
            return state
        }
        const incomingRunMatch = this.findGeneratedMediaRunInState(state, currentNode, tracker)
        if (incomingRunMatch) {
            this.ports.debug('skip-preserve-active-tracker-incoming-has-run', {
                runKey,
                mediaType,
                nodeId: tracker.nodeId,
                sourceNodeId: tracker.sourceNodeId ?? '',
                assetId: tracker.assetId,
                hasReceivedFrame: tracker.hasReceivedFrame,
                incomingNodeId: incomingRunMatch.nodeId,
                incomingAssetId: incomingRunMatch.assetId,
                reason: incomingRunMatch.reason,
            })
            return state
        }

        const stateNodeIds = new Set(state.nodes.map((node: CanvasNode) => node.nodeId))
        const stateEdgeIds = new Set(state.edges.map((edge: WorkspaceEdge) => edge.edgeId))
        const sourceNode = tracker.sourceNodeId
            ? this.currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === tracker.sourceNodeId)
            : undefined
        const nodes = stateNodeIds.has(currentNode.nodeId)
            ? state.nodes
            : [
                ...state.nodes,
                ...(sourceNode && !stateNodeIds.has(sourceNode.nodeId) ? [sourceNode] : []),
                currentNode,
            ]
        const preservedEdges = this.currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
            (edge.targetNodeId === currentNode.nodeId || edge.sourceNodeId === currentNode.nodeId)
            && !stateEdgeIds.has(edge.edgeId)
        )
        if (preservedEdges.length === 0 && nodes === state.nodes) return state

        this.ports.debug('preserve-active-tracker-render', {
            runKey,
            mediaType,
            nodeId: tracker.nodeId,
            sourceNodeId: tracker.sourceNodeId ?? '',
            assetId: tracker.assetId,
            hasReceivedFrame: tracker.hasReceivedFrame,
            incomingNodeCount: state.nodes.length,
            preservedEdgeCount: preservedEdges.length,
        })

        return {
            ...state,
            nodes,
            edges: [...state.edges, ...preservedEdges],
        }
    }

    preserveActiveGeneratedMediaTrackersInState(state: CanvasState | null): CanvasState | null {
        if (!state || !this.currentCanvasState) return state

        let nextState = state
        for (const [runKey, tracker] of this.images.entries()) {
            nextState = this.preserveActiveGeneratedMediaTrackerInState(nextState, runKey, tracker, 'image')
        }
        for (const [runKey, tracker] of this.videos.entries()) {
            nextState = this.preserveActiveGeneratedMediaTrackerInState(nextState, runKey, tracker, 'video')
        }
        return nextState
    }

    findGeneratedMediaNodeForRun(
        mediaType: 'image' | 'video',
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): ImageCanvasNode | VideoCanvasNode | undefined {
        return this.currentCanvasState?.nodes.find((node: CanvasNode) => this.generatedMediaNodeMatchesGenerationRun(node, mediaType, threadId, generationRun))
    }

    getGeneratedMediaSourceNodeId(nodeId: string): string | undefined {
        return this.currentCanvasState?.edges.find((edge: WorkspaceEdge) => edge.targetNodeId === nodeId)?.sourceNodeId
    }

    hasGeneratedImageFrame(node: ImageCanvasNode): boolean {
        return this.ports.hasDecodedFrame(node.nodeId)
            || this.ports.hasReadyOriginal(node.assetId)
    }

    hasGeneratedVideoFrame(node: VideoCanvasNode): boolean {
        return this.ports.hasReadyOriginal(node.assetId)
    }

    rememberPartialImageTrackerForNode(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        imageNode: ImageCanvasNode,
    ): PendingGeneratedMediaTracker {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        const sourceNodeId = this.getGeneratedMediaSourceNodeId(imageNode.nodeId)
        const tracker: PendingGeneratedMediaTracker = {
            nodeId: imageNode.nodeId,
            assetId: imageNode.assetId,
            placementKey: this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun),
            hasReceivedFrame: this.hasGeneratedImageFrame(imageNode),
            ...(sourceNodeId ? { sourceNodeId } : {}),
        }
        if (!scope || !this.isCurrent(scope)) return tracker
        setGeneratedMediaTracker(this.images, this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun), tracker)
        return tracker
    }

    rememberVideoGenerationTrackerForNode(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        videoNode: VideoCanvasNode,
    ): PendingGeneratedMediaTracker {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        const sourceNodeId = this.getGeneratedMediaSourceNodeId(videoNode.nodeId)
        const tracker: PendingGeneratedMediaTracker = {
            nodeId: videoNode.nodeId,
            assetId: videoNode.assetId,
            placementKey: this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun),
            hasReceivedFrame: this.hasGeneratedVideoFrame(videoNode),
            ...(sourceNodeId ? { sourceNodeId } : {}),
        }
        if (!scope || !this.isCurrent(scope)) return tracker
        setGeneratedMediaTracker(this.videos, this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun), tracker)
        return tracker
    }

    pruneApiCanvasRemovedGeneratedMediaTrackers(nodeIds: Iterable<string>): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope || !this.isCurrent(scope)) return
        const nodeIdSet = new Set(nodeIds)
        if (nodeIdSet.size === 0) return

        for (const [runKey, tracker] of [...this.images.entries()]) {
            if (nodeIdSet.has(tracker.nodeId)) this.images.delete(runKey)
        }
        for (const [runKey, tracker] of [...this.videos.entries()]) {
            if (nodeIdSet.has(tracker.nodeId)) this.videos.delete(runKey)
        }
        for (const nodeId of nodeIdSet) {
            this.ports.forgetDecodedFrame(nodeId)
            if (!this.isCurrent(scope)) return
            this.ports.clearCompletion(nodeId)
            if (!this.isCurrent(scope)) return
        }
    }
}
