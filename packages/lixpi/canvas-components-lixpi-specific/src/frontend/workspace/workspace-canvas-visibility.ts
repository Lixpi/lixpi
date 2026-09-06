import {
    getBranchMarkerThreadId,
    isMediaGenerationOperationSupersededByOutput,
    isMediaGenerationReferenceResolutionOperation,
    resolveBranchMarkerRenderOwnership,
    type BranchMarkerNode,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { isWorkspaceNodeType } from '@lixpi/canvas-components-lixpi-specific/frontend/nodes'
import {
    type CanvasNode,
    type CanvasState,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'

export type WorkspaceCanvasVisibilityPorts = {
    hasStartedMedia: (nodeId: string) => boolean
    ensureOperation: (node: OperationStatusCanvasNode) => Promise<unknown>
    reportedOwnershipKeys: Set<string>
    reportUnknownType: (nodeType: string) => void
    reportOwnership: (details: Record<string, unknown>) => void
}

export class WorkspaceCanvasVisibility {
    constructor(private readonly ports: WorkspaceCanvasVisibilityPorts) {}

    getVisibleNodes(state: CanvasState): CanvasNode[] {
        const visible: CanvasNode[] = []
        const markers = state.nodes.filter((node: CanvasNode): node is BranchMarkerNode => this.isMarker(node))
        const startedPlannedMarkerIds = new Set(
            markers
                .filter(node => node.pendingState?.phase !== 'preflight')
                .filter(node => this.ports.hasStartedMedia(node.nodeId))
                .map(node => node.nodeId),
        )
        const ownership = resolveBranchMarkerRenderOwnership(markers, startedPlannedMarkerIds)

        for (const node of state.nodes) {
            if (!isWorkspaceNodeType(node.type)) {
                this.ports.reportUnknownType(node.type)

                continue
            }

            if (ownership.suppressedNodeIds.has(node.nodeId)) {
                this.reportSuppressedMarker(
                    node,
                    markers,
                    startedPlannedMarkerIds,
                    ownership.visibleOwnerBySuppressedNodeId,
                )

                continue
            }

            if (node.type === 'operationStatus')
                void this.ports.ensureOperation(node)

            if (
                node.type !== 'operationStatus'
                || this.shouldRenderOperation(node, state)
            )
                visible.push(node)
        }

        return visible
    }

    shouldRenderOperation(
        node: OperationStatusCanvasNode,
        state: CanvasState,
    ): boolean {
        if (isMediaGenerationReferenceResolutionOperation(node))
            return false

        if (
            node.operation === 'media-generation'
            && node.status === 'failed'
        ) {
            const superseded = state.nodes.some(
                candidate => (
                    (candidate.type === 'image' || candidate.type === 'video')
                    && candidate.mediaGenerationPhase === 'ready'
                    && candidate.generatedBy?.generationRequestId === node.generationRequestId
                    && isMediaGenerationOperationSupersededByOutput(
                        node,
                        {
                            nodeId: candidate.nodeId,
                            mediaRunId: candidate.generationProgress?.mediaRunId ?? candidate.generatedBy?.mediaRunId,
                        },
                    )
                ),
            )

            if (superseded)
                return false
        }

        return node.operation !== 'media-generation' || node.status !== 'in-progress'
    }

    private reportSuppressedMarker(
        node: CanvasNode,
        markers: BranchMarkerNode[],
        startedPlannedMarkerIds: Set<string>,
        visibleOwners: ReadonlyMap<string, string>,
    ): void {
        if (!this.isMarker(node))
            return

        const visibleOwnerNodeId = visibleOwners.get(node.nodeId) ?? ''
        const key = `structural-owner:${node.nodeId}:${visibleOwnerNodeId}`

        if (this.ports.reportedOwnershipKeys.has(key))
            return

        this.ports.reportedOwnershipKeys.add(key)
        const visibleOwner = markers.find(candidate => candidate.nodeId === visibleOwnerNodeId)
        this.ports.reportOwnership({
            threadId: getBranchMarkerThreadId(node),
            suppressedNodeId: node.nodeId,
            suppressedPhase: node.pendingState?.phase ?? 'planned',
            visibleOwnerNodeId,
            visibleOwnerPhase: visibleOwner?.pendingState?.phase ?? 'planned',
            visibleOwnerMediaStarted: startedPlannedMarkerIds.has(visibleOwnerNodeId),
        })
    }

    private isMarker(node: CanvasNode): node is BranchMarkerNode {
        return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
    }
}
