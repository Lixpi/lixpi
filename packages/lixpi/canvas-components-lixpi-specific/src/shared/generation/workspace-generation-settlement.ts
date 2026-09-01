import type {
    CanvasState,
    CanvasNode,
    WorkspaceEdge,
    MediaBranchLineagePlan,
    MediaGenerationRunMeta,
} from '@lixpi/constants'
import type {
    WorkspaceGenerationPlacements,
    PendingGeneratedImagePlacement,
} from './workspace-generation-placements.ts'
import type {
    WorkspaceBranchMarkerHandoff,
    WorkspaceBranchMarkerSettlementOptions as BranchMarkerSettlementOptions,
} from './workspace-branch-marker-handoff.ts'
import type { WorkspacePreflightMarkers } from './workspace-preflight-markers.ts'
import type { WorkspaceLineageProjection } from '../branch-tree-layout/workspace-lineage-projection.ts'
import type { BranchMarkerNode } from '../branch-tree-layout/generated-media-rebalance.ts'
import { hasCompletePlannedBranchMarkerGeometry } from '../branch-tree-layout/marker-render-ownership.ts'
import { removePreflightBranchMarkersForThread } from '../branch-tree-layout/marker-settlement.ts'
import { getBranchMarkerThreadId } from '../review/workspace-history.ts'

type SettlementScope = { workspaceId: string; sceneKey: string }

export type WorkspaceGenerationSettlementPorts = {
    readScope: () => SettlementScope | null
    readCanvasState: () => CanvasState | null
    placements: WorkspaceGenerationPlacements
    lineage: Pick<WorkspaceLineageProjection, 'getUniqueLineageAssignmentsForMarkers' | 'buildGenerationRunFromLineageAssignment'>
    handoff: Pick<WorkspaceBranchMarkerHandoff, 'resolvePendingBranchMarkerWithLineagePlan' | 'clearPendingBranchMarkerStateForRun' | 'forgetPendingBranchMarkerRecordForRun' | 'stripPendingBranchMarkerState'>
    preflight: Pick<WorkspacePreflightMarkers, 'insertPendingBranchMarkersFromLineagePlan'>
    setReferences: (placementKey: string, nodeIds: Iterable<string>) => void
    clearReferences: (placementKey: string) => void
    scheduleConversationRefresh: (threadId: string) => void
    refreshConversation: (threadId: string) => void
    settleConversation: (threadId: string) => void
    scheduleTeardown: (threadId: string) => void
    cleanup: (nodeIds: Iterable<string>) => void
    commit: (state: CanvasState) => void
    syncMedia: (state: CanvasState | null) => void
    liveGeometry: (node: BranchMarkerNode) => BranchMarkerNode
    resizeMarker: (node: BranchMarkerNode) => BranchMarkerNode
    isManuallyPositioned: (nodeId: string) => boolean
    syncMarker: (node: BranchMarkerNode) => void
    log: (message: string, details: Record<string, unknown>) => void
}

function isBranchMarkerNode(node: CanvasNode): node is BranchMarkerNode {
    return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
}

export class WorkspaceGenerationSettlement {
    constructor(private readonly ports: WorkspaceGenerationSettlementPorts) {}

    private get currentCanvasState(): CanvasState | null {
        return this.ports.readCanvasState()
    }

    private isCurrent(scope: SettlementScope): boolean {
        const current = this.ports.readScope()
        return current?.workspaceId === scope.workspaceId && current.sceneKey === scope.sceneKey
    }

    applyMediaBranchLineagePlan(
        threadId: string,
        lineagePlan: MediaBranchLineagePlan,
        generationRun?: MediaGenerationRunMeta,
    ): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        const placement = this.ports.placements.ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun, {
            ...(lineagePlan.placementAnchorNodeId ? { placementAnchorNodeId: lineagePlan.placementAnchorNodeId } : {}),
            referenceNodeIds: lineagePlan.referenceNodeIds,
            lineagePlan,
            promptText: lineagePlan.promptText,
            createdAt: lineagePlan.createdAt,
        })
        if (!placement) return

        const nextPlacement: PendingGeneratedImagePlacement = {
            ...placement,
            lineagePlan,
            ...(lineagePlan.placementAnchorNodeId ? { placementAnchorNodeId: lineagePlan.placementAnchorNodeId } : {}),
            referenceNodeIds: lineagePlan.referenceNodeIds,
            activeRunKeys: new Set([
                ...(placement.activeRunKeys ?? []),
                ...lineagePlan.runAssignments
                    .map(assignment => assignment.mediaRunId ?? assignment.reasoningRunId)
                    .filter((runKey): runKey is string => Boolean(runKey)),
            ]),
        }
        this.ports.placements.setPendingGeneratedMediaPlacement(threadId, generationRun, nextPlacement)
        this.ports.setReferences(this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun), lineagePlan.referenceNodeIds)
        if (!this.isCurrent(scope)) return
        this.ports.log('[CANVAS] branch marker lineage plan received', {
            threadId,
            generationRequestId: lineagePlan.generationRequestId,
            sourceMediaRunId: generationRun?.mediaRunId ?? '',
            runAssignments: lineagePlan.runAssignments.map(assignment => ({
                mediaRunId: assignment.mediaRunId ?? '',
                reasoningRunId: assignment.reasoningRunId ?? '',
                reasoningIndex: assignment.reasoningIndex,
                reasoningModelId: assignment.reasoningModelId,
                branchOriginNodeId: assignment.branchOriginNodeId ?? '',
                branchForkNodeId: assignment.branchForkNodeId ?? '',
                branchLineNodeId: assignment.branchLineNodeId ?? '',
            })),
        })
        if (!this.isCurrent(scope)) return
        if (lineagePlan.regenerationTarget && !lineagePlan.regenerationTarget.sourceMediaNodeId) {
            this.ports.handoff.resolvePendingBranchMarkerWithLineagePlan(threadId, generationRun)
            if (!this.isCurrent(scope)) return
            return
        }
        this.ports.preflight.insertPendingBranchMarkersFromLineagePlan(threadId, lineagePlan, generationRun)
        if (!this.isCurrent(scope)) return
        if (
            !this.currentCanvasState
            || !hasCompletePlannedBranchMarkerGeometry(this.currentCanvasState.nodes, lineagePlan)
        ) return
        this.resolvePendingBranchMarkersForLineagePlan(threadId, lineagePlan, generationRun)
        if (!this.isCurrent(scope)) return
        this.cleanupOrphanPreflightMarkersForThread(threadId)
        if (!this.isCurrent(scope)) return
    }

    resolvePendingBranchMarkersForLineagePlan(
        threadId: string,
        lineagePlan: MediaBranchLineagePlan,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        const assignments = this.ports.lineage.getUniqueLineageAssignmentsForMarkers(lineagePlan)
        if (assignments.length === 0) {
            this.ports.handoff.resolvePendingBranchMarkerWithLineagePlan(threadId, sourceGenerationRun)
            if (!this.isCurrent(scope)) return
            return
        }

        for (const assignment of assignments) {
            this.ports.handoff.resolvePendingBranchMarkerWithLineagePlan(
                threadId,
                this.ports.lineage.buildGenerationRunFromLineageAssignment(lineagePlan, assignment, sourceGenerationRun),
            )
            if (!this.isCurrent(scope)) return
        }
    }

    cleanupOrphanPreflightMarkersForThread(threadId: string): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        if (!this.currentCanvasState) return
        const recordedNodeIds = new Set(
            [...this.ports.placements.markers.values()].map(record => record.nodeId),
        )
        const orphanNodeIds = this.currentCanvasState.nodes
            .filter((node: CanvasNode): node is BranchMarkerNode =>
                isBranchMarkerNode(node)
                && node.pendingState?.phase === 'preflight'
                && getBranchMarkerThreadId(node) === threadId
                && !recordedNodeIds.has(node.nodeId)
            )
            .map(node => node.nodeId)
        this.ports.cleanup(orphanNodeIds)
        if (!this.isCurrent(scope)) return
        if (orphanNodeIds.length > 0) {
            this.ports.commit({
                ...this.currentCanvasState,
                nodes: this.currentCanvasState.nodes.filter((node: CanvasNode) => !orphanNodeIds.includes(node.nodeId)),
                edges: this.currentCanvasState.edges.filter((edge: WorkspaceEdge) => !orphanNodeIds.includes(edge.sourceNodeId) && !orphanNodeIds.includes(edge.targetNodeId)),
            })
            if (!this.isCurrent(scope)) return
        }
    }

    registerGeneratedMediaRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        const placement = this.ports.placements.ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun)
        if (!placement) return

        const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)
        const activeRunKeys = new Set(placement.activeRunKeys ?? [])
        if (generationRun?.mediaRunId && generationRun.reasoningRunId) {
            activeRunKeys.delete(generationRun.reasoningRunId)
        }
        activeRunKeys.add(runKey)
        this.ports.placements.setPendingGeneratedMediaPlacement(threadId, generationRun, {
            ...placement,
            activeRunKeys,
        })
    }

    finishGeneratedMediaRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        const placementKey = this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun)
        const placement = this.ports.placements.placements.get(placementKey)
        if (!placement) return

        if (!generationRun?.generationRequestId) {
            this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)
            if (!this.isCurrent(scope)) return
            this.ports.placements.clearBranchMarkerUiPhasesForRun(threadId, generationRun)
            this.ports.scheduleConversationRefresh(threadId)
            if (!this.isCurrent(scope)) return
            this.ports.placements.placements.delete(placementKey)
            this.ports.clearReferences(placementKey)
            if (!this.isCurrent(scope)) return
            this.ports.handoff.forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
            if (!this.isCurrent(scope)) return
            this.ports.refreshConversation(threadId)
            if (!this.isCurrent(scope)) return
            return
        }

        const activeRunKeys = new Set(placement.activeRunKeys ?? [])
        activeRunKeys.delete(this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun))
        if (generationRun.reasoningRunId) activeRunKeys.delete(generationRun.reasoningRunId)
        if (generationRun.mediaRunId) activeRunKeys.delete(generationRun.mediaRunId)
        this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)
        if (!this.isCurrent(scope)) return
        this.ports.placements.clearBranchMarkerUiPhasesForRun(threadId, generationRun)
        this.ports.scheduleConversationRefresh(threadId)
        if (!this.isCurrent(scope)) return
        if (activeRunKeys.size > 0) {
            this.ports.log('[CANVAS] generated media run finished with siblings still active', {
                threadId,
                generationRequestId: generationRun.generationRequestId,
                mediaRunId: generationRun.mediaRunId,
                activeRunKeys: [...activeRunKeys],
            })
            if (!this.isCurrent(scope)) return
            this.ports.placements.placements.set(placementKey, {
                ...placement,
                activeRunKeys,
            })
            this.ports.refreshConversation(threadId)
            if (!this.isCurrent(scope)) return
            return
        }
        this.ports.placements.placements.delete(placementKey)
        this.ports.placements.placements.delete(threadId)
        this.ports.clearReferences(placementKey)
        if (!this.isCurrent(scope)) return
        this.ports.clearReferences(threadId)
        if (!this.isCurrent(scope)) return
        this.ports.placements.deletePendingBranchMarkerAliasesForPlacement(placementKey)
        if (placementKey !== threadId) {
            this.ports.placements.markers.delete(threadId)
            const initialReasoningModelPrefix = `${threadId}:reasoning-model:`
            for (const key of this.ports.placements.markers.keys()) {
                if (key.startsWith(initialReasoningModelPrefix)) this.ports.placements.markers.delete(key)
            }
        }
        const preflightSettlement = this.currentCanvasState
            ? removePreflightBranchMarkersForThread(this.currentCanvasState, threadId)
            : undefined
        if (preflightSettlement) {
            this.ports.cleanup(preflightSettlement.removedNodeIds)
            if (!this.isCurrent(scope)) return
            if (preflightSettlement.state !== this.currentCanvasState) {
                this.ports.commit(preflightSettlement.state)
                if (!this.isCurrent(scope)) return
            }
        }
        this.ports.syncMedia(this.currentCanvasState)
        if (!this.isCurrent(scope)) return
        this.ports.log('[CANVAS] final generated media run settled detached canvas state', {
            threadId,
            generationRequestId: generationRun.generationRequestId,
            mediaRunId: generationRun.mediaRunId,
            removedPreflightNodeIds: preflightSettlement?.removedNodeIds ?? [],
        })
        if (!this.isCurrent(scope)) return
        this.ports.refreshConversation(threadId)
        if (!this.isCurrent(scope)) return
        this.ports.settleConversation(threadId)
        if (!this.isCurrent(scope)) return
        this.ports.scheduleTeardown(threadId)
        if (!this.isCurrent(scope)) return
    }

    finishFailedGeneratedMediaRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        const placementKey = this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun)
        this.finishGeneratedMediaRun(threadId, generationRun)
        if (!this.isCurrent(scope)) return
        if (this.ports.placements.placements.has(placementKey)) return
        this.ports.settleConversation(threadId)
        if (!this.isCurrent(scope)) return
        this.ports.scheduleTeardown(threadId)
        if (!this.isCurrent(scope)) return
    }

    settleBranchMarkersForGenerationRequest(
        generationRequestId: string,
        options: BranchMarkerSettlementOptions = {},
    ): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        if (!generationRequestId || !this.currentCanvasState) return

        let changed = false
        const markersToSync: BranchMarkerNode[] = []
        const nodes = this.currentCanvasState.nodes.map((node: CanvasNode): CanvasNode => {
            if (!this.isCurrent(scope)) return node
            if (!isBranchMarkerNode(node) || node.generationRequestId !== generationRequestId) return node
            const hadTrackedUiPhase = this.ports.placements.phases.has(node.nodeId)
            this.ports.placements.phases.delete(node.nodeId)
            this.ports.placements.deletePendingBranchMarkerAliasesForNodeId(node.nodeId)
            if (!node.pendingState) {
                if (hadTrackedUiPhase) markersToSync.push(node)
                return node
            }

            const liveNode = this.ports.liveGeometry(node)
            if (!this.isCurrent(scope)) return node
            const settledNode = options.preserveGeometry
                ? this.ports.handoff.stripPendingBranchMarkerState(liveNode) as BranchMarkerNode
                : this.ports.resizeMarker(this.ports.handoff.stripPendingBranchMarkerState(liveNode) as BranchMarkerNode)
            if (!this.isCurrent(scope)) return node
            const positionedSettledNode = !options.preserveGeometry && this.ports.isManuallyPositioned(node.nodeId)
                ? { ...settledNode, position: liveNode.position }
                : settledNode
            markersToSync.push(positionedSettledNode)
            changed = true
            return positionedSettledNode
        })

        if (!this.isCurrent(scope)) return
        if (changed) {
            this.ports.commit({
                ...this.currentCanvasState,
                nodes,
            })
            if (!this.isCurrent(scope)) return
        }
        for (const marker of markersToSync) {
            this.ports.syncMarker(marker)
            if (!this.isCurrent(scope)) return
        }
    }

    settleMediaGenerationRequest(
        threadId: string,
        generationRequestId: string,
        generationRun?: MediaGenerationRunMeta,
        options: BranchMarkerSettlementOptions = {},
    ): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        const requestPlacementKey = generationRequestId ? `${threadId}:${generationRequestId}` : ''
        const runPlacementKey = this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun)
        const placementKey = requestPlacementKey || runPlacementKey
        const placement = this.ports.placements.placements.get(placementKey)
            ?? this.ports.placements.placements.get(runPlacementKey)
            ?? this.ports.placements.placements.get(threadId)
        const lineagePlan = placement?.lineagePlan
        const plannedRuns: Array<MediaGenerationRunMeta | undefined> = lineagePlan
            ? this.ports.lineage.getUniqueLineageAssignmentsForMarkers(lineagePlan)
                .map(assignment => this.ports.lineage.buildGenerationRunFromLineageAssignment(lineagePlan, assignment, generationRun))
            : []
        if (plannedRuns.length === 0) plannedRuns.push(generationRun)

        for (const plannedRun of plannedRuns) {
            const targetRun = plannedRun ?? generationRun
            this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, targetRun, options)
            if (!this.isCurrent(scope)) return
            this.ports.placements.clearBranchMarkerUiPhasesForRun(threadId, targetRun)
            this.ports.handoff.forgetPendingBranchMarkerRecordForRun(threadId, targetRun)
            if (!this.isCurrent(scope)) return
        }
        this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun, options)
        if (!this.isCurrent(scope)) return
        this.ports.placements.clearBranchMarkerUiPhasesForRun(threadId, generationRun)
        this.ports.handoff.forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
        if (!this.isCurrent(scope)) return
        this.ports.scheduleConversationRefresh(threadId)
        if (!this.isCurrent(scope)) return
        if (requestPlacementKey) {
            this.ports.placements.placements.delete(requestPlacementKey)
            this.ports.clearReferences(requestPlacementKey)
            if (!this.isCurrent(scope)) return
            this.ports.placements.deletePendingBranchMarkerAliasesForPlacement(requestPlacementKey)
        }
        this.ports.placements.placements.delete(runPlacementKey)
        this.ports.placements.placements.delete(threadId)
        this.ports.clearReferences(runPlacementKey)
        if (!this.isCurrent(scope)) return
        this.ports.clearReferences(threadId)
        if (!this.isCurrent(scope)) return
        this.settleBranchMarkersForGenerationRequest(generationRequestId, options)
        if (!this.isCurrent(scope)) return
        if (this.currentCanvasState) {
            const preflightSettlement = removePreflightBranchMarkersForThread(this.currentCanvasState, threadId)
            this.ports.cleanup(preflightSettlement.removedNodeIds)
            if (!this.isCurrent(scope)) return
            if (preflightSettlement.state !== this.currentCanvasState) {
                this.ports.commit(preflightSettlement.state)
                if (!this.isCurrent(scope)) return
            }
            this.ports.syncMedia(this.currentCanvasState)
            if (!this.isCurrent(scope)) return
        }
        this.ports.refreshConversation(threadId)
        if (!this.isCurrent(scope)) return
        this.ports.settleConversation(threadId)
        if (!this.isCurrent(scope)) return
        this.ports.scheduleTeardown(threadId)
        if (!this.isCurrent(scope)) return
    }

    settleMediaGenerationRun(
        threadId: string,
        generationRun: MediaGenerationRunMeta,
    ): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun)
        if (!this.isCurrent(scope)) return
        this.ports.placements.clearBranchMarkerUiPhasesForRun(threadId, generationRun)
        this.ports.handoff.forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
        if (!this.isCurrent(scope)) return
        this.ports.scheduleConversationRefresh(threadId)
        if (!this.isCurrent(scope)) return
        this.ports.refreshConversation(threadId)
        if (!this.isCurrent(scope)) return
    }

    clearPendingGeneratedMediaPlacementsForThread(threadId: string): void {
        const currentScope = this.ports.readScope()
        const scope = currentScope ? { ...currentScope } : null
        if (!scope) return
        for (const placementKey of this.ports.placements.placements.keys()) {
            if (placementKey !== threadId && !placementKey.startsWith(`${threadId}:`)) continue
            this.ports.placements.placements.delete(placementKey)
            this.ports.clearReferences(placementKey)
            if (!this.isCurrent(scope)) return
        }
        for (const placementKey of this.ports.placements.markers.keys()) {
            if (placementKey !== threadId && !placementKey.startsWith(`${threadId}:`)) continue
            this.ports.placements.markers.delete(placementKey)
        }
        for (const node of this.currentCanvasState?.nodes ?? []) {
            if (isBranchMarkerNode(node) && getBranchMarkerThreadId(node) === threadId) {
                this.ports.placements.phases.delete(node.nodeId)
            }
        }
    }
}
