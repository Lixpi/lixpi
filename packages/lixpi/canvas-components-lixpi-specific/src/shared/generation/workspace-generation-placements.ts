import {
    type AiModelId,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type CanvasNode,
    type CanvasState,
    type MediaBranchCandidateSnapshot,
    type MediaBranchLineagePlan,
    type MediaBranchVlmResolution,
    type MediaGenerationRunMeta,
    type MediaRunLineageAssignment,
} from '@lixpi/constants'
import { getBranchMarkerThreadId } from '../review/workspace-history.ts'
import {
    type BranchMarkerNode,
} from '../branch-tree-layout/generated-media-rebalance.ts'
import {
    type BranchMarkerPromptPart,
} from '../branch-tree-layout/marker-prompt-parts.ts'

export type PendingBranchMarkerRecord = {
    nodeId: string
    placementKey: string
    threadId: string
    reasoningModelId?: AiModelId
    reasoningIndex?: number
}

export type PendingGeneratedImagePlacement = {
    generationRequestId?: string
    placementAnchorNodeId?: string
    referenceNodeIds?: string[]
    lineagePlan?: MediaBranchLineagePlan
    promptText: string
    promptParts?: BranchMarkerPromptPart[]
    mediaBranchCandidateSnapshot?: MediaBranchCandidateSnapshot
    mediaBranchResolution?: MediaBranchVlmResolution
    activeRunKeys?: Set<string>
    promptHandoffRunKeys?: Set<string>
    createdAt: number
}

export type BranchMarkerUiPhase = 'preflight' | 'planned-awaiting-media' | 'media-placeholder'

export type WorkspaceGenerationPlacementsPorts = {
    readCanvasState: () => CanvasState | null
    hasStartedMedia: (markerNodeId: string) => boolean
}

const normalizeBranchMarkerModelValue = (value: string | null | undefined): string => {
    return String(value ?? '')
        .trim()
        .toLowerCase()
}

const isBranchMarkerNode = (node: CanvasNode): node is BranchMarkerNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

export class WorkspaceGenerationPlacements {
    readonly placements = new Map<string, PendingGeneratedImagePlacement>()
    readonly markers = new Map<string, PendingBranchMarkerRecord>()
    readonly phases = new Map<string, BranchMarkerUiPhase>()
    readonly cancelledRequests = new Set<string>()

    constructor(private readonly ports: WorkspaceGenerationPlacementsPorts) {}

    clear(): void {
        this.placements.clear()
        this.markers.clear()
        this.phases.clear()
        this.cancelledRequests.clear()
    }

    isBranchMarkerGenerationCancelled(node: BranchMarkerNode): boolean {
        return Boolean(
            node.generationRequestId
                && this.cancelledRequests.has(node.generationRequestId),
        )
    }

    getBranchMarkerUiPhase(node: BranchMarkerNode): BranchMarkerUiPhase | undefined {
        if (this.isBranchMarkerGenerationCancelled(node))
            return undefined

        if (this.ports.hasStartedMedia(node.nodeId))
            return 'media-placeholder'

        const trackedPhase = this.phases.get(node.nodeId)

        if (trackedPhase)
            return trackedPhase

        // Markers restored without a tracked phase (e.g. after a reload) fall back
        // to the persisted pendingState phase.
        if (node.pendingState?.phase === 'preflight')
            return 'preflight'

        if (node.pendingState?.phase === 'planned')
            return 'planned-awaiting-media'

        return undefined
    }

    isBranchMarkerPendingForUi(node: BranchMarkerNode): boolean {
        if (this.isBranchMarkerGenerationCancelled(node))
            return false

        const uiPhase = this.getBranchMarkerUiPhase(node)

        return uiPhase === 'preflight' || uiPhase === 'planned-awaiting-media'
    }

    getBranchMarkerUiPhaseNodeIdsForRun(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): string[] {
        const nodeIds = new Set<string>()
        const record = this.getPendingBranchMarkerRecord(threadId, generationRun)

        if (record)
            nodeIds.add(record.nodeId)

        const assignment = this.getApiMediaRunLineageAssignment(generationRun)

        for (const nodeId of [
            assignment?.lineageParentNodeId,
            assignment?.branchOriginNodeId,
            assignment?.branchForkNodeId,
            assignment?.branchLineNodeId,
        ]) {
            if (nodeId)
                nodeIds.add(nodeId)
        }

        return [...nodeIds]
    }

    markBranchMarkerRunMediaPlaceholderPhase(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): void {
        for (const nodeId of this.getBranchMarkerUiPhaseNodeIdsForRun(threadId, generationRun)) {
            if (this.phases.has(nodeId))
                this.phases.set(nodeId, 'media-placeholder')
        }
    }

    clearBranchMarkerUiPhasesForRun(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): void {
        for (const nodeId of this.getBranchMarkerUiPhaseNodeIdsForRun(threadId, generationRun)) {
            this.phases.delete(nodeId)
        }
    }

    getGeneratedMediaPlacementKey(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): string {
        return generationRun?.generationRequestId
            ? `${threadId}:${generationRun.generationRequestId}`
            : threadId
    }

    getGeneratedMediaRunKey(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): string {
        return generationRun?.mediaRunId
            ?? generationRun?.lineageAssignment?.mediaRunId
            ?? generationRun?.reasoningRunId
            ?? threadId
    }

    getPendingBranchMarkerReasoningModelKey(
        placementKey: string,
        reasoningModelId: string,
    ): string {
        return `${placementKey}:reasoning-model:${reasoningModelId}`
    }

    getPendingBranchMarkerReasoningRunKey(
        placementKey: string,
        reasoningRunId: string,
    ): string {
        return `${placementKey}:reasoning-run:${reasoningRunId}`
    }

    getPendingBranchMarkerReasoningIndexKey(
        placementKey: string,
        reasoningIndex: number,
    ): string {
        return `${placementKey}:reasoning-index:${reasoningIndex}`
    }

    getPendingBranchMarkerBranchNodeKey(
        placementKey: string,
        markerNodeId: string,
    ): string {
        return `${placementKey}:marker:${markerNodeId}`
    }

    hasPendingBranchMarkerForPlacement(placementKey: string): boolean {
        const placementPrefix = `${placementKey}:`

        for (const key of this.markers.keys()) {
            if (
                key === placementKey
                || key.startsWith(placementPrefix)
            )
                return true
        }

        return false
    }

    hasCanvasBranchMarkerForPlacement(placementKey: string): boolean {
        const currentCanvasState = this.ports.readCanvasState()

        if (!currentCanvasState)
            return false

        const [threadId, generationRequestId] = placementKey.split(':')
        const placementIds = new Set<string>(
            [placementKey, threadId, generationRequestId].filter((value): value is string => Boolean(value)),
        )

        return currentCanvasState.nodes.some((node: CanvasNode) => {
            if (!isBranchMarkerNode(node))
                return false

            return placementIds.has(
                getBranchMarkerThreadId(node),
            ) || placementIds.has(node.generationRequestId)
        })
    }

    addUniquePendingBranchMarkerKey(
        keys: string[],
        key: string | undefined,
    ): void {
        if (
            !key
            || keys.includes(key)
        )
            return

        keys.push(key)
    }

    getPendingBranchMarkerSpecificKeys(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): string[] {
        const placementKey = this.getGeneratedMediaPlacementKey(threadId, generationRun)
        const lineageAssignment = this.getApiMediaRunLineageAssignment(generationRun)
        const keys: string[] = []
        this.addUniquePendingBranchMarkerKey(
            keys,
            generationRun?.reasoningRunId
                ? this.getPendingBranchMarkerReasoningRunKey(placementKey, generationRun.reasoningRunId)
                : undefined,
        )
        this.addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.reasoningRunId
                ? this.getPendingBranchMarkerReasoningRunKey(placementKey, lineageAssignment.reasoningRunId)
                : undefined,
        )
        this.addUniquePendingBranchMarkerKey(
            keys,
            generationRun?.reasoningIndex != null
                ? this.getPendingBranchMarkerReasoningIndexKey(placementKey, generationRun.reasoningIndex)
                : undefined,
        )
        this.addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.branchForkNodeId
                ? this.getPendingBranchMarkerBranchNodeKey(placementKey, lineageAssignment.branchForkNodeId)
                : undefined,
        )
        this.addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.branchLineNodeId
                ? this.getPendingBranchMarkerBranchNodeKey(placementKey, lineageAssignment.branchLineNodeId)
                : undefined,
        )
        this.addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.branchOriginNodeId
                ? this.getPendingBranchMarkerBranchNodeKey(placementKey, lineageAssignment.branchOriginNodeId)
                : undefined,
        )
        this.addUniquePendingBranchMarkerKey(
            keys,
            generationRun?.reasoningModelId
                ? this.getPendingBranchMarkerReasoningModelKey(placementKey, generationRun.reasoningModelId)
                : undefined,
        )
        this.addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.reasoningModelId
                ? this.getPendingBranchMarkerReasoningModelKey(placementKey, lineageAssignment.reasoningModelId)
                : undefined,
        )

        return keys
    }

    findPendingBranchMarkerRecordByReasoningModel(
        placementKey: string,
        reasoningModelId: string | undefined,
    ): PendingBranchMarkerRecord | undefined {
        if (!reasoningModelId)
            return undefined

        const normalizedReasoningModelId = normalizeBranchMarkerModelValue(reasoningModelId)
        const placementPrefix = `${placementKey}:`

        for (const [key, record] of this.markers.entries()) {
            if (
                key !== placementKey
                && !key.startsWith(placementPrefix)
            )
                continue

            if (normalizeBranchMarkerModelValue(record.reasoningModelId) === normalizedReasoningModelId)
                return record
        }

        return undefined
    }

    findPendingBranchMarkerRecordByReasoningIndex(
        placementKey: string,
        reasoningIndex: number | undefined,
    ): PendingBranchMarkerRecord | undefined {
        if (reasoningIndex == null)
            return undefined

        return this.markers.get(
            this.getPendingBranchMarkerReasoningIndexKey(placementKey, reasoningIndex),
        )
    }

    pendingBranchMarkerRecordMatchesGenerationRun(
        record: PendingBranchMarkerRecord,
        generationRun: MediaGenerationRunMeta | undefined,
    ): boolean {
        if (!generationRun)
            return true

        if (
            record.reasoningIndex != null
            && generationRun.reasoningIndex != null
        )
            return record.reasoningIndex === generationRun.reasoningIndex

        if (
            record.reasoningModelId
            && generationRun.reasoningModelId
        )
            return normalizeBranchMarkerModelValue(record.reasoningModelId) === normalizeBranchMarkerModelValue(generationRun.reasoningModelId)

        return !record.reasoningModelId && record.reasoningIndex == null
    }

    createPendingBranchMarkerRecordFromCanvasNode(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        node: BranchMarkerNode,
    ): PendingBranchMarkerRecord {
        const placementKey = this.getGeneratedMediaPlacementKey(threadId, generationRun)
        const lineageAssignment = this.getApiMediaRunLineageAssignment(generationRun)
        const runNode = node as Partial<Omit<BranchForkCanvasNode, 'type'> & Omit<BranchLineCanvasNode, 'type'>>
        const reasoningModelId = node.pendingState?.reasoningModelId
            ?? runNode.reasoningModelId
            ?? generationRun?.reasoningModelId
            ?? lineageAssignment?.reasoningModelId
        const reasoningIndex = node.pendingState?.reasoningIndex
            ?? runNode.reasoningIndex
            ?? generationRun?.reasoningIndex

        return {
            nodeId: node.nodeId,
            placementKey,
            threadId: getBranchMarkerThreadId(node) || threadId,
            ...(reasoningModelId ? { reasoningModelId } : {}),
            ...(reasoningIndex == null ? {} : { reasoningIndex }),
        }
    }

    recoverPendingBranchMarkerRecordFromCanvasState(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): PendingBranchMarkerRecord | undefined {
        const currentCanvasState = this.ports.readCanvasState()

        if (!currentCanvasState)
            return undefined

        const lineageAssignment = this.getApiMediaRunLineageAssignment(generationRun)
        const placementKey = this.getGeneratedMediaPlacementKey(threadId, generationRun)
        const candidates = currentCanvasState.nodes.filter(
            (node: CanvasNode): node is BranchMarkerNode =>
                isBranchMarkerNode(node)
                && Boolean(node.pendingState)
                && getBranchMarkerThreadId(node) === threadId,
        )

        if (candidates.length === 0)
            return undefined

        const lineageNodeIds = new Set(
            [
                lineageAssignment?.branchForkNodeId,
                lineageAssignment?.branchLineNodeId,
                lineageAssignment?.branchOriginNodeId,
            ].filter((nodeId): nodeId is string => Boolean(nodeId)),
        )
        const matchingLineageNode = lineageNodeIds.size > 0
            ? candidates.find(node => lineageNodeIds.has(node.nodeId))
            : undefined
        const matchingRunNode = candidates.find(node => {
            const runNode = node as Partial<Omit<BranchForkCanvasNode, 'type'> & Omit<BranchLineCanvasNode, 'type'>>

            return Boolean(
                (generationRun?.reasoningRunId && runNode.reasoningRunId === generationRun.reasoningRunId)
                    || (lineageAssignment?.reasoningRunId && runNode.reasoningRunId === lineageAssignment.reasoningRunId)
                    || (generationRun?.mediaRunId && runNode.mediaRunId === generationRun.mediaRunId)
                    || (lineageAssignment?.mediaRunId && runNode.mediaRunId === lineageAssignment.mediaRunId),
            )
        })
        const matchingReasoningIndex = generationRun?.reasoningIndex == null
            ? undefined
            : candidates.find(node => node.pendingState?.reasoningIndex === generationRun.reasoningIndex)
        const matchingReasoningModel = generationRun?.reasoningModelId
            ? candidates.find(
                node =>
                    normalizeBranchMarkerModelValue(node.pendingState?.reasoningModelId)
                        === normalizeBranchMarkerModelValue(generationRun.reasoningModelId),
            )
            : undefined
        const requestMatches = generationRun?.generationRequestId
            ? candidates.filter(node => node.generationRequestId === generationRun.generationRequestId)
            : []
        const matchingNode = matchingLineageNode
            ?? matchingRunNode
            ?? matchingReasoningIndex
            ?? matchingReasoningModel
            ?? (requestMatches.length === 1 ? requestMatches[0] : undefined)
            ?? (candidates.length === 1 ? candidates[0] : undefined)

        if (!matchingNode)
            return undefined

        const record = this.createPendingBranchMarkerRecordFromCanvasNode(
            threadId,
            generationRun,
            matchingNode,
        )
        this.markers.set(placementKey, record)
        this.setPendingBranchMarkerRecordAliases(
            threadId,
            generationRun,
            record,
        )

        return record
    }

    setPendingBranchMarkerRecordAliases(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        record: PendingBranchMarkerRecord,
    ): void {
        const placementKey = this.getGeneratedMediaPlacementKey(threadId, generationRun)

        for (const key of this.getPendingBranchMarkerSpecificKeys(threadId, generationRun)) {
            this.markers.set(
                key,
                {
                    ...record,
                    placementKey,
                },
            )
        }
    }

    deletePendingBranchMarkerAliasesForNodeId(nodeId: string): void {
        for (const [key, record] of this.markers.entries()) {
            if (record.nodeId === nodeId)
                this.markers.delete(key)
        }
    }

    deletePendingBranchMarkerAliasesForPlacement(placementKey: string): void {
        const placementPrefix = `${placementKey}:`

        for (const key of this.markers.keys()) {
            if (
                key === placementKey
                || key.startsWith(placementPrefix)
            )
                this.markers.delete(key)
        }
    }

    getPendingBranchMarkerRecord(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): PendingBranchMarkerRecord | undefined {
        const placementKey = this.getGeneratedMediaPlacementKey(threadId, generationRun)

        for (const key of this.getPendingBranchMarkerSpecificKeys(threadId, generationRun)) {
            const record = this.markers.get(key)

            if (record)
                return record
        }

        const byReasoningIndex = this.findPendingBranchMarkerRecordByReasoningIndex(placementKey, generationRun?.reasoningIndex)
            ?? (placementKey !== threadId
                ? this.findPendingBranchMarkerRecordByReasoningIndex(threadId, generationRun?.reasoningIndex)
                : undefined)

        if (byReasoningIndex)
            return byReasoningIndex

        const byReasoningModel = this.findPendingBranchMarkerRecordByReasoningModel(placementKey, generationRun?.reasoningModelId)
            ?? (placementKey !== threadId
                ? this.findPendingBranchMarkerRecordByReasoningModel(threadId, generationRun?.reasoningModelId)
                : undefined)

        if (byReasoningModel)
            return byReasoningModel

        const placementRecord = this.markers.get(placementKey)

        if (
            placementRecord
            && this.pendingBranchMarkerRecordMatchesGenerationRun(placementRecord, generationRun)
        )
            return placementRecord

        const threadRecord = placementKey !== threadId ? this.markers.get(threadId) : undefined

        if (
            threadRecord
            && this.pendingBranchMarkerRecordMatchesGenerationRun(threadRecord, generationRun)
        )
            return threadRecord

        return this.recoverPendingBranchMarkerRecordFromCanvasState(threadId, generationRun)
    }

    ensurePendingBranchMarkerRecordForApiRun(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): PendingBranchMarkerRecord | undefined {
        const placementKey = this.getGeneratedMediaPlacementKey(threadId, generationRun)

        for (const key of this.getPendingBranchMarkerSpecificKeys(threadId, generationRun)) {
            const existing = this.markers.get(key)

            if (existing) {
                this.setPendingBranchMarkerRecordAliases(
                    threadId,
                    generationRun,
                    existing,
                )

                return existing
            }
        }

        const byReasoningIndex = this.findPendingBranchMarkerRecordByReasoningIndex(placementKey, generationRun?.reasoningIndex)
            ?? (placementKey !== threadId
                ? this.findPendingBranchMarkerRecordByReasoningIndex(threadId, generationRun?.reasoningIndex)
                : undefined)

        if (byReasoningIndex) {
            this.setPendingBranchMarkerRecordAliases(
                threadId,
                generationRun,
                byReasoningIndex,
            )

            return byReasoningIndex
        }

        const byReasoningModel = this.findPendingBranchMarkerRecordByReasoningModel(placementKey, generationRun?.reasoningModelId)
            ?? (placementKey !== threadId
                ? this.findPendingBranchMarkerRecordByReasoningModel(threadId, generationRun?.reasoningModelId)
                : undefined)

        if (byReasoningModel) {
            this.setPendingBranchMarkerRecordAliases(
                threadId,
                generationRun,
                byReasoningModel,
            )

            return byReasoningModel
        }

        const existing = this.markers.get(placementKey)

        if (
            existing
            && this.pendingBranchMarkerRecordMatchesGenerationRun(existing, generationRun)
        ) {
            this.setPendingBranchMarkerRecordAliases(
                threadId,
                generationRun,
                existing,
            )

            return existing
        }

        const threadRecord = placementKey !== threadId ? this.markers.get(threadId) : undefined

        if (
            !threadRecord
            || !this.pendingBranchMarkerRecordMatchesGenerationRun(threadRecord, generationRun)
        )
            return this.recoverPendingBranchMarkerRecordFromCanvasState(threadId, generationRun)

        const migrated = {
            ...threadRecord,
            placementKey,
        }
        this.markers.set(placementKey, migrated)
        this.setPendingBranchMarkerRecordAliases(
            threadId,
            generationRun,
            migrated,
        )

        return migrated
    }

    clonePendingGeneratedMediaPlacement(placement: PendingGeneratedImagePlacement): PendingGeneratedImagePlacement {
        return {
            ...placement,
            activeRunKeys: placement.activeRunKeys ? new Set(placement.activeRunKeys) : undefined,
            promptHandoffRunKeys: placement.promptHandoffRunKeys
                ? new Set(placement.promptHandoffRunKeys)
                : undefined,
        }
    }

    getPendingGeneratedMediaPlacement(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): PendingGeneratedImagePlacement | undefined {
        return this.placements.get(
            this.getGeneratedMediaPlacementKey(threadId, generationRun),
        )
    }

    ensurePendingGeneratedMediaPlacementForApiRun(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        seed?: PendingGeneratedImagePlacement,
    ): PendingGeneratedImagePlacement | undefined {
        const placementKey = this.getGeneratedMediaPlacementKey(threadId, generationRun)
        const existing = this.placements.get(placementKey)

        if (existing)
            return existing

        const threadPlacement = placementKey !== threadId
            ? this.placements.get(threadId)
            : undefined
        const placement = threadPlacement
            ? this.clonePendingGeneratedMediaPlacement(threadPlacement)
            : seed

        if (!placement)
            return undefined

        this.placements.set(placementKey, placement)

        return placement
    }

    setPendingGeneratedMediaPlacement(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        placement: PendingGeneratedImagePlacement,
    ): void {
        this.placements.set(
            this.getGeneratedMediaPlacementKey(threadId, generationRun),
            placement,
        )
    }

    getApiMediaRunLineageAssignment(generationRun?: MediaGenerationRunMeta): MediaRunLineageAssignment | undefined {
        return generationRun?.lineageAssignment
    }
}
