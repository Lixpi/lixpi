'use strict'

import {
    estimateBranchMarkerDimensions,
    getGeneratedMediaChromeCollisionHeight,
    getPendingGeneratedMediaNodeId,
    rebalanceBranchTreesAndResolve,
} from '@lixpi/canvas-engine'
import type {
    AiModelId,
    BranchForkCanvasNode,
    BranchForkLineagePlan,
    BranchLineCanvasNode,
    BranchLineLineagePlan,
    BranchOriginCanvasNode,
    BranchOriginLineagePlan,
    CanvasGeometryUpdate,
    CanvasNode,
    CanvasNodeGeometry,
    CanvasState,
    ImageCanvasNode,
    MediaBranchLineagePlan,
    MediaGenerationRunMeta,
    MediaRunLineageAssignment,
    VideoCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'
import {
    getBranchMarkerConversationPreviewFromThreadContent,
    shouldShowBranchMarkerConversationResponseLine,
    type BranchMarkerTurnDescriptor,
} from '@lixpi/prosemirror/shared/thread-doc'

import Workspace from '../models/workspace.ts'
import { settings } from '../settings.ts'

type MarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
type CanvasVisibleArea = { width: number; height: number }
type ProjectionContext = { proseMirrorThreadContent?: unknown }

const layout = settings.mediaGenerationCanvasProjection
const collision = settings.workspaceCollision.branchTree

const isMarkerNode = (node: CanvasNode): node is MarkerNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const findNode = (nodes: CanvasNode[], nodeId: string | undefined): CanvasNode | undefined =>
    nodeId ? nodes.find((node) => node.nodeId === nodeId) : undefined

const markerTurnDescriptor = (node: MarkerNode): BranchMarkerTurnDescriptor => ({
    generationRequestId: node.generationRequestId,
    ...(node.type !== 'branchOrigin' && node.reasoningRunId ? { reasoningRunId: node.reasoningRunId } : {}),
    ...(node.type !== 'branchOrigin' && node.reasoningModelId ? { reasoningModelId: node.reasoningModelId } : {}),
    reasoningIndex: node.type === 'branchOrigin' ? null : node.reasoningIndex ?? null,
    markerNodeId: node.nodeId,
    markerNodeAttr: node.type === 'branchOrigin'
        ? 'branchOriginNodeId'
        : node.type === 'branchFork'
            ? 'branchForkNodeId'
            : 'branchLineNodeId',
})

const markerDimensions = (node: MarkerNode, context: ProjectionContext = {}): { width: number; height: number } => {
    const preview = node.conversationAssetId && context.proseMirrorThreadContent
        ? getBranchMarkerConversationPreviewFromThreadContent(
            context.proseMirrorThreadContent,
            node.conversationAssetId,
            markerTurnDescriptor(node),
        )
        : null
    const promptText = preview?.userText || node.provenance?.promptText || node.pendingState?.promptText || ''
    if (!promptText) return { width: layout.markerWidth, height: layout.markerHeight }
    return estimateBranchMarkerDimensions(promptText, {
        responseLine: shouldShowBranchMarkerConversationResponseLine(preview),
        responseText: preview?.responseText ?? '',
    })
}

const fallbackPosition = (
    state: CanvasState,
    dimensions: { width: number; height: number },
    index: number,
    visibleArea?: CanvasVisibleArea,
): { x: number; y: number } => {
    const viewport = (state as CanvasState & { viewport?: { x: number; y: number; zoom: number } }).viewport
    const zoom = Number.isFinite(viewport?.zoom) && Number(viewport?.zoom) > 0 ? Number(viewport?.zoom) : 1
    const left = -(Number(viewport?.x) || 0) / zoom
    const top = -(Number(viewport?.y) || 0) / zoom
    const paneHeight = Number.isFinite(visibleArea?.height) ? Number(visibleArea?.height) / zoom : layout.serverFallbackPaneHeight
    return {
        x: left + layout.nodeGap,
        y: top + Math.max(layout.nodeGap, (paneHeight - dimensions.height) / 2)
            + index * (dimensions.height + layout.branchRowGap),
    }
}

const positionRightOf = (
    source: CanvasNode | undefined,
    state: CanvasState,
    dimensions: { width: number; height: number },
    index: number,
    visibleArea?: CanvasVisibleArea,
): { x: number; y: number } => source
    ? {
        x: source.position.x + source.dimensions.width + layout.rootToFirstMediaGap,
        y: source.position.y + (source.dimensions.height - dimensions.height) / 2,
    }
    : fallbackPosition(state, dimensions, index, visibleArea)

const upsertNode = (nodes: CanvasNode[], next: CanvasNode): { nodes: CanvasNode[]; changed: boolean } => {
    const index = nodes.findIndex((node) => node.nodeId === next.nodeId)
    if (index < 0) return { nodes: [...nodes, next], changed: true }
    const existing = nodes[index]!
    const merged = {
        ...existing,
        ...next,
        position: existing.position,
        dimensions: existing.dimensions,
    } as CanvasNode
    if (JSON.stringify(existing) === JSON.stringify(merged)) return { nodes, changed: false }
    return { nodes: nodes.map((node, nodeIndex) => nodeIndex === index ? merged : node), changed: true }
}

const addEdge = (edges: WorkspaceEdge[], sourceNodeId: string | undefined, targetNodeId: string): {
    edges: WorkspaceEdge[]
    changed: boolean
} => {
    if (!sourceNodeId) return { edges, changed: false }
    const edgeId = `edge-${sourceNodeId}-${targetNodeId}`
    if (edges.some((edge) => edge.edgeId === edgeId)) return { edges, changed: false }
    return {
        edges: [...edges, {
            edgeId,
            sourceNodeId,
            targetNodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
        }],
        changed: true,
    }
}

const baseMarkerPosition = (
    nodes: CanvasNode[],
    state: CanvasState,
    parentNodeId: string | undefined,
    dimensions: { width: number; height: number },
    index: number,
    visibleArea?: CanvasVisibleArea,
): { x: number; y: number } => positionRightOf(findNode(nodes, parentNodeId), state, dimensions, index, visibleArea)

const branchOriginFromPlan = (
    plan: BranchOriginLineagePlan,
    conversationAssetId: string,
    state: CanvasState,
    anchorNodeId: string | undefined,
    visibleArea?: CanvasVisibleArea,
): BranchOriginCanvasNode => {
    const provisional = {
        nodeId: plan.nodeId,
        type: 'branchOrigin',
        branchId: plan.branchId,
        generationRequestId: plan.generationRequestId,
        conversationAssetId,
        ...(plan.promptFingerprint ? { promptFingerprint: plan.promptFingerprint } : {}),
        provenance: plan.provenance,
        position: { x: 0, y: 0 },
        dimensions: { width: layout.markerWidth, height: layout.markerHeight },
        temporary: true,
    } satisfies BranchOriginCanvasNode
    const dimensions = markerDimensions(provisional)
    return {
        ...provisional,
        dimensions,
        position: baseMarkerPosition(state.nodes, state, anchorNodeId, dimensions, state.nodes.length, visibleArea),
    }
}

const branchForkFromPlan = (
    plan: BranchForkLineagePlan,
    conversationAssetId: string,
    state: CanvasState,
    nodes: CanvasNode[],
    visibleArea?: CanvasVisibleArea,
): BranchForkCanvasNode => {
    const provisional = {
        nodeId: plan.nodeId,
        type: 'branchFork',
        branchId: plan.branchId,
        generationRequestId: plan.generationRequestId,
        conversationAssetId,
        reasoningRunId: plan.reasoningRunId,
        reasoningModelId: plan.reasoningModelId,
        reasoningIndex: plan.reasoningIndex,
        ...(plan.parentBranchNodeId ? { parentBranchNodeId: plan.parentBranchNodeId } : {}),
        ...(plan.promptFingerprint ? { promptFingerprint: plan.promptFingerprint } : {}),
        provenance: plan.provenance,
        position: { x: 0, y: 0 },
        dimensions: { width: layout.markerWidth, height: layout.markerHeight },
        temporary: true,
    } satisfies BranchForkCanvasNode
    const dimensions = markerDimensions(provisional)
    return {
        ...provisional,
        dimensions,
        position: baseMarkerPosition(nodes, state, plan.parentBranchNodeId, dimensions, nodes.length, visibleArea),
    }
}

const branchLineFromPlan = (
    plan: BranchLineLineagePlan,
    conversationAssetId: string,
    state: CanvasState,
    nodes: CanvasNode[],
    visibleArea?: CanvasVisibleArea,
): BranchLineCanvasNode => {
    const provisional = {
        nodeId: plan.nodeId,
        type: 'branchLine',
        branchId: plan.branchId,
        generationRequestId: plan.generationRequestId,
        conversationAssetId,
        reasoningRunId: plan.reasoningRunId,
        reasoningModelId: plan.reasoningModelId,
        reasoningIndex: plan.reasoningIndex,
        ...(plan.mediaRunId ? { mediaRunId: plan.mediaRunId } : {}),
        ...(plan.mediaModelId ? { mediaModelId: plan.mediaModelId } : {}),
        ...(plan.mediaType ? { mediaType: plan.mediaType } : {}),
        parentBranchNodeId: plan.parentBranchNodeId,
        ...(plan.promptFingerprint ? { promptFingerprint: plan.promptFingerprint } : {}),
        provenance: plan.provenance,
        position: { x: 0, y: 0 },
        dimensions: { width: layout.markerWidth, height: layout.markerHeight },
        temporary: true,
    } satisfies BranchLineCanvasNode
    const dimensions = markerDimensions(provisional)
    return {
        ...provisional,
        dimensions,
        position: baseMarkerPosition(nodes, state, plan.parentBranchNodeId, dimensions, nodes.length, visibleArea),
    }
}

const markerNodesFromPlan = (
    plan: MediaBranchLineagePlan,
    conversationAssetId: string,
    state: CanvasState,
    visibleArea?: CanvasVisibleArea,
): MarkerNode[] => {
    const markers: MarkerNode[] = []
    if (plan.branchOrigin) {
        markers.push(branchOriginFromPlan(
            plan.branchOrigin,
            conversationAssetId,
            state,
            plan.placementAnchorNodeId ?? plan.sourceNodeId,
            visibleArea,
        ))
    }
    for (const fork of plan.branchForks) {
        markers.push(branchForkFromPlan(fork, conversationAssetId, state, [...state.nodes, ...markers], visibleArea))
    }
    for (const line of plan.branchLines) {
        markers.push(branchLineFromPlan(line, conversationAssetId, state, [...state.nodes, ...markers], visibleArea))
    }
    return markers
}

const ensureMarkers = (state: CanvasState, markers: MarkerNode[]): { state: CanvasState; changed: boolean } => {
    let nodes = state.nodes
    let edges = state.edges ?? []
    let changed = false
    for (const marker of markers) {
        const nodeResult = upsertNode(nodes, marker)
        nodes = nodeResult.nodes
        changed ||= nodeResult.changed
        if (marker.type !== 'branchOrigin') {
            const edgeResult = addEdge(edges, marker.parentBranchNodeId, marker.nodeId)
            edges = edgeResult.edges
            changed ||= edgeResult.changed
        }
    }
    return { state: { ...state, nodes, edges }, changed }
}

const collisionSettingsFor = (node: CanvasNode) => {
    switch (node.type) {
        case 'image': return collision.nodeTypes.image
        case 'video': return collision.nodeTypes.video
        case 'branchOrigin': return collision.nodeTypes.branchOrigin
        case 'branchFork': return collision.nodeTypes.branchFork
        case 'branchLine': return collision.nodeTypes.branchLine
        default: return collision.nodeTypes.document
    }
}

const getPendingMediaLayoutRect = (
    node: GeneratedMediaNode,
    position: { x: number; y: number },
): { x: number; y: number; width: number; height: number } => {
    const configuredScale = Number(layout.preFrameCircleScale)
    const scale = Number.isFinite(configuredScale) && configuredScale > 0
        ? Math.min(1, configuredScale)
        : 1 / 3
    const size = Math.max(1, Math.min(node.dimensions.width, node.dimensions.height) * scale)
    return {
        x: position.x + (node.dimensions.width - size) / 2,
        y: position.y + (node.dimensions.height - size) / 2,
        width: size,
        height: size,
    }
}

const rebalance = (
    state: CanvasState,
    context: ProjectionContext = {},
    pendingMediaNodeIds: ReadonlySet<string> = new Set(),
): { state: CanvasState; changed: boolean } => {
    const resizedNodes = state.nodes.map((node): CanvasNode => {
        if (!isMarkerNode(node)) return node
        const dimensions = markerDimensions(node, context)
        return dimensions.width === node.dimensions.width && dimensions.height === node.dimensions.height
            ? node
            : { ...node, dimensions }
    })
    const nodes = rebalanceBranchTreesAndResolve(resizedNodes, state.edges ?? [], {
        depthGap: layout.mediaToMediaGap,
        branchOriginDepthGap: layout.branchOriginToFirstMediaGap,
        rootMarkerDepthGap: layout.rootToFirstMediaGap,
        siblingGap: layout.branchRowGap,
        branchFanoutExtraGap: layout.branchFanoutExtraGap,
        getBranchFanoutExtraGap: (_parentNode, childNodes) =>
            childNodes.length > 0 && childNodes.every((node) => pendingMediaNodeIds.has(node.nodeId))
                ? 0
                : layout.branchFanoutExtraGap,
        branchOriginMarkerStackGap: layout.nodeGap,
        collisionIterations: Math.max(...Object.values(collision.nodeTypes).map((entry) => entry.iterations)),
        collisionMargin: 0,
        getNodeCollisionRect: (node, position) =>
            pendingMediaNodeIds.has(node.nodeId) && (node.type === 'image' || node.type === 'video')
                ? getPendingMediaLayoutRect(node, position)
                : {
                    x: position.x,
                    y: position.y,
                    width: node.dimensions.width,
                    height: node.dimensions.height + (
                        node.type === 'image' || node.type === 'video'
                            ? getGeneratedMediaChromeCollisionHeight(node.type)
                            : 0
                    ),
                },
        getNodeConnectorAnchorRect: (node, position) =>
            pendingMediaNodeIds.has(node.nodeId) && (node.type === 'image' || node.type === 'video')
                ? getPendingMediaLayoutRect(node, position)
                : {
                    x: position.x,
                    y: position.y,
                    width: node.dimensions.width,
                    height: node.dimensions.height,
                },
        getNodeCollisionMargin: (node) => isMarkerNode(node) ? layout.nodeGap : collisionSettingsFor(node).margin,
        getNodeCollisionOverlapThreshold: (node) => collisionSettingsFor(node).overlapThreshold,
    })
    return {
        state: { ...state, nodes },
        changed: JSON.stringify(state.nodes) !== JSON.stringify(nodes),
    }
}

const geometryDiff = (before: CanvasState, after: CanvasState): CanvasNodeGeometry[] => {
    const beforeById = new Map(before.nodes.map((node) => [node.nodeId, node]))
    return after.nodes.flatMap((node): CanvasNodeGeometry[] => {
        const previous = beforeById.get(node.nodeId)
        if (
            previous
            && previous.position.x === node.position.x
            && previous.position.y === node.position.y
            && previous.dimensions.width === node.dimensions.width
            && previous.dimensions.height === node.dimensions.height
            && previous.parentId === node.parentId
        ) return []
        return [{
            nodeId: node.nodeId,
            position: node.position,
            dimensions: node.dimensions,
            ...(node.parentId ? { parentNodeId: node.parentId } : {}),
        }]
    })
}

export const buildAssetCanvasGeometryUpdate = ({
    state,
    layoutRevision,
    generationRequestId,
    geometryNodes,
    removedNodeIds = [],
}: {
    state: CanvasState
    layoutRevision: number
    generationRequestId: string
    geometryNodes: CanvasNodeGeometry[]
    removedNodeIds?: string[]
}): CanvasGeometryUpdate => {
    const geometryNodeIds = new Set(geometryNodes.map((node) => node.nodeId))
    const removed = new Set(removedNodeIds)
    const nodeSnapshots = state.nodes.filter((node) =>
        !removed.has(node.nodeId)
        && (
            geometryNodeIds.has(node.nodeId)
            || (isMarkerNode(node) && node.generationRequestId === generationRequestId)
            || ((node.type === 'image' || node.type === 'video')
                && node.generatedBy?.generationRequestId === generationRequestId)
        )
    )
    const snapshotIds = new Set(nodeSnapshots.map((node) => node.nodeId))
    const edgeSnapshots = (state.edges ?? []).filter((edge) =>
        !removed.has(edge.sourceNodeId)
        && !removed.has(edge.targetNodeId)
        && (snapshotIds.has(edge.sourceNodeId) || snapshotIds.has(edge.targetNodeId))
    )
    return {
        generationRequestId,
        layoutRevision,
        nodes: geometryNodes,
        ...(nodeSnapshots.length ? { nodeSnapshots } : {}),
        ...(edgeSnapshots.length ? { edgeSnapshots } : {}),
        ...(removedNodeIds.length ? { removedNodeIds: [...new Set(removedNodeIds)] } : {}),
    }
}

export const upsertMediaLineagePlanToCanvas = async (params: {
    workspaceId: string
    conversationAssetId: string
    lineagePlan: MediaBranchLineagePlan
    canvasVisibleArea?: CanvasVisibleArea
    proseMirrorThreadContent?: unknown
}): Promise<CanvasGeometryUpdate | null> => {
    let geometryNodes: CanvasNodeGeometry[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertAssetMediaLineagePlanToCanvas',
        mutate: (canvasState) => {
            const markers = markerNodesFromPlan(
                params.lineagePlan,
                params.conversationAssetId,
                canvasState,
                params.canvasVisibleArea,
            )
            const markerResult = ensureMarkers(canvasState, markers)
            const balanced = rebalance(markerResult.state, { proseMirrorThreadContent: params.proseMirrorThreadContent })
            geometryNodes = geometryDiff(canvasState, balanced.state)
            return { canvasState: balanced.state, changed: markerResult.changed || balanced.changed }
        },
    })
    if (!result.canvasState || result.canvasStateUpdatedAt === null) return null
    return buildAssetCanvasGeometryUpdate({
        state: result.canvasState,
        layoutRevision: result.canvasStateUpdatedAt,
        generationRequestId: params.lineagePlan.generationRequestId,
        geometryNodes,
    })
}

export const refreshMediaGenerationRequestCanvasGeometry = async (params: {
    workspaceId: string
    generationRequestId: string
    proseMirrorThreadContent?: unknown
}): Promise<CanvasGeometryUpdate | null> => {
    let geometryNodes: CanvasNodeGeometry[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'refreshAssetMediaGenerationCanvasGeometry',
        mutate: (canvasState) => {
            if (!canvasState.nodes.some((node) => isMarkerNode(node) && node.generationRequestId === params.generationRequestId)) {
                return { canvasState, changed: false }
            }
            const balanced = rebalance(canvasState, { proseMirrorThreadContent: params.proseMirrorThreadContent })
            geometryNodes = geometryDiff(canvasState, balanced.state)
            return { canvasState: balanced.state, changed: balanced.changed }
        },
    })
    if (!result.changed || !result.canvasState || result.canvasStateUpdatedAt === null) return null
    return buildAssetCanvasGeometryUpdate({
        state: result.canvasState,
        layoutRevision: result.canvasStateUpdatedAt,
        generationRequestId: params.generationRequestId,
        geometryNodes,
    })
}

export const settleMediaGenerationRequestOnCanvas = async (params: {
    workspaceId: string
    generationRequestId: string
    proseMirrorThreadContent?: unknown
    removeProjectedPendingNodes?: boolean
    lineagePlan?: MediaBranchLineagePlan
}): Promise<CanvasGeometryUpdate | null> => {
    let geometryNodes: CanvasNodeGeometry[] = []
    const candidateRemovedNodeIds = params.removeProjectedPendingNodes
        ? (params.lineagePlan?.runAssignments ?? []).map((assignment) => getPendingGeneratedMediaNodeId(assignment))
        : []
    let removedNodeIds: string[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'settleAssetMediaGenerationCanvas',
        mutate: (canvasState) => {
            const persistedPendingIds = new Set(candidateRemovedNodeIds)
            removedNodeIds = canvasState.nodes
                .filter((node) => persistedPendingIds.has(node.nodeId) && !('assetId' in node && node.assetId))
                .map((node) => node.nodeId)
            const removableIds = new Set(removedNodeIds)
            const stateWithoutPending = removableIds.size
                ? {
                    ...canvasState,
                    nodes: canvasState.nodes.filter((node) => !removableIds.has(node.nodeId)),
                    edges: (canvasState.edges ?? []).filter((edge) =>
                        !removableIds.has(edge.sourceNodeId) && !removableIds.has(edge.targetNodeId)
                    ),
                }
                : canvasState
            const balanced = rebalance(stateWithoutPending, { proseMirrorThreadContent: params.proseMirrorThreadContent })
            geometryNodes = geometryDiff(canvasState, balanced.state)
            return {
                canvasState: balanced.state,
                changed: stateWithoutPending !== canvasState || balanced.changed,
            }
        },
    })
    if (!result.canvasState || result.canvasStateUpdatedAt === null) return null
    if (!result.changed && removedNodeIds.length === 0) return null
    return buildAssetCanvasGeometryUpdate({
        state: result.canvasState,
        layoutRevision: result.canvasStateUpdatedAt,
        generationRequestId: params.generationRequestId,
        geometryNodes,
        removedNodeIds,
    })
}

const generatedByLineage = (assignment: MediaRunLineageAssignment) => ({
    generationRequestId: assignment.generationRequestId,
    ...(assignment.reasoningRunId ? { reasoningRunId: assignment.reasoningRunId } : {}),
    ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
    ...(assignment.reasoningModelId ? { reasoningModelId: assignment.reasoningModelId } : {}),
    ...(assignment.reasoningIndex !== undefined ? { reasoningIndex: assignment.reasoningIndex } : {}),
    ...(assignment.mediaModelId ? { mediaModelId: assignment.mediaModelId } : {}),
    ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
    ...(assignment.mediaIndex !== undefined ? { mediaIndex: assignment.mediaIndex } : {}),
    branchId: assignment.branchId,
    ...(assignment.parentMediaNodeId ? { parentMediaNodeId: assignment.parentMediaNodeId } : {}),
    ...(assignment.parentImageNodeId ? { parentImageNodeId: assignment.parentImageNodeId } : {}),
    ...(assignment.branchOriginNodeId ? { branchOriginNodeId: assignment.branchOriginNodeId } : {}),
    ...(assignment.branchForkNodeId ? { branchForkNodeId: assignment.branchForkNodeId } : {}),
    ...(assignment.branchLineNodeId ? { branchLineNodeId: assignment.branchLineNodeId } : {}),
    ...(assignment.lineageParentNodeId ? { lineageParentNodeId: assignment.lineageParentNodeId } : {}),
    referenceImageNodeIds: assignment.referenceNodeIds,
    sourceContextNodeIds: assignment.sourceContextNodeIds,
    ...(assignment.operationKind ? { operationKind: assignment.operationKind } : {}),
    promptText: assignment.promptText,
    ...(assignment.promptFingerprint ? { promptFingerprint: assignment.promptFingerprint } : {}),
    createdAt: assignment.createdAt,
})

const markerNodesFromAssignment = (
    assignment: MediaRunLineageAssignment,
    conversationAssetId: string,
    state: CanvasState,
): MarkerNode[] => {
    const promptText = assignment.promptText
    const plan: MediaBranchLineagePlan = {
        planVersion: 'media-branch-lineage-v1',
        generationRequestId: assignment.generationRequestId,
        branchId: assignment.branchId,
        promptText,
        ...(assignment.promptFingerprint ? { promptFingerprint: assignment.promptFingerprint } : {}),
        referenceNodeIds: assignment.referenceNodeIds,
        sourceContextNodeIds: assignment.sourceContextNodeIds,
        ...(assignment.branchOriginNodeId ? {
            branchOrigin: {
                nodeId: assignment.branchOriginNodeId,
                generationRequestId: assignment.generationRequestId,
                branchId: assignment.branchId,
                provenance: {
                    kind: 'branch-root-fork-decision',
                    promptText,
                    referenceNodeIds: assignment.referenceNodeIds,
                    sourceContextNodeIds: assignment.sourceContextNodeIds,
                    forked: Boolean(assignment.branchForkNodeId),
                    forkCount: assignment.branchForkNodeId ? 1 : 0,
                },
            },
        } : {}),
        branchForks: assignment.branchForkNodeId ? [{
            nodeId: assignment.branchForkNodeId,
            generationRequestId: assignment.generationRequestId,
            branchId: assignment.branchId,
            ...(assignment.branchOriginNodeId ? { parentBranchNodeId: assignment.branchOriginNodeId } : {}),
            reasoningRunId: assignment.reasoningRunId ?? '',
            reasoningModelId: (assignment.reasoningModelId ?? '') as AiModelId,
            reasoningIndex: assignment.reasoningIndex ?? 0,
            provenance: {
                kind: 'reasoning-run',
                promptText,
                referenceNodeIds: assignment.referenceNodeIds,
                sourceContextNodeIds: assignment.sourceContextNodeIds,
                reasoningRunId: assignment.reasoningRunId ?? '',
                reasoningModelId: (assignment.reasoningModelId ?? '') as AiModelId,
                reasoningIndex: assignment.reasoningIndex ?? 0,
            },
        }] : [],
        branchLines: assignment.branchLineNodeId ? [{
            nodeId: assignment.branchLineNodeId,
            generationRequestId: assignment.generationRequestId,
            branchId: assignment.branchId,
            parentBranchNodeId: assignment.parentMediaNodeId ?? assignment.branchOriginNodeId ?? '',
            reasoningRunId: assignment.reasoningRunId ?? '',
            reasoningModelId: (assignment.reasoningModelId ?? '') as AiModelId,
            reasoningIndex: assignment.reasoningIndex ?? 0,
            ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
            ...(assignment.mediaModelId ? { mediaModelId: assignment.mediaModelId } : {}),
            ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
            provenance: {
                kind: 'branch-continuation',
                promptText,
                referenceNodeIds: assignment.referenceNodeIds,
                sourceContextNodeIds: assignment.sourceContextNodeIds,
                reasoningRunId: assignment.reasoningRunId ?? '',
                reasoningModelId: (assignment.reasoningModelId ?? '') as AiModelId,
                reasoningIndex: assignment.reasoningIndex ?? 0,
                ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
                ...(assignment.mediaModelId ? { mediaModelId: assignment.mediaModelId } : {}),
                ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
            },
        }] : [],
        runAssignments: [assignment],
        createdAt: assignment.createdAt,
    }
    return markerNodesFromPlan(plan, conversationAssetId, state)
}

export const projectGeneratedAssetNode = ({
    canvasState,
    assetId,
    kind,
    aspectRatio,
    generationRun,
    conversationAssetId,
    pendingBeforeFirstFrame = false,
}: {
    canvasState: CanvasState
    assetId: string
    kind: 'image' | 'video'
    aspectRatio: number
    generationRun: MediaGenerationRunMeta
    conversationAssetId: string
    pendingBeforeFirstFrame?: boolean
}): { canvasState: CanvasState; nodeId: string; geometryNodes: CanvasNodeGeometry[] } => {
    const assignment = generationRun.lineageAssignment
    if (!assignment) throw new Error('Generated Asset canvas projection requires a lineage assignment')
    const markerResult = ensureMarkers(
        canvasState,
        markerNodesFromAssignment(assignment, conversationAssetId, canvasState),
    )
    const nodeId = getPendingGeneratedMediaNodeId(assignment)
    const existing = markerResult.state.nodes.find((node) => node.nodeId === nodeId) as GeneratedMediaNode | undefined
    const width = existing?.dimensions.width ?? layout.generatedMediaSize
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
    const dimensions = { width, height: width / safeAspectRatio }
    const lineageParentNodeId = assignment.lineageParentNodeId
        ?? assignment.branchLineNodeId
        ?? assignment.branchForkNodeId
        ?? assignment.parentMediaNodeId
        ?? assignment.branchOriginNodeId
    const source = findNode(markerResult.state.nodes, lineageParentNodeId)
    const position = existing
        ? {
            x: existing.position.x + (existing.dimensions.width - dimensions.width) / 2,
            y: existing.position.y + (existing.dimensions.height - dimensions.height) / 2,
        }
        : positionRightOf(source, markerResult.state, dimensions, markerResult.state.nodes.length)
    const lineage = generatedByLineage(assignment)
    const node: GeneratedMediaNode = kind === 'image'
        ? {
            nodeId,
            type: 'image',
            assetId,
            position,
            dimensions,
            generatedBy: {
                conversationAssetId,
                responseId: '',
                aiModel: generationRun.reasoningModelId,
                revisedPrompt: assignment.promptText,
                ...lineage,
            },
        }
        : {
            nodeId,
            type: 'video',
            assetId,
            position,
            dimensions,
            generatedBy: {
                conversationAssetId,
                responseId: '',
                videoModel: (generationRun.mediaModelId ?? assignment.mediaModelId ?? '') as AiModelId,
                revisedPrompt: assignment.promptText,
                ...lineage,
            },
        }
    const withoutSameAsset = markerResult.state.nodes.filter((candidate) =>
        candidate.nodeId === nodeId || !('assetId' in candidate) || candidate.assetId !== assetId
    )
    const nodeResult = upsertNode(withoutSameAsset, node)
    const edgeResult = addEdge(markerResult.state.edges ?? [], lineageParentNodeId, nodeId)
    const next = rebalance(
        { ...markerResult.state, nodes: nodeResult.nodes, edges: edgeResult.edges },
        {},
        pendingBeforeFirstFrame ? new Set([nodeId]) : new Set(),
    ).state
    return { canvasState: next, nodeId, geometryNodes: geometryDiff(canvasState, next) }
}

export const logCanvasProjectionError = (context: string, error: unknown): void => {
    err(`[asset-canvas-projection] ${context}:`, error)
}
