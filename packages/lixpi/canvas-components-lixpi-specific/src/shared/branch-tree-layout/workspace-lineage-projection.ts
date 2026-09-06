import {
    type CanvasState,
    type CanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type BranchForkLineagePlan,
    type BranchLineLineagePlan,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
    type MediaRunLineageAssignment,
    type WorkspaceEdge,
} from '@lixpi/constants'
import { computeCenteredPositionToRightOfRect } from '@lixpi/canvas-engine/shared'
import {
    type Point,
    type Rect,
    type BranchMarkerNode,
} from './generated-media-rebalance.ts'
import {
    type WorkspaceGeometry,
    type WorkspaceGeometrySettings,
} from './workspace-geometry.ts'
import {
    type WorkspaceGenerationPlacements,
} from '../generation/workspace-generation-placements.ts'
import { estimateBranchMarkerDimensions } from './marker-dimensions.ts'
import { computeReferenceBranchRootMarkerPosition } from './reference-branch-placement.ts'
import { normalizeBranchLineageNodeGap } from './branch-lineage-spacing.ts'

export type WorkspaceLineageProjectionPorts = {
    readCanvasState: () => CanvasState | null
    placements: WorkspaceGenerationPlacements
    geometry: WorkspaceGeometry
    settings: WorkspaceGeometrySettings['mediaBranchLineage']
    getWorldPosition: (
        node: CanvasNode,
        nodesById: Map<string, CanvasNode>,
    ) => Point
    getWorldRect: (
        node: CanvasNode,
        nodesById: Map<string, CanvasNode>,
    ) => Rect
    resizeMarker: <Node extends BranchMarkerNode>(node: Node) => Node
}

// Projects identities and parentage supplied by the API into canvas geometry.
export class WorkspaceLineageProjection {
    constructor(private readonly ports: WorkspaceLineageProjectionPorts) {}

    private getCanvasNodesById(nodes: readonly CanvasNode[] = this.ports.readCanvasState()?.nodes ?? []): Map<string, CanvasNode> {
        return new Map(
            nodes.map(node => [node.nodeId, node]),
        )
    }

    private getNodeWorldRect(
        node: CanvasNode,
        nodesById = this.getCanvasNodesById(),
    ): Rect {
        return this.ports.getWorldRect(node, nodesById)
    }

    private getGeneratedMediaOutputGap(sourceNode: CanvasNode): number {
        if (sourceNode.type === 'branchOrigin')
            return this.ports.settings.branchOriginToFirstMediaGap

        if (
            sourceNode.type === 'branchFork'
            && !sourceNode.parentBranchNodeId
        )
            return this.ports.settings.rootToFirstMediaGap

        return this.ports.settings.mediaToMediaGap
    }

    findCanvasNodeById(nodeId: string | undefined): CanvasNode | undefined {
        if (!nodeId)
            return undefined

        return this.ports.readCanvasState()?.nodes.find((node: CanvasNode) => node.nodeId === nodeId)
    }

    getFirstExistingMediaNodeId(nodeIds: Iterable<string | null | undefined>): string | undefined {
        for (const nodeId of nodeIds) {
            const node = this.findCanvasNodeById(nodeId ?? undefined)

            if (
                node?.type === 'image'
                || node?.type === 'video'
            )
                return node.nodeId
        }

        return undefined
    }

    getExistingMediaNodeIds(nodeIds: Iterable<string | null | undefined>): string[] {
        const mediaNodeIds: string[] = []
        const seen = new Set<string>()

        for (const nodeId of nodeIds) {
            const node = this.findCanvasNodeById(nodeId ?? undefined)

            if (
                !node
                || (node.type !== 'image' && node.type !== 'video')
                || seen.has(node.nodeId)
            )
                continue

            seen.add(node.nodeId)
            mediaNodeIds.push(node.nodeId)
        }

        return mediaNodeIds
    }

    findPendingLineageNode(
        nodeId: string,
        pendingNodes: Array<BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode | undefined>,
    ): CanvasNode | undefined {
        return pendingNodes.find(
            (node): node is BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode => Boolean(node && node.nodeId === nodeId),
        )
    }

    getGeneratedMediaEdgeSourceNode(
        generationRun: MediaGenerationRunMeta | undefined,
        pendingNodes: Array<BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode | undefined> = [],
    ): CanvasNode | undefined {
        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)
        const lineageParentNodeId = lineageAssignment?.lineageParentNodeId
            ?? lineageAssignment?.branchLineNodeId
            ?? lineageAssignment?.branchForkNodeId
            ?? lineageAssignment?.parentMediaNodeId
            ?? lineageAssignment?.branchOriginNodeId

        if (!lineageParentNodeId)
            return undefined

        return this.findCanvasNodeById(lineageParentNodeId)
            ?? this.findPendingLineageNode(lineageParentNodeId, pendingNodes)
    }

    findBranchForkPlanForRun(
        lineagePlan: MediaBranchLineagePlan | undefined,
        branchForkNodeId?: string,
    ): BranchForkLineagePlan | undefined {
        const branchForks = lineagePlan?.branchForks ?? []

        return branchForkNodeId ? branchForks.find(fork => fork.nodeId === branchForkNodeId) : undefined
    }

    getBranchForkParentNode(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        branchOriginNode: BranchOriginCanvasNode | undefined,
    ): CanvasNode | undefined {
        const placement = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)
        const forkPlan = this.findBranchForkPlanForRun(placement?.lineagePlan, lineageAssignment?.branchForkNodeId)
        const parentBranchNodeId = forkPlan?.parentBranchNodeId

        if (!parentBranchNodeId)
            return undefined

        return this.findCanvasNodeById(parentBranchNodeId)
            ?? (branchOriginNode?.nodeId === parentBranchNodeId ? branchOriginNode : undefined)
    }

    addBranchLineageMarkerNodesIfMissing(
        nodes: CanvasNode[],
        ...markerNodes: Array<BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode | undefined>
    ): CanvasNode[] {
        const existingNodeIds = new Set(
            nodes.map((node: CanvasNode) => node.nodeId),
        )
        const additions = markerNodes.filter((node): node is BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode => {
            if (
                !node
                || existingNodeIds.has(node.nodeId)
            )
                return false

            existingNodeIds.add(node.nodeId)

            return true
        })

        return additions.length > 0 ? [...nodes, ...additions] : nodes
    }

    createBranchMarkerEdge(markerNode: BranchForkCanvasNode | BranchLineCanvasNode): WorkspaceEdge | undefined {
        if (!markerNode.parentBranchNodeId)
            return undefined

        return {
            edgeId: `edge-${markerNode.parentBranchNodeId}-${markerNode.nodeId}`,
            sourceNodeId: markerNode.parentBranchNodeId,
            targetNodeId: markerNode.nodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
        }
    }

    addBranchMarkerEdgeIfMissing(
        edges: WorkspaceEdge[],
        markerNode: BranchForkCanvasNode | BranchLineCanvasNode | undefined,
    ): WorkspaceEdge[] {
        if (!markerNode)
            return edges

        const edge = this.createBranchMarkerEdge(markerNode)

        if (!edge)
            return edges

        if (edges.some((existing: WorkspaceEdge) => existing.edgeId === edge.edgeId))
            return edges

        return [...edges, edge]
    }

    ensureBranchOriginForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        mediaHeight: number,
    ): BranchOriginCanvasNode | undefined {
        const placement = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)

        if (
            !placement
            || !lineageAssignment?.branchOriginNodeId
        )
            return undefined

        const plannedBranchOriginNodeId = lineageAssignment.branchOriginNodeId
        const branchOriginPlan = placement.lineagePlan?.branchOrigin?.nodeId === plannedBranchOriginNodeId
            ? placement.lineagePlan.branchOrigin
            : undefined

        if (!branchOriginPlan)
            return undefined

        const nodeId = plannedBranchOriginNodeId
        const dimensions = estimateBranchMarkerDimensions(branchOriginPlan.provenance?.promptText ?? '')
        const referenceRootPosition = this.getReferenceBranchRootMarkerPositionForGeneratedMedia(
            threadId,
            generationRun,
            dimensions,
            mediaHeight,
            this.ports.settings.branchOriginToFirstMediaGap,
        )
        const position = referenceRootPosition
            ? referenceRootPosition
            : this.ports.geometry.getFreshBranchRootMarkerPosition(dimensions)
        const branchOriginNode: BranchOriginCanvasNode = {
            nodeId,
            type: 'branchOrigin',
            branchId: branchOriginPlan.branchId,
            generationRequestId: branchOriginPlan.generationRequestId,
            conversationAssetId: threadId,
            ...(branchOriginPlan.promptFingerprint ? { promptFingerprint: branchOriginPlan.promptFingerprint } : {}),
            provenance: branchOriginPlan.provenance,
            position,
            dimensions,
            temporary: true,
        }
        const existing = this.findCanvasNodeById(plannedBranchOriginNodeId)

        if (existing?.type === 'branchOrigin')
            return existing as BranchOriginCanvasNode

        return this.ports.resizeMarker(branchOriginNode) as BranchOriginCanvasNode
    }

    ensureBranchForkForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        branchOriginNode: BranchOriginCanvasNode | undefined,
    ): BranchForkCanvasNode | undefined {
        const placement = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)

        if (
            !placement
            || !generationRun
            || !lineageAssignment?.branchForkNodeId
        )
            return undefined

        const branchForkNodeId = lineageAssignment.branchForkNodeId

        const branchForkPlan = this.findBranchForkPlanForRun(placement.lineagePlan, branchForkNodeId)

        if (!branchForkPlan)
            return undefined

        const nodeId = branchForkNodeId
        const parentNode = this.getBranchForkParentNode(
            threadId,
            generationRun,
            branchOriginNode,
        )
        const dimensions = estimateBranchMarkerDimensions(branchForkPlan.provenance?.promptText ?? '')
        const mediaHeight = this.ports.geometry.getGeneratedMediaInsertionSize()
        const position = parentNode
            && branchForkPlan.parentBranchNodeId
            ? this.getPendingBranchMarkerPositionBeforeGeneratedMedia(
                parentNode,
                dimensions,
                this.getPlannedBranchMarkerSiblingSlot(
                    threadId,
                    generationRun,
                    branchForkPlan.parentBranchNodeId,
                    branchForkNodeId,
                ),
            )
            : this.getRootBranchMarkerPositionBeforeGeneratedMedia(
                threadId,
                generationRun,
                dimensions,
                mediaHeight,
                this.getPlannedRootBranchForkSiblingSlot(
                    threadId,
                    generationRun,
                    branchForkNodeId,
                ),
            )

        const branchForkNode: BranchForkCanvasNode = {
            nodeId,
            type: 'branchFork',
            branchId: branchForkPlan.branchId,
            generationRequestId: branchForkPlan.generationRequestId,
            conversationAssetId: threadId,
            reasoningRunId: branchForkPlan.reasoningRunId,
            reasoningModelId: branchForkPlan.reasoningModelId,
            reasoningIndex: branchForkPlan.reasoningIndex,
            ...(branchForkPlan.parentBranchNodeId ? { parentBranchNodeId: branchForkPlan.parentBranchNodeId } : {}),
            ...(branchForkPlan.promptFingerprint ? { promptFingerprint: branchForkPlan.promptFingerprint } : {}),
            provenance: branchForkPlan.provenance,
            position,
            dimensions,
            temporary: true,
        }
        const existing = this.findCanvasNodeById(branchForkNodeId)

        if (existing?.type === 'branchFork')
            return existing as BranchForkCanvasNode

        return this.ports.resizeMarker(branchForkNode) as BranchForkCanvasNode
    }

    findBranchLinePlanForRun(
        lineagePlan: MediaBranchLineagePlan | undefined,
        branchLineNodeId?: string,
    ): BranchLineLineagePlan | undefined {
        const branchLines = lineagePlan?.branchLines ?? []

        return branchLineNodeId ? branchLines.find(line => line.nodeId === branchLineNodeId) : undefined
    }

    ensureBranchLineForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        branchOriginNode: BranchOriginCanvasNode | undefined,
    ): BranchLineCanvasNode | undefined {
        const placement = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = this.ports.placements.getApiMediaRunLineageAssignment(generationRun)

        if (
            !placement
            || !generationRun
            || !lineageAssignment?.branchLineNodeId
        )
            return undefined

        const branchLineNodeId = lineageAssignment.branchLineNodeId

        const existing = this.findCanvasNodeById(branchLineNodeId)

        if (
            existing?.type === 'branchLine'
            && existing.pendingState?.phase !== 'preflight'
        )
            return existing as BranchLineCanvasNode

        const nodeId = branchLineNodeId
        const branchLinePlan = this.findBranchLinePlanForRun(placement.lineagePlan, branchLineNodeId)

        if (!branchLinePlan)
            return undefined

        const parentBranchNodeId = branchLinePlan.parentBranchNodeId

        if (!parentBranchNodeId)
            return undefined

        const parentNode = this.findCanvasNodeById(parentBranchNodeId)
            ?? (branchOriginNode?.nodeId === parentBranchNodeId ? branchOriginNode : undefined)
        const dimensions = estimateBranchMarkerDimensions(branchLinePlan.provenance?.promptText ?? '')

        if (!parentNode)
            return undefined

        const siblingSlot = this.getPlannedBranchMarkerSiblingSlot(
            threadId,
            generationRun,
            parentBranchNodeId,
            branchLineNodeId,
        )
        const position = this.getPendingBranchMarkerPositionBeforeGeneratedMedia(
            parentNode,
            dimensions,
            siblingSlot,
        )

        const branchLineNode: BranchLineCanvasNode = {
            nodeId,
            type: 'branchLine',
            branchId: branchLinePlan.branchId,
            generationRequestId: branchLinePlan.generationRequestId,
            conversationAssetId: threadId,
            reasoningRunId: branchLinePlan.reasoningRunId,
            reasoningModelId: branchLinePlan.reasoningModelId,
            reasoningIndex: branchLinePlan.reasoningIndex,
            ...(branchLinePlan.mediaRunId ? { mediaRunId: branchLinePlan.mediaRunId } : {}),
            ...(branchLinePlan.mediaModelId ? { mediaModelId: branchLinePlan.mediaModelId } : {}),
            ...(branchLinePlan.mediaType ? { mediaType: branchLinePlan.mediaType } : {}),
            parentBranchNodeId,
            ...(branchLinePlan.promptFingerprint ? { promptFingerprint: branchLinePlan.promptFingerprint } : {}),
            provenance: branchLinePlan.provenance,
            position,
            dimensions,
            temporary: true,
        }

        return this.ports.resizeMarker(branchLineNode) as BranchLineCanvasNode
    }

    ensureBranchMarkerForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        branchOriginNode: BranchOriginCanvasNode | undefined,
    ): {
        branchForkNode: BranchForkCanvasNode | undefined
        branchLineNode: BranchLineCanvasNode | undefined
        markerNode: BranchForkCanvasNode | BranchLineCanvasNode | undefined
    } {
        const branchForkNode = this.ensureBranchForkForGeneratedMedia(
            threadId,
            generationRun,
            branchOriginNode,
        )
        const branchLineNode = branchForkNode
            ? undefined
            : this.ensureBranchLineForGeneratedMedia(
                threadId,
                generationRun,
                branchOriginNode,
            )

        return {
            branchForkNode,
            branchLineNode,
            markerNode: branchForkNode ?? branchLineNode,
        }
    }

    getPlannedBranchMarkerSiblingSlot(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        parentBranchNodeId: string,
        markerNodeId: string,
    ): {
        index: number
        count: number
    } | undefined {
        const lineagePlan = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)?.lineagePlan

        if (!lineagePlan)
            return undefined

        const markerEntries: Array<{
            nodeId: string
            reasoningIndex: number
        }> = []
        const seen = new Set<string>()

        for (const assignment of this.getUniqueLineageAssignmentsForMarkers(lineagePlan)) {
            const markerId = assignment.branchForkNodeId ?? assignment.branchLineNodeId

            if (
                !markerId
                || seen.has(markerId)
            )
                continue

            const forkPlan = this.findBranchForkPlanForRun(lineagePlan, assignment.branchForkNodeId)
            const linePlan = this.findBranchLinePlanForRun(lineagePlan, assignment.branchLineNodeId)
            const markerParentBranchNodeId = forkPlan?.parentBranchNodeId ?? linePlan?.parentBranchNodeId

            if (markerParentBranchNodeId !== parentBranchNodeId)
                continue

            markerEntries.push({
                nodeId: markerId,
                reasoningIndex: forkPlan?.reasoningIndex ?? linePlan?.reasoningIndex ?? markerEntries.length,
            })
            seen.add(markerId)
        }

        markerEntries.sort((a, b) => {
            const indexDelta = a.reasoningIndex - b.reasoningIndex

            if (indexDelta !== 0)
                return indexDelta

            return a.nodeId.localeCompare(b.nodeId)
        })

        const markerIds = markerEntries.map(entry => entry.nodeId)
        const index = markerIds.indexOf(markerNodeId)

        if (
            index < 0
            || markerIds.length <= 1
        )
            return undefined

        return {
            index,
            count: markerIds.length,
        }
    }

    getPlannedRootBranchForkSiblingSlot(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        markerNodeId: string,
    ): {
        index: number
        count: number
    } | undefined {
        const lineagePlan = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)?.lineagePlan

        if (!lineagePlan)
            return undefined

        const markerEntries = lineagePlan.branchForks.filter(fork => !fork.parentBranchNodeId).map(
            fork => ({
                nodeId: fork.nodeId,
                reasoningIndex: fork.reasoningIndex,
            }),
        )
            .sort((a, b) => {
                const indexDelta = a.reasoningIndex - b.reasoningIndex

                if (indexDelta !== 0)
                    return indexDelta

                return a.nodeId.localeCompare(b.nodeId)
            })

        const markerIds = markerEntries.map(entry => entry.nodeId)
        const index = markerIds.indexOf(markerNodeId)

        if (
            index < 0
            || markerIds.length <= 1
        )
            return undefined

        return {
            index,
            count: markerIds.length,
        }
    }

    getRootBranchMarkerPositionBeforeGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        markerDimensions: {
            width: number
            height: number
        },
        mediaHeight: number,
        siblingSlot?: {
            index: number
            count: number
        },
    ): {
        x: number
        y: number
    } {
        const referenceRootPosition = this.getReferenceBranchRootMarkerPositionForGeneratedMedia(
            threadId,
            generationRun,
            markerDimensions,
            mediaHeight,
            this.ports.settings.rootToFirstMediaGap,
        )
        const basePosition = referenceRootPosition
            ? referenceRootPosition
            : this.ports.geometry.getFreshBranchRootMarkerPosition(markerDimensions)

        if (!siblingSlot)
            return basePosition

        const stackGap = normalizeBranchLineageNodeGap(this.ports.settings.nodeGap)
        const stackStep = markerDimensions.height + stackGap
        const stackHeight = siblingSlot.count * markerDimensions.height
            + Math.max(0, siblingSlot.count - 1) * stackGap

        return {
            x: basePosition.x,
            y: basePosition.y - stackHeight / 2
                + markerDimensions.height / 2
                + siblingSlot.index * stackStep,
        }
    }

    getPendingBranchMarkerPositionBeforeGeneratedMedia(
        parentNode: CanvasNode,
        markerDimensions: {
            width: number
            height: number
        },
        siblingSlot?: {
            index: number
            count: number
        },
    ): {
        x: number
        y: number
    } {
        const nodesById = this.getCanvasNodesById(this.ports.readCanvasState()?.nodes ?? [])
        const parentPosition = this.ports.getWorldPosition(parentNode, nodesById)
        const parentRect = this.ports.geometry.getCanvasNodeConnectorAnchorRect(parentNode, parentPosition)
        const mediaSize = this.ports.geometry.getGeneratedMediaInsertionSize()
        const mediaDimensions = {
            width: mediaSize,
            height: mediaSize,
        }
        const siblingCount = siblingSlot?.count ?? 1
        const mediaGapBase = parentNode.type === 'branchOrigin'
            ? this.ports.settings.branchOriginToFirstMediaGap
            : this.ports.settings.mediaToMediaGap
        const mediaGap = mediaGapBase + this.ports.settings.branchFanoutExtraGap * Math.max(0, siblingCount - 1)
        const futureMediaPosition = computeCenteredPositionToRightOfRect(
            parentRect,
            mediaDimensions.height,
            mediaGap,
        )
        const futureCircleInset = this.ports.geometry.getPendingGeneratedMediaBeforeFrameCircleInset(mediaDimensions)
        const futureCircleLeft = futureMediaPosition.x + futureCircleInset.x
        const futureCircleStep = futureCircleInset.size + this.ports.settings.branchRowGap
        const futureCircleStackHeight = futureCircleInset.size * siblingCount
            + this.ports.settings.branchRowGap * Math.max(0, siblingCount - 1)
        const firstCircleCenterY = parentRect.y + parentRect.height / 2
            - futureCircleStackHeight / 2
            + futureCircleInset.size / 2
        const futureCircleCenterY = siblingSlot
            ? firstCircleCenterY + futureCircleStep * siblingSlot.index
            : futureMediaPosition.y + futureCircleInset.y + futureCircleInset.size / 2
        const parentAnchorX = parentRect.x + parentRect.width
        const parentAnchorY = parentRect.y + parentRect.height / 2

        if (parentNode.type === 'branchOrigin') {
            const stackIndex = siblingSlot?.index ?? 0
            const stackGap = normalizeBranchLineageNodeGap(this.ports.settings.nodeGap)

            return {
                x: (parentAnchorX + futureCircleLeft) / 2 - markerDimensions.width / 2,
                y: parentRect.y + parentRect.height
                    + stackGap
                    + stackIndex * (markerDimensions.height + stackGap),
            }
        }

        return {
            x: (parentAnchorX + futureCircleLeft) / 2 - markerDimensions.width / 2,
            y: (parentAnchorY + futureCircleCenterY) / 2 - markerDimensions.height / 2,
        }
    }

    getReferenceGroupRectForGeneratedMedia(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): Rect | undefined {
        const placement = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)
        const state = this.ports.readCanvasState()

        if (
            !placement?.referenceNodeIds?.length
            || !state
        )
            return undefined

        const nodesById = this.getCanvasNodesById(state.nodes)
        const referenceRects = placement.referenceNodeIds
            .map((nodeId: string) => nodesById.get(nodeId))
            .filter(
                (node: CanvasNode | undefined): node is ImageCanvasNode | VideoCanvasNode => Boolean(
                    node && (node.type === 'image' || node.type === 'video'),
                ),
            )
            .map((node: ImageCanvasNode | VideoCanvasNode) => this.getNodeWorldRect(node, nodesById))

        if (referenceRects.length === 0)
            return undefined

        const minX = Math.min(...referenceRects.map((rect: Rect) => rect.x))
        const minY = Math.min(...referenceRects.map((rect: Rect) => rect.y))
        const maxX = Math.max(...referenceRects.map((rect: Rect) => rect.x + rect.width))
        const maxY = Math.max(...referenceRects.map((rect: Rect) => rect.y + rect.height))

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        }
    }

    getReferenceBranchRootMarkerPositionForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        markerDimensions: {
            width: number
            height: number
        },
        mediaHeight: number,
        markerToMediaGap: number,
    ): {
        x: number
        y: number
    } | undefined {
        const referenceGroupRect = this.getReferenceGroupRectForGeneratedMedia(threadId, generationRun)

        if (!referenceGroupRect)
            return undefined

        return computeReferenceBranchRootMarkerPosition({
            referenceGroupRect,
            mediaHeight,
            markerDimensions,
            rootToFirstMediaGap: this.ports.settings.rootToFirstMediaGap,
            markerToMediaGap,
            referenceToMarkerMinGap: normalizeBranchLineageNodeGap(this.ports.settings.nodeGap),
        })
    }

    getNextGeneratedMediaPosition(
        sourceNode: CanvasNode,
        mediaHeight: number,
    ): {
        x: number
        y: number
    } {
        const nodes = this.ports.readCanvasState()?.nodes || []
        const edges = this.ports.readCanvasState()?.edges ?? []
        const existingMediaOutputs = this.getGeneratedMediaOutputs(
            sourceNode,
            nodes,
            edges,
        )
        const previousOutput = this.getMostRecentGeneratedMediaOutput(existingMediaOutputs)
        const anchorRect = previousOutput ? this.getNodeWorldRect(previousOutput) : this.getNodeWorldRect(sourceNode)

        return computeCenteredPositionToRightOfRect(
            anchorRect,
            mediaHeight,
            previousOutput ? this.ports.settings.mediaToMediaGap : this.getGeneratedMediaOutputGap(sourceNode),
        )
    }

    getGeneratedMediaOutputs(
        sourceNode: CanvasNode,
        nodes: CanvasNode[],
        edges: WorkspaceEdge[],
    ): (ImageCanvasNode | VideoCanvasNode)[] {
        return nodes.filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode => {
            if (
                (node.type !== 'image' && node.type !== 'video')
                || node.parentId
            )
                return false

            if (!node.generatedBy)
                return false

            return edges.some((edge: WorkspaceEdge) => edge.sourceNodeId === sourceNode.nodeId && edge.targetNodeId === node.nodeId)
        })
    }

    getMostRecentGeneratedMediaOutput(outputs: (ImageCanvasNode | VideoCanvasNode)[]): ImageCanvasNode | VideoCanvasNode | undefined {
        return [...outputs].sort((a: ImageCanvasNode | VideoCanvasNode, b: ImageCanvasNode | VideoCanvasNode) => {
            const createdAtDelta = (a.generatedBy?.createdAt ?? 0) - (b.generatedBy?.createdAt ?? 0)

            if (createdAtDelta !== 0)
                return createdAtDelta

            return a.position.x - b.position.x
        }).at(-1)
    }

    createGeneratedImageEdge(
        sourceNode: CanvasNode,
        imageNodeId: string,
        responseMessageId?: string,
    ): WorkspaceEdge {
        return {
            edgeId: `edge-${sourceNode.nodeId}-${imageNodeId}`,
            sourceNodeId: sourceNode.nodeId,
            targetNodeId: imageNodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
        }
    }

    getLineageAssignmentReasoningIndex(
        lineagePlan: MediaBranchLineagePlan,
        lineageAssignment: MediaRunLineageAssignment,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): number {
        if (
            sourceGenerationRun
            && sourceGenerationRun.reasoningRunId === lineageAssignment.reasoningRunId
        )
            return sourceGenerationRun.reasoningIndex

        const branchForkPlan = this.findBranchForkPlanForRun(lineagePlan, lineageAssignment.branchForkNodeId)

        if (branchForkPlan)
            return branchForkPlan.reasoningIndex

        const branchLinePlan = this.findBranchLinePlanForRun(lineagePlan, lineageAssignment.branchLineNodeId)

        if (branchLinePlan)
            return branchLinePlan.reasoningIndex

        return 0
    }

    buildGenerationRunFromLineageAssignment(
        lineagePlan: MediaBranchLineagePlan,
        lineageAssignment: MediaRunLineageAssignment,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): MediaGenerationRunMeta | undefined {
        if (
            !lineageAssignment.reasoningRunId
            || !lineageAssignment.reasoningModelId
        )
            return undefined

        return {
            requestKind: sourceGenerationRun?.requestKind ?? 'media-generation-matrix',
            generationRequestId: lineageAssignment.generationRequestId,
            reasoningRunId: lineageAssignment.reasoningRunId,
            ...(lineageAssignment.mediaRunId ? { mediaRunId: lineageAssignment.mediaRunId } : {}),
            reasoningModelId: lineageAssignment.reasoningModelId,
            ...(lineageAssignment.mediaModelId ? { mediaModelId: lineageAssignment.mediaModelId } : {}),
            ...(lineageAssignment.mediaType ? { mediaType: lineageAssignment.mediaType } : {}),
            reasoningIndex: this.getLineageAssignmentReasoningIndex(
                lineagePlan,
                lineageAssignment,
                sourceGenerationRun,
            ),
            lineageAssignment,
        }
    }

    getLineageAssignmentMarkerKey(assignment: MediaRunLineageAssignment): string | undefined {
        return assignment.branchForkNodeId
            ?? assignment.branchLineNodeId
            ?? assignment.branchOriginNodeId
            ?? assignment.reasoningRunId
            ?? assignment.mediaRunId
    }

    getUniqueLineageAssignmentsForMarkers(lineagePlan: MediaBranchLineagePlan): MediaRunLineageAssignment[] {
        const assignments: MediaRunLineageAssignment[] = []
        const seen = new Set<string>()

        for (const assignment of lineagePlan.runAssignments) {
            const markerKey = this.getLineageAssignmentMarkerKey(assignment)

            if (
                !markerKey
                || seen.has(markerKey)
            )
                continue

            seen.add(markerKey)
            assignments.push(assignment)
        }

        return assignments
    }

    getRelatedLineageAssignments(
        lineagePlan: MediaBranchLineagePlan,
        assignment: MediaRunLineageAssignment,
    ): MediaRunLineageAssignment[] {
        const markerKey = this.getLineageAssignmentMarkerKey(assignment)

        return lineagePlan.runAssignments.filter(
            candidate =>
                (markerKey && this.getLineageAssignmentMarkerKey(candidate) === markerKey)
                || (assignment.reasoningRunId && candidate.reasoningRunId === assignment.reasoningRunId),
        )
    }
}
