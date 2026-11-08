import {
    type CanvasNode,
    type CanvasState,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type WorkspaceEdge,
    type MediaGenerationRunMeta,
    type WorkspaceContextResolution,
    type CapabilityRunEvent,
} from '@lixpi/constants'
import {
    type CanvasGenerationEvents,
} from '../../shared/generation/canvas-generation-events.ts'
import {
    type WorkspaceGenerationPlacements,
} from '../../shared/generation/workspace-generation-placements.ts'
import {
    setGeneratedMediaTracker,
    pruneGeneratedMediaTrackerAliases,
    type WorkspaceMediaTrackers,
    type PendingGeneratedMediaTracker,
} from '../../shared/generation/workspace-media-trackers.ts'
import {
    type WorkspaceGenerationSettlement,
} from '../../shared/generation/workspace-generation-settlement.ts'
import {
    type WorkspaceBranchMarkerHandoff,
} from '../../shared/generation/workspace-branch-marker-handoff.ts'
import {
    type WorkspaceMediaOperationRecovery,
} from '../../shared/generation/workspace-media-operation-recovery.ts'
import {
    type WorkspaceMediaAnalysis,
} from '../../shared/generation/workspace-media-analysis.ts'
import {
    applyMediaGenerationStreamFailureToOperationNodes,
    type MediaGenerationOperationRecoveryResult,
} from '../../shared/generation/operation-recovery.ts'
import { shouldAcceptGeneratedMediaEvent as shouldAcceptGeneratedMediaEventForState } from '../../shared/generation/event-workspace-guard.ts'
import {
    type WorkspaceLineageProjection,
} from '../../shared/branch-tree-layout/workspace-lineage-projection.ts'
import {
    type WorkspaceGeometry,
} from '../../shared/branch-tree-layout/workspace-geometry.ts'
import {
    type WorkspaceApiCanvasGeometry,
} from '../../shared/scene/workspace-api-canvas-geometry.ts'
import { getPendingGeneratedMediaNodeId } from '../../shared/branch-tree-layout/index.ts'
import {
    type WorkspaceGenerationVisuals,
} from './workspace-generation-visuals.ts'

type HandlerScope = {
    workspaceId: string
    sceneKey: string
}

export type WorkspaceGenerationHandlersPorts = {
    readScope: () => HandlerScope | null
    readCanvasState: () => CanvasState | null
    readThreads: () => Array<{ threadId: string }>
    placements: Pick<WorkspaceGenerationPlacements, 'placements' | 'cancelledRequests' | 'ensurePendingGeneratedMediaPlacementForApiRun' | 'getPendingGeneratedMediaPlacement' | 'setPendingGeneratedMediaPlacement' | 'getGeneratedMediaPlacementKey' | 'getGeneratedMediaRunKey' | 'getApiMediaRunLineageAssignment'>
    trackers: Pick<WorkspaceMediaTrackers, 'images' | 'videos' | 'findGeneratedMediaNodeForRun' | 'hasGeneratedImageFrame' | 'rememberPartialImageTrackerForNode' | 'rememberVideoGenerationTrackerForNode'>
    settlement: Pick<WorkspaceGenerationSettlement, 'applyMediaBranchLineagePlan' | 'settleMediaGenerationRun' | 'settleMediaGenerationRequest' | 'registerGeneratedMediaRun' | 'finishGeneratedMediaRun' | 'finishFailedGeneratedMediaRun'>
    handoff: Pick<WorkspaceBranchMarkerHandoff, 'removePendingBranchMarkerForRun' | 'clearPendingBranchMarkerStateForRun' | 'resolvePendingBranchMarkerWithLineagePlan'>
    lineage: Pick<WorkspaceLineageProjection, 'getExistingMediaNodeIds' | 'ensureBranchOriginForGeneratedMedia' | 'ensureBranchMarkerForGeneratedMedia' | 'getGeneratedMediaEdgeSourceNode' | 'getNextGeneratedMediaPosition' | 'addBranchLineageMarkerNodesIfMissing' | 'addBranchMarkerEdgeIfMissing' | 'createGeneratedImageEdge'>
    geometry: Pick<WorkspaceGeometry, 'getGeneratedMediaInsertionSize'>
    apiGeometry: Pick<WorkspaceApiCanvasGeometry, 'applyApiCanvasGeometry'>
    recovery: Pick<WorkspaceMediaOperationRecovery, 'revision'>
    analysis: Pick<WorkspaceMediaAnalysis, 'refreshCompleted'>
    visuals: Pick<WorkspaceGenerationVisuals, 'isFinalizing' | 'keepCompletion'>
    refreshAsset: (
        assetId: string,
        workspaceId: string,
    ) => Promise<void>
    reloadWorkspace: (workspaceId: string) => Promise<unknown>
    applyCapabilityRunEventToBranchMarkers: (
        threadId: string,
        event: CapabilityRunEvent,
    ) => void
    handleWorkspaceContextResolution: (
        threadId: string,
        resolution: WorkspaceContextResolution,
        generationRun?: MediaGenerationRunMeta,
    ) => void
    setGeneratingReferenceNodeIds: (
        key: string,
        nodeIds: Iterable<string>,
    ) => void
    clearGeneratingReferenceNodeIds: (key: string) => void
    clearGeneratingReferencesAfterPromptHandoff: (
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ) => void
    clearGeneratingReferencesOnFirstPixels: (
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ) => void
    settleDetachedCanvasRun: (threadId: string) => void
    scheduleDetachedCanvasRunTeardown: (threadId: string) => void
    applyMediaOperationRecoveryResult: (result: MediaGenerationOperationRecoveryResult) => void
    syncGeneratingMediaNodes: () => void
    syncCanvasMediaLayer: (state: CanvasState | null) => void
    syncCanvasNodeDomGeometry: (nodes: CanvasNode[]) => void
    setTransientImageSource: (
        nodeId: string,
        source: string | null,
    ) => void
    renderNow: () => void
    removeSelection: (nodeId: string) => void
    rebalanceGeneratedMediaTrees: (
        nodes: CanvasNode[],
        edges: WorkspaceEdge[],
    ) => CanvasNode[]
    commitTransientCanvasStatePreservingEditors: (state: CanvasState) => void
    appendCanvasNodeToDOM: (node: CanvasNode) => void
    appendBranchMarkerNodeToDOM: (
        nodes: CanvasNode[],
        marker: BranchForkCanvasNode | BranchLineCanvasNode | undefined,
    ) => void
    hasNodeElement: (nodeId: string) => boolean
    debugLoggingEnabled: boolean
    debugGeneratedMediaLifecycle: (
        event: string,
        details: Record<string, unknown>,
    ) => void
    log: (
        level: 'info' | 'error',
        ...details: unknown[]
    ) => void
}

const isBranchMarkerNode = (node: CanvasNode): node is BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

export class WorkspaceGenerationHandlers {
    private readonly releases: Array<() => void> = []
    private closed = false

    constructor(
        events: CanvasGenerationEvents,
        private readonly ports: WorkspaceGenerationHandlersPorts,
    ) {
        try {
            this.releases.push(
                events.subscribeImages({
                    onCapabilityRunEventToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        event,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId
                        this.ports.applyCapabilityRunEventToBranchMarkers(threadId, event)

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onAddToCanvas: async data => {
                        const scope = this.capture(data.workspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!data.assetId)
                            return

                        await this.ports.refreshAsset(data.assetId, workspaceId)

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onMediaBranchResolvedToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        resolution,
                        generationRun,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        const placement = this.ports.placements.ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        if (!placement)
                            return

                        const candidateById = new Map(
                            (placement.mediaBranchCandidateSnapshot?.candidates ?? []).map(candidate => [candidate.candidateId, candidate]),
                        )
                        const referenceNodeIds = this.ports.lineage.getExistingMediaNodeIds(
                            resolution.referenceCandidateIds.flatMap(candidateId => {
                                const nodeId = candidateById.get(candidateId)?.nodeId

                                return nodeId ? [nodeId] : []
                            }),
                        )

                        if (!this.isCurrent(scope))
                            return

                        const placementAnchorNodeId = placement.placementAnchorNodeId ?? referenceNodeIds[0]
                        this.ports.placements.setPendingGeneratedMediaPlacement(
                            threadId,
                            generationRun,
                            {
                                ...placement,
                                placementAnchorNodeId,
                                referenceNodeIds,
                                mediaBranchResolution: resolution,
                            },
                        )

                        if (!this.isCurrent(scope))
                            return

                        this.ports.setGeneratingReferenceNodeIds(
                            this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun),
                            referenceNodeIds,
                        )

                        if (!this.isCurrent(scope))
                            return

                        this.ports.log(
                            'info',
                            '[CANVAS] image branch VLM resolution',
                            {
                                threadId,
                                mode: resolution.mode,
                                branchId: resolution.branchId,
                                operationKind: resolution.operationKind,
                                referenceCandidateIds: resolution.referenceCandidateIds,
                                excludedCandidateIds: resolution.excludedCandidateIds,
                                confidence: resolution.confidence,
                                rationale: resolution.rationale,
                            },
                        )

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onMediaLineagePlannedToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        lineagePlan,
                        generationRun,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        this.ports.settlement.applyMediaBranchLineagePlan(
                            threadId,
                            lineagePlan,
                            generationRun,
                        )

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onWorkspaceContextResolvedToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        resolution,
                        generationRun,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        this.ports.handleWorkspaceContextResolution(
                            threadId,
                            resolution,
                            generationRun,
                        )

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    // The reasoning model finished without calling a media tool. A matrix
                    // child owns only its reasoning marker; request-wide settlement belongs
                    // to the matrix completion event after every sibling has finished.
                    onMediaGenerationSkippedToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        generationRequestId,
                        generationRun,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!this.shouldAcceptGeneratedMediaEvent(threadId))
                            return

                        if (generationRun?.requestKind === 'media-generation-matrix') {
                            this.ports.settlement.settleMediaGenerationRun(threadId, generationRun)

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        this.ports.settlement.settleMediaGenerationRequest(
                            threadId,
                            generationRequestId,
                            generationRun,
                        )

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onCanvasGeometryResolvedToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        canvasGeometry,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId
                        const generationRequestId = canvasGeometry.generationRequestId ?? ''
                        const isCancelledRequest = generationRequestId
                            && this.ports.placements.cancelledRequests.has(generationRequestId)

                        if (
                            isCancelledRequest
                            && (canvasGeometry.removedNodeIds?.length ?? 0) === 0
                        )
                            return

                        this.ports.apiGeometry.applyApiCanvasGeometry(canvasGeometry)

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onMediaGenerationRequestCompleteToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        generationRequestId,
                        generationRun,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId
                        const accepted = this.shouldAcceptGeneratedMediaEvent(threadId)
                        this.ports.log(
                            'info',
                            '[CANVAS] media generation request completion received',
                            {
                                threadId,
                                generationRequestId,
                                mediaRunId: generationRun?.mediaRunId,
                                accepted,
                                pendingPlacementKeys: [...this.ports.placements.placements.keys()]
                                    .filter(key => key === threadId || key.startsWith(`${threadId}:`)),
                                preflightNodeIds: this.currentCanvasState?.nodes.filter(
                                    (node: CanvasNode) =>
                                            isBranchMarkerNode(node)
                                            && node.conversationAssetId === threadId
                                            && node.pendingState?.phase === 'preflight',
                                ).map(node => node.nodeId) ?? [],
                            },
                        )

                        if (!this.isCurrent(scope))
                            return

                        if (!accepted)
                            return

                        this.ports.settlement.settleMediaGenerationRequest(
                            threadId,
                            generationRequestId,
                            generationRun,
                        )

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onMediaBranchResolutionErrorToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        generationRun,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        this.ports.handoff.removePendingBranchMarkerForRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        const placementKey = this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.placements.placements.delete(placementKey)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.clearGeneratingReferenceNodeIds(placementKey)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.settleDetachedCanvasRun(threadId)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.scheduleDetachedCanvasRunTeardown(threadId)

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onImageGenerationTraceToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        generationRun,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        this.ports.settlement.registerGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        if (this.ports.placements.getApiMediaRunLineageAssignment(generationRun)) {
                            const existingImageNode = this.ports.trackers.findGeneratedMediaNodeForRun(
                                'image',
                                threadId,
                                generationRun,
                            )

                            if (!this.isCurrent(scope))
                                return

                            if (existingImageNode?.type === 'image') {
                                this.ports.trackers.rememberPartialImageTrackerForNode(
                                    threadId,
                                    generationRun,
                                    existingImageNode,
                                )

                                if (!this.isCurrent(scope))
                                    return

                                this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)

                                if (!this.isCurrent(scope))
                                    return

                                this.ports.syncGeneratingMediaNodes()

                                if (!this.isCurrent(scope))
                                    return
                            } else {
                                this.ports.debugGeneratedMediaLifecycle(
                                    'image-generation-trace-waiting-for-api-geometry',
                                    {
                                        runKey: this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun),
                                        threadId,
                                        generationRequestId: generationRun?.generationRequestId ?? '',
                                        mediaRunId: generationRun?.mediaRunId ?? '',
                                    },
                                )

                                if (!this.isCurrent(scope))
                                    return
                            }

                            this.ports.clearGeneratingReferencesAfterPromptHandoff(threadId, generationRun)

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        this.ensureImageGenerationPlaceholderForRun({
                            threadId,
                            generationRun,
                        })

                        if (!this.isCurrent(scope))
                            return

                        this.ports.clearGeneratingReferencesAfterPromptHandoff(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onImageErrorToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        error,
                        generationRun,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        const existing = this.ports.trackers.images.get(runKey)

                        if (!this.isCurrent(scope))
                            return

                        const generationRequestId = this.getGenerationRequestId(generationRun)
                        const outputNodeId = generationRun?.lineageAssignment
                            ? getPendingGeneratedMediaNodeId(generationRun.lineageAssignment)
                            : existing?.nodeId
                        const failureResult = this.currentCanvasState
                            && generationRequestId
                            ? applyMediaGenerationStreamFailureToOperationNodes(
                                this.currentCanvasState,
                                {
                                    generationRequestId,
                                    ...(generationRun?.mediaRunId ? { mediaRunId: generationRun.mediaRunId } : {}),
                                    ...(outputNodeId ? { outputNodeId } : {}),
                                    message: error,
                                    requestRevision: this.ports.recovery.revision(generationRequestId),
                                    updatedAt: Date.now(),
                                },
                            )
                            : undefined

                        if (failureResult)
                            this.ports.applyMediaOperationRecoveryResult(failureResult)

                        if (!this.isCurrent(scope))
                            return

                        if (
                            !existing
                            || !this.currentCanvasState
                        ) {
                            if (!failureResult?.changed)
                                this.ports.handoff.removePendingBranchMarkerForRun(threadId, generationRun)

                            if (!this.isCurrent(scope))
                                return

                            this.ports.settlement.finishFailedGeneratedMediaRun(threadId, generationRun)

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        this.ports.trackers.images.delete(runKey)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.setTransientImageSource(existing.nodeId, null)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.removeSelection(existing.nodeId)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.syncGeneratingMediaNodes()

                        if (!this.isCurrent(scope))
                            return

                        this.ports.settlement.finishFailedGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onImagePartialToCanvas: data => {
                        const scope = this.capture(data.workspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId
                        const {
                            threadId,
                            imageUrl,
                            assetId,
                            generationRun,
                            canvasGeometry,
                        } = data

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.settlement.registerGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)

                        if (!this.isCurrent(scope))
                            return

                        if (canvasGeometry) {
                            if (this.ports.debugLoggingEnabled) {
                                this.ports.log(
                                    'info',
                                    '[CANVAS][api-geometry]',
                                    'image-partial-apply',
                                    {
                                        runKey,
                                        layoutRevision: canvasGeometry.layoutRevision,
                                        partialIndex: data.partialIndex,
                                        generationRequestId: generationRun?.generationRequestId,
                                        mediaRunId: generationRun?.mediaRunId,
                                        mediaModelId: generationRun?.mediaModelId,
                                        geometryNodeIds: canvasGeometry.nodes.map(node => node.nodeId),
                                        nodeSnapshotIds: canvasGeometry.nodeSnapshots?.map(node => node.nodeId) ?? [],
                                        edgeSnapshotIds: canvasGeometry.edgeSnapshots?.map(edge => edge.edgeId) ?? [],
                                    },
                                )
                            }

                            if (!this.isCurrent(scope))
                                return

                            const previousTracker = this.ports.trackers.images.get(runKey)

                            if (!this.isCurrent(scope))
                                return

                            this.ports.apiGeometry.applyApiCanvasGeometry(canvasGeometry)

                            if (!this.isCurrent(scope))
                                return

                            const expectedNodeId = lineageAssignment ? getPendingGeneratedMediaNodeId(lineageAssignment) : ''
                            const imageNode = (expectedNodeId ? this.getCurrentCanvasMediaNode(expectedNodeId) : undefined)
                                ?? this.ports.trackers.findGeneratedMediaNodeForRun(
                                    'image',
                                    threadId,
                                    generationRun,
                                )

                            if (imageNode?.type !== 'image') {
                                this.ports.log(
                                    'error',
                                    '[CANVAS][api-geometry] image partial geometry did not materialize image node',
                                    {
                                        runKey,
                                        threadId,
                                        expectedNodeId,
                                        generationRequestId: generationRun?.generationRequestId,
                                        mediaRunId: generationRun?.mediaRunId,
                                    },
                                )

                                if (!this.isCurrent(scope))
                                    return

                                this.ports.syncGeneratingMediaNodes()

                                if (!this.isCurrent(scope))
                                    return

                                return
                            }

                            const hasFrame = this.ports.trackers.hasGeneratedImageFrame(imageNode) || Boolean(imageUrl)

                            if (!this.isCurrent(scope))
                                return

                            const tracker = this.ports.trackers.rememberPartialImageTrackerForNode(
                                threadId,
                                generationRun,
                                imageNode,
                            )

                            if (!this.isCurrent(scope))
                                return

                            setGeneratedMediaTracker(
                                this.ports.trackers.images,
                                runKey,
                                {
                                    ...tracker,
                                    assetId: assetId || tracker.assetId,
                                    hasReceivedFrame: hasFrame,
                                },
                            )
                            const receivedFirstFrame = !previousTracker?.hasReceivedFrame && hasFrame
                            this.ports.debugGeneratedMediaLifecycle(
                                'image-partial-api-geometry-update',
                                {
                                    runKey,
                                    threadId,
                                    nodeId: imageNode.nodeId,
                                    assetId: assetId || imageNode.assetId,
                                    receivedFirstFrame,
                                    hasReceivedFrame: hasFrame,
                                    imageUrlPresent: Boolean(imageUrl),
                                    layoutRevision: canvasGeometry.layoutRevision,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)

                            if (!this.isCurrent(scope))
                                return

                            if (hasFrame)
                                this.ports.clearGeneratingReferencesOnFirstPixels(threadId, generationRun)

                            if (!this.isCurrent(scope))
                                return

                            // The API snapshot may replace the image DOM shell before this
                            // partial flips the run from its pre-frame circle to media bounds.
                            // Publish the new outline target before asking PIXI to resolve the
                            // transient source, then project every media-owned surface from the
                            // final tracker and authoritative node geometry in one pass.
                            this.ports.syncGeneratingMediaNodes()

                            if (!this.isCurrent(scope))
                                return

                            if (imageUrl) {
                                this.ports.setTransientImageSource(imageNode.nodeId, imageUrl)

                                if (!this.isCurrent(scope))
                                    return
                            }

                            this.ports.syncCanvasMediaLayer(this.currentCanvasState)

                            if (!this.isCurrent(scope))
                                return

                            this.ports.syncCanvasNodeDomGeometry([imageNode])

                            if (!this.isCurrent(scope))
                                return

                            this.ports.renderNow()

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        if (
                            lineageAssignment
                            && (imageUrl || assetId)
                        ) {
                            const existingTracker = this.ports.trackers.images.get(runKey)

                            if (!this.isCurrent(scope))
                                return

                            const expectedNodeId = getPendingGeneratedMediaNodeId(lineageAssignment)
                            const existingImageNode = (existingTracker ? this.getCurrentCanvasMediaNode(existingTracker.nodeId) : undefined)
                                ?? this.getCurrentCanvasMediaNode(expectedNodeId)
                                ?? this.ports.trackers.findGeneratedMediaNodeForRun(
                                    'image',
                                    threadId,
                                    generationRun,
                                )

                            if (
                                existingImageNode?.type === 'image'
                                && this.ports.trackers.hasGeneratedImageFrame(existingImageNode)
                                && (!assetId || existingImageNode.assetId === assetId)
                            ) {
                                this.ports.debugGeneratedMediaLifecycle(
                                    'image-partial-duplicate-without-geometry',
                                    {
                                        runKey,
                                        threadId,
                                        nodeId: existingImageNode.nodeId,
                                        assetId: existingImageNode.assetId,
                                        partialIndex: data.partialIndex,
                                        generationRequestId: generationRun?.generationRequestId ?? '',
                                        mediaRunId: generationRun?.mediaRunId ?? '',
                                    },
                                )

                                if (!this.isCurrent(scope))
                                    return

                                this.ports.syncGeneratingMediaNodes()

                                if (!this.isCurrent(scope))
                                    return

                                return
                            }

                            this.ports.log(
                                'error',
                                '[CANVAS][api-geometry] missing image partial geometry; refusing local canvas topology mutation',
                                {
                                    runKey,
                                    threadId,
                                    partialIndex: data.partialIndex,
                                    partialAssetId: assetId,
                                    generationRequestId: generationRun?.generationRequestId,
                                    mediaRunId: generationRun?.mediaRunId,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            this.ports.syncGeneratingMediaNodes()

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        if (lineageAssignment) {
                            const existing = this.ports.trackers.images.get(runKey)

                            if (!this.isCurrent(scope))
                                return

                            this.ports.debugGeneratedMediaLifecycle(
                                'empty-image-partial-api-heartbeat',
                                {
                                    runKey,
                                    threadId,
                                    nodeId: existing?.nodeId ?? '',
                                    hasReceivedFrame: existing?.hasReceivedFrame ?? false,
                                    generationRequestId: generationRun?.generationRequestId ?? '',
                                    mediaRunId: generationRun?.mediaRunId ?? '',
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            this.ports.syncGeneratingMediaNodes()

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        let existing = this.ports.trackers.images.get(runKey)

                        if (!this.isCurrent(scope))
                            return

                        if (
                            existing
                            && !this.getCurrentCanvasMediaNode(existing.nodeId)
                        ) {
                            this.ports.debugGeneratedMediaLifecycle(
                                'drop-stale-image-tracker-before-partial',
                                {
                                    runKey,
                                    threadId,
                                    nodeId: existing.nodeId,
                                    assetId: existing.assetId,
                                    incomingHasImageUrl: Boolean(imageUrl),
                                    incomingAssetId: assetId,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            this.ports.trackers.images.delete(runKey)

                            if (!this.isCurrent(scope))
                                return

                            existing = undefined
                        }

                        if (!existing) {
                            existing = this.ensureImageGenerationPlaceholderForRun({
                                threadId,
                                generationRun,
                                imageUrl,
                                assetId,
                                imageWorkspaceId: workspaceId,
                                failOnMissingLineage: true,
                            })

                            if (!existing)
                                return
                        }

                        if (existing) {
                            if (
                                !imageUrl
                                && !assetId
                            ) {
                                this.ports.debugGeneratedMediaLifecycle(
                                    'empty-image-partial-refresh-outline',
                                    {
                                        runKey,
                                        threadId,
                                        nodeId: existing.nodeId,
                                        hasReceivedFrame: existing.hasReceivedFrame,
                                    },
                                )

                                if (!this.isCurrent(scope))
                                    return

                                this.ports.syncGeneratingMediaNodes()

                                if (!this.isCurrent(scope))
                                    return

                                return
                            }

                            const receivedFirstFrame = !existing.hasReceivedFrame && Boolean(imageUrl)
                            const updatedTracker = {
                                ...existing,
                                assetId: assetId || existing.assetId,
                                hasReceivedFrame: existing.hasReceivedFrame || Boolean(imageUrl),
                            }
                            setGeneratedMediaTracker(
                                this.ports.trackers.images,
                                runKey,
                                updatedTracker,
                            )
                            this.ports.debugGeneratedMediaLifecycle(
                                'image-partial-update',
                                {
                                    runKey,
                                    threadId,
                                    nodeId: existing.nodeId,
                                    assetId: updatedTracker.assetId,
                                    receivedFirstFrame,
                                    hasReceivedFrame: updatedTracker.hasReceivedFrame,
                                    imageUrlPresent: Boolean(imageUrl),
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            if (
                                imageUrl
                                && this.currentCanvasState
                            ) {
                                this.ports.setTransientImageSource(existing.nodeId, imageUrl)

                                if (!this.isCurrent(scope))
                                    return

                                this.ports.clearGeneratingReferencesOnFirstPixels(threadId, generationRun)

                                if (!this.isCurrent(scope))
                                    return

                                const updatedNodes = this.currentCanvasState.nodes.map((node: CanvasNode) => {
                                    if (node.nodeId !== existing.nodeId)
                                        return node

                                    const imageNode = node as ImageCanvasNode
                                    const position = imageNode.position
                                    const generatedBy = imageNode.generatedBy
                                        && generationRun?.mediaModelId
                                        ? {
                                            ...imageNode.generatedBy,
                                            mediaModelId: generationRun.mediaModelId as any,
                                        }
                                        : imageNode.generatedBy

                                    return {
                                        ...imageNode,
                                        assetId: assetId || imageNode.assetId,
                                        position,
                                        generatedBy,
                                    } satisfies ImageCanvasNode
                                })
    
                                const resolvedNodes = receivedFirstFrame
                                    ? this.ports.rebalanceGeneratedMediaTrees(updatedNodes, this.currentCanvasState.edges)
                                    : updatedNodes
    
                                this.ports.commitTransientCanvasStatePreservingEditors({
                                    ...this.currentCanvasState,
                                    nodes: resolvedNodes,
                                })

                                if (!this.isCurrent(scope))
                                    return
                            }

                            return
                        }
                    },
    
                    onImageCompleteToCanvas: data => {
                        const scope = this.capture(data.workspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId
                        const {
                            threadId,
                            assetId,
                            generationRun,
                        } = data

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.settlement.registerGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        const pendingNodeId = this.ports.trackers.images.get(runKey)?.nodeId

                        if (!this.isCurrent(scope))
                            return

                        const completedNodeId = generationRun?.lineageAssignment
                            ? getPendingGeneratedMediaNodeId(generationRun.lineageAssignment)
                            : ''
                        const completedAssetId = assetId
                            || generationRun?.lineageAssignment?.assetId
                            || ''
                        this.prepareGeneratedImageCompletionTextureHandoff(
                            threadId,
                            generationRun,
                            runKey,
                            completedNodeId,
                            completedAssetId,
                        )

                        if (!this.isCurrent(scope))
                            return

                        if (!data.canvasGeometry) {
                            const existingCompletedImageNode = completedNodeId ? this.getCurrentCanvasMediaNode(completedNodeId) : undefined

                            if (existingCompletedImageNode?.type === 'image') {
                                if (this.ports.debugLoggingEnabled) {
                                    this.ports.log(
                                        'info',
                                        '[CANVAS][api-geometry]',
                                        'image-complete-existing-final-without-geometry',
                                        {
                                            runKey,
                                            threadId,
                                            completedNodeId,
                                            generationRequestId: generationRun?.generationRequestId,
                                            mediaRunId: generationRun?.mediaRunId,
                                        },
                                    )
                                }

                                if (!this.isCurrent(scope))
                                    return

                                const completionTracker = this.ports.trackers.images.get(runKey)
                                    ?? this.ports.trackers.rememberPartialImageTrackerForNode(
                                        threadId,
                                        generationRun,
                                        existingCompletedImageNode,
                                    )

                                if (!this.isCurrent(scope))
                                    return

                                if (!this.ports.visuals.isFinalizing(existingCompletedImageNode.nodeId)) {
                                    this.ports.visuals.keepCompletion(
                                        runKey,
                                        completionTracker,
                                        existingCompletedImageNode,
                                    )

                                    if (!this.isCurrent(scope))
                                        return
                                }

                                if (pendingNodeId)
                                    this.ports.setTransientImageSource(pendingNodeId, null)

                                if (!this.isCurrent(scope))
                                    return

                                if (
                                    completedNodeId
                                    && completedNodeId !== pendingNodeId
                                ) {
                                    this.ports.setTransientImageSource(completedNodeId, null)

                                    if (!this.isCurrent(scope))
                                        return
                                }

                                this.ports.appendCanvasNodeToDOM(existingCompletedImageNode)

                                if (!this.isCurrent(scope))
                                    return

                                this.ports.settlement.finishGeneratedMediaRun(threadId, generationRun)

                                if (!this.isCurrent(scope))
                                    return

                                void this.ports.analysis.refreshCompleted(existingCompletedImageNode)

                                if (!this.isCurrent(scope))
                                    return

                                return
                            }

                            this.ports.log(
                                'error',
                                '[CANVAS][api-geometry] missing image completion geometry; refusing local canvas topology mutation',
                                {
                                    runKey,
                                    threadId,
                                    completionAssetId: assetId,
                                    generationRequestId: generationRun?.generationRequestId,
                                    mediaRunId: generationRun?.mediaRunId,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            void this.ports.reloadWorkspace(workspaceId)

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        if (this.ports.debugLoggingEnabled) {
                            this.ports.log(
                                'info',
                                '[CANVAS][api-geometry]',
                                'image-complete-apply',
                                {
                                    runKey,
                                    layoutRevision: data.canvasGeometry.layoutRevision,
                                    removedNodeIds: data.canvasGeometry.removedNodeIds ?? [],
                                    edgeSnapshotIds: data.canvasGeometry.edgeSnapshots?.map(edge => edge.edgeId) ?? [],
                                },
                            )
                        }

                        if (!this.isCurrent(scope))
                            return

                        this.ports.apiGeometry.applyApiCanvasGeometry(data.canvasGeometry)

                        if (!this.isCurrent(scope))
                            return

                        const completedImageNode = completedNodeId ? this.getCurrentCanvasMediaNode(completedNodeId) : undefined

                        if (completedImageNode?.type !== 'image') {
                            this.ports.log(
                                'error',
                                '[CANVAS][api-geometry] image completion geometry did not materialize final node',
                                {
                                    runKey,
                                    threadId,
                                    completedNodeId,
                                    generationRequestId: generationRun?.generationRequestId,
                                    mediaRunId: generationRun?.mediaRunId,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        const completionTracker = this.ports.trackers.images.get(runKey)
                            ?? this.ports.trackers.rememberPartialImageTrackerForNode(
                                threadId,
                                generationRun,
                                completedImageNode,
                            )

                        if (!this.isCurrent(scope))
                            return

                        if (!this.ports.visuals.isFinalizing(completedImageNode.nodeId)) {
                            this.ports.visuals.keepCompletion(
                                runKey,
                                completionTracker,
                                completedImageNode,
                            )

                            if (!this.isCurrent(scope))
                                return
                        }

                        if (pendingNodeId)
                            this.ports.setTransientImageSource(pendingNodeId, null)

                        if (!this.isCurrent(scope))
                            return

                        if (
                            completedNodeId
                            && completedNodeId !== pendingNodeId
                        ) {
                            this.ports.setTransientImageSource(completedNodeId, null)

                            if (!this.isCurrent(scope))
                                return
                        }

                        this.ports.appendCanvasNodeToDOM(completedImageNode)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.settlement.finishGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        void this.ports.analysis.refreshCompleted(completedImageNode)

                        if (!this.isCurrent(scope))
                            return
                    },
                }),
            )
            this.releases.push(
                events.subscribeVideos({
                    onVideoPendingToCanvas: data => {
                        const scope = this.capture(data.workspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId
                        const {
                            threadId,
                            generationRun,
                            canvasGeometry,
                        } = data

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.settlement.registerGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)

                        if (!this.isCurrent(scope))
                            return

                        if (!lineageAssignment) {
                            this.ports.log(
                                'error',
                                '[CANVAS] Missing API media lineage assignment for video pending',
                                {
                                    threadId,
                                    generationRun,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            this.ports.handoff.removePendingBranchMarkerForRun(threadId, generationRun)

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        if (!canvasGeometry) {
                            this.ports.log(
                                'error',
                                '[CANVAS][api-geometry] missing video pending geometry; refusing local canvas topology mutation',
                                {
                                    runKey,
                                    threadId,
                                    generationRequestId: generationRun?.generationRequestId,
                                    mediaRunId: generationRun?.mediaRunId,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        this.ports.apiGeometry.applyApiCanvasGeometry(canvasGeometry)

                        if (!this.isCurrent(scope))
                            return

                        const nodeId = getPendingGeneratedMediaNodeId(lineageAssignment)
                        const videoNode = this.getCurrentCanvasMediaNode(nodeId)

                        if (videoNode?.type !== 'video') {
                            this.ports.log(
                                'error',
                                '[CANVAS][api-geometry] video pending geometry did not materialize video node',
                                {
                                    runKey,
                                    threadId,
                                    nodeId,
                                    generationRequestId: generationRun?.generationRequestId,
                                    mediaRunId: generationRun?.mediaRunId,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        this.ports.trackers.rememberVideoGenerationTrackerForNode(
                            threadId,
                            generationRun,
                            videoNode,
                        )

                        if (!this.isCurrent(scope))
                            return

                        this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.appendCanvasNodeToDOM(videoNode)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.syncGeneratingMediaNodes()

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onVideoGeneratingToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!this.shouldAcceptGeneratedMediaEvent(threadId))
                            return
    
                        // VEO keepalive heartbeat. The PIXI traveling outline is already
                        // running on the placeholder via canvasMediaLayer's generating-image
                        // tracker, so no canvas state mutation is required here. Phase 6
                        // may add a "still generating" pulse animation.
                    },
    
                    onVideoGenerationTraceToCanvas: ({
                        workspaceId: eventWorkspaceId,
                        threadId,
                        generationRun,
                    }) => {
                        const scope = this.capture(eventWorkspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        this.ports.settlement.registerGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.clearGeneratingReferencesAfterPromptHandoff(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onVideoCompleteToCanvas: data => {
                        const scope = this.capture(data.workspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId
                        const {
                            threadId,
                            assetId,
                            generationRun,
                        } = data

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.settlement.registerGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        const pendingNodeId = this.ports.trackers.videos.get(runKey)?.nodeId

                        if (!this.isCurrent(scope))
                            return

                        const completedNodeId = generationRun?.lineageAssignment
                            ? getPendingGeneratedMediaNodeId(generationRun.lineageAssignment)
                            : ''

                        if (!data.canvasGeometry) {
                            this.ports.log(
                                'error',
                                '[CANVAS][api-geometry] missing video completion geometry; refusing local canvas topology mutation',
                                {
                                    runKey,
                                    threadId,
                                    completionAssetId: assetId,
                                    generationRequestId: generationRun?.generationRequestId,
                                    mediaRunId: generationRun?.mediaRunId,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            void this.ports.reloadWorkspace(workspaceId)

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        if (this.ports.debugLoggingEnabled) {
                            this.ports.log(
                                'info',
                                '[CANVAS][api-geometry]',
                                'video-complete-apply',
                                {
                                    runKey,
                                    layoutRevision: data.canvasGeometry.layoutRevision,
                                    removedNodeIds: data.canvasGeometry.removedNodeIds ?? [],
                                    edgeSnapshotIds: data.canvasGeometry.edgeSnapshots?.map(edge => edge.edgeId) ?? [],
                                },
                            )
                        }

                        if (!this.isCurrent(scope))
                            return

                        this.ports.apiGeometry.applyApiCanvasGeometry(data.canvasGeometry)

                        if (!this.isCurrent(scope))
                            return

                        const completedVideoNode = this.getCurrentCanvasMediaNode(completedNodeId)

                        if (completedVideoNode?.type !== 'video') {
                            this.ports.log(
                                'error',
                                '[CANVAS][api-geometry] video completion geometry did not materialize final node',
                                {
                                    runKey,
                                    threadId,
                                    completedNodeId,
                                    generationRequestId: generationRun?.generationRequestId,
                                    mediaRunId: generationRun?.mediaRunId,
                                },
                            )

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        this.ports.trackers.videos.delete(runKey)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.syncGeneratingMediaNodes()

                        if (!this.isCurrent(scope))
                            return

                        this.ports.appendCanvasNodeToDOM(completedVideoNode)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.settlement.finishGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        void this.ports.analysis.refreshCompleted(completedVideoNode)

                        if (!this.isCurrent(scope))
                            return
                    },
    
                    onVideoErrorToCanvas: data => {
                        const scope = this.capture(data.workspaceId)

                        if (!scope)
                            return

                        const workspaceId = scope.workspaceId
                        const {
                            threadId,
                            generationRun,
                        } = data

                        if (!this.shouldAcceptGeneratedMediaEvent(
                            threadId,
                            undefined,
                            generationRun,
                        ))
                            return

                        const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return

                        const existing = this.ports.trackers.videos.get(runKey)

                        if (!this.isCurrent(scope))
                            return

                        if (
                            !existing
                            || !this.currentCanvasState
                        ) {
                            this.ports.handoff.removePendingBranchMarkerForRun(threadId, generationRun)

                            if (!this.isCurrent(scope))
                                return

                            this.ports.settlement.finishFailedGeneratedMediaRun(threadId, generationRun)

                            if (!this.isCurrent(scope))
                                return

                            return
                        }

                        this.ports.trackers.videos.delete(runKey)

                        if (!this.isCurrent(scope))
                            return

                        this.ports.syncGeneratingMediaNodes()

                        if (!this.isCurrent(scope))
                            return

                        this.ports.settlement.finishFailedGeneratedMediaRun(threadId, generationRun)

                        if (!this.isCurrent(scope))
                            return
                    },
                }),
            )
        } catch (error) {
            this.destroy()

            throw error
        }
    }

    destroy(): void {
        if (this.closed)
            return

        this.closed = true
        const errors: unknown[] = []

        for (const release of this.releases.splice(0).reverse()) {
            try {
                release()
            } catch (error) {
                errors.push(error)
            }
        }

        if (errors.length)
            throw new AggregateError(errors, 'Canvas generation handler cleanup failed')
    }

    private capture(eventWorkspaceId?: string): HandlerScope | null {
        const scope = this.closed ? null : this.ports.readScope()

        if (
            !scope
            || (eventWorkspaceId && eventWorkspaceId !== scope.workspaceId)
        )
            return null

        return { ...scope }
    }

    private isCurrent(scope: HandlerScope): boolean {
        const current = this.closed ? null : this.ports.readScope()

        return current?.workspaceId === scope.workspaceId && current.sceneKey === scope.sceneKey
    }

    private get currentCanvasState(): CanvasState | null {
        return this.closed ? null : this.ports.readCanvasState()
    }

    private getCurrentCanvasMediaNode(nodeId: string): ImageCanvasNode | VideoCanvasNode | undefined {
        const node = this.currentCanvasState?.nodes.find(candidate => candidate.nodeId === nodeId)

        return node?.type === 'image'
            || node?.type === 'video'
            ? node
            : undefined
    }

    getPendingGeneratedImageLineage(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): Partial<NonNullable<ImageCanvasNode['generatedBy']>> {
        const placement = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)

        if (!lineageAssignment)
            return {}

        const resolution = placement?.mediaBranchResolution
        const candidateById = new Map(
            (placement?.mediaBranchCandidateSnapshot?.candidates ?? []).map(candidate => [candidate.candidateId, candidate]),
        )
        const targetImageNodeId = resolution?.targetCandidateId
            ? candidateById.get(resolution.targetCandidateId)?.nodeId
            : undefined
        const styleReferenceNodeIds = (resolution?.styleReferenceCandidateIds ?? []).flatMap(candidateId => {
            const nodeId = candidateById.get(candidateId)?.nodeId

            return nodeId ? [nodeId] : []
        })
        const excludedNodeIds = (resolution?.excludedCandidateIds ?? []).flatMap(candidateId => {
            const nodeId = candidateById.get(candidateId)?.nodeId

            return nodeId ? [nodeId] : []
        })

        return {
            generationRequestId: lineageAssignment.generationRequestId,
            reasoningRunId: lineageAssignment.reasoningRunId,
            mediaRunId: lineageAssignment.mediaRunId,
            reasoningModelId: lineageAssignment.reasoningModelId,
            mediaModelId: lineageAssignment.mediaModelId,
            mediaType: lineageAssignment.mediaType,
            variantIndex: generationRun?.variantIndex,
            branchOriginNodeId: lineageAssignment.branchOriginNodeId,
            branchForkNodeId: lineageAssignment.branchForkNodeId,
            branchLineNodeId: lineageAssignment.branchLineNodeId,
            branchId: lineageAssignment.branchId,
            parentMediaNodeId: lineageAssignment.parentMediaNodeId,
            parentImageNodeId: lineageAssignment.parentImageNodeId,
            sourceContextNodeIds: lineageAssignment.sourceContextNodeIds,
            referenceImageNodeIds: lineageAssignment.referenceNodeIds,
            operationKind: lineageAssignment.operationKind,
            promptText: lineageAssignment.promptText,
            promptFingerprint: lineageAssignment.promptFingerprint,
            visualEntitySummary: resolution?.visualEntitySummary,
            visualStyleSummary: resolution?.visualStyleSummary,
            entitySummary: resolution?.visualEntitySummary,
            entityTags: resolution?.entityTags ?? [],
            styleTags: resolution?.styleTags ?? [],
            targetImageNodeId,
            styleReferenceNodeIds,
            excludedNodeIds,
            resolverKind: resolution?.resolverKind,
            resolverModelProvider: resolution?.resolverModelProvider,
            resolverModelId: resolution?.resolverModelId,
            resolverRationale: resolution?.rationale,
            resolverConfidence: resolution?.confidence,
            resolverVersion: resolution?.resolverVersion ?? placement?.mediaBranchCandidateSnapshot?.resolverVersion,
            createdAt: lineageAssignment.createdAt,
        }
    }

    ensureImageGenerationPlaceholderForRun({
        threadId,
        generationRun,
        imageUrl = '',
        assetId = '',
        imageWorkspaceId = '',
        failOnMissingLineage = false,
    }: {
        threadId: string
        generationRun?: MediaGenerationRunMeta
        imageUrl?: string
        assetId?: string
        imageWorkspaceId?: string
        failOnMissingLineage?: boolean
    }): PendingGeneratedMediaTracker | undefined {
        const scope = this.capture()

        if (!scope)
            return

        if (!this.currentCanvasState)
            return undefined

        const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)

        if (!this.isCurrent(scope))
            return

        const existingTracker = this.ports.trackers.images.get(runKey)

        if (!this.isCurrent(scope))
            return

        if (existingTracker) {
            this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)

            if (!this.isCurrent(scope))
                return

            return existingTracker
        }

        const existingImageNode = this.ports.trackers.findGeneratedMediaNodeForRun(
            'image',
            threadId,
            generationRun,
        )

        if (!this.isCurrent(scope))
            return

        if (existingImageNode?.type === 'image') {
            if (
                this.ports.trackers.hasGeneratedImageFrame(existingImageNode)
                && !imageUrl
                && !assetId
            ) {
                this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)

                if (!this.isCurrent(scope))
                    return

                return undefined
            }

            const tracker = this.ports.trackers.rememberPartialImageTrackerForNode(
                threadId,
                generationRun,
                existingImageNode,
            )

            if (!this.isCurrent(scope))
                return

            this.ports.debugGeneratedMediaLifecycle(
                'reattach-image-placeholder',
                {
                    runKey,
                    threadId,
                    nodeId: tracker.nodeId,
                    assetId: tracker.assetId,
                    sourceNodeId: tracker.sourceNodeId ?? '',
                    hasReceivedFrame: tracker.hasReceivedFrame,
                },
            )

            if (!this.isCurrent(scope))
                return

            this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)

            if (!this.isCurrent(scope))
                return

            if (!this.ports.hasNodeElement(existingImageNode.nodeId)) {
                this.ports.appendCanvasNodeToDOM(existingImageNode)

                if (!this.isCurrent(scope))
                    return
            } else {
                this.ports.syncCanvasMediaLayer(this.currentCanvasState)

                if (!this.isCurrent(scope))
                    return
            }

            return tracker
        }

        const imageWidth = this.ports.geometry.getGeneratedMediaInsertionSize()

        if (!this.isCurrent(scope))
            return

        const imageHeight = imageWidth
        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)

        if (!this.isCurrent(scope))
            return

        if (!lineageAssignment) {
            if (failOnMissingLineage) {
                this.ports.log(
                    'error',
                    '[CANVAS] Missing API media lineage assignment for image placeholder',
                    {
                        threadId,
                        generationRun,
                    },
                )

                if (!this.isCurrent(scope))
                    return

                this.ports.handoff.removePendingBranchMarkerForRun(threadId, generationRun)

                if (!this.isCurrent(scope))
                    return
            } else {
                this.ports.debugGeneratedMediaLifecycle(
                    'skip-image-placeholder-missing-lineage',
                    {
                        runKey,
                        threadId,
                        generationRequestId: generationRun?.generationRequestId ?? '',
                        mediaRunId: generationRun?.mediaRunId ?? '',
                    },
                )

                if (!this.isCurrent(scope))
                    return
            }

            return undefined
        }

        this.ports.handoff.resolvePendingBranchMarkerWithLineagePlan(threadId, generationRun)

        if (!this.isCurrent(scope))
            return

        const branchOriginNode = this.ports.lineage.ensureBranchOriginForGeneratedMedia(
            threadId,
            generationRun,
            imageHeight,
        )

        if (!this.isCurrent(scope))
            return

        const {
            branchForkNode,
            branchLineNode,
            markerNode,
        } = this.ports.lineage.ensureBranchMarkerForGeneratedMedia(
            threadId,
            generationRun,
            branchOriginNode,
        )
        const edgeSourceNode = this.ports.lineage.getGeneratedMediaEdgeSourceNode(generationRun, [branchOriginNode, branchForkNode, branchLineNode])

        if (!this.isCurrent(scope))
            return

        if (!edgeSourceNode) {
            if (failOnMissingLineage) {
                this.ports.log(
                    'error',
                    '[CANVAS] Missing API media lineage parent for image placeholder',
                    {
                        threadId,
                        lineageParentNodeId: lineageAssignment.lineageParentNodeId,
                        generationRun,
                    },
                )

                if (!this.isCurrent(scope))
                    return

                this.ports.handoff.removePendingBranchMarkerForRun(threadId, generationRun)

                if (!this.isCurrent(scope))
                    return
            } else {
                this.ports.debugGeneratedMediaLifecycle(
                    'skip-image-placeholder-missing-parent',
                    {
                        runKey,
                        threadId,
                        lineageParentNodeId: lineageAssignment.lineageParentNodeId,
                        generationRequestId: generationRun?.generationRequestId ?? '',
                        mediaRunId: generationRun?.mediaRunId ?? '',
                    },
                )

                if (!this.isCurrent(scope))
                    return
            }

            return undefined
        }

        const promptText = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''

        if (!this.isCurrent(scope))
            return

        this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)

        if (!this.isCurrent(scope))
            return

        const placementKey = this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun)

        if (!this.isCurrent(scope))
            return

        const nodeId = getPendingGeneratedMediaNodeId(lineageAssignment)
        this.ports.trackers.images.set(
            runKey,
            {
                nodeId,
                assetId: assetId || lineageAssignment.assetId,
                placementKey,
                hasReceivedFrame: Boolean(imageUrl),
                sourceNodeId: edgeSourceNode.nodeId,
            },
        )

        if (!this.isCurrent(scope))
            return

        pruneGeneratedMediaTrackerAliases(
            this.ports.trackers.images,
            runKey,
            nodeId,
        )
        const tracker = this.ports.trackers.images.get(runKey)

        if (!this.isCurrent(scope))
            return

        if (!tracker)
            return undefined

        this.ports.debugGeneratedMediaLifecycle(
            'create-image-placeholder',
            {
                runKey,
                threadId,
                nodeId,
                assetId: tracker.assetId,
                sourceNodeId: edgeSourceNode.nodeId,
                hasInitialFrame: Boolean(imageUrl),
                generationRequestId: generationRun?.generationRequestId ?? '',
                mediaRunId: generationRun?.mediaRunId ?? '',
            },
        )

        if (!this.isCurrent(scope))
            return

        // The node sits at its final position from insertion; the pre-frame
        // circle is a render-only treatment inside the full placeholder rect, so
        // no position swap happens when the first frame arrives.
        const position = this.ports.lineage.getNextGeneratedMediaPosition(edgeSourceNode, imageHeight)

        if (!this.isCurrent(scope))
            return

        const imageNode: ImageCanvasNode = {
            nodeId,
            type: 'image',
            assetId: assetId || lineageAssignment.assetId,
            position,
            dimensions: {
                width: imageWidth,
                height: imageHeight,
            },
            generatedBy: {
                conversationAssetId: threadId,
                responseId: '',
                aiModel: (generationRun?.reasoningModelId ?? '') as any,
                ...(generationRun?.mediaModelId ? { mediaModelId: generationRun.mediaModelId } : {}),
                revisedPrompt: promptText,
                responseMessageId: '',
                ...this.getPendingGeneratedImageLineage(threadId, generationRun),
            },
        }

        const existingNodes = this.ports.lineage.addBranchLineageMarkerNodesIfMissing(
            this.currentCanvasState.nodes,
            branchOriginNode,
            branchForkNode,
            branchLineNode,
        )

        if (!this.isCurrent(scope))
            return

        const existingEdges = this.ports.lineage.addBranchMarkerEdgeIfMissing(this.currentCanvasState.edges, markerNode)

        if (!this.isCurrent(scope))
            return

        const newEdges = [
            ...existingEdges,
            this.ports.lineage.createGeneratedImageEdge(edgeSourceNode, nodeId),
        ]

        if (!this.isCurrent(scope))
            return

        const nodesWithImage: CanvasNode[] = [...existingNodes, imageNode]
        const rebalancedNodes = this.ports.rebalanceGeneratedMediaTrees(nodesWithImage, newEdges)

        if (!this.isCurrent(scope))
            return

        const newCanvasState: CanvasState = {
            ...this.currentCanvasState,
            nodes: rebalancedNodes,
            edges: newEdges,
        }
        this.ports.commitTransientCanvasStatePreservingEditors(newCanvasState)

        if (!this.isCurrent(scope))
            return

        if (branchOriginNode) {
            const placedBranchOriginNode = (rebalancedNodes.find((n: CanvasNode) => n.nodeId === branchOriginNode.nodeId) as BranchOriginCanvasNode | undefined)
                ?? branchOriginNode
            this.ports.appendCanvasNodeToDOM(placedBranchOriginNode)

            if (!this.isCurrent(scope))
                return
        }

        this.ports.appendBranchMarkerNodeToDOM(rebalancedNodes, markerNode)

        if (!this.isCurrent(scope))
            return

        const placedImageNode = (rebalancedNodes.find((n: CanvasNode) => n.nodeId === nodeId) as ImageCanvasNode) ?? imageNode
        this.ports.appendCanvasNodeToDOM(placedImageNode)

        if (!this.isCurrent(scope))
            return

        if (imageUrl)
            this.ports.clearGeneratingReferencesOnFirstPixels(threadId, generationRun)

        if (!this.isCurrent(scope))
            return

        return tracker
    }

    prepareGeneratedImageCompletionTextureHandoff(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        runKey: string,
        completedNodeId: string,
        completedAssetId: string,
    ): void {
        const scope = this.capture()

        if (!scope)
            return

        if (
            !completedNodeId
            || !completedAssetId
        )
            return

        const previousTracker = this.ports.trackers.images.get(runKey) ?? {
            nodeId: completedNodeId,
            assetId: completedAssetId,
            placementKey: this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun),
            hasReceivedFrame: false,
        }
        this.ports.visuals.keepCompletion(
            runKey,
            previousTracker,
            {
                nodeId: completedNodeId,
                assetId: completedAssetId,
            },
        )

        if (!this.isCurrent(scope))
            return
    }

    getGenerationRequestId(generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.generationRequestId
            ?? this.ports.placements.getApiMediaRunLineageAssignment(generationRun)?.generationRequestId
            ?? ''
    }

    shouldAcceptGeneratedMediaEvent(
        threadId: string,
        eventWorkspaceId?: string,
        generationRun?: MediaGenerationRunMeta,
    ): boolean {
        const scope = this.capture(eventWorkspaceId)

        if (!scope)
            return false

        const workspaceId = scope.workspaceId
        const generationRequestId = this.getGenerationRequestId(generationRun)

        if (
            generationRequestId
            && this.ports.placements.cancelledRequests.has(generationRequestId)
        )
            return false

        return shouldAcceptGeneratedMediaEventForState({
            threadId,
            eventWorkspaceId,
            workspaceId,
            currentCanvasState: this.currentCanvasState,
            currentAiChatThreads: this.ports.readThreads(),
        })
    }
}
