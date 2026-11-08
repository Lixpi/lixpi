import {
    type CanvasState,
    type CanvasNode,
    type BranchForkCanvasNode,
    type CanvasGeometryUpdate,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import { applyCanvasGeometryUpdateToState } from '../canvas-node/canvas-geometry-update.ts'
import {
    type BranchMarkerNode,
} from '../branch-tree-layout/generated-media-rebalance.ts'
import { getSupersededBranchMarkerNodeIdsForAuthoritativePlan } from '../branch-tree-layout/marker-settlement.ts'
import { hasCompletePlannedBranchMarkerGeometry } from '../branch-tree-layout/marker-render-ownership.ts'
import { getBranchMarkerThreadId } from '../review/workspace-history.ts'
import { lineagePlanReferencesBranchMarkerNode } from '../generation/workspace-branch-activity.ts'
import {
    type WorkspaceGenerationPlacements,
    type PendingBranchMarkerRecord,
} from '../generation/workspace-generation-placements.ts'
import {
    type WorkspaceGenerationSettlement,
} from '../generation/workspace-generation-settlement.ts'

type GeometryScope = {
    workspaceId: string
    sceneKey: string
}
type GeometryTicket = GeometryScope & { epoch: number }

export type WorkspaceApiCanvasGeometryPorts = {
    readScope: () => GeometryScope | null
    readCanvasState: () => CanvasState | null
    placements: WorkspaceGenerationPlacements
    settlement: Pick<WorkspaceGenerationSettlement, 'resolvePendingBranchMarkersForLineagePlan' | 'cleanupOrphanPreflightMarkersForThread'>
    cleanupMarkers: (nodeIds: Iterable<string>) => void
    pruneTrackers: (nodeIds: Iterable<string>) => void
    commit: (state: CanvasState) => void
    publishAuthoritative: (snapshot: {
        canvasState: CanvasState
        layoutRevision: number
    }) => void
    syncMedia: (state: CanvasState | null) => void
    syncGeneratingMedia: () => void
    appendNode: (node: CanvasNode) => void
    syncOperationNode: (node: OperationStatusCanvasNode) => void
    syncNodeGeometry: (nodes: CanvasNode[]) => void
    preserveUntilAcknowledged: (state: CanvasState) => void
    log: (
        event: string,
        details: Record<string, unknown>,
    ) => void
}

const isBranchMarkerNode = (node: CanvasNode): node is BranchMarkerNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const normalizeModelValue = (value: string): string => value.trim().toLowerCase()

const branchMarkerMatchesPendingRecord = (
    node: BranchMarkerNode,
    record: PendingBranchMarkerRecord,
): boolean => {
    if (record.nodeId === node.nodeId)
        return true

    const nodeThreadId = getBranchMarkerThreadId(node)

    if (
        record.threadId
        && nodeThreadId
        && record.threadId !== nodeThreadId
    )
        return false

    const runNode = node as Partial<Pick<BranchForkCanvasNode, 'reasoningIndex' | 'reasoningModelId'>>

    if (
        record.reasoningIndex != null
        && runNode.reasoningIndex != null
    )
        return record.reasoningIndex === runNode.reasoningIndex

    if (
        record.reasoningModelId
        && runNode.reasoningModelId
    )
        return normalizeModelValue(record.reasoningModelId) === normalizeModelValue(runNode.reasoningModelId)

    return !record.reasoningModelId
        && record.reasoningIndex == null
        && record.threadId === getBranchMarkerThreadId(node)
}

const reconcileApiBranchMarkersWithTemporaryPreflightNodes = (
    state: CanvasState,
    canvasGeometry: CanvasGeometryUpdate,
    sourceRecords: ReadonlyMap<string, PendingBranchMarkerRecord>,
): {
    state: CanvasState
    removedNodeIds: string[]
    records: Map<string, PendingBranchMarkerRecord>
} => {
    const pendingBranchMarkers = new Map(sourceRecords)
    const cleanupBranchMarkerArtifacts = (nodeIds: Iterable<string>) => {
        const removed = new Set(nodeIds)

        for (const [key, record] of pendingBranchMarkers)
            if (removed.has(record.nodeId))
                pendingBranchMarkers.delete(key)
    }
    const plannedMarkers = (canvasGeometry.nodeSnapshots ?? []).filter((node: CanvasNode): node is BranchMarkerNode => isBranchMarkerNode(node)).filter(
        node =>
                !canvasGeometry.generationRequestId
                || node.generationRequestId === canvasGeometry.generationRequestId,
    )
        .sort((left, right) => {
            const priority = {
                branchFork: 0,
                branchLine: 1,
                branchOrigin: 2,
            } as const

            return priority[left.type] - priority[right.type]
        })

    if (plannedMarkers.length === 0)
        return {
            state,
            removedNodeIds: [],
            records: pendingBranchMarkers,
        }

    const removedNodeIds = new Set<string>()

    for (const plannedMarker of plannedMarkers) {
        const matchingRecords = [...pendingBranchMarkers.entries()].filter(([, record]) => branchMarkerMatchesPendingRecord(plannedMarker, record))
        const temporaryNodeIds = new Set(
            matchingRecords.map(([, record]) => record.nodeId),
        )

        for (const temporaryNode of state.nodes) {
            if (
                !isBranchMarkerNode(temporaryNode)
                || temporaryNode.pendingState?.phase !== 'preflight'
            )
                continue

            const temporaryRecord: PendingBranchMarkerRecord = {
                nodeId: temporaryNode.nodeId,
                placementKey: temporaryNode.generationRequestId,
                threadId: getBranchMarkerThreadId(temporaryNode),
                ...(temporaryNode.pendingState.reasoningModelId
                    ? { reasoningModelId: temporaryNode.pendingState.reasoningModelId }
                    : {}),
                ...(temporaryNode.pendingState.reasoningIndex == null
                    ? {}
                    : { reasoningIndex: temporaryNode.pendingState.reasoningIndex }),
            }

            if (branchMarkerMatchesPendingRecord(plannedMarker, temporaryRecord))
                temporaryNodeIds.add(temporaryNode.nodeId)
        }

        for (const temporaryNodeId of temporaryNodeIds) {
            if (
                temporaryNodeId === plannedMarker.nodeId
                || removedNodeIds.has(temporaryNodeId)
            )
                continue

            const temporaryNode = state.nodes.find(node => node.nodeId === temporaryNodeId)

            if (
                !temporaryNode
                || !isBranchMarkerNode(temporaryNode)
                || temporaryNode.pendingState?.phase !== 'preflight'
            )
                continue

            removedNodeIds.add(temporaryNodeId)
            cleanupBranchMarkerArtifacts([temporaryNodeId])
        }

        for (const [key, record] of matchingRecords) {
            if (record.nodeId === plannedMarker.nodeId)
                continue

            if (!removedNodeIds.has(record.nodeId))
                continue

            pendingBranchMarkers.set(
                key,
                {
                    ...record,
                    nodeId: plannedMarker.nodeId,
                    threadId: getBranchMarkerThreadId(plannedMarker) || record.threadId,
                },
            )
        }
    }

    // Legacy client-side markers can still be keyed by the conversation Asset
    // ID. If an authoritative canvas snapshot wins the state race, the
    // resolved marker can arrive after aliases moved while the legacy marker
    // remains. It is a duplicate and must not survive beside the topology.
    const authoritativeThreadIds = new Set(
        plannedMarkers
            .filter(marker => Boolean(marker.generationRequestId))
            .map(marker => getBranchMarkerThreadId(marker))
            .filter((threadId): threadId is string => Boolean(threadId)),
    )

    for (const temporaryNode of state.nodes) {
        if (
            !isBranchMarkerNode(temporaryNode)
            || temporaryNode.pendingState?.phase !== 'preflight'
        )
            continue

        const threadId = getBranchMarkerThreadId(temporaryNode)

        if (
            !threadId
            || temporaryNode.generationRequestId !== threadId
        )
            continue

        if (!authoritativeThreadIds.has(threadId))
            continue

        removedNodeIds.add(temporaryNode.nodeId)
        cleanupBranchMarkerArtifacts([temporaryNode.nodeId])
    }

    if (canvasGeometry.generationRequestId) {
        const supersededNodeIds = getSupersededBranchMarkerNodeIdsForAuthoritativePlan({
            state,
            plannedMarkers,
            generationRequestId: canvasGeometry.generationRequestId,
        })

        for (const nodeId of supersededNodeIds) {
            if (removedNodeIds.has(nodeId))
                continue

            removedNodeIds.add(nodeId)
            cleanupBranchMarkerArtifacts([nodeId])
        }
    }

    for (const plannedMarker of plannedMarkers) {
        for (const [key, record] of pendingBranchMarkers.entries()) {
            if (
                !removedNodeIds.has(record.nodeId)
                || !branchMarkerMatchesPendingRecord(plannedMarker, record)
            )
                continue

            pendingBranchMarkers.set(
                key,
                {
                    ...record,
                    nodeId: plannedMarker.nodeId,
                    threadId: getBranchMarkerThreadId(plannedMarker) || record.threadId,
                },
            )
        }
    }

    if (removedNodeIds.size === 0)
        return {
            state,
            removedNodeIds: [],
            records: pendingBranchMarkers,
        }

    return {
        state: {
            ...state,
            nodes: state.nodes.filter(node => !removedNodeIds.has(node.nodeId)),
            edges: state.edges.filter(edge => !removedNodeIds.has(edge.sourceNodeId) && !removedNodeIds.has(edge.targetNodeId)),
        },
        removedNodeIds: [...removedNodeIds],
        records: pendingBranchMarkers,
    }
}

export class WorkspaceApiCanvasGeometry {
    private scope: GeometryScope | null = null
    private lastAppliedApiLayoutRevision = 0
    private highestObservedApiLayoutRevision = 0
    private epoch = 0
    private closed = false

    constructor(private readonly ports: WorkspaceApiCanvasGeometryPorts) {}

    clear(): void {
        this.scope = null
        this.lastAppliedApiLayoutRevision = 0
        this.highestObservedApiLayoutRevision = 0
        this.epoch++
    }

    destroy(): void {
        this.closed = true
        this.clear()
    }

    private capture(): GeometryTicket | null {
        const scope = this.closed ? null : this.ports.readScope()

        if (!scope)
            return null

        if (
            scope.workspaceId !== this.scope?.workspaceId
            || scope.sceneKey !== this.scope?.sceneKey
        ) {
            this.clear()
            this.scope = { ...scope }
        }

        return {
            ...scope,
            epoch: this.epoch,
        }
    }

    private isCurrent(ticket: GeometryTicket): boolean {
        const scope = this.closed ? null : this.ports.readScope()

        return scope?.workspaceId === ticket.workspaceId
            && scope.sceneKey === ticket.sceneKey
            && this.epoch === ticket.epoch
    }

    syncApiCanvasSnapshotNodesToDOM(nodeIds: Iterable<string>): void {
        const ticket = this.capture()
        const state = this.ports.readCanvasState()

        if (
            !ticket
            || !state
        )
            return

        const ids = new Set(nodeIds)

        for (const node of state.nodes) {
            if (!this.isCurrent(ticket))
                return

            if (!ids.has(node.nodeId))
                continue

            if (node.type === 'operationStatus')
                this.ports.syncOperationNode(node)
            else if (
                isBranchMarkerNode(node)
                || node.type === 'image'
                || node.type === 'video'
                || node.type === 'mediaDocument'
                || node.type === 'audio'
                || node.type === 'capabilityArtifact'
            )
                this.ports.appendNode(node)
        }
    }

    resolvePendingBranchMarkersAfterApiGeometry(generationRequestId: string | undefined): void {
        const ticket = this.capture()
        const state = this.ports.readCanvasState()

        if (
            !ticket
            || !state
            || !generationRequestId
        )
            return

        const resolved = new Set<string>()

        for (const placement of this.ports.placements.placements.values()) {
            if (!this.isCurrent(ticket))
                return

            const lineagePlan = placement.lineagePlan

            if (
                !lineagePlan
                || lineagePlan.generationRequestId !== generationRequestId
                || resolved.has(lineagePlan.generationRequestId)
                || !hasCompletePlannedBranchMarkerGeometry(state.nodes, lineagePlan)
            )
                continue

            const marker = state.nodes.find(
                (node): node is BranchMarkerNode =>
                    isBranchMarkerNode(node)
                    && node.pendingState?.phase !== 'preflight'
                    && lineagePlanReferencesBranchMarkerNode(lineagePlan, node),
            )
            const threadId = marker ? getBranchMarkerThreadId(marker) : ''

            if (!threadId)
                continue

            resolved.add(lineagePlan.generationRequestId)
            this.ports.settlement.resolvePendingBranchMarkersForLineagePlan(threadId, lineagePlan)

            if (!this.isCurrent(ticket))
                return

            this.ports.settlement.cleanupOrphanPreflightMarkersForThread(threadId)
        }
    }

    applyApiCanvasGeometry(canvasGeometry: CanvasGeometryUpdate): void {
        const scope = this.capture()
        const state = this.ports.readCanvasState()

        if (
            !scope
            || !state
        )
            return

        if (canvasGeometry.layoutRevision <= this.lastAppliedApiLayoutRevision)
            return

        if (canvasGeometry.layoutRevision < this.highestObservedApiLayoutRevision)
            return

        const ticket = {
            ...scope,
            epoch: ++this.epoch,
        }
        this.highestObservedApiLayoutRevision = Math.max(this.highestObservedApiLayoutRevision, canvasGeometry.layoutRevision)
        const preflight = reconcileApiBranchMarkersWithTemporaryPreflightNodes(
            state,
            canvasGeometry,
            this.ports.placements.markers,
        )
        const result = applyCanvasGeometryUpdateToState(preflight.state, canvasGeometry)
        const replacedMediaNodeIds = result.updatedNodeIds.filter(nodeId => {
            const previous = preflight.state.nodes.find(node => node.nodeId === nodeId)
            const updated = result.state.nodes.find(node => node.nodeId === nodeId)

            return (previous?.type === 'image' || previous?.type === 'video') && updated?.type === 'operationStatus'
        })
        const changed = result.changed || preflight.removedNodeIds.length > 0
        this.ports.log(
            'received',
            {
                layoutRevision: canvasGeometry.layoutRevision,
                geometryNodeCount: canvasGeometry.nodes.length,
                nodeSnapshotCount: canvasGeometry.nodeSnapshots?.length ?? 0,
                edgeSnapshotCount: canvasGeometry.edgeSnapshots?.length ?? 0,
                removedNodeCount: canvasGeometry.removedNodeIds?.length ?? 0,
                removedEdgeCount: canvasGeometry.removedEdgeIds?.length ?? 0,
                initialMatchedGeometryNodeCount: result.initialMatchedGeometryNodeCount,
                matchedGeometryNodeCount: result.matchedGeometryNodeCount,
                missingGeometryNodeCount: result.missingGeometryNodeIds.length,
                geometryNodeIds: canvasGeometry.nodes.map(node => node.nodeId),
                nodeSnapshotIds: canvasGeometry.nodeSnapshots?.map(node => node.nodeId) ?? [],
                edgeSnapshotIds: canvasGeometry.edgeSnapshots?.map(edge => edge.edgeId) ?? [],
                removedNodeIds: canvasGeometry.removedNodeIds ?? [],
                removedEdgeIds: canvasGeometry.removedEdgeIds ?? [],
                upsertedNodeIds: result.upsertedNodeIds,
                updatedNodeIds: result.updatedNodeIds,
                upsertedEdgeIds: result.upsertedEdgeIds,
                missingGeometryNodeIds: result.missingGeometryNodeIds,
            },
        )

        if (!this.isCurrent(ticket))
            return

        if (preflight.removedNodeIds.length) {
            this.ports.cleanupMarkers(preflight.removedNodeIds)

            if (!this.isCurrent(ticket))
                return

            this.ports.placements.markers.clear()

            for (const [key, record] of preflight.records)
                this.ports.placements.markers.set(key, record)
        }

        if (result.fullyApplied)
            this.lastAppliedApiLayoutRevision = canvasGeometry.layoutRevision

        this.ports.log(
            'applied',
            {
                layoutRevision: canvasGeometry.layoutRevision,
                changed: result.changed,
                fullyApplied: result.fullyApplied,
                appliedGeometryNodeIds: result.appliedGeometryNodeIds,
                upsertedNodeIds: result.upsertedNodeIds,
                updatedNodeIds: result.updatedNodeIds,
                upsertedEdgeIds: result.upsertedEdgeIds,
                removedNodeIds: result.removedNodeIds,
                removedEdgeIds: result.removedEdgeIds,
                missingGeometryNodeIds: result.missingGeometryNodeIds,
            },
        )

        if (!this.isCurrent(ticket))
            return

        if (changed) {
            this.ports.commit(result.state)

            if (!this.isCurrent(ticket))
                return
        }

        if (result.fullyApplied) {
            this.ports.publishAuthoritative({
                canvasState: result.state,
                layoutRevision: canvasGeometry.layoutRevision,
            })

            if (!this.isCurrent(ticket))
                return
        }

        if (!changed)
            return

        if (
            preflight.removedNodeIds.length
            || result.removedNodeIds.length
        ) {
            this.ports.syncMedia(
                this.ports.readCanvasState(),
            )

            if (!this.isCurrent(ticket))
                return

            this.ports.log('removed-dom-nodes', { removedNodeIds: [...preflight.removedNodeIds, ...result.removedNodeIds] })

            if (!this.isCurrent(ticket))
                return
        }

        this.ports.pruneTrackers([...result.removedNodeIds, ...replacedMediaNodeIds])

        if (!this.isCurrent(ticket))
            return

        this.ports.syncGeneratingMedia()

        if (!this.isCurrent(ticket))
            return

        const snapshotNodeIds = new Set([
            ...result.upsertedNodeIds,
            ...result.updatedNodeIds,
        ])
        this.syncApiCanvasSnapshotNodesToDOM(snapshotNodeIds)

        if (!this.isCurrent(ticket))
            return

        const current = this.ports.readCanvasState()

        if (
            current
            && snapshotNodeIds.size
        ) {
            this.ports.syncNodeGeometry(
                current.nodes.filter(node => snapshotNodeIds.has(node.nodeId)),
            )

            if (!this.isCurrent(ticket))
                return
        }

        this.resolvePendingBranchMarkersAfterApiGeometry(canvasGeometry.generationRequestId)

        if (!this.isCurrent(ticket))
            return

        const resolved = this.ports.readCanvasState()

        if (resolved) {
            this.ports.preserveUntilAcknowledged(resolved)

            if (!this.isCurrent(ticket))
                return

            this.ports.log(
                'preserve-until-store-ack',
                {
                    layoutRevision: canvasGeometry.layoutRevision,
                    nodeCount: resolved.nodes.length,
                    edgeCount: resolved.edges.length,
                },
            )
        }
    }
}
