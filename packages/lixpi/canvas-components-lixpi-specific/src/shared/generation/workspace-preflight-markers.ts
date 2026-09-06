import {
    type CanvasState,
    type CanvasNode,
    type BranchLineCanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type MediaBranchLineagePlan,
    type MediaBranchCandidateSnapshot,
    type MediaGenerationRunMeta,
    type AiModelId,
    type WorkspaceEdge,
} from '@lixpi/constants'
import { parseAiModelSelectionAttr } from '@lixpi/prosemirror/shared/model-selection-attrs'
import {
    parseProseMirrorJsonContent,
    findAiChatThreadContentNode,
    collectProseMirrorText,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    type AiPromptComposerSubmitData,
} from '../composer/canvas-conversation-content.ts'
import { getBranchMarkerPromptDisplayText } from '../branch-tree-layout/marker-prompt-parts.ts'
import { estimateBranchMarkerDimensions } from '../branch-tree-layout/marker-dimensions.ts'
import {
    type BranchMarkerNode,
} from '../branch-tree-layout/generated-media-rebalance.ts'
import {
    type WorkspaceGenerationPlacements,
    type PendingBranchMarkerRecord,
} from './workspace-generation-placements.ts'
import {
    type WorkspaceLineageProjection,
} from '../branch-tree-layout/workspace-lineage-projection.ts'
import {
    type WorkspaceBranchMarkerHandoff,
} from './workspace-branch-marker-handoff.ts'
import {
    type WorkspaceGeometry,
} from '../branch-tree-layout/workspace-geometry.ts'
import { uniqueAiModelIds } from './model-identity.ts'

type PreflightScope = {
    workspaceId: string
    sceneKey: string
}
export type WorkspacePreflightConversation = {
    threadId: string
    content?: object
}
export type WorkspacePreflightMarkersPorts = {
    readScope: () => PreflightScope | null
    readCanvasState: () => CanvasState | null
    placements: WorkspaceGenerationPlacements
    lineage: WorkspaceLineageProjection
    handoff: WorkspaceBranchMarkerHandoff
    geometry: WorkspaceGeometry
    activeThreadIds: () => readonly string[]
    isRunActive: (threadId: string) => boolean
    readThread: (threadId: string) => WorkspacePreflightConversation | undefined
    resizeMarker: (node: BranchMarkerNode) => BranchMarkerNode
    rebalance: (
        nodes: CanvasNode[],
        edges: WorkspaceEdge[],
    ) => CanvasNode[]
    commit: (state: CanvasState) => void
    append: (node: BranchMarkerNode) => void
    createId: () => string
    log: (
        level: 'info' | 'error',
        message: string,
        details: Record<string, unknown>,
    ) => void
}

const isBranchMarkerNode = (node: CanvasNode): node is BranchMarkerNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

export class WorkspacePreflightMarkers {
    constructor(private readonly ports: WorkspacePreflightMarkersPorts) {}

    private isCurrent(scope: PreflightScope): boolean {
        const current = this.ports.readScope()

        return current?.workspaceId === scope.workspaceId && current.sceneKey === scope.sceneKey
    }

    getPendingBranchMarkerModelState(
        data: AiPromptComposerSubmitData,
        promptText: string,
    ): NonNullable<BranchMarkerNode['pendingState']> {
        const reasoningModelIds = data.useMultipleReasoningModels
            ? uniqueAiModelIds(data.aiReasoningModels)
            : uniqueAiModelIds(
                data.aiReasoningModels.slice(0, 1),
            )
        const selectedImageModelIds = data.useMultipleImageModels
            ? uniqueAiModelIds(data.imageOptions?.aiImageModels ?? [])
            : uniqueAiModelIds(
                (data.imageOptions?.aiImageModels ?? []).slice(0, 1),
            )
        const selectedVideoModelIds = data.useMultipleVideoModels
            ? uniqueAiModelIds(data.videoOptions?.aiVideoModels ?? [])
            : uniqueAiModelIds(
                (data.videoOptions?.aiVideoModels ?? []).slice(0, 1),
            )
        const imageModelIds = data.mediaGenerationMode === 'image' ? selectedImageModelIds : []
        const videoModelIds = data.mediaGenerationMode === 'video' ? selectedVideoModelIds : []

        return {
            phase: 'preflight',
            promptText,
            reasoningModelIds,
            imageModelIds,
            videoModelIds,
        }
    }

    getPendingBranchMarkerModelStates(
        data: AiPromptComposerSubmitData,
        promptText: string,
    ): Array<NonNullable<BranchMarkerNode['pendingState']>> {
        const baseState = this.getPendingBranchMarkerModelState(data, promptText)
        const focusedReasoningModelIds: Array<AiModelId | undefined> = baseState.reasoningModelIds.length > 0
            ? baseState.reasoningModelIds
            : [undefined]

        return focusedReasoningModelIds.map(
            (reasoningModelId, reasoningIndex) => ({
                ...baseState,
                reasoningModelIds: reasoningModelId ? [reasoningModelId] : [],
                ...(reasoningModelId ? { reasoningModelId } : {}),
                reasoningIndex,
            }),
        )
    }

    parseBooleanAttr(value: unknown): boolean {
        return value === true || value === 'true'
    }

    getAiChatThreadJsonNode(thread: WorkspacePreflightConversation): ProseMirrorJsonNode | null {
        const root = parseProseMirrorJsonContent(thread.content)

        return root ? findAiChatThreadContentNode(root, thread.threadId) : null
    }

    getLatestAiUserMessageText(thread: WorkspacePreflightConversation): string {
        const threadNode = this.getAiChatThreadJsonNode(thread)
        const latestUserMessage = [...(threadNode?.content ?? [])]
            .reverse().find(child => child.type === 'aiUserMessage')

        return latestUserMessage ? collectProseMirrorText(latestUserMessage).trim() : ''
    }

    getDetachedThreadPendingModelStates(
        thread: WorkspacePreflightConversation,
        promptText: string,
    ): Array<NonNullable<BranchMarkerNode['pendingState']>> {
        const attrs = this.getAiChatThreadJsonNode(thread)?.attrs ?? {}
        const useMultipleReasoningModels = this.parseBooleanAttr(attrs.useMultipleReasoningModels)
        const useMultipleImageModels = this.parseBooleanAttr(attrs.useMultipleImageModels)
        const useMultipleVideoModels = this.parseBooleanAttr(attrs.useMultipleVideoModels)
        const collapseForMode = (
            models: string[],
            useMultiple: boolean,
        ): string[] => (useMultiple ? models : models.slice(0, 1))
        const reasoningModelIds = uniqueAiModelIds(
            collapseForMode(
                parseAiModelSelectionAttr(attrs.aiReasoningModels),
                useMultipleReasoningModels,
            ),
        )
        const selectedImageModelIds = uniqueAiModelIds(
            collapseForMode(
                parseAiModelSelectionAttr(attrs.aiImageModels),
                useMultipleImageModels,
            ),
        )
        const selectedVideoModelIds = uniqueAiModelIds(
            collapseForMode(
                parseAiModelSelectionAttr(attrs.aiVideoModels),
                useMultipleVideoModels,
            ),
        )
        const hasExplicitMediaFanout = useMultipleImageModels || useMultipleVideoModels
        const imageModelIds = hasExplicitMediaFanout
            && !useMultipleImageModels
            ? []
            : selectedImageModelIds
        const videoModelIds = hasExplicitMediaFanout
            && !useMultipleVideoModels
            ? []
            : selectedVideoModelIds
        const focusedReasoningModelIds: Array<AiModelId | undefined> = reasoningModelIds.length > 0
            ? reasoningModelIds
            : [undefined]

        return focusedReasoningModelIds.map(
            (reasoningModelId, reasoningIndex) => ({
                phase: 'preflight',
                promptText,
                reasoningModelIds: reasoningModelId ? [reasoningModelId] : [],
                ...(reasoningModelId ? { reasoningModelId } : {}),
                reasoningIndex,
                imageModelIds,
                videoModelIds,
            }),
        )
    }

    insertPendingBranchMarkerForPersistedCanvasThread(thread: WorkspacePreflightConversation): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        const currentCanvasState = this.ports.readCanvasState()

        if (!scope)
            return

        const recordMutations: Array<() => void> = []

        if (!currentCanvasState)
            return

        const threadId = thread.threadId

        if (
            this.ports.placements.hasPendingBranchMarkerForPlacement(threadId)
            || this.ports.placements.hasCanvasBranchMarkerForPlacement(threadId)
        )
            return

        const promptText = this.getLatestAiUserMessageText(thread)

        if (!promptText)
            return

        const generationRequestId = this.ports.placements.placements.get(threadId)?.generationRequestId ?? threadId

        const pendingStates = this.getDetachedThreadPendingModelStates(thread, promptText)
        const pendingNodes: BranchLineCanvasNode[] = []
        pendingStates.forEach((pendingState, index) => {
            if (!this.isCurrent(scope))
                return

            const dimensions = estimateBranchMarkerDimensions(promptText)
            const siblingSlot = pendingStates.length > 1
                ? {
                    index,
                    count: pendingStates.length,
                }
                : undefined
            const nodeId = `pending-branch-${threadId}-${index}`
            const pendingNode = this.ports.resizeMarker(
                {
                    nodeId,
                    type: 'branchLine',
                    branchId: `pending-${threadId}-${index}`,
                    generationRequestId,
                    conversationAssetId: threadId,
                    ...(pendingState.reasoningModelId ? { reasoningModelId: pendingState.reasoningModelId } : {}),
                    ...(pendingState.reasoningIndex == null ? {} : { reasoningIndex: pendingState.reasoningIndex }),
                    pendingState,
                    position: this.ports.lineage.getRootBranchMarkerPositionBeforeGeneratedMedia(
                        threadId,
                        undefined,
                        dimensions,
                        this.ports.geometry.getGeneratedMediaInsertionSize(),
                        siblingSlot,
                    ),
                    dimensions,
                    temporary: true,
                } as BranchLineCanvasNode,
            ) as BranchLineCanvasNode
            const record: PendingBranchMarkerRecord = {
                nodeId,
                placementKey: threadId,
                threadId,
                ...(pendingState.reasoningModelId ? { reasoningModelId: pendingState.reasoningModelId } : {}),
                ...(pendingState.reasoningIndex == null ? {} : { reasoningIndex: pendingState.reasoningIndex }),
            }

            if (pendingState.reasoningModelId) {
                recordMutations.push(
                    () => void this.ports.placements.markers.set(
                        this.ports.placements.getPendingBranchMarkerReasoningModelKey(threadId, pendingState.reasoningModelId!),
                        record,
                    ),
                )
            }

            if (pendingState.reasoningIndex != null) {
                recordMutations.push(
                    () => void this.ports.placements.markers.set(
                        this.ports.placements.getPendingBranchMarkerReasoningIndexKey(threadId, pendingState.reasoningIndex!),
                        record,
                    ),
                )
            }

            if (pendingStates.length === 1)
                recordMutations.push(() => void this.ports.placements.markers.set(threadId, record))

            recordMutations.push(() => void this.ports.placements.phases.set(nodeId, 'preflight'))
            pendingNodes.push(pendingNode)
        })

        if (pendingNodes.length === 0)
            return

        if (!this.isCurrent(scope))
            return

        for (const mutate of recordMutations) mutate()

        this.ports.commit({
            ...currentCanvasState,
            nodes: [...currentCanvasState.nodes, ...pendingNodes],
        })

        for (const pendingNode of pendingNodes) {
            if (!this.isCurrent(scope))
                return

            this.ports.append(pendingNode)
        }

        if (!this.isCurrent(scope))
            return

        this.ports.log(
            'info',
            '[CANVAS] branch marker preflight ownership created',
            {
                threadId,
                pendingMarkers: pendingNodes.map(
                    node => ({
                        nodeId: node.nodeId,
                        reasoningIndex: node.pendingState?.reasoningIndex,
                        reasoningModelId: node.pendingState?.reasoningModelId ?? '',
                    }),
                ),
            },
        )
    }

    restoreDetachedCanvasPreflightMarkersForActiveThreads(): void {
        for (const threadId of this.ports.activeThreadIds()) {
            if (this.ports.isRunActive(threadId))
                continue

            const thread = this.ports.readThread(threadId)

            if (!thread)
                continue

            this.insertPendingBranchMarkerForPersistedCanvasThread(thread)
        }
    }

    insertPendingBranchMarkerForCanvasRun(
        placementKey: string,
        promptText: string,
        data: AiPromptComposerSubmitData,
    ): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        const currentCanvasState = this.ports.readCanvasState()

        if (!scope)
            return

        const recordMutations: Array<() => void> = []

        if (
            !currentCanvasState
            || this.ports.placements.hasPendingBranchMarkerForPlacement(placementKey)
            || this.ports.placements.hasCanvasBranchMarkerForPlacement(placementKey)
        )
            return

        const pendingStates = this.getPendingBranchMarkerModelStates(data, promptText)
        const pendingNodes: BranchLineCanvasNode[] = []
        const submittedPromptParts = this.ports.placements.placements.get(placementKey)?.promptParts
        const generationRequestId = this.ports.placements.placements.get(placementKey)?.generationRequestId
            ?? placementKey
        const submittedPromptText = submittedPromptParts?.length
            ? getBranchMarkerPromptDisplayText(submittedPromptParts)
            : promptText
        const placement = this.ports.placements.placements.get(placementKey)
        const provisionalLineageParent = this.getProvisionalGeneratedLineageSourceNode(placement?.mediaBranchCandidateSnapshot)
        pendingStates.forEach((pendingState, index) => {
            if (!this.isCurrent(scope))
                return

            const dimensions = estimateBranchMarkerDimensions(submittedPromptText)
            const siblingSlot = pendingStates.length > 1
                ? {
                    index,
                    count: pendingStates.length,
                }
                : undefined
            const position = provisionalLineageParent
                ? this.ports.lineage.getPendingBranchMarkerPositionBeforeGeneratedMedia(
                    provisionalLineageParent,
                    dimensions,
                    siblingSlot,
                )
                : this.ports.lineage.getRootBranchMarkerPositionBeforeGeneratedMedia(
                    placementKey,
                    undefined,
                    dimensions,
                    this.ports.geometry.getGeneratedMediaInsertionSize(),
                    siblingSlot,
                )
            const nodeId = `pending-branch-${this.ports.createId()}`
            const basePendingNode: BranchLineCanvasNode = {
                nodeId,
                type: 'branchLine',
                branchId: provisionalLineageParent?.generatedBy?.branchId ?? `pending-${placementKey}-${index}`,
                generationRequestId,
                conversationAssetId: placementKey,
                ...(pendingState.reasoningModelId ? { reasoningModelId: pendingState.reasoningModelId } : {}),
                ...(pendingState.reasoningIndex == null ? {} : { reasoningIndex: pendingState.reasoningIndex }),
                ...(provisionalLineageParent ? { parentBranchNodeId: provisionalLineageParent.nodeId } : {}),
                pendingState,
                position,
                dimensions,
                temporary: true,
            }
            const pendingNode = this.ports.resizeMarker(basePendingNode) as BranchLineCanvasNode
            const record: PendingBranchMarkerRecord = {
                nodeId,
                placementKey,
                threadId: placementKey,
                ...(pendingState.reasoningModelId ? { reasoningModelId: pendingState.reasoningModelId } : {}),
                ...(pendingState.reasoningIndex == null ? {} : { reasoningIndex: pendingState.reasoningIndex }),
            }

            if (pendingState.reasoningModelId) {
                recordMutations.push(
                    () => void this.ports.placements.markers.set(
                        this.ports.placements.getPendingBranchMarkerReasoningModelKey(placementKey, pendingState.reasoningModelId!),
                        record,
                    ),
                )
            }

            if (pendingState.reasoningIndex != null) {
                recordMutations.push(
                    () => void this.ports.placements.markers.set(
                        this.ports.placements.getPendingBranchMarkerReasoningIndexKey(placementKey, pendingState.reasoningIndex!),
                        record,
                    ),
                )
            }

            if (pendingStates.length === 1)
                recordMutations.push(() => void this.ports.placements.markers.set(placementKey, record))

            recordMutations.push(() => void this.ports.placements.phases.set(nodeId, 'preflight'))
            pendingNodes.push(pendingNode)
        })
        const pendingEdges = pendingNodes.flatMap(pendingNode => {
            const edge = this.ports.lineage.createBranchMarkerEdge(pendingNode)

            return edge ? [edge] : []
        })
        const edges = [
            ...currentCanvasState.edges,
            ...pendingEdges.filter(edge => !currentCanvasState?.edges.some(candidate => candidate.edgeId === edge.edgeId)),
        ]
        const nodes = provisionalLineageParent
            ? this.ports.rebalance([...currentCanvasState.nodes, ...pendingNodes], edges)
            : [...currentCanvasState.nodes, ...pendingNodes]

        if (!this.isCurrent(scope))
            return

        for (const mutate of recordMutations) mutate()

        this.ports.commit({
            ...currentCanvasState,
            nodes,
            edges,
        })

        for (const pendingNode of pendingNodes) {
            if (!this.isCurrent(scope))
                return

            const placedNode = nodes.find(node => node.nodeId === pendingNode.nodeId)
            this.ports.append(placedNode?.type === 'branchLine' ? placedNode : pendingNode)
        }

        if (!this.isCurrent(scope))
            return

        this.ports.log(
            'info',
            '[CANVAS] branch marker preflight ownership created',
            {
                threadId: placementKey,
                pendingMarkers: pendingNodes.map(
                    node => ({
                        nodeId: node.nodeId,
                        reasoningIndex: node.pendingState?.reasoningIndex,
                        reasoningModelId: node.pendingState?.reasoningModelId ?? '',
                    }),
                ),
            },
        )
    }

    insertPendingBranchMarkersFromLineagePlan(
        threadId: string,
        lineagePlan: MediaBranchLineagePlan,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        const currentCanvasState = this.ports.readCanvasState()

        if (!scope)
            return

        const recordMutations: Array<() => void> = []

        if (!currentCanvasState)
            return

        const lineagePlacementKey = `${threadId}:${lineagePlan.generationRequestId}`

        if (
            this.ports.placements.hasPendingBranchMarkerForPlacement(threadId)
            || this.ports.placements.hasPendingBranchMarkerForPlacement(lineagePlacementKey)
            || this.ports.placements.hasCanvasBranchMarkerForPlacement(threadId)
            || this.ports.placements.hasCanvasBranchMarkerForPlacement(lineagePlacementKey)
        )
            return

        const pendingSpecs = this.ports.handoff.buildPendingBranchMarkerSpecsFromLineagePlan(lineagePlan, sourceGenerationRun)
        const pendingNodes: BranchLineCanvasNode[] = []

        pendingSpecs.forEach((spec, index) => {
            if (!this.isCurrent(scope))
                return

            const promptText = spec.pendingState.promptText
            const dimensions = estimateBranchMarkerDimensions(promptText)
            const siblingSlot = pendingSpecs.length > 1
                ? {
                    index,
                    count: pendingSpecs.length,
                }
                : undefined
            const nodeId = spec.assignment?.branchForkNodeId
                ?? spec.assignment?.branchLineNodeId
                ?? spec.assignment?.branchOriginNodeId
                ?? `pending-branch-${this.ports.createId()}`
            const existingMarker = currentCanvasState?.nodes.find(
                (node: CanvasNode): node is BranchMarkerNode => node.nodeId === nodeId && isBranchMarkerNode(node),
            )
            const placementKey = spec.generationRun
                ? this.ports.placements.getGeneratedMediaPlacementKey(threadId, spec.generationRun)
                : lineagePlacementKey

            if (existingMarker) {
                this.ports.log(
                    'error',
                    '[CANVAS] API lineage plan attempted to reuse an existing marker as a transient marker.',
                    {
                        nodeId,
                        generationRequestId: lineagePlan.generationRequestId,
                        existingGenerationRequestId: existingMarker.generationRequestId,
                    },
                )

                return
            }

            const pendingNode: BranchLineCanvasNode = this.ports.resizeMarker(
                {
                    nodeId,
                    type: 'branchLine',
                    branchId: `pending-${lineagePlan.generationRequestId}-${index}`,
                    generationRequestId: lineagePlan.generationRequestId,
                    conversationAssetId: threadId,
                    ...(spec.pendingState.reasoningModelId ? { reasoningModelId: spec.pendingState.reasoningModelId } : {}),
                    ...(spec.pendingState.reasoningIndex == null ? {} : { reasoningIndex: spec.pendingState.reasoningIndex }),
                    pendingState: spec.pendingState,
                    position: this.ports.lineage.getRootBranchMarkerPositionBeforeGeneratedMedia(
                        threadId,
                        spec.generationRun,
                        dimensions,
                        this.ports.geometry.getGeneratedMediaInsertionSize(),
                        siblingSlot,
                    ),
                    dimensions,
                    temporary: true,
                } as BranchLineCanvasNode,
            ) as BranchLineCanvasNode
            const record: PendingBranchMarkerRecord = {
                nodeId,
                placementKey,
                threadId,
                ...(spec.pendingState.reasoningModelId ? { reasoningModelId: spec.pendingState.reasoningModelId } : {}),
                ...(spec.pendingState.reasoningIndex == null ? {} : { reasoningIndex: spec.pendingState.reasoningIndex }),
            }
            recordMutations.push(() => void this.ports.placements.markers.set(placementKey, record))

            if (spec.generationRun) {
                recordMutations.push(
                    () => void this.ports.placements.setPendingBranchMarkerRecordAliases(
                        threadId,
                        spec.generationRun,
                        record,
                    ),
                )
            }

            if (pendingSpecs.length === 1)
                recordMutations.push(() => void this.ports.placements.markers.set(threadId, record))

            recordMutations.push(() => void this.ports.placements.phases.set(nodeId, 'preflight'))
            pendingNodes.push(pendingNode)
        })

        if (pendingNodes.length === 0)
            return

        if (!this.isCurrent(scope))
            return

        for (const mutate of recordMutations) mutate()

        this.ports.commit({
            ...currentCanvasState,
            nodes: [...currentCanvasState.nodes, ...pendingNodes],
        })

        for (const pendingNode of pendingNodes) {
            if (!this.isCurrent(scope))
                return

            this.ports.append(pendingNode)
        }
    }

    getMediaBranchSnapshotActiveTargetNodeId(snapshot: MediaBranchCandidateSnapshot | undefined): string | undefined {
        const activeTargetCandidateId = snapshot?.activeTargetCandidateId

        if (!activeTargetCandidateId)
            return undefined

        return snapshot.candidates.find(candidate => candidate.candidateId === activeTargetCandidateId)?.nodeId
    }

    getProvisionalGeneratedLineageSourceNode(snapshot: MediaBranchCandidateSnapshot | undefined): ImageCanvasNode | VideoCanvasNode | undefined {
        const activeTargetCandidateId = snapshot?.activeTargetCandidateId

        if (!activeTargetCandidateId)
            return undefined

        const candidate = snapshot.candidates.find(item => item.candidateId === activeTargetCandidateId)
        const isGeneratedLineageCandidate = Boolean(
            candidate?.branchId
                || candidate?.roleHints.includes('generated-variant')
                || candidate?.roleHints.includes('branch-leaf')
                || candidate?.roleHints.includes('branch-ancestor'),
        )

        if (
            !candidate?.nodeId
            || !isGeneratedLineageCandidate
        )
            return undefined

        const node = this.ports.lineage.findCanvasNodeById(candidate.nodeId)

        return node?.type === 'image'
            || node?.type === 'video'
            ? node
            : undefined
    }
}
