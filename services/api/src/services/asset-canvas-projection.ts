import {
    estimateBranchMarkerDimensions,
    getBranchMarkerResponsePreview,
    getGeneratedMediaPreFrameLayoutRect,
    getGeneratedMediaPreFrameRect,
    getGeneratedMediaProgressCollisionRect,
    getGeneratedOutputChromeCollisionInsets,
    getPendingGeneratedMediaNodeId,
    rebalanceBranchTreesAndResolve,
    resizeBranchMarkerToDimensions,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    settleMediaGenerationRunProgress,
    type AiModelId,
    type Asset,
    type AssetRequesterContext,
    type BranchForkCanvasNode,
    type BranchForkLineagePlan,
    type BranchLineCanvasNode,
    type BranchLineLineagePlan,
    type BranchOriginCanvasNode,
    type BranchOriginLineagePlan,
    type CanvasGeometryUpdate,
    type CanvasNode,
    type CanvasNodeGeometry,
    type CanvasState,
    type CapabilityArtifactCanvasNode,
    type CapabilityJsonValue,
    type ImageCanvasNode,
    type MediaBranchLineagePlan,
    type MediaGenerationProblem,
    type MediaGenerationRunProgress,
    type MediaGenerationRunMeta,
    type MediaRunLineageAssignment,
    type OperationStatusCanvasNode,
    type VideoCanvasNode,
    type WorkspaceEdge,
} from '@lixpi/constants'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'
import { err } from '@lixpi/debug-tools'
import {
    findAiChatThreadContentNode,
    getBranchMarkerConversationPreviewFromThreadContent,
    parseProseMirrorJsonContent,
    type BranchMarkerConversationPreview,
    type BranchMarkerTurnDescriptor,
} from '@lixpi/prosemirror/shared/thread-doc'

import AssetModel, { getAssetRecord } from '../models/asset.ts'
import Workspace from '../models/workspace.ts'
import { settings } from '../settings.ts'

type MarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
type GeneratedOutputNode = ImageCanvasNode | VideoCanvasNode | CapabilityArtifactCanvasNode
type CanvasVisibleArea = { width: number; height: number }
type CanvasVisibleWorldBounds = { left: number; top: number; right: number; bottom: number }
type Rect = { x: number; y: number; width: number; height: number }
type ProjectionContext = { proseMirrorThreadContent?: unknown }

const layout = settings.mediaGenerationCanvasProjection
const collision = settings.workspaceCollision.branchTree

const isMarkerNode = (node: CanvasNode): node is MarkerNode => node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const findNode = (nodes: CanvasNode[], nodeId: string | undefined): CanvasNode | undefined => nodeId ? nodes.find((node) => node.nodeId === nodeId) : undefined

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

const getMarkerConversationPreview = (
    node: MarkerNode,
    proseMirrorThreadContent: unknown,
): BranchMarkerConversationPreview | null => {
    if (!node.conversationAssetId) return null
    const descriptor = markerTurnDescriptor(node)
    const exactPreview = getBranchMarkerConversationPreviewFromThreadContent(
        proseMirrorThreadContent,
        node.conversationAssetId,
        descriptor,
        { allowLatestTurnFallback: false },
    )
    if (exactPreview?.responseText) return exactPreview

    // Detached canvas generations are one-turn conversations. If a workflow
    // persisted the response before lineage attrs reached its section, using
    // that sole turn is unambiguous and keeps the durable marker response from
    // depending on provider-specific event ordering.
    const root = parseProseMirrorJsonContent(proseMirrorThreadContent)
    const thread = root ? findAiChatThreadContentNode(root, node.conversationAssetId) : null
    if (!thread) return exactPreview
    const userMessageCount = (thread.content ?? []).filter(child => child.type === 'aiUserMessage').length
    const responseMessageCount = (thread.content ?? []).filter(child => child.type === 'aiResponseMessage').length
    if (userMessageCount !== 1 || responseMessageCount > 1) return exactPreview

    return getBranchMarkerConversationPreviewFromThreadContent(
        proseMirrorThreadContent,
        node.conversationAssetId,
        descriptor,
        { allowLatestTurnFallback: true },
    ) ?? exactPreview
}

const markerDimensions = (node: MarkerNode, context: ProjectionContext = {}): { width: number; height: number } => {
    const preview = node.conversationAssetId && context.proseMirrorThreadContent
        ? getMarkerConversationPreview(node, context.proseMirrorThreadContent)
        : null
    const promptText = preview?.userText || node.provenance?.promptText || node.pendingState?.promptText || ''
    const responseText = preview?.responseText || node.provenance?.reasoningResponseText || ''
    if (!promptText) return { width: layout.markerWidth, height: layout.markerHeight }
    return estimateBranchMarkerDimensions(promptText, {
        responseLine: Boolean(responseText),
        responseText,
    })
}

const getVisibleWorldBounds = (
    state: CanvasState,
    visibleArea?: CanvasVisibleArea,
): CanvasVisibleWorldBounds | null => {
    const visibleWidth = Number(visibleArea?.width)
    const visibleHeight = Number(visibleArea?.height)
    if (
        !Number.isFinite(visibleWidth) || visibleWidth <= 0
        || !Number.isFinite(visibleHeight) || visibleHeight <= 0
    ) return null
    const viewport = (state as CanvasState & { viewport?: { x: number; y: number; zoom: number } }).viewport
    const zoom = Number.isFinite(viewport?.zoom) && Number(viewport?.zoom) > 0 ? Number(viewport?.zoom) : 1
    const left = -(Number(viewport?.x) || 0) / zoom
    const top = -(Number(viewport?.y) || 0) / zoom
    return {
        left,
        top,
        right: left + visibleWidth / zoom,
        bottom: top + visibleHeight / zoom,
    }
}

const isGenerationRequestReservationNode = (node: CanvasNode, generationRequestId: string): boolean => {
    if (node.type === 'operationStatus') return node.generationRequestId === generationRequestId
    if (node.type !== 'image' && node.type !== 'video' && node.type !== 'capabilityArtifact') return false
    return node.generatedBy?.generationRequestId === generationRequestId
        || (node.type !== 'capabilityArtifact'
            && node.generationProgress?.generationRequestId === generationRequestId)
}

const overlapArea = (a: Rect, b: Rect): number => {
    const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
    return width * height
}

const findClearVisiblePosition = (
    nodes: CanvasNode[],
    dimensions: { width: number; height: number },
    index: number,
    bounds: CanvasVisibleWorldBounds,
    generationRequestId: string,
): { x: number; y: number } => {
    const minX = bounds.left + layout.nodeGap
    const minY = bounds.top + layout.nodeGap
    const maxX = Math.max(minX, bounds.right - layout.nodeGap - dimensions.width)
    const maxY = Math.max(minY, bounds.bottom - layout.nodeGap - dimensions.height)
    const preferredY = Math.min(
        maxY,
        Math.max(
            minY,
            bounds.top + (bounds.bottom - bounds.top - dimensions.height) / 2
                + index * (dimensions.height + layout.branchRowGap),
        ),
    )
    const obstacles = nodes
        .filter(node => !node.parentId)
        .filter(node => node.type !== 'operationStatus')
        .filter(node => !isGenerationRequestReservationNode(node, generationRequestId))
        .map((node): Rect => ({
            x: node.position.x - layout.nodeGap,
            y: node.position.y - layout.nodeGap,
            width: node.dimensions.width + layout.nodeGap * 2,
            height: node.dimensions.height + layout.nodeGap * 2,
        }))
        .filter(rect =>
            rect.x < bounds.right && rect.x + rect.width > bounds.left
            && rect.y < bounds.bottom && rect.y + rect.height > bounds.top
        )
    const clampX = (x: number): number => Math.min(maxX, Math.max(minX, x))
    const clampY = (y: number): number => Math.min(maxY, Math.max(minY, y))
    const xCandidates = [
        minX,
        ...obstacles.flatMap(rect => [
            clampX(rect.x - dimensions.width),
            clampX(rect.x + rect.width),
        ]),
        maxX,
    ]
    const yCandidates = [
        preferredY,
        minY,
        ...obstacles.flatMap(rect => [
            clampY(rect.y - dimensions.height),
            clampY(rect.y + rect.height),
        ]),
        maxY,
    ]
    let best = { x: minX, y: preferredY }
    let bestScore = Number.POSITIVE_INFINITY
    for (const x of xCandidates) {
        for (const y of yCandidates) {
            const candidate = { x, y, width: dimensions.width, height: dimensions.height }
            const occupiedArea = obstacles.reduce((sum, obstacle) => sum + overlapArea(candidate, obstacle), 0)
            const score = occupiedArea * 1_000_000
                + Math.abs(x - minX)
                + Math.abs(y - preferredY) * 4
            if (score >= bestScore) continue
            best = { x, y }
            bestScore = score
        }
    }
    return best
}

const fallbackPosition = (
    nodes: CanvasNode[],
    state: CanvasState,
    dimensions: { width: number; height: number },
    index: number,
    generationRequestId: string,
    visibleArea?: CanvasVisibleArea,
): { x: number; y: number } => {
    const visibleBounds = getVisibleWorldBounds(state, visibleArea)
    if (visibleBounds) {
        return findClearVisiblePosition(nodes, dimensions, index, visibleBounds, generationRequestId)
    }
    const viewport = (state as CanvasState & { viewport?: { x: number; y: number; zoom: number } }).viewport
    const zoom = Number.isFinite(viewport?.zoom) && Number(viewport?.zoom) > 0 ? Number(viewport?.zoom) : 1
    const left = -(Number(viewport?.x) || 0) / zoom
    const top = -(Number(viewport?.y) || 0) / zoom
    const paneWidth = Number.isFinite(visibleArea?.width) ? Number(visibleArea?.width) / zoom : undefined
    const paneHeight = Number.isFinite(visibleArea?.height) ? Number(visibleArea?.height) / zoom : layout.serverFallbackPaneHeight
    const proposed = {
        x: left + layout.nodeGap,
        y: top + Math.max(layout.nodeGap, (paneHeight - dimensions.height) / 2)
            + index * (dimensions.height + layout.branchRowGap),
    }
    if (paneWidth === undefined) return proposed
    const minX = left + layout.nodeGap
    const minY = top + layout.nodeGap
    const maxX = Math.max(minX, left + paneWidth - layout.nodeGap - dimensions.width)
    const maxY = Math.max(minY, top + paneHeight - layout.nodeGap - dimensions.height)
    return {
        x: Math.min(maxX, Math.max(minX, proposed.x)),
        y: Math.min(maxY, Math.max(minY, proposed.y)),
    }
}

const clampPositionToVisibleArea = (
    state: CanvasState,
    position: { x: number; y: number },
    dimensions: { width: number; height: number },
    visibleArea?: CanvasVisibleArea,
): { x: number; y: number } => {
    const visibleWidth = Number(visibleArea?.width)
    const visibleHeight = Number(visibleArea?.height)
    if (
        !Number.isFinite(visibleWidth) || visibleWidth <= 0
        || !Number.isFinite(visibleHeight) || visibleHeight <= 0
    ) return position
    const viewport = (state as CanvasState & { viewport?: { x: number; y: number; zoom: number } }).viewport
    const zoom = Number.isFinite(viewport?.zoom) && Number(viewport?.zoom) > 0 ? Number(viewport?.zoom) : 1
    const left = -(Number(viewport?.x) || 0) / zoom
    const top = -(Number(viewport?.y) || 0) / zoom
    const right = left + visibleWidth / zoom
    const bottom = top + visibleHeight / zoom
    const minX = left + layout.nodeGap
    const minY = top + layout.nodeGap
    const maxX = Math.max(minX, right - layout.nodeGap - dimensions.width)
    const maxY = Math.max(minY, bottom - layout.nodeGap - dimensions.height)
    return {
        x: Math.min(maxX, Math.max(minX, position.x)),
        y: Math.min(maxY, Math.max(minY, position.y)),
    }
}

const positionRightOf = (
    source: CanvasNode | undefined,
    nodes: CanvasNode[],
    state: CanvasState,
    dimensions: { width: number; height: number },
    index: number,
    generationRequestId: string,
    visibleArea?: CanvasVisibleArea,
): { x: number; y: number } =>
    source
        ? clampPositionToVisibleArea(
            state,
            {
                x: source.position.x + source.dimensions.width + layout.rootToFirstMediaGap,
                y: source.position.y + (source.dimensions.height - dimensions.height) / 2,
            },
            dimensions,
            visibleArea,
        )
        : fallbackPosition(nodes, state, dimensions, index, generationRequestId, visibleArea)

const upsertNode = (nodes: CanvasNode[], next: CanvasNode): { nodes: CanvasNode[]; changed: boolean } => {
    const index = nodes.findIndex((node) => node.nodeId === next.nodeId)
    if (index < 0) return { nodes: [...nodes, next], changed: true }
    const existing = nodes[index]!
    const mergedProvenance = isMarkerNode(existing)
            && isMarkerNode(next)
            && (existing.provenance || next.provenance)
        ? { ...existing.provenance, ...next.provenance }
        : undefined
    const merged = {
        ...existing,
        ...next,
        ...(mergedProvenance ? { provenance: mergedProvenance } : {}),
        position: existing.position,
        dimensions: existing.dimensions,
    } as CanvasNode
    if (JSON.stringify(existing) === JSON.stringify(merged)) return { nodes, changed: false }
    return { nodes: nodes.map((node, nodeIndex) => nodeIndex === index ? merged : node), changed: true }
}

const upsertGeneratedMediaNode = (
    nodes: CanvasNode[],
    next: GeneratedMediaNode,
): { nodes: CanvasNode[]; changed: boolean } => {
    const index = nodes.findIndex((node) => node.nodeId === next.nodeId)
    if (index < 0) return { nodes: [...nodes, next], changed: true }
    const existing = nodes[index]!
    const merged = { ...existing, ...next } as GeneratedMediaNode
    if (JSON.stringify(existing) === JSON.stringify(merged)) return { nodes, changed: false }
    return { nodes: nodes.map((node, nodeIndex) => nodeIndex === index ? merged : node), changed: true }
}

const addEdge = (edges: WorkspaceEdge[], sourceNodeId: string | undefined, targetNodeId: string): {
    edges: WorkspaceEdge[]
    changed: boolean
} => {
    if (!sourceNodeId) return { edges, changed: false }
    const edgeId = `edge-${sourceNodeId}-${targetNodeId}`
    const existingEdgeIndex = edges.findIndex((edge) => edge.edgeId === edgeId)
    if (existingEdgeIndex >= 0) {
        const existingEdge = edges[existingEdgeIndex]!
        if (existingEdge.sourceHandle === 'right' && existingEdge.targetHandle === 'left') {
            return { edges, changed: false }
        }
        return {
            edges: edges.map((edge, index) =>
                index === existingEdgeIndex
                    ? { ...edge, sourceHandle: 'right', targetHandle: 'left' }
                    : edge
            ),
            changed: true,
        }
    }
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
    generationRequestId: string,
    visibleArea?: CanvasVisibleArea,
): { x: number; y: number } =>
    positionRightOf(
        findNode(nodes, parentNodeId),
        nodes,
        state,
        dimensions,
        index,
        generationRequestId,
        visibleArea,
    )

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
        position: baseMarkerPosition(
            state.nodes,
            state,
            anchorNodeId,
            dimensions,
            0,
            plan.generationRequestId,
            visibleArea,
        ),
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
        position: baseMarkerPosition(
            nodes,
            state,
            plan.parentBranchNodeId,
            dimensions,
            plan.reasoningIndex,
            plan.generationRequestId,
            visibleArea,
        ),
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
        position: baseMarkerPosition(
            nodes,
            state,
            plan.parentBranchNodeId,
            dimensions,
            plan.reasoningIndex,
            plan.generationRequestId,
            visibleArea,
        ),
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

const reconcileLineagePlan = (
    state: CanvasState,
    markers: MarkerNode[],
    plan: MediaBranchLineagePlan,
    conversationAssetId: string,
): {
    state: CanvasState
    changed: boolean
    removedNodeIds: string[]
    removedEdgeIds: string[]
} => {
    const markerIds = new Set(markers.map(marker => marker.nodeId))
    const staleMarkerIds = new Set(state.nodes.flatMap(node => (
        isMarkerNode(node)
            && !markerIds.has(node.nodeId)
            && (
                node.generationRequestId === plan.generationRequestId
                || (
                    node.pendingState?.phase === 'preflight'
                    && node.conversationAssetId === conversationAssetId
                    && node.generationRequestId === conversationAssetId
                )
            )
            ? [node.nodeId]
            : []
    )))
    const plannedParentByOutputNodeId = new Map(plan.runAssignments.flatMap(assignment => (
        assignment.lineageParentNodeId
            ? [[getPendingGeneratedMediaNodeId(assignment), assignment.lineageParentNodeId] as const]
            : []
    )))
    const retainedEdges = (state.edges ?? []).filter(edge => {
        const plannedParentNodeId = plannedParentByOutputNodeId.get(edge.targetNodeId)
        return !staleMarkerIds.has(edge.sourceNodeId)
            && !staleMarkerIds.has(edge.targetNodeId)
            && (!plannedParentNodeId || edge.sourceNodeId === plannedParentNodeId)
    })
    const removedEdgeIds = (state.edges ?? [])
        .filter(edge => !retainedEdges.includes(edge))
        .map(edge => edge.edgeId)
    const withoutStaleMarkers: CanvasState = {
        ...state,
        nodes: state.nodes.filter(node => !staleMarkerIds.has(node.nodeId)),
        edges: retainedEdges,
    }
    const markerResult = ensureMarkers(withoutStaleMarkers, markers)
    const existingNodeIds = new Set(markerResult.state.nodes.map(node => node.nodeId))
    let edges = markerResult.state.edges ?? []
    let changed = markerResult.changed || staleMarkerIds.size > 0 || removedEdgeIds.length > 0
    for (const [outputNodeId, parentNodeId] of plannedParentByOutputNodeId) {
        if (!existingNodeIds.has(outputNodeId) || !existingNodeIds.has(parentNodeId)) continue
        const edgeResult = addEdge(edges, parentNodeId, outputNodeId)
        edges = edgeResult.edges
        changed ||= edgeResult.changed
    }
    return {
        state: { ...markerResult.state, edges },
        changed,
        removedNodeIds: [...staleMarkerIds],
        removedEdgeIds,
    }
}

const collisionSettingsFor = (node: CanvasNode) => {
    switch (node.type) {
        case 'image':
            return collision.nodeTypes.image
        case 'video':
            return collision.nodeTypes.video
        case 'branchOrigin':
            return collision.nodeTypes.branchOrigin
        case 'branchFork':
            return collision.nodeTypes.branchFork
        case 'branchLine':
            return collision.nodeTypes.branchLine
        default:
            return collision.nodeTypes.document
    }
}

const getApiNodePreFrameRect = (
    node: CanvasNode,
    position: { x: number; y: number },
): Rect | null => {
    if (
        (node.type !== 'image' && node.type !== 'video')
        || (node.generationProgress
            && ['completed', 'failed', 'cancelled'].includes(node.generationProgress.status))
        || node.mediaGenerationPhase !== 'pending-before-first-frame'
    ) return null
    return getGeneratedMediaPreFrameRect(position, node.dimensions, layout.preFrameCircleScale)
}

const rebalance = (
    state: CanvasState,
    context: ProjectionContext = {},
): { state: CanvasState; changed: boolean } => {
    const contentProjectedNodes = state.nodes.map((node): CanvasNode => {
        if (!isMarkerNode(node)) return node
        if (!node.conversationAssetId || !context.proseMirrorThreadContent || !node.provenance) return node
        const preview = getMarkerConversationPreview(node, context.proseMirrorThreadContent)
        const reasoningResponseText = getBranchMarkerResponsePreview(preview?.responseText ?? '')
        if (!reasoningResponseText || node.provenance.reasoningResponseText === reasoningResponseText) return node
        return {
            ...node,
            provenance: {
                ...node.provenance,
                reasoningResponseText,
            },
        } as MarkerNode
    })
    const resizedNodes = contentProjectedNodes.map((node): CanvasNode => {
        if (!isMarkerNode(node)) return node
        const dimensions = markerDimensions(node, context)
        return resizeBranchMarkerToDimensions(node, dimensions)
    })
    // Hidden in-progress operation records are orchestration state. A failed
    // media operation with lineage is the visible replacement for its output,
    // so it must remain a real branch leaf during every later rebalance.
    const layoutNodes = resizedNodes.filter(node => (
        node.type !== 'operationStatus'
        || (node.operation === 'media-generation'
            && node.status === 'failed'
            && Boolean(node.lineageAssignment))
    ))
    const balancedLayoutNodes = rebalanceBranchTreesAndResolve(layoutNodes, state.edges ?? [], {
        depthGap: layout.mediaToMediaGap,
        branchOriginDepthGap: layout.branchOriginToFirstMediaGap,
        rootMarkerDepthGap: layout.rootToFirstMediaGap,
        siblingGap: layout.branchRowGap,
        branchFanoutExtraGap: layout.branchFanoutExtraGap,
        branchOriginMarkerStackGap: layout.nodeGap,
        collisionIterations: Math.max(...Object.values(collision.nodeTypes).map((entry) => entry.iterations)),
        collisionMargin: 0,
        // Pending media keeps the final horizontal column while using the same
        // compact vertical footprint and connector anchor the browser renders.
        getNodeCollisionRect: (node, position) => {
            const preFrameRect = getApiNodePreFrameRect(node, position)
            if (preFrameRect) {
                return getGeneratedMediaPreFrameLayoutRect(
                    position,
                    node.dimensions,
                    layout.preFrameCircleScale,
                )
            }
            const chromeInsets = node.type === 'image' || node.type === 'video' || node.type === 'capabilityArtifact'
                ? getGeneratedOutputChromeCollisionInsets(node.type)
                : { top: 0, bottom: 0 }
            const collisionRect = {
                x: position.x,
                y: position.y - chromeInsets.top,
                width: node.dimensions.width,
                height: chromeInsets.top + node.dimensions.height + chromeInsets.bottom,
            }
            if ((node.type !== 'image' && node.type !== 'video') || !node.generationProgress) {
                return collisionRect
            }
            return getGeneratedMediaProgressCollisionRect(
                collisionRect,
                { position, dimensions: node.dimensions },
                node.dimensions.height,
            )
        },
        getNodeConnectorAnchorRect: (node, position) => {
            const preFrameRect = getApiNodePreFrameRect(node, position)
            if (preFrameRect) return preFrameRect
            const mediaRect = {
                x: position.x,
                y: position.y,
                width: node.dimensions.width,
                height: node.dimensions.height,
            }
            if ((node.type !== 'image' && node.type !== 'video') || !node.generationProgress) return mediaRect
            return getGeneratedMediaProgressCollisionRect(
                mediaRect,
                { position, dimensions: node.dimensions },
                node.dimensions.height,
            )
        },
        getNodeCollisionMargin: (node) => isMarkerNode(node) ? layout.nodeGap : collisionSettingsFor(node).margin,
        getNodeCollisionOverlapThreshold: (node) => collisionSettingsFor(node).overlapThreshold,
    })
    const balancedByNodeId = new Map(balancedLayoutNodes.map(node => [node.nodeId, node]))
    const nodes = resizedNodes.map(node => balancedByNodeId.get(node.nodeId) ?? node)
    return {
        state: { ...state, nodes },
        changed: JSON.stringify(state.nodes) !== JSON.stringify(nodes),
    }
}

const keepFreshLineageMarkersInsideVisibleArea = (
    state: CanvasState,
    plan: MediaBranchLineagePlan,
    visibleArea?: CanvasVisibleArea,
): { state: CanvasState; changed: boolean } => {
    const rootMarkerId = plan.branchOrigin?.nodeId
        ?? plan.branchForks.find(marker => !marker.parentBranchNodeId)?.nodeId
        ?? plan.branchLines.find(marker => !marker.parentBranchNodeId)?.nodeId
    const bounds = getVisibleWorldBounds(state, visibleArea)
    if (!rootMarkerId || !bounds) return { state, changed: false }

    const requestMarkers = state.nodes.filter((node): node is MarkerNode => isMarkerNode(node) && node.generationRequestId === plan.generationRequestId)
    const rootMarker = requestMarkers.find(marker => marker.nodeId === rootMarkerId)
    if (!rootMarker || requestMarkers.length === 0) return { state, changed: false }

    const minX = Math.min(...requestMarkers.map(marker => marker.position.x))
    const minY = Math.min(...requestMarkers.map(marker => marker.position.y))
    const maxX = Math.max(...requestMarkers.map(marker => marker.position.x + marker.dimensions.width))
    const maxY = Math.max(...requestMarkers.map(marker => marker.position.y + marker.dimensions.height))
    const visibleMinX = bounds.left + layout.nodeGap
    const visibleMinY = bounds.top + layout.nodeGap
    const visibleMaxX = bounds.right - layout.nodeGap
    const visibleMaxY = bounds.bottom - layout.nodeGap
    const clampedRootPosition = clampPositionToVisibleArea(
        state,
        rootMarker.position,
        rootMarker.dimensions,
        visibleArea,
    )
    let dx = 0
    let dy = 0
    if (maxX - minX <= visibleMaxX - visibleMinX) {
        if (minX < visibleMinX) dx = visibleMinX - minX
        else if (maxX > visibleMaxX) dx = visibleMaxX - maxX
    } else {
        dx = clampedRootPosition.x - rootMarker.position.x
    }
    if (maxY - minY <= visibleMaxY - visibleMinY) {
        if (minY < visibleMinY) dy = visibleMinY - minY
        else if (maxY > visibleMaxY) dy = visibleMaxY - maxY
    } else {
        dy = clampedRootPosition.y - rootMarker.position.y
    }
    if (dx === 0 && dy === 0) return { state, changed: false }

    const nodes = state.nodes.map((node): CanvasNode => {
        const belongsToRequest = isMarkerNode(node)
            ? node.generationRequestId === plan.generationRequestId
            : node.type !== 'operationStatus'
                && isGenerationRequestReservationNode(node, plan.generationRequestId)
        if (!belongsToRequest || node.parentId) return node
        return {
            ...node,
            position: {
                x: node.position.x + dx,
                y: node.position.y + dy,
            },
        } as CanvasNode
    })
    return { state: { ...state, nodes }, changed: true }
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
    removedEdgeIds = [],
}: {
    state: CanvasState
    layoutRevision: number
    generationRequestId: string
    geometryNodes: CanvasNodeGeometry[]
    removedNodeIds?: string[]
    removedEdgeIds?: string[]
}): CanvasGeometryUpdate => {
    const geometryNodeIds = new Set(geometryNodes.map((node) => node.nodeId))
    const removed = new Set(removedNodeIds)
    const nodeSnapshots = state.nodes.filter((node) =>
        !removed.has(node.nodeId)
        && (
            geometryNodeIds.has(node.nodeId)
            || (isMarkerNode(node) && node.generationRequestId === generationRequestId)
            || ((node.type === 'image' || node.type === 'video' || node.type === 'capabilityArtifact')
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
        ...(removedEdgeIds.length ? { removedEdgeIds: [...new Set(removedEdgeIds)] } : {}),
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
    let removedNodeIds: string[] = []
    let removedEdgeIds: string[] = []
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
            const markerResult = reconcileLineagePlan(
                canvasState,
                markers,
                params.lineagePlan,
                params.conversationAssetId,
            )
            removedNodeIds = markerResult.removedNodeIds
            removedEdgeIds = markerResult.removedEdgeIds
            const balanced = rebalance(markerResult.state, { proseMirrorThreadContent: params.proseMirrorThreadContent })
            const viewportSafe = keepFreshLineageMarkersInsideVisibleArea(
                balanced.state,
                params.lineagePlan,
                params.canvasVisibleArea,
            )
            geometryNodes = geometryDiff(canvasState, viewportSafe.state)
            return {
                canvasState: viewportSafe.state,
                changed: markerResult.changed || balanced.changed || viewportSafe.changed,
            }
        },
    })
    if (!result.canvasState || result.canvasStateUpdatedAt === null) return null
    return buildAssetCanvasGeometryUpdate({
        state: result.canvasState,
        layoutRevision: result.canvasStateUpdatedAt,
        generationRequestId: params.lineagePlan.generationRequestId,
        geometryNodes,
        removedNodeIds,
        ...(removedEdgeIds.length ? { removedEdgeIds } : {}),
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
                .filter((node) => {
                    if (!persistedPendingIds.has(node.nodeId)) return false
                    if (node.type !== 'image' && node.type !== 'video') return false
                    if (node.mediaGenerationPhase) return node.mediaGenerationPhase === 'pending-before-first-frame'
                    return !node.assetId
                })
                .map((node) => node.nodeId)
            const removableIds = new Set(removedNodeIds)
            const stateWithoutPending = removableIds.size
                ? {
                    ...canvasState,
                    nodes: canvasState.nodes.filter((node) => !removableIds.has(node.nodeId)),
                    edges: (canvasState.edges ?? []).filter((edge) => !removableIds.has(edge.sourceNodeId) && !removableIds.has(edge.targetNodeId)),
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
    return buildAssetCanvasGeometryUpdate({
        state: result.canvasState,
        layoutRevision: result.canvasStateUpdatedAt,
        generationRequestId: params.generationRequestId,
        geometryNodes,
        removedNodeIds,
    })
}

export const settleFailedGeneratedMediaRunOnCanvas = async (params: {
    workspaceId: string
    generationRun: MediaGenerationRunMeta
    outputNodeId?: string
    assetId?: string
    errorMessage?: string
    problem?: MediaGenerationProblem
    progress?: MediaGenerationRunProgress
    requestRevision?: number
}): Promise<CanvasGeometryUpdate | null> => {
    const declaredAssignment = params.generationRun.lineageAssignment
    const pendingNodeId = declaredAssignment
        ? getPendingGeneratedMediaNodeId(declaredAssignment)
        : params.outputNodeId
    const assetId = declaredAssignment?.assetId ?? params.assetId
    if (!pendingNodeId || !assetId) return null

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const asset = await getAssetRecord(assetId)
        if (!asset) return null
        const workspace = await Workspace.getWorkspace({
            workspaceId: params.workspaceId,
            userId: asset.ownerUserId,
        })
        if ('error' in workspace) throw new Error(workspace.error)

        const pendingNode = workspace.canvasState.nodes.find((node) => node.nodeId === pendingNodeId)
        const isRemovablePendingNode = pendingNode
            && (pendingNode.type === 'image' || pendingNode.type === 'video')
            && pendingNode.assetId === assetId
            && pendingNode.mediaGenerationPhase === 'pending-before-first-frame'
        if (!isRemovablePendingNode) return null

        const failedOperationNode = workspace.canvasState.nodes.find((node): node is OperationStatusCanvasNode => (
            node.type === 'operationStatus'
            && node.operation === 'media-generation'
            && node.generationRequestId === params.generationRun.generationRequestId
            && (params.generationRun.mediaRunId
                ? node.mediaRunId === params.generationRun.mediaRunId
                : node.generationRun === params.generationRun.mediaIndex)
        ))
        const resolvedAssignment = declaredAssignment
            ?? pendingNode.generationProgress?.lineageAssignment
            ?? failedOperationNode?.lineageAssignment
        const now = Date.now()
        const message = params.problem?.detail
            ?? failedOperationNode?.problem?.detail
            ?? params.errorMessage
            ?? (failedOperationNode?.status === 'failed' ? failedOperationNode.message : undefined)
            ?? 'Media generation failed.'
        const failedDimensions = failedOperationNode?.dimensions ?? { width: 360, height: 104 }
        const failedNode: OperationStatusCanvasNode = {
            ...(failedOperationNode ?? {
                type: 'operationStatus' as const,
                operation: 'media-generation' as const,
                title: `Generating with ${params.generationRun.mediaModelId ?? 'the selected model'}`,
                createdAt: now,
            }),
            nodeId: pendingNodeId,
            status: 'failed',
            message,
            generationRequestId: params.generationRun.generationRequestId,
            ...(params.generationRun.mediaRunId ? { mediaRunId: params.generationRun.mediaRunId } : {}),
            ...(failedOperationNode?.generationRun !== undefined
                ? { generationRun: failedOperationNode.generationRun }
                : params.generationRun.variantIndex !== undefined
                ? { generationRun: params.generationRun.variantIndex }
                : params.generationRun.mediaIndex !== undefined
                ? { generationRun: params.generationRun.mediaIndex }
                : {}),
            outputNodeId: pendingNodeId,
            plannedMediaType: params.generationRun.mediaType ?? 'image',
            ...(resolvedAssignment ? { lineageAssignment: resolvedAssignment } : {}),
            ...(params.problem ? { problem: params.problem } : {}),
            ...(params.requestRevision === undefined ? {} : { requestRevision: params.requestRevision }),
            progress: settleMediaGenerationRunProgress(
                params.progress ?? failedOperationNode?.progress ?? pendingNode.generationProgress?.progress,
                'failed',
                message,
            ),
            ...(pendingNode.parentId ? { parentId: pendingNode.parentId } : {}),
            position: {
                x: pendingNode.position.x + (pendingNode.dimensions.width - failedDimensions.width) / 2,
                y: pendingNode.position.y + (pendingNode.dimensions.height - failedDimensions.height) / 2,
            },
            dimensions: failedDimensions,
            updatedAt: now,
        }
        const replacedOperationNodeId = failedOperationNode?.nodeId !== pendingNodeId
            ? failedOperationNode?.nodeId
            : undefined
        const stateWithFailedNode: CanvasState = {
            ...workspace.canvasState,
            nodes: workspace.canvasState.nodes
                .filter((node) => node.nodeId !== replacedOperationNodeId)
                .map((node) => node.nodeId === pendingNodeId ? failedNode : node),
            edges: (workspace.canvasState.edges ?? []).filter((edge) => edge.sourceNodeId !== replacedOperationNodeId && edge.targetNodeId !== replacedOperationNodeId),
        }
        const balancedFailureState = rebalance(stateWithFailedNode).state
        const geometryNodes = geometryDiff(workspace.canvasState, balancedFailureState)
        if (!geometryNodes.some(node => node.nodeId === pendingNodeId)) {
            const settledNode = balancedFailureState.nodes.find(node => node.nodeId === pendingNodeId)
            if (settledNode) {
                geometryNodes.push({
                    nodeId: settledNode.nodeId,
                    position: settledNode.position,
                    dimensions: settledNode.dimensions,
                    ...(settledNode.parentId ? { parentNodeId: settledNode.parentId } : {}),
                })
            }
        }
        const persistedCanvasRevision = workspace.canvasStateUpdatedAt ?? workspace.updatedAt ?? 0
        const canvasStateUpdatedAt = Math.max(Date.now(), persistedCanvasRevision + 1)

        try {
            const detached = await AssetModel.detachWorkspaceReference({
                assetId,
                workspaceId: params.workspaceId,
                requester: {
                    userId: asset.ownerUserId,
                    workspaceIds: [params.workspaceId],
                    editableWorkspaceIds: [params.workspaceId],
                    organizationIds: [asset.organizationId],
                },
                nodeId: pendingNodeId,
                workspaceMutation: {
                    expectedCanvasStateUpdatedAt: workspace.canvasStateUpdatedAt,
                    canvasStateUpdatedAt,
                    canvasState: balancedFailureState,
                },
            })
            if ('error' in detached) {
                if (detached.error === 'STALE_CANVAS_STATE') continue
                throw new Error(detached.error)
            }
            return buildAssetCanvasGeometryUpdate({
                state: balancedFailureState,
                layoutRevision: canvasStateUpdatedAt,
                generationRequestId: params.generationRun.generationRequestId,
                geometryNodes,
                ...(replacedOperationNodeId ? { removedNodeIds: [replacedOperationNodeId] } : {}),
            })
        } catch (error) {
            if (isTransactionConditionalCheckFailure(error)) continue
            throw error
        }
    }

    throw new Error(`FAILED_GENERATED_MEDIA_CANVAS_DETACH_EXHAUSTED:${assetId}`)
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
    referenceAssetIds: assignment.referenceAssetIds,
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
        referenceAssetIds: assignment.referenceAssetIds,
        referenceNodeIds: assignment.referenceNodeIds,
        sourceContextNodeIds: assignment.sourceContextNodeIds,
        ...(assignment.branchOriginNodeId
            ? {
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
            }
            : {}),
        branchForks: assignment.branchForkNodeId
            ? [{
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
            }]
            : [],
        branchLines: assignment.branchLineNodeId
            ? [{
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
            }]
            : [],
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
    const existingLineageParent = findNode(canvasState.nodes, assignment.lineageParentNodeId)
    const markerResult = ensureMarkers(
        canvasState,
        existingLineageParent && isMarkerNode(existingLineageParent)
            ? []
            : markerNodesFromAssignment(assignment, conversationAssetId, canvasState),
    )
    const nodeId = getPendingGeneratedMediaNodeId(assignment)
    const existing = markerResult.state.nodes.find((node) => node.nodeId === nodeId) as GeneratedMediaNode | undefined
    const width = existing?.dimensions.width ?? layout.generatedMediaSize
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
    // Keep the stable card dimensions on the node while its visible layout
    // footprint transitions from the compact pre-frame circle to the card.
    const dimensions = existing?.mediaGenerationPhase === 'pending-before-first-frame'
        ? existing.dimensions
        : { width, height: width / safeAspectRatio }
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
        : positionRightOf(
            source,
            markerResult.state.nodes,
            markerResult.state,
            dimensions,
            markerResult.state.nodes.length,
            assignment.generationRequestId,
        )
    const lineage = generatedByLineage(assignment)
    const activeGenerationProgress = existing?.generationProgress
            && ['pending', 'running', 'awaiting-provider-verification'].includes(existing.generationProgress.status)
        ? existing.generationProgress
        : undefined
    const generationProgress = !pendingBeforeFirstFrame && activeGenerationProgress
        ? {
            ...activeGenerationProgress,
            status: 'completed' as const,
            message: 'Media generation completed.',
            progress: settleMediaGenerationRunProgress(
                activeGenerationProgress.progress,
                'completed',
                'Media generation completed.',
            ),
            updatedAt: Date.now(),
        }
        : undefined
    const node: GeneratedMediaNode = kind === 'image'
        ? {
            nodeId,
            type: 'image',
            assetId,
            mediaGenerationPhase: pendingBeforeFirstFrame ? 'pending-before-first-frame' : 'ready',
            ...(generationProgress ? { generationProgress } : {}),
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
            mediaGenerationPhase: pendingBeforeFirstFrame ? 'pending-before-first-frame' : 'ready',
            ...(generationProgress ? { generationProgress } : {}),
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
    const withoutSameAsset = markerResult.state.nodes.filter((candidate) => candidate.nodeId === nodeId || !('assetId' in candidate) || candidate.assetId !== assetId)
    const nodeResult = upsertGeneratedMediaNode(withoutSameAsset, node)
    const edgeResult = addEdge(markerResult.state.edges ?? [], lineageParentNodeId, nodeId)
    const next = rebalance({ ...markerResult.state, nodes: nodeResult.nodes, edges: edgeResult.edges }).state
    return { canvasState: next, nodeId, geometryNodes: geometryDiff(canvasState, next) }
}

export const projectGeneratedArtifactNode = ({
    canvasState,
    assetId,
    artifactTypeId,
    generationRun,
    conversationAssetId,
    capabilityRunId,
    capabilityId,
    toolId,
    input,
    dimensions,
}: {
    canvasState: CanvasState
    assetId: string
    artifactTypeId: string
    generationRun: MediaGenerationRunMeta
    conversationAssetId: string
    capabilityRunId: string
    capabilityId: string
    toolId: string
    input: Record<string, CapabilityJsonValue>
    dimensions: { width: number; height: number }
}): { canvasState: CanvasState; nodeId: string; geometryNodes: CanvasNodeGeometry[] } => {
    const assignment = generationRun.lineageAssignment
    if (!assignment) throw new Error('Generated Artifact canvas projection requires a lineage assignment')
    const existingLineageParent = findNode(canvasState.nodes, assignment.lineageParentNodeId)
    const markerResult = ensureMarkers(
        canvasState,
        existingLineageParent && isMarkerNode(existingLineageParent)
            ? []
            : markerNodesFromAssignment(assignment, conversationAssetId, canvasState),
    )
    const nodeId = `capability-artifact-${assetId}`
    const existing = markerResult.state.nodes.find(node => node.nodeId === nodeId)
    const lineageParentNodeId = assignment.lineageParentNodeId
        ?? assignment.branchLineNodeId
        ?? assignment.branchForkNodeId
        ?? assignment.parentMediaNodeId
        ?? assignment.branchOriginNodeId
    const source = findNode(markerResult.state.nodes, lineageParentNodeId)
    const position = existing?.position
        ?? positionRightOf(
            source,
            markerResult.state.nodes,
            markerResult.state,
            dimensions,
            markerResult.state.nodes.length,
            assignment.generationRequestId,
        )
    const node: CapabilityArtifactCanvasNode = {
        nodeId,
        type: 'capabilityArtifact',
        artifactTypeId,
        assetId,
        position,
        dimensions,
        generatedBy: {
            outputKind: 'capabilityArtifact',
            conversationAssetId,
            capabilityRunId,
            capabilityId,
            toolId,
            input,
            ...generatedByLineage(assignment),
        },
    }
    const withoutSameAsset = markerResult.state.nodes.filter(candidate => candidate.nodeId === nodeId || !('assetId' in candidate) || candidate.assetId !== assetId)
    const nodes = existing
        ? withoutSameAsset.map(candidate => candidate.nodeId === nodeId ? node : candidate)
        : [...withoutSameAsset, node]
    const edgeResult = addEdge(markerResult.state.edges ?? [], lineageParentNodeId, nodeId)
    const next = rebalance({ ...markerResult.state, nodes, edges: edgeResult.edges }).state
    return { canvasState: next, nodeId, geometryNodes: geometryDiff(canvasState, next) }
}

export const detachReviewedGeneratedOutputsFromCanvas = ({
    canvasState,
    scope,
    nodeId,
}: {
    canvasState: CanvasState
    scope: 'output-node' | 'branch-lineage'
    nodeId: string
}): {
    canvasState: CanvasState
    affectedNodes: GeneratedOutputNode[]
    geometryNodes: CanvasNodeGeometry[]
    removedNodeIds: string[]
    removedEdgeIds: string[]
} => {
    const affectedNodes = canvasState.nodes.filter((candidate): candidate is GeneratedOutputNode => {
        if (candidate.type !== 'image' && candidate.type !== 'video' && candidate.type !== 'capabilityArtifact') return false
        if (!candidate.generatedBy?.branchId) return false
        if (scope === 'output-node') return candidate.nodeId === nodeId
        return candidate.generatedBy.branchOriginNodeId === nodeId
            || candidate.generatedBy.branchForkNodeId === nodeId
            || candidate.generatedBy.branchLineNodeId === nodeId
            || candidate.generatedBy.lineageParentNodeId === nodeId
    })
    if (affectedNodes.length === 0) {
        return { canvasState, affectedNodes, geometryNodes: [], removedNodeIds: [], removedEdgeIds: [] }
    }

    const affectedNodeIds = new Set(affectedNodes.map(node => node.nodeId))
    const detachedLineageParentIds = new Set(affectedNodes.flatMap((node) =>
        [
            node.generatedBy?.lineageParentNodeId,
            node.generatedBy?.branchOriginNodeId,
            node.generatedBy?.branchForkNodeId,
            node.generatedBy?.branchLineNodeId,
        ].filter((value): value is string => Boolean(value))
    ))
    const detachedNodes = canvasState.nodes.map((candidate): CanvasNode => {
        if (
            (candidate.type !== 'image' && candidate.type !== 'video' && candidate.type !== 'capabilityArtifact')
            || !affectedNodeIds.has(candidate.nodeId)
        ) return candidate
        const generatedBy = candidate.generatedBy
        if (!generatedBy) return candidate
        const provenanceLocator = { ...generatedBy } as Record<string, unknown>
        for (
            const field of [
                'branchId',
                'parentMediaNodeId',
                'parentImageNodeId',
                'branchOriginNodeId',
                'branchForkNodeId',
                'branchLineNodeId',
                'lineageParentNodeId',
            ]
        ) delete provenanceLocator[field]
        if (candidate.type === 'image' || candidate.type === 'video') {
            const acceptedNode = { ...candidate }
            delete acceptedNode.generationProgress
            return { ...acceptedNode, generatedBy: provenanceLocator } as CanvasNode
        }
        return { ...candidate, generatedBy: provenanceLocator } as CanvasNode
    })
    const edgesWithoutDetachedLineage = (canvasState.edges ?? []).filter((edge) => !(affectedNodeIds.has(edge.targetNodeId) && detachedLineageParentIds.has(edge.sourceNodeId)))

    const referencedOriginNodeIds = new Set<string>()
    const referencedForkNodeIds = new Set<string>()
    const referencedLineNodeIds = new Set<string>()
    const markerTypeByNodeId = new Map(
        detachedNodes
            .filter((node): node is MarkerNode => isMarkerNode(node))
            .map(node => [node.nodeId, node.type]),
    )
    for (const candidate of detachedNodes) {
        if (candidate.type !== 'image' && candidate.type !== 'video' && candidate.type !== 'capabilityArtifact') continue
        if (candidate.generatedBy?.branchOriginNodeId) referencedOriginNodeIds.add(candidate.generatedBy.branchOriginNodeId)
        if (candidate.generatedBy?.branchForkNodeId) referencedForkNodeIds.add(candidate.generatedBy.branchForkNodeId)
        if (candidate.generatedBy?.branchLineNodeId) referencedLineNodeIds.add(candidate.generatedBy.branchLineNodeId)
        const lineageParentNodeId = candidate.generatedBy?.lineageParentNodeId
        const lineageParentType = lineageParentNodeId ? markerTypeByNodeId.get(lineageParentNodeId) : undefined
        if (lineageParentNodeId && lineageParentType === 'branchOrigin') referencedOriginNodeIds.add(lineageParentNodeId)
        if (lineageParentNodeId && lineageParentType === 'branchFork') referencedForkNodeIds.add(lineageParentNodeId)
        if (lineageParentNodeId && lineageParentType === 'branchLine') referencedLineNodeIds.add(lineageParentNodeId)
    }
    const removedMarkerNodeIds = new Set<string>()
    const nodesWithoutOrphanMarkers = detachedNodes.filter((candidate) => {
        const remove = (candidate.type === 'branchOrigin' && !referencedOriginNodeIds.has(candidate.nodeId))
            || (candidate.type === 'branchFork' && !referencedForkNodeIds.has(candidate.nodeId))
            || (candidate.type === 'branchLine' && !referencedLineNodeIds.has(candidate.nodeId))
        if (remove) removedMarkerNodeIds.add(candidate.nodeId)
        return !remove
    })
    const edgesWithoutOrphanMarkers = edgesWithoutDetachedLineage.filter((edge) => !removedMarkerNodeIds.has(edge.sourceNodeId) && !removedMarkerNodeIds.has(edge.targetNodeId))
    const removedEdgeIds = (canvasState.edges ?? [])
        .filter((edge) => !edgesWithoutOrphanMarkers.some((candidate) => candidate.edgeId === edge.edgeId))
        .map(edge => edge.edgeId)
    const next = rebalance({
        ...canvasState,
        nodes: nodesWithoutOrphanMarkers,
        edges: edgesWithoutOrphanMarkers,
    }).state
    return {
        canvasState: next,
        affectedNodes,
        geometryNodes: geometryDiff(canvasState, next),
        removedNodeIds: [...removedMarkerNodeIds],
        removedEdgeIds,
    }
}

export const removeOrphanBranchLineageMarkerFromCanvas = ({
    canvasState,
    nodeId,
}: {
    canvasState: CanvasState
    nodeId: string
}): {
    canvasState: CanvasState
    geometryNodes: CanvasNodeGeometry[]
    removedNodeIds: string[]
    removedEdgeIds: string[]
} => {
    const marker = canvasState.nodes.find((node) => node.nodeId === nodeId && isMarkerNode(node))
    if (!marker) {
        return {
            canvasState,
            geometryNodes: [],
            removedNodeIds: [],
            removedEdgeIds: [],
        }
    }

    const nodes = canvasState.nodes.filter((node) => node.nodeId !== nodeId)
    const edges = (canvasState.edges ?? []).filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId)
    const removedEdgeIds = (canvasState.edges ?? [])
        .filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId)
        .map((edge) => edge.edgeId)
    const contextChips = canvasState.aiChatPanel?.contextChips.filter((candidateNodeId) => candidateNodeId !== nodeId)
    const next = rebalance({
        ...canvasState,
        ...(canvasState.aiChatPanel
            ? {
                aiChatPanel: { ...canvasState.aiChatPanel, contextChips: contextChips ?? [] },
            }
            : {}),
        nodes,
        edges,
    }).state

    return {
        canvasState: next,
        geometryNodes: geometryDiff(canvasState, next),
        removedNodeIds: [nodeId],
        removedEdgeIds,
    }
}

export const removeGeneratedOutputCandidateFromCanvas = ({
    canvasState,
    nodeId,
    preserveLineageNodeIds = new Set<string>(),
}: {
    canvasState: CanvasState
    nodeId: string
    preserveLineageNodeIds?: ReadonlySet<string>
}): {
    canvasState: CanvasState
    geometryNodes: CanvasNodeGeometry[]
    removedNodeIds: string[]
    removedEdgeIds: string[]
} => {
    const withoutCandidate = canvasState.nodes.filter(node => node.nodeId !== nodeId)
    const referencedOriginNodeIds = new Set<string>(preserveLineageNodeIds)
    const referencedForkNodeIds = new Set<string>(preserveLineageNodeIds)
    const referencedLineNodeIds = new Set<string>(preserveLineageNodeIds)
    const markerTypeByNodeId = new Map(
        withoutCandidate
            .filter((node): node is MarkerNode => isMarkerNode(node))
            .map(node => [node.nodeId, node.type]),
    )
    for (const candidate of withoutCandidate) {
        if (candidate.type !== 'image' && candidate.type !== 'video' && candidate.type !== 'capabilityArtifact') continue
        if (candidate.generatedBy?.branchOriginNodeId) referencedOriginNodeIds.add(candidate.generatedBy.branchOriginNodeId)
        if (candidate.generatedBy?.branchForkNodeId) referencedForkNodeIds.add(candidate.generatedBy.branchForkNodeId)
        if (candidate.generatedBy?.branchLineNodeId) referencedLineNodeIds.add(candidate.generatedBy.branchLineNodeId)
        const lineageParentNodeId = candidate.generatedBy?.lineageParentNodeId
        const lineageParentType = lineageParentNodeId ? markerTypeByNodeId.get(lineageParentNodeId) : undefined
        if (lineageParentNodeId && lineageParentType === 'branchOrigin') referencedOriginNodeIds.add(lineageParentNodeId)
        if (lineageParentNodeId && lineageParentType === 'branchFork') referencedForkNodeIds.add(lineageParentNodeId)
        if (lineageParentNodeId && lineageParentType === 'branchLine') referencedLineNodeIds.add(lineageParentNodeId)
    }
    const removedNodeIds = new Set<string>([nodeId])
    const nodes = withoutCandidate.filter((candidate) => {
        const remove = (candidate.type === 'branchOrigin' && !referencedOriginNodeIds.has(candidate.nodeId))
            || (candidate.type === 'branchFork' && !referencedForkNodeIds.has(candidate.nodeId))
            || (candidate.type === 'branchLine' && !referencedLineNodeIds.has(candidate.nodeId))
        if (remove) removedNodeIds.add(candidate.nodeId)
        return !remove
    })
    const edges = (canvasState.edges ?? []).filter((edge) => !removedNodeIds.has(edge.sourceNodeId) && !removedNodeIds.has(edge.targetNodeId))
    const removedEdgeIds = (canvasState.edges ?? [])
        .filter((edge) => !edges.some((candidate) => candidate.edgeId === edge.edgeId))
        .map(edge => edge.edgeId)
    const nextContextChips = canvasState.aiChatPanel?.contextChips.filter((candidateNodeId) => !removedNodeIds.has(candidateNodeId))
    const next = rebalance({
        ...canvasState,
        ...(canvasState.aiChatPanel
            ? {
                aiChatPanel: { ...canvasState.aiChatPanel, contextChips: nextContextChips ?? [] },
            }
            : {}),
        nodes,
        edges,
    }).state
    return {
        canvasState: next,
        geometryNodes: geometryDiff(canvasState, next),
        removedNodeIds: [...removedNodeIds],
        removedEdgeIds,
    }
}

const isGeneratedOutputForRequest = (
    node: CanvasNode,
    generationRequestId: string,
    conversationAssetId: string,
): node is GeneratedOutputNode => {
    if (node.type !== 'image' && node.type !== 'video' && node.type !== 'capabilityArtifact') return false
    const generatedBy = node.generatedBy
    return (generatedBy?.generationRequestId === generationRequestId
        && generatedBy.conversationAssetId === conversationAssetId)
        || ((node.type === 'image' || node.type === 'video')
            && node.generationProgress?.generationRequestId === generationRequestId)
}

const removeGenerationRequestProjectionNode = ({
    canvasState,
    generationRequestId,
    conversationAssetId,
    assetNodeId,
}: {
    canvasState: CanvasState
    generationRequestId: string
    conversationAssetId: string
    assetNodeId?: string
}): {
    canvasState: CanvasState
    removedNodeIds: string[]
    removedEdgeIds: string[]
} => {
    const removedNodeIds = new Set(assetNodeId ? [assetNodeId] : [])
    for (const node of canvasState.nodes) {
        if (
            node.type === 'operationStatus'
            && node.operation === 'media-generation'
            && node.generationRequestId === generationRequestId
        ) {
            removedNodeIds.add(node.nodeId)
        }
    }
    const hasRemainingGeneratedOutput = canvasState.nodes.some((node) =>
        node.nodeId !== assetNodeId
        && isGeneratedOutputForRequest(node, generationRequestId, conversationAssetId)
    )
    if (!hasRemainingGeneratedOutput) {
        for (const node of canvasState.nodes) {
            if (
                isMarkerNode(node)
                && node.generationRequestId === generationRequestId
                && node.conversationAssetId === conversationAssetId
            ) {
                removedNodeIds.add(node.nodeId)
            }
        }
    }
    if (removedNodeIds.size === 0) {
        return { canvasState, removedNodeIds: [], removedEdgeIds: [] }
    }

    const nodes = canvasState.nodes.filter((node) => !removedNodeIds.has(node.nodeId))
    const edges = (canvasState.edges ?? []).filter((edge) => !removedNodeIds.has(edge.sourceNodeId) && !removedNodeIds.has(edge.targetNodeId))
    const retainedEdgeIds = new Set(edges.map((edge) => edge.edgeId))
    const removedEdgeIds = (canvasState.edges ?? [])
        .filter((edge) => !retainedEdgeIds.has(edge.edgeId))
        .map((edge) => edge.edgeId)
    return {
        canvasState: rebalance({ ...canvasState, nodes, edges }).state,
        removedNodeIds: [...removedNodeIds],
        removedEdgeIds,
    }
}

const removeGeneratedAssetConversationSurface = async ({
    asset,
    generationRequestId,
    conversationAssetId,
}: {
    asset: Asset
    generationRequestId: string
    conversationAssetId: string
}): Promise<void> => {
    const sourceConversationAssetId = asset.lineage?.sourceConversationAssetId
    const mediaRunId = asset.lineage?.mediaRunId ?? asset.lineage?.reasoningRunId
    if (
        asset.lineage?.generationRequestId !== generationRequestId
        || sourceConversationAssetId !== conversationAssetId
        || !mediaRunId
    ) return

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await AssetModel.removeAssetSurfaceReferenceSystem({
                assetId: asset.assetId,
                organizationId: asset.organizationId,
                surfaceId: `conversation#${sourceConversationAssetId}#media#${mediaRunId}`,
            })
            return
        } catch (error) {
            if (attempt < 2) continue
            err(`[asset-canvas-projection] failed to remove cancelled generation Asset surface ${asset.assetId}:`, error)
        }
    }
}

export const removeMediaGenerationRequestFromCanvas = async ({
    workspaceId,
    generationRequestId,
    conversationAssetId,
    requester,
}: {
    workspaceId: string
    generationRequestId: string
    conversationAssetId: string
    requester: AssetRequesterContext
}): Promise<CanvasGeometryUpdate | null> => {
    const removedNodeIds = new Set<string>()
    const removedEdgeIds = new Set<string>()

    for (let operation = 0; operation < 100; operation += 1) {
        const workspace = await Workspace.getWorkspace({ workspaceId, userId: requester.userId })
        if ('error' in workspace) throw new Error(workspace.error)
        const assetNode = workspace.canvasState.nodes.find((node) => isGeneratedOutputForRequest(node, generationRequestId, conversationAssetId))

        if (assetNode) {
            const asset = await getAssetRecord(assetNode.assetId)
            const isUnboundReservation = (assetNode.type === 'image' || assetNode.type === 'video')
                && assetNode.mediaGenerationPhase === 'pending-before-first-frame'
                && assetNode.generationProgress?.generationRequestId === generationRequestId
                && !assetNode.generatedBy
            if (isUnboundReservation) {
                let removal = removeGenerationRequestProjectionNode({
                    canvasState: workspace.canvasState,
                    generationRequestId,
                    conversationAssetId,
                    assetNodeId: assetNode.nodeId,
                })
                const persisted = await Workspace.mutateCanvasState({
                    workspaceId,
                    origin: 'removeUnboundMediaGenerationOutputFromCanvas',
                    allowUnboundGeneratedMediaReservationMutation: true,
                    mutate: canvasState => {
                        removal = removeGenerationRequestProjectionNode({
                            canvasState,
                            generationRequestId,
                            conversationAssetId,
                            assetNodeId: assetNode.nodeId,
                        })
                        return {
                            canvasState: removal.canvasState,
                            changed: removal.removedNodeIds.length > 0,
                        }
                    },
                })
                if (!persisted.canvasState || persisted.canvasStateUpdatedAt === null) {
                    throw new Error('WORKSPACE_NOT_FOUND')
                }
                removal.removedNodeIds.forEach(nodeId => removedNodeIds.add(nodeId))
                removal.removedEdgeIds.forEach(edgeId => removedEdgeIds.add(edgeId))
                if (asset) {
                    if (
                        asset.lineage?.generationRequestId !== generationRequestId
                        || asset.lineage?.sourceConversationAssetId !== conversationAssetId
                    ) {
                        throw new Error(`GENERATION_REQUEST_ASSET_LINEAGE_MISMATCH:${asset.assetId}`)
                    }
                    await removeGeneratedAssetConversationSurface({
                        asset,
                        generationRequestId,
                        conversationAssetId,
                    })
                }
                continue
            }
            if (!asset) throw new Error(`GENERATION_REQUEST_ASSET_NOT_FOUND:${assetNode.assetId}`)
            const removal = removeGenerationRequestProjectionNode({
                canvasState: workspace.canvasState,
                generationRequestId,
                conversationAssetId,
                assetNodeId: assetNode.nodeId,
            })
            const expectedCanvasStateUpdatedAt = workspace.canvasStateUpdatedAt ?? workspace.updatedAt
            let detached: Awaited<ReturnType<typeof AssetModel.detachWorkspaceReference>>
            try {
                detached = await AssetModel.detachWorkspaceReference({
                    assetId: assetNode.assetId,
                    workspaceId,
                    requester,
                    nodeId: assetNode.nodeId,
                    workspaceMutation: {
                        expectedCanvasStateUpdatedAt,
                        canvasStateUpdatedAt: Math.max(Date.now(), expectedCanvasStateUpdatedAt + 1),
                        canvasState: removal.canvasState,
                    },
                })
            } catch (error) {
                if (isTransactionConditionalCheckFailure(error)) continue
                throw error
            }
            if ('error' in detached) {
                if (detached.error === 'STALE_CANVAS_STATE') continue
                throw new Error(detached.error)
            }
            removal.removedNodeIds.forEach((nodeId) => removedNodeIds.add(nodeId))
            removal.removedEdgeIds.forEach((edgeId) => removedEdgeIds.add(edgeId))

            await removeGeneratedAssetConversationSurface({ asset, generationRequestId, conversationAssetId })
            continue
        }

        let markerRemoval = removeGenerationRequestProjectionNode({
            canvasState: workspace.canvasState,
            generationRequestId,
            conversationAssetId,
        })
        if (markerRemoval.removedNodeIds.length > 0) {
            const persisted = await Workspace.mutateCanvasState({
                workspaceId,
                origin: 'removeCancelledMediaGenerationRequestFromCanvas',
                mutate: (canvasState) => {
                    markerRemoval = removeGenerationRequestProjectionNode({
                        canvasState,
                        generationRequestId,
                        conversationAssetId,
                    })
                    return {
                        canvasState: markerRemoval.canvasState,
                        changed: markerRemoval.removedNodeIds.length > 0,
                    }
                },
            })
            if (!persisted.canvasState || persisted.canvasStateUpdatedAt === null) {
                throw new Error('WORKSPACE_NOT_FOUND')
            }
            markerRemoval.removedNodeIds.forEach((nodeId) => removedNodeIds.add(nodeId))
            markerRemoval.removedEdgeIds.forEach((edgeId) => removedEdgeIds.add(edgeId))
            continue
        }

        if (removedNodeIds.size === 0) return null
        const layoutRevision = workspace.canvasStateUpdatedAt ?? workspace.updatedAt
        return {
            generationRequestId,
            layoutRevision,
            nodes: workspace.canvasState.nodes.map((node) => ({
                nodeId: node.nodeId,
                position: node.position,
                dimensions: node.dimensions,
                ...(node.parentId ? { parentNodeId: node.parentId } : {}),
            })),
            nodeSnapshots: workspace.canvasState.nodes,
            edgeSnapshots: workspace.canvasState.edges,
            removedNodeIds: [...removedNodeIds],
            removedEdgeIds: [...removedEdgeIds],
        }
    }

    throw new Error(`GENERATION_REQUEST_CANVAS_REMOVAL_EXHAUSTED:${generationRequestId}`)
}

export const logCanvasProjectionError = (context: string, error: unknown): void => {
    err(`[asset-canvas-projection] ${context}:`, error)
}
