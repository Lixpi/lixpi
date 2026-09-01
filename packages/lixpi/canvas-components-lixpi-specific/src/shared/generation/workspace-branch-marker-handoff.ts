import type {
    CanvasState,
    CanvasNode,
    BranchOriginCanvasNode,
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    MediaBranchLineagePlan,
    MediaRunLineageAssignment,
    MediaGenerationRunMeta,
    WorkspaceEdge,
    AiModelId,
} from '@lixpi/constants'
import {
    WorkspaceGenerationPlacements,
    type PendingBranchMarkerRecord,
} from './workspace-generation-placements.ts'
import { WorkspaceLineageProjection } from '../branch-tree-layout/workspace-lineage-projection.ts'
import { WorkspaceGeometry } from '../branch-tree-layout/workspace-geometry.ts'
import type { BranchMarkerNode } from '../branch-tree-layout/generated-media-rebalance.ts'
import { getSupersededPreflightNodeIdsForPlannedOwner } from '../branch-tree-layout/marker-render-ownership.ts'
import { getBranchMarkerThreadId } from '../review/workspace-history.ts'
import { uniqueAiModelIds } from './model-identity.ts'

export type WorkspaceBranchMarkerSettlementOptions = { preserveGeometry?: boolean }
export type PendingBranchMarkerLineageSpec = {
    assignment?: MediaRunLineageAssignment
    generationRun?: MediaGenerationRunMeta
    pendingState: NonNullable<BranchMarkerNode['pendingState']>
}

type HandoffScope = { workspaceId: string; sceneKey: string }

export type WorkspaceBranchMarkerHandoffPorts = {
    readScope: () => HandoffScope | null
    readCanvasState: () => CanvasState | null
    placements: WorkspaceGenerationPlacements
    lineage: WorkspaceLineageProjection
    geometry: WorkspaceGeometry
    resizeMarker: (node: BranchMarkerNode) => BranchMarkerNode
    liveGeometry: (node: BranchMarkerNode) => BranchMarkerNode
    isManuallyPositioned: (nodeId: string) => boolean
    preservePreview: (pendingNodeId: string, node: BranchMarkerNode) => BranchMarkerNode
    cleanup: (nodeIds: Iterable<string>) => void
    clearProjection: (nodeId: string) => void
    commit: (state: CanvasState) => void
    syncMarker: (node: BranchMarkerNode) => void
    refreshConversation: (threadId: string) => void
    hasElement: (nodeId: string) => boolean
    debugHandoff: (event: string, node: BranchMarkerNode, details: Record<string, unknown>) => void
    log: (level: 'info' | 'error', message: string, details: Record<string, unknown>) => void
}

function isBranchMarkerNode(node: CanvasNode): node is BranchMarkerNode {
    return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
}

export class WorkspaceBranchMarkerHandoff {
    constructor(private readonly ports: WorkspaceBranchMarkerHandoffPorts) {}

    private isCurrent(scope: HandoffScope): boolean {
        const current = this.ports.readScope()
        return current?.workspaceId === scope.workspaceId && current.sceneKey === scope.sceneKey
    }

    stripPendingBranchMarkerState(node: BranchMarkerNode): BranchMarkerNode {
        const { pendingState: _pendingState, ...nodeWithoutPendingState } = node
        return nodeWithoutPendingState as BranchMarkerNode
    }

    rememberPlannedBranchMarkerRecord(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        previousRecord: PendingBranchMarkerRecord,
        plannedNodeId: string,
    ): void {
        if (previousRecord.nodeId !== plannedNodeId) {
            this.ports.placements.deletePendingBranchMarkerAliasesForNodeId(previousRecord.nodeId)
        }
        const placementKey = this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun)
        const reasoningModelId = previousRecord.reasoningModelId ?? generationRun?.reasoningModelId
        const reasoningIndex = previousRecord.reasoningIndex ?? generationRun?.reasoningIndex
        const plannedRecord: PendingBranchMarkerRecord = {
            nodeId: plannedNodeId,
            placementKey,
            threadId: previousRecord.threadId,
            ...(reasoningModelId ? { reasoningModelId } : {}),
            ...(reasoningIndex == null ? {} : { reasoningIndex }),
        }
        this.ports.placements.markers.set(placementKey, plannedRecord)
        const threadRecord = this.ports.placements.markers.get(threadId)
        if (threadRecord?.nodeId === previousRecord.nodeId) {
            this.ports.placements.markers.set(threadId, plannedRecord)
        }
        this.ports.placements.setPendingBranchMarkerRecordAliases(threadId, generationRun, plannedRecord)
    }

    getPlannedBranchMarkerResolution(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
    ): {
        branchOriginNode: BranchOriginCanvasNode | undefined
        branchForkNode: BranchForkCanvasNode | undefined
        branchLineNode: BranchLineCanvasNode | undefined
        primaryNode: BranchMarkerNode | undefined
    } {
        const mediaHeight = this.ports.geometry.getGeneratedMediaInsertionSize()
        const branchOriginNode = this.ports.lineage.ensureBranchOriginForGeneratedMedia(threadId, generationRun, mediaHeight)
        const { branchForkNode, branchLineNode, markerNode } = this.ports.lineage.ensureBranchMarkerForGeneratedMedia(threadId, generationRun, branchOriginNode)
        return {
            branchOriginNode,
            branchForkNode,
            branchLineNode,
            primaryNode: markerNode ?? branchOriginNode,
        }
    }

    findLineageAssignmentForGenerationRun(
        lineagePlan: MediaBranchLineagePlan,
        generationRun?: MediaGenerationRunMeta,
    ): MediaRunLineageAssignment | undefined {
        if (generationRun?.lineageAssignment) return generationRun.lineageAssignment
        if (!generationRun) return undefined

        return lineagePlan.runAssignments.find(assignment =>
            (generationRun.mediaRunId && assignment.mediaRunId === generationRun.mediaRunId)
            || (generationRun.reasoningRunId && assignment.reasoningRunId === generationRun.reasoningRunId)
            || (
                generationRun.reasoningIndex != null
                && this.ports.lineage.getLineageAssignmentReasoningIndex(lineagePlan, assignment, generationRun) === generationRun.reasoningIndex
                && (!generationRun.reasoningModelId || assignment.reasoningModelId === generationRun.reasoningModelId)
            )
        )
    }

    buildPendingBranchMarkerStateForPlannedRun(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): NonNullable<BranchMarkerNode['pendingState']> | undefined {
        const placement = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)
            ?? this.ports.placements.placements.get(threadId)
        const lineagePlan = placement?.lineagePlan
        if (lineagePlan) {
            const assignment = this.findLineageAssignmentForGenerationRun(lineagePlan, generationRun)
            const relatedAssignments = assignment
                ? this.ports.lineage.getRelatedLineageAssignments(lineagePlan, assignment)
                : lineagePlan.runAssignments
            const reasoningModelId = assignment?.reasoningModelId ?? generationRun?.reasoningModelId
            const reasoningIndex = assignment
                ? this.ports.lineage.getLineageAssignmentReasoningIndex(lineagePlan, assignment, generationRun)
                : generationRun?.reasoningIndex
            return {
                phase: 'planned',
                promptText: assignment?.promptText || lineagePlan.promptText,
                reasoningModelIds: uniqueAiModelIds([reasoningModelId]),
                ...(reasoningModelId ? { reasoningModelId } : {}),
                ...(reasoningIndex == null ? {} : { reasoningIndex }),
                imageModelIds: this.getLineageAssignmentMediaModelIds(relatedAssignments, 'image'),
                videoModelIds: this.getLineageAssignmentMediaModelIds(relatedAssignments, 'video'),
            }
        }

        const promptText = placement?.promptText
        if (!promptText) return undefined

        const mediaModelIds = uniqueAiModelIds([generationRun?.mediaModelId])
        return {
            phase: 'planned',
            promptText,
            reasoningModelIds: uniqueAiModelIds([generationRun?.reasoningModelId]),
            ...(generationRun?.reasoningModelId ? { reasoningModelId: generationRun.reasoningModelId } : {}),
            ...(generationRun?.reasoningIndex == null ? {} : { reasoningIndex: generationRun.reasoningIndex }),
            imageModelIds: generationRun?.mediaType === 'video' ? [] : mediaModelIds,
            videoModelIds: generationRun?.mediaType === 'video' ? mediaModelIds : [],
        }
    }

    applyPendingStateToSyncedPlannedBranchMarker(
        plannedNode: BranchMarkerNode,
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): BranchMarkerNode {
        const pendingState = this.buildPendingBranchMarkerStateForPlannedRun(threadId, generationRun)
        if (!pendingState) return this.ports.resizeMarker(plannedNode)

        return this.ports.resizeMarker({
            ...plannedNode,
            conversationAssetId: getBranchMarkerThreadId(plannedNode) || threadId,
            pendingState,
        } as BranchMarkerNode)
    }

    applyPendingStateToPlannedBranchMarker(
        plannedNode: BranchMarkerNode,
        pendingNode: BranchMarkerNode,
    ): BranchMarkerNode {
        return this.ports.resizeMarker({
            ...plannedNode,
            ...(pendingNode.conversationAssetId ? { conversationAssetId: pendingNode.conversationAssetId } : {}),
            pendingState: {
                ...pendingNode.pendingState!,
                phase: 'planned',
            },
        } as BranchMarkerNode)
    }

    syncPlannedBranchMarkerResolution(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        previousRecord: PendingBranchMarkerRecord,
        plannedResolution: ReturnType<WorkspaceBranchMarkerHandoff['getPlannedBranchMarkerResolution']>,
    ): void {
        const capturedScope = this.ports.readScope()
        if (!capturedScope) return
        const scope = { ...capturedScope }
        const currentCanvasState = this.ports.readCanvasState()
        if (!currentCanvasState || !plannedResolution.primaryNode) return

        const plannedNode = this.applyPendingStateToSyncedPlannedBranchMarker(
            plannedResolution.primaryNode,
            threadId,
            generationRun,
        )
        const supportNodes = [
            plannedResolution.branchOriginNode,
            plannedResolution.branchForkNode,
            plannedResolution.branchLineNode,
        ].filter((node): node is BranchMarkerNode => Boolean(node && node.nodeId !== plannedNode.nodeId))
        const nodesById = new Map<string, BranchMarkerNode>([
            ...supportNodes.map(node => [node.nodeId, node] as const),
            [plannedNode.nodeId, plannedNode],
        ])
        const insertedNodeIds = new Set<string>()
        const retiredOwnerNodeIds = new Set([
            previousRecord.nodeId,
            ...getSupersededPreflightNodeIdsForPlannedOwner(
                currentCanvasState.nodes.filter((node: CanvasNode): node is BranchMarkerNode => isBranchMarkerNode(node)),
                plannedNode,
            ),
        ].filter(nodeId => nodeId !== plannedNode.nodeId))
        const nodes: CanvasNode[] = []
        for (const node of currentCanvasState.nodes) {
            if (retiredOwnerNodeIds.has(node.nodeId)) continue
            const plannedReplacement = nodesById.get(node.nodeId)
            if (plannedReplacement) {
                if (!insertedNodeIds.has(plannedReplacement.nodeId)) {
                    nodes.push(plannedReplacement)
                    insertedNodeIds.add(plannedReplacement.nodeId)
                }
                continue
            }
            nodes.push(node)
        }
        for (const node of nodesById.values()) {
            if (insertedNodeIds.has(node.nodeId)) continue
            nodes.push(node)
            insertedNodeIds.add(node.nodeId)
        }

        let edges = retiredOwnerNodeIds.size > 0
            ? currentCanvasState.edges.filter((edge: WorkspaceEdge) => !retiredOwnerNodeIds.has(edge.sourceNodeId) && !retiredOwnerNodeIds.has(edge.targetNodeId))
            : currentCanvasState.edges
        edges = this.ports.lineage.addBranchMarkerEdgeIfMissing(edges, plannedResolution.branchForkNode)
        edges = this.ports.lineage.addBranchMarkerEdgeIfMissing(edges, plannedResolution.branchLineNode)
        edges = plannedNode.type === 'branchFork' || plannedNode.type === 'branchLine'
            ? this.ports.lineage.addBranchMarkerEdgeIfMissing(edges, plannedNode)
            : edges

        if (!this.isCurrent(scope)) return
        this.ports.cleanup(retiredOwnerNodeIds)
        if (!this.isCurrent(scope)) return
        this.rememberPlannedBranchMarkerRecord(threadId, generationRun, previousRecord, plannedNode.nodeId)
        this.ports.placements.phases.delete(previousRecord.nodeId)
        this.ports.placements.phases.set(plannedNode.nodeId, 'planned-awaiting-media')
        if (!this.isCurrent(scope)) return
        this.ports.debugHandoff('sync-planned-marker-resolution', plannedNode, {
            previousNodeId: previousRecord.nodeId,
            placementKey: this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun),
            retiredOwnerNodeIds: [...retiredOwnerNodeIds],
        })
        if (!this.isCurrent(scope)) return
        this.ports.commit({
            ...currentCanvasState,
            nodes,
            edges,
        })
        if (!this.isCurrent(scope)) return
        this.ports.log('info', '[CANVAS] incremental branch marker ownership handoff', {
            threadId,
            generationRequestId: generationRun?.generationRequestId ?? '',
            mediaRunId: generationRun?.mediaRunId ?? '',
            previousNodeId: previousRecord.nodeId,
            plannedNodeId: plannedNode.nodeId,
        })
        if (!this.isCurrent(scope)) return
        this.ports.refreshConversation(threadId)
    }

    resolvePendingBranchMarkerWithLineagePlan(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
    ): void {
        const capturedScope = this.ports.readScope()
        if (!capturedScope) return
        const scope = { ...capturedScope }
        const currentCanvasState = this.ports.readCanvasState()
        if (!currentCanvasState) return
        const lineagePlan = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)?.lineagePlan
        const regenerationTarget = lineagePlan?.regenerationTarget
        if (regenerationTarget) {
            const markerNode = currentCanvasState.nodes.find((node: CanvasNode): node is BranchMarkerNode =>
                node.nodeId === regenerationTarget.lineageParentNodeId
                && node.type === regenerationTarget.lineageParentType
            )
            if (!markerNode) {
                if (!this.isCurrent(scope)) return
                this.ports.log('error', '[CANVAS][generated-output-review] API regeneration lineage parent is missing.', {
                    threadId,
                    generationRequestId: generationRun?.generationRequestId,
                    regenerationTarget,
                })
                return
            }
            this.ports.placements.phases.set(markerNode.nodeId, 'planned-awaiting-media')
            if (!this.isCurrent(scope)) return
            this.ports.syncMarker(markerNode)
            return
        }
        const record = this.ports.placements.ensurePendingBranchMarkerRecordForApiRun(threadId, generationRun)
        if (!record) {
            const plannedResolution = this.getPlannedBranchMarkerResolution(threadId, generationRun)
            const plannedNode = plannedResolution.primaryNode
            if (plannedNode) {
                if (!this.isCurrent(scope)) return
                this.syncPlannedBranchMarkerResolution(
                    threadId,
                    generationRun,
                    this.ports.placements.createPendingBranchMarkerRecordFromCanvasNode(threadId, generationRun, plannedNode),
                    plannedResolution,
                )
            }
            return
        }

        const pendingNode = currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === record.nodeId)
        if (!pendingNode || !isBranchMarkerNode(pendingNode) || !pendingNode.pendingState) {
            // A state replacement (incoming workspace update) can drop the
            // transient preflight node while its request record lingers;
            // keep the API-planned marker as the active run instead of recreating
            // another preflight marker beside it.
            const plannedResolution = this.getPlannedBranchMarkerResolution(threadId, generationRun)
            if (!plannedResolution.primaryNode) return
            if (!this.isCurrent(scope)) return
            this.syncPlannedBranchMarkerResolution(threadId, generationRun, record, plannedResolution)
            return
        }

        const plannedResolution = this.getPlannedBranchMarkerResolution(threadId, generationRun)
        const plannedNode = plannedResolution.primaryNode
        if (!plannedNode) return

        const supportNodes = [
            plannedResolution.branchOriginNode,
            plannedResolution.branchForkNode,
            plannedResolution.branchLineNode,
        ].filter((node): node is BranchMarkerNode => Boolean(node && node.nodeId !== plannedNode.nodeId))
        let plannedNodeWithPending = this.applyPendingStateToPlannedBranchMarker(plannedNode, pendingNode)
        plannedNodeWithPending = this.ports.preservePreview(record.nodeId, plannedNodeWithPending)
        if (!this.isCurrent(scope)) return
        this.ports.debugHandoff('promote-planned-marker', plannedNodeWithPending, {
            previousNodeId: record.nodeId,
            placementKey: this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun),
            hadPreflightElement: this.ports.hasElement(record.nodeId),
        })

        const supportNodesById = new Map<string, BranchMarkerNode>(supportNodes.map(node => [node.nodeId, node]))
        const insertedSupportNodeIds = new Set<string>()
        let insertedPlannedNode = false
        const retiredOwnerNodeIds = new Set([
            record.nodeId,
        ].filter(nodeId => nodeId !== plannedNodeWithPending.nodeId))
        const nodes: CanvasNode[] = []
        for (const node of currentCanvasState.nodes) {
            const supportNode = supportNodesById.get(node.nodeId)
            if (supportNode) {
                if (!insertedSupportNodeIds.has(supportNode.nodeId)) {
                    nodes.push(supportNode)
                    insertedSupportNodeIds.add(supportNode.nodeId)
                }
                continue
            }
            if (retiredOwnerNodeIds.has(node.nodeId) || node.nodeId === plannedNodeWithPending.nodeId) {
                if (!insertedPlannedNode) {
                    nodes.push(plannedNodeWithPending)
                    insertedPlannedNode = true
                }
                continue
            }
            nodes.push(node)
        }
        for (const supportNode of supportNodes) {
            if (insertedSupportNodeIds.has(supportNode.nodeId)) continue
            nodes.push(supportNode)
            insertedSupportNodeIds.add(supportNode.nodeId)
        }
        if (!insertedPlannedNode) nodes.push(plannedNodeWithPending)

        let edges = currentCanvasState.edges.filter((edge: WorkspaceEdge) => !retiredOwnerNodeIds.has(edge.sourceNodeId) && !retiredOwnerNodeIds.has(edge.targetNodeId))
        edges = this.ports.lineage.addBranchMarkerEdgeIfMissing(edges, plannedResolution.branchForkNode)
        edges = this.ports.lineage.addBranchMarkerEdgeIfMissing(edges, plannedResolution.branchLineNode)
        edges = plannedNodeWithPending.type === 'branchFork' || plannedNodeWithPending.type === 'branchLine'
            ? this.ports.lineage.addBranchMarkerEdgeIfMissing(edges, plannedNodeWithPending)
            : edges

        if (!this.isCurrent(scope)) return
        this.ports.cleanup(retiredOwnerNodeIds)
        if (!this.isCurrent(scope)) return
        this.rememberPlannedBranchMarkerRecord(threadId, generationRun, record, plannedNodeWithPending.nodeId)
        this.ports.placements.phases.delete(record.nodeId)
        this.ports.placements.phases.set(plannedNodeWithPending.nodeId, 'planned-awaiting-media')
        if (!this.isCurrent(scope)) return
        this.ports.commit({
            ...currentCanvasState,
            nodes,
            edges,
        })
        if (!this.isCurrent(scope)) return
        this.ports.refreshConversation(threadId)
    }

    clearPendingBranchMarkerStateForRun(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
        options: WorkspaceBranchMarkerSettlementOptions = {},
    ): void {
        // Every caller reaches this point when the generated-media placeholder or
        // tracker takes over the visible progress (or the run is settling, where
        // the finish/skip handlers clear the phase immediately afterwards).
        const capturedScope = this.ports.readScope()
        if (!capturedScope) return
        const scope = { ...capturedScope }
        const currentCanvasState = this.ports.readCanvasState()
        this.ports.placements.markBranchMarkerRunMediaPlaceholderPhase(threadId, generationRun)
        if (!currentCanvasState) return
        const record = this.ports.placements.getPendingBranchMarkerRecord(threadId, generationRun)
        if (!record) return

        let updatedMarker: BranchMarkerNode | undefined
        const nodes = currentCanvasState.nodes.map((node: CanvasNode): CanvasNode => {
            if (node.nodeId !== record.nodeId || !isBranchMarkerNode(node) || !node.pendingState) return node
            const liveNode = this.ports.liveGeometry(node)
            if (options.preserveGeometry) {
                updatedMarker = this.stripPendingBranchMarkerState(liveNode) as BranchMarkerNode
                return updatedMarker
            }
            const resizedNode = this.ports.resizeMarker(this.stripPendingBranchMarkerState(liveNode) as BranchMarkerNode)
            updatedMarker = this.ports.isManuallyPositioned(node.nodeId)
                ? { ...resizedNode, position: liveNode.position }
                : resizedNode
            return updatedMarker
        })
        if (!updatedMarker) return

        if (!this.isCurrent(scope)) return
        this.ports.clearProjection(record.nodeId)
        if (!this.isCurrent(scope)) return
        this.ports.commit({
            ...currentCanvasState,
            nodes,
        })
        if (!this.isCurrent(scope)) return
        this.ports.syncMarker(updatedMarker)
        if (!this.isCurrent(scope)) return
        this.ports.refreshConversation(threadId)
    }

    forgetPendingBranchMarkerRecordForRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const placementKey = this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun)
        const record = this.ports.placements.getPendingBranchMarkerRecord(threadId, generationRun)
        if (record) this.ports.placements.deletePendingBranchMarkerAliasesForNodeId(record.nodeId)
        else this.ports.placements.markers.delete(placementKey)
        const threadRecord = this.ports.placements.markers.get(threadId)
        if (record && threadRecord?.nodeId === record.nodeId) this.ports.placements.markers.delete(threadId)
    }

    removePendingBranchMarkerForRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const capturedScope = this.ports.readScope()
        if (!capturedScope) return
        const scope = { ...capturedScope }
        const currentCanvasState = this.ports.readCanvasState()
        this.ports.placements.clearBranchMarkerUiPhasesForRun(threadId, generationRun)
        const record = this.ports.placements.getPendingBranchMarkerRecord(threadId, generationRun)
        if (!currentCanvasState) {
            if (record) this.ports.cleanup([record.nodeId])
            else this.forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
            return
        }
        if (!record) {
            const placementKey = this.ports.placements.getGeneratedMediaPlacementKey(threadId, generationRun)
            const removableGenerationRequestIds = new Set([placementKey, threadId])
            const removableNodeIds = currentCanvasState.nodes
                .filter((node: CanvasNode): node is BranchMarkerNode =>
                    isBranchMarkerNode(node)
                    && Boolean(node.pendingState)
                    && removableGenerationRequestIds.has(node.generationRequestId)
                )
                .map(node => node.nodeId)
            if (removableNodeIds.length === 0) return
            if (!this.isCurrent(scope)) return
            this.ports.commit({
                ...currentCanvasState,
                nodes: currentCanvasState.nodes.filter((node: CanvasNode) => !removableNodeIds.includes(node.nodeId)),
                edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) => !removableNodeIds.includes(edge.sourceNodeId) && !removableNodeIds.includes(edge.targetNodeId)),
            })
            if (!this.isCurrent(scope)) return
            this.ports.cleanup(removableNodeIds)
            if (!this.isCurrent(scope)) return
            return
        }

        const markerNode = currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === record.nodeId)
        this.forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
        if (!markerNode || !isBranchMarkerNode(markerNode) || !markerNode.pendingState) return

        if (!this.isCurrent(scope)) return
        this.ports.commit({
            ...currentCanvasState,
            nodes: currentCanvasState.nodes.filter((node: CanvasNode) => node.nodeId !== record.nodeId),
            edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) => edge.sourceNodeId !== record.nodeId && edge.targetNodeId !== record.nodeId),
        })
        if (!this.isCurrent(scope)) return
        this.ports.cleanup([record.nodeId])
        if (!this.isCurrent(scope)) return
    }

    getLineageAssignmentMediaModelIds(
        assignments: MediaRunLineageAssignment[],
        mediaType: 'image' | 'video',
    ): AiModelId[] {
        return uniqueAiModelIds(
            assignments
                .filter(assignment =>
                    mediaType === 'image'
                        ? assignment.mediaType === 'image' || (!assignment.mediaType && Boolean(assignment.mediaModelId))
                        : assignment.mediaType === 'video'
                )
                .map(assignment => assignment.mediaModelId),
        )
    }

    buildPendingBranchMarkerSpecsFromLineagePlan(
        lineagePlan: MediaBranchLineagePlan,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): PendingBranchMarkerLineageSpec[] {
        const assignments = this.ports.lineage.getUniqueLineageAssignmentsForMarkers(lineagePlan)
        if (assignments.length === 0) {
            return [{
                pendingState: {
                    phase: 'preflight',
                    promptText: lineagePlan.promptText,
                    reasoningModelIds: uniqueAiModelIds([sourceGenerationRun?.reasoningModelId]),
                    ...(sourceGenerationRun?.reasoningModelId ? { reasoningModelId: sourceGenerationRun.reasoningModelId } : {}),
                    ...(sourceGenerationRun?.reasoningIndex == null ? {} : { reasoningIndex: sourceGenerationRun.reasoningIndex }),
                    imageModelIds: this.getLineageAssignmentMediaModelIds(lineagePlan.runAssignments, 'image'),
                    videoModelIds: this.getLineageAssignmentMediaModelIds(lineagePlan.runAssignments, 'video'),
                },
            }]
        }

        return assignments.map((assignment) => {
            const generationRun = this.ports.lineage.buildGenerationRunFromLineageAssignment(lineagePlan, assignment, sourceGenerationRun)
            const relatedAssignments = this.ports.lineage.getRelatedLineageAssignments(lineagePlan, assignment)
            const reasoningModelId = assignment.reasoningModelId ?? generationRun?.reasoningModelId
            return {
                assignment,
                generationRun,
                pendingState: {
                    phase: 'preflight',
                    promptText: assignment.promptText || lineagePlan.promptText,
                    reasoningModelIds: uniqueAiModelIds([reasoningModelId]),
                    ...(reasoningModelId ? { reasoningModelId } : {}),
                    reasoningIndex: this.ports.lineage.getLineageAssignmentReasoningIndex(lineagePlan, assignment, sourceGenerationRun),
                    imageModelIds: this.getLineageAssignmentMediaModelIds(relatedAssignments, 'image'),
                    videoModelIds: this.getLineageAssignmentMediaModelIds(relatedAssignments, 'video'),
                },
            }
        })
    }
}
