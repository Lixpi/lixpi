'use strict'

import {
    type AiModelId,
    type BranchForkCanvasNode,
    type BranchForkLineagePlan,
    type BranchLineCanvasNode,
    type BranchLineLineagePlan,
    type BranchOriginCanvasNode,
    type BranchOriginLineagePlan,
    type CanvasNode,
    type CanvasState,
    type ImageGeneratedByMetadata,
    type ImageCanvasNode,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
    type MediaRunLineageAssignment,
    type VideoGeneratedByMetadata,
    type VideoCanvasNode,
    type WorkspaceEdge,
} from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'

import Workspace from '../models/workspace.ts'
import { settings } from '../settings.ts'

const canvasProjectionSettings = settings.mediaGenerationCanvasProjection

type CanvasViewport = {
    x: number
    y: number
    zoom: number
}

type CanvasVisibleArea = {
    width: number
    height: number
}

type CanvasStateWithViewport = CanvasState & {
    viewport?: CanvasViewport
}

type UpsertImageInput = {
    workspaceId: string
    aiChatThreadId: string
    imageUrl: string
    fileId: string
    responseId: string
    revisedPrompt: string
    aiProvider: string
    imageModelProvider: string
    imageModelId: string
    canvasVisibleArea?: CanvasVisibleArea
    generationRun?: MediaGenerationRunMeta
}

type UpsertVideoInput = {
    workspaceId: string
    aiChatThreadId: string
    videoUrl: string
    fileId: string
    posterUrl: string
    posterFileId: string
    frameUrl: string
    frameFileId: string
    durationSeconds: number
    aspectRatio: string
    hasAudio: boolean
    responseId: string
    revisedPrompt: string
    aiProvider: string
    videoModelProvider: string
    videoModelId: string
    canvasVisibleArea?: CanvasVisibleArea
    generationRun?: MediaGenerationRunMeta
}

type MarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
type GeneratedByLineageMetadata = Partial<ImageGeneratedByMetadata & VideoGeneratedByMetadata>
type BranchMarkerSiblingSlot = {
    index: number
    count: number
}

function markerDimensions(): { width: number; height: number } {
    return {
        width: canvasProjectionSettings.markerWidth,
        height: canvasProjectionSettings.markerHeight,
    }
}

function mediaDimensions(aspectRatio = 1): { width: number; height: number } {
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
    return {
        width: canvasProjectionSettings.generatedMediaSize,
        height: canvasProjectionSettings.generatedMediaSize / safeAspectRatio,
    }
}

function parseAspectRatio(value: string): number {
    const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value)
    if (!match) return 1
    const width = Number(match[1])
    const height = Number(match[2])
    return Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : 1
}

function getSafeViewportZoom(viewport: CanvasViewport): number {
    return Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
}

function getFiniteNumber(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? Number(value) : fallback
}

function clampInsideRange(value: number, min: number, max: number): number {
    if (max < min) return min
    return Math.min(max, Math.max(min, value))
}

function getCanvasViewport(state: CanvasState): CanvasViewport {
    const viewport = (state as CanvasStateWithViewport).viewport
    const zoom = getFiniteNumber(viewport?.zoom, 1)
    return {
        x: getFiniteNumber(viewport?.x, 0),
        y: getFiniteNumber(viewport?.y, 0),
        zoom: zoom > 0 ? zoom : 1,
    }
}

function fallbackPosition(
    state: CanvasState,
    index: number,
    dimensions: { width: number; height: number },
    canvasVisibleArea?: CanvasVisibleArea,
): { x: number; y: number } {
    const viewport = getCanvasViewport(state)
    const zoom = getSafeViewportZoom(viewport)
    const visibleLeft = (0 - viewport.x) / zoom
    const visibleTop = (0 - viewport.y) / zoom
    const paneHeight = getFiniteNumber(canvasVisibleArea?.height, canvasProjectionSettings.serverFallbackPaneHeight)
    const visibleHeight = paneHeight / zoom
    const viewportEdgeGap = canvasProjectionSettings.nodeGap / zoom
    const stackStep = dimensions.height + canvasProjectionSettings.branchRowGap
    const minY = visibleTop + viewportEdgeGap
    const maxY = visibleTop + visibleHeight - dimensions.height - viewportEdgeGap
    const centeredY = visibleTop + (visibleHeight - dimensions.height) / 2
    return {
        x: visibleLeft + viewportEdgeGap,
        y: clampInsideRange(centeredY, minY, maxY) + index * stackStep,
    }
}

function getGapToGeneratedMedia(sourceNode: CanvasNode | undefined): number {
    if (!sourceNode) return canvasProjectionSettings.rootToFirstMediaGap
    if (sourceNode.type === 'branchOrigin') return canvasProjectionSettings.branchOriginToFirstMediaGap
    if (sourceNode.type === 'branchFork' && !sourceNode.parentBranchNodeId) return canvasProjectionSettings.rootToFirstMediaGap
    return canvasProjectionSettings.mediaToMediaGap
}

function positionRightOf(
    sourceNode: CanvasNode | undefined,
    dimensions: { width: number; height: number },
    fallbackIndex: number,
    state: CanvasState,
    canvasVisibleArea?: CanvasVisibleArea,
    gap = getGapToGeneratedMedia(sourceNode),
): { x: number; y: number } {
    if (!sourceNode) return fallbackPosition(state, fallbackIndex, dimensions, canvasVisibleArea)
    return {
        x: sourceNode.position.x + sourceNode.dimensions.width + gap,
        y: sourceNode.position.y + sourceNode.dimensions.height / 2 - dimensions.height / 2,
    }
}

function positionBranchMarkerBeforeGeneratedMedia(
    parentNode: CanvasNode | undefined,
    dimensions: { width: number; height: number },
    fallbackIndex: number,
    state: CanvasState,
    canvasVisibleArea?: CanvasVisibleArea,
    siblingSlot?: BranchMarkerSiblingSlot,
): { x: number; y: number } {
    if (!parentNode) return fallbackPosition(state, fallbackIndex, dimensions, canvasVisibleArea)

    const siblingCount = siblingSlot?.count ?? 1
    const mediaGap = getGapToGeneratedMedia(parentNode)
        + canvasProjectionSettings.branchFanoutExtraGap * Math.max(0, siblingCount - 1)
    const mediaBox = mediaDimensions()
    const futureMediaPosition = positionRightOf(parentNode, mediaBox, fallbackIndex, state, canvasVisibleArea, mediaGap)
    const parentAnchorX = parentNode.position.x + parentNode.dimensions.width
    const parentAnchorY = parentNode.position.y + parentNode.dimensions.height / 2

    if (parentNode.type === 'branchOrigin') {
        const stackIndex = siblingSlot?.index ?? 0
        return {
            x: (parentAnchorX + futureMediaPosition.x) / 2 - dimensions.width / 2,
            y: parentNode.position.y + parentNode.dimensions.height
                + canvasProjectionSettings.nodeGap
                + stackIndex * (dimensions.height + canvasProjectionSettings.nodeGap),
        }
    }

    const mediaStep = mediaBox.height + canvasProjectionSettings.branchRowGap
    const mediaStackHeight = mediaBox.height * siblingCount
        + canvasProjectionSettings.branchRowGap * Math.max(0, siblingCount - 1)
    const firstMediaCenterY = parentAnchorY - mediaStackHeight / 2 + mediaBox.height / 2
    const futureMediaCenterY = siblingSlot
        ? firstMediaCenterY + mediaStep * siblingSlot.index
        : futureMediaPosition.y + mediaBox.height / 2

    return {
        x: (parentAnchorX + futureMediaPosition.x) / 2 - dimensions.width / 2,
        y: (parentAnchorY + futureMediaCenterY) / 2 - dimensions.height / 2,
    }
}

function findNode(nodes: CanvasNode[], nodeId: string | undefined): CanvasNode | undefined {
    return nodeId ? nodes.find(node => node.nodeId === nodeId) : undefined
}

function getGeneratedMediaPosition(
    sourceNode: CanvasNode | undefined,
    nodes: CanvasNode[],
    dimensions: { width: number; height: number },
    fallbackIndex: number,
    state: CanvasState,
    canvasVisibleArea?: CanvasVisibleArea,
): { x: number; y: number } {
    if (sourceNode?.type === 'branchFork' || sourceNode?.type === 'branchLine') {
        const parentNode = findNode(nodes, sourceNode.parentBranchNodeId)
        if (parentNode) return positionRightOf(parentNode, dimensions, fallbackIndex, state, canvasVisibleArea)
    }
    return positionRightOf(sourceNode, dimensions, fallbackIndex, state, canvasVisibleArea)
}

function getPlanSiblingSlot(
    lineagePlan: MediaBranchLineagePlan,
    markerNodeId: string,
    parentBranchNodeId: string | undefined,
): BranchMarkerSiblingSlot | undefined {
    if (!parentBranchNodeId) return undefined
    const siblings = [...lineagePlan.branchForks, ...lineagePlan.branchLines]
        .filter(marker => marker.parentBranchNodeId === parentBranchNodeId)
        .sort((a, b) => {
            const reasoningDelta = a.reasoningIndex - b.reasoningIndex
            if (reasoningDelta !== 0) return reasoningDelta
            return a.nodeId.localeCompare(b.nodeId)
        })
    const index = siblings.findIndex(marker => marker.nodeId === markerNodeId)
    return index >= 0 ? { index, count: siblings.length } : undefined
}

function findGeneratedMediaNodeForRun(
    nodes: CanvasNode[],
    mediaType: 'image' | 'video',
    fileId: string,
    generationRun: MediaGenerationRunMeta | undefined,
): ImageCanvasNode | VideoCanvasNode | undefined {
    return nodes.find((node): node is ImageCanvasNode | VideoCanvasNode => {
        if (node.type !== mediaType) return false
        if (fileId && node.fileId === fileId) return true
        const generatedBy = node.generatedBy
        if (!generatedBy || !generationRun) return false
        if (generationRun.mediaRunId && generatedBy.mediaRunId === generationRun.mediaRunId) return true
        return Boolean(
            generationRun.generationRequestId
            && generatedBy.generationRequestId === generationRun.generationRequestId
            && generationRun.mediaModelId
            && generatedBy.mediaModelId === generationRun.mediaModelId
        )
    })
}

function upsertNode(nodes: CanvasNode[], nextNode: CanvasNode): { nodes: CanvasNode[]; changed: boolean } {
    const index = nodes.findIndex(node => node.nodeId === nextNode.nodeId)
    if (index < 0) return { nodes: [...nodes, nextNode], changed: true }

    const existing = nodes[index]
    const mergedNode = {
        ...existing,
        ...nextNode,
        position: existing.position,
        dimensions: existing.dimensions,
    } as CanvasNode
    return {
        nodes: nodes.map((node, nodeIndex) => nodeIndex === index ? mergedNode : node),
        changed: JSON.stringify(existing) !== JSON.stringify(mergedNode),
    }
}

function addEdgeIfMissing(edges: WorkspaceEdge[], edge: WorkspaceEdge | undefined): { edges: WorkspaceEdge[]; changed: boolean } {
    if (!edge) return { edges, changed: false }
    if (edges.some(existing => existing.edgeId === edge.edgeId)) return { edges, changed: false }
    return { edges: [...edges, edge], changed: true }
}

function createMarkerEdge(markerNode: BranchForkCanvasNode | BranchLineCanvasNode): WorkspaceEdge | undefined {
    if (!markerNode.parentBranchNodeId) return undefined
    return {
        edgeId: `edge-${markerNode.parentBranchNodeId}-${markerNode.nodeId}`,
        sourceNodeId: markerNode.parentBranchNodeId,
        targetNodeId: markerNode.nodeId,
        sourceHandle: 'right',
        targetHandle: 'left',
    }
}

function branchOriginNodeFromPlan(
    plan: BranchOriginLineagePlan,
    aiChatThreadId: string,
    nodes: CanvasNode[],
    fallbackIndex: number,
    state: CanvasState,
    anchorNodeId?: string,
    canvasVisibleArea?: CanvasVisibleArea,
): BranchOriginCanvasNode {
    const dimensions = markerDimensions()
    return {
        nodeId: plan.nodeId,
        type: 'branchOrigin',
        branchId: plan.branchId,
        generationRequestId: plan.generationRequestId,
        aiChatThreadId,
        ...(plan.promptFingerprint ? { promptFingerprint: plan.promptFingerprint } : {}),
        provenance: plan.provenance,
        position: positionRightOf(findNode(nodes, anchorNodeId), dimensions, fallbackIndex, state, canvasVisibleArea),
        dimensions,
        temporary: true,
    }
}

function branchForkNodeFromPlan(
    plan: BranchForkLineagePlan,
    aiChatThreadId: string,
    nodes: CanvasNode[],
    fallbackIndex: number,
    state: CanvasState,
    canvasVisibleArea?: CanvasVisibleArea,
    siblingSlot?: BranchMarkerSiblingSlot,
): BranchForkCanvasNode {
    const dimensions = markerDimensions()
    const parentNode = findNode(nodes, plan.parentBranchNodeId)
    return {
        nodeId: plan.nodeId,
        type: 'branchFork',
        branchId: plan.branchId,
        generationRequestId: plan.generationRequestId,
        aiChatThreadId,
        reasoningRunId: plan.reasoningRunId,
        reasoningModelId: plan.reasoningModelId,
        reasoningIndex: plan.reasoningIndex,
        ...(plan.parentBranchNodeId ? { parentBranchNodeId: plan.parentBranchNodeId } : {}),
        ...(plan.promptFingerprint ? { promptFingerprint: plan.promptFingerprint } : {}),
        provenance: plan.provenance,
        position: plan.parentBranchNodeId
            ? positionBranchMarkerBeforeGeneratedMedia(parentNode, dimensions, fallbackIndex, state, canvasVisibleArea, siblingSlot)
            : positionRightOf(parentNode, dimensions, fallbackIndex, state, canvasVisibleArea),
        dimensions,
        temporary: true,
    }
}

function branchLineNodeFromPlan(
    plan: BranchLineLineagePlan,
    aiChatThreadId: string,
    nodes: CanvasNode[],
    fallbackIndex: number,
    state: CanvasState,
    canvasVisibleArea?: CanvasVisibleArea,
    siblingSlot?: BranchMarkerSiblingSlot,
): BranchLineCanvasNode {
    const dimensions = markerDimensions()
    const parentNode = findNode(nodes, plan.parentBranchNodeId)
    return {
        nodeId: plan.nodeId,
        type: 'branchLine',
        branchId: plan.branchId,
        generationRequestId: plan.generationRequestId,
        aiChatThreadId,
        reasoningRunId: plan.reasoningRunId,
        reasoningModelId: plan.reasoningModelId,
        reasoningIndex: plan.reasoningIndex,
        ...(plan.mediaRunId ? { mediaRunId: plan.mediaRunId } : {}),
        ...(plan.mediaModelId ? { mediaModelId: plan.mediaModelId } : {}),
        ...(plan.mediaType ? { mediaType: plan.mediaType } : {}),
        parentBranchNodeId: plan.parentBranchNodeId,
        ...(plan.promptFingerprint ? { promptFingerprint: plan.promptFingerprint } : {}),
        provenance: plan.provenance,
        position: positionBranchMarkerBeforeGeneratedMedia(parentNode, dimensions, fallbackIndex, state, canvasVisibleArea, siblingSlot),
        dimensions,
        temporary: true,
    }
}

function markerNodesFromLineagePlan(
    lineagePlan: MediaBranchLineagePlan,
    aiChatThreadId: string,
    state: CanvasState,
    canvasVisibleArea?: CanvasVisibleArea,
): MarkerNode[] {
    const markers: MarkerNode[] = []
    const anchorNodeId = lineagePlan.placementAnchorNodeId ?? lineagePlan.sourceNodeId
    if (lineagePlan.branchOrigin) {
        markers.push(branchOriginNodeFromPlan(lineagePlan.branchOrigin, aiChatThreadId, state.nodes, markers.length, state, anchorNodeId, canvasVisibleArea))
    }
    for (const fork of lineagePlan.branchForks) {
        markers.push(branchForkNodeFromPlan(
            fork,
            aiChatThreadId,
            [...state.nodes, ...markers],
            markers.length,
            state,
            canvasVisibleArea,
            getPlanSiblingSlot(lineagePlan, fork.nodeId, fork.parentBranchNodeId),
        ))
    }
    for (const line of lineagePlan.branchLines) {
        markers.push(branchLineNodeFromPlan(
            line,
            aiChatThreadId,
            [...state.nodes, ...markers],
            markers.length,
            state,
            canvasVisibleArea,
            getPlanSiblingSlot(lineagePlan, line.nodeId, line.parentBranchNodeId),
        ))
    }
    return markers
}

function markerNodesFromAssignment(
    assignment: MediaRunLineageAssignment,
    aiChatThreadId: string,
    state: CanvasState,
    canvasVisibleArea?: CanvasVisibleArea,
): MarkerNode[] {
    const markers: MarkerNode[] = []
    if (assignment.branchOriginNodeId) {
        markers.push({
            nodeId: assignment.branchOriginNodeId,
            type: 'branchOrigin',
            branchId: assignment.branchId,
            generationRequestId: assignment.generationRequestId,
            aiChatThreadId,
            position: fallbackPosition(state, markers.length, markerDimensions(), canvasVisibleArea),
            dimensions: markerDimensions(),
            temporary: true,
        })
    }
    if (assignment.branchForkNodeId) {
        const parentBranchNodeId = assignment.branchOriginNodeId
        const parentNode = findNode([...state.nodes, ...markers], parentBranchNodeId)
        markers.push({
            nodeId: assignment.branchForkNodeId,
            type: 'branchFork',
            branchId: assignment.branchId,
            generationRequestId: assignment.generationRequestId,
            aiChatThreadId,
            ...(assignment.reasoningRunId ? { reasoningRunId: assignment.reasoningRunId } : {}),
            ...(assignment.reasoningModelId ? { reasoningModelId: assignment.reasoningModelId } : {}),
            reasoningIndex: 0,
            ...(parentBranchNodeId ? { parentBranchNodeId } : {}),
            position: parentBranchNodeId
                ? positionBranchMarkerBeforeGeneratedMedia(parentNode, markerDimensions(), markers.length, state, canvasVisibleArea)
                : positionRightOf(parentNode, markerDimensions(), markers.length, state, canvasVisibleArea),
            dimensions: markerDimensions(),
            temporary: true,
        })
    }
    if (assignment.branchLineNodeId) {
        const parentBranchNodeId = assignment.parentMediaNodeId ?? assignment.branchOriginNodeId
        const parentNode = findNode([...state.nodes, ...markers], parentBranchNodeId)
        markers.push({
            nodeId: assignment.branchLineNodeId,
            type: 'branchLine',
            branchId: assignment.branchId,
            generationRequestId: assignment.generationRequestId,
            aiChatThreadId,
            ...(assignment.reasoningRunId ? { reasoningRunId: assignment.reasoningRunId } : {}),
            ...(assignment.reasoningModelId ? { reasoningModelId: assignment.reasoningModelId } : {}),
            reasoningIndex: 0,
            ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
            ...(assignment.mediaModelId ? { mediaModelId: assignment.mediaModelId } : {}),
            ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
            ...(parentBranchNodeId ? { parentBranchNodeId } : {}),
            position: parentBranchNodeId
                ? positionBranchMarkerBeforeGeneratedMedia(parentNode, markerDimensions(), markers.length, state, canvasVisibleArea)
                : positionRightOf(parentNode, markerDimensions(), markers.length, state, canvasVisibleArea),
            dimensions: markerDimensions(),
            temporary: true,
        })
    }
    return markers
}

function ensureMarkers(state: CanvasState, markers: MarkerNode[]): { state: CanvasState; changed: boolean } {
    let nodes = state.nodes
    let edges = state.edges ?? []
    let changed = false
    for (const marker of markers) {
        const nodeResult = upsertNode(nodes, marker)
        nodes = nodeResult.nodes
        changed = changed || nodeResult.changed
        if (marker.type === 'branchFork' || marker.type === 'branchLine') {
            const edgeResult = addEdgeIfMissing(edges, createMarkerEdge(marker))
            edges = edgeResult.edges
            changed = changed || edgeResult.changed
        }
    }
    return { state: { ...state, nodes, edges }, changed }
}

function getLineageParentNodeId(assignment: MediaRunLineageAssignment): string | undefined {
    return assignment.lineageParentNodeId
        ?? assignment.branchForkNodeId
        ?? assignment.branchLineNodeId
        ?? assignment.branchOriginNodeId
}

function generatedByLineage(assignment: MediaRunLineageAssignment | undefined): GeneratedByLineageMetadata {
    if (!assignment) return {}
    return {
        generationRequestId: assignment.generationRequestId,
        ...(assignment.reasoningRunId ? { reasoningRunId: assignment.reasoningRunId } : {}),
        ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
        ...(assignment.reasoningModelId ? { reasoningModelId: assignment.reasoningModelId } : {}),
        ...(assignment.mediaModelId ? { mediaModelId: assignment.mediaModelId } : {}),
        ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
        branchId: assignment.branchId,
        ...(assignment.parentMediaNodeId ? { parentMediaNodeId: assignment.parentMediaNodeId } : {}),
        ...(assignment.parentImageNodeId ? { parentImageNodeId: assignment.parentImageNodeId } : {}),
        ...(assignment.branchOriginNodeId ? { branchOriginNodeId: assignment.branchOriginNodeId } : {}),
        ...(assignment.branchForkNodeId ? { branchForkNodeId: assignment.branchForkNodeId } : {}),
        ...(assignment.branchLineNodeId ? { branchLineNodeId: assignment.branchLineNodeId } : {}),
        referenceImageNodeIds: assignment.referenceNodeIds,
        sourceContextNodeIds: assignment.sourceContextNodeIds,
        ...(assignment.operationKind ? { operationKind: assignment.operationKind } : {}),
        promptText: assignment.promptText,
        ...(assignment.promptFingerprint ? { promptFingerprint: assignment.promptFingerprint } : {}),
        createdAt: assignment.createdAt,
    }
}

function addGeneratedMediaEdge(
    state: CanvasState,
    sourceNodeId: string | undefined,
    targetNodeId: string,
): { state: CanvasState; changed: boolean } {
    if (!sourceNodeId) return { state, changed: false }
    const edgeResult = addEdgeIfMissing(state.edges ?? [], {
        edgeId: `edge-${sourceNodeId}-${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
        sourceHandle: 'right',
        targetHandle: 'left',
    })
    return { state: { ...state, edges: edgeResult.edges }, changed: edgeResult.changed }
}

function isImageNode(node: CanvasNode | undefined): node is ImageCanvasNode {
    return node?.type === 'image'
}

function isVideoNode(node: CanvasNode | undefined): node is VideoCanvasNode {
    return node?.type === 'video'
}

export async function upsertMediaLineagePlanToCanvas(params: {
    workspaceId: string
    aiChatThreadId: string
    lineagePlan: MediaBranchLineagePlan
    canvasVisibleArea?: CanvasVisibleArea
}): Promise<void> {
    await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertMediaLineagePlanToCanvas',
        mutate: (canvasState) => {
            const markers = markerNodesFromLineagePlan(params.lineagePlan, params.aiChatThreadId, canvasState, params.canvasVisibleArea)
            const markerResult = ensureMarkers(canvasState, markers)
            return {
                canvasState: markerResult.state,
                changed: markerResult.changed,
            }
        },
    })
}

export async function upsertGeneratedImageToCanvas(params: UpsertImageInput): Promise<void> {
    const assignment = params.generationRun?.lineageAssignment
    if (!assignment) return

    await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertGeneratedImageToCanvas',
        mutate: (canvasState) => {
            const markerResult = ensureMarkers(canvasState, markerNodesFromAssignment(assignment, params.aiChatThreadId, canvasState, params.canvasVisibleArea))
            let nextState = markerResult.state
            const existing = findGeneratedMediaNodeForRun(nextState.nodes, 'image', params.fileId, params.generationRun)
            const nodeId = existing?.nodeId ?? `node-${params.fileId}`
            const dimensions = existing?.dimensions ?? mediaDimensions()
            const lineageParentNodeId = getLineageParentNodeId(assignment)
            const sourceNode = findNode(nextState.nodes, lineageParentNodeId)
            const mediaModelId = (params.generationRun?.mediaModelId ?? `${params.imageModelProvider}:${params.imageModelId}`) as AiModelId
            const imageNode: ImageCanvasNode = {
                nodeId,
                type: 'image',
                fileId: params.fileId,
                workspaceId: params.workspaceId,
                src: params.imageUrl,
                aspectRatio: isImageNode(existing) ? existing.aspectRatio : 1,
                position: existing?.position ?? getGeneratedMediaPosition(sourceNode, nextState.nodes, dimensions, nextState.nodes.length, nextState, params.canvasVisibleArea),
                dimensions,
                generatedBy: {
                    aiChatThreadId: params.aiChatThreadId,
                    responseId: params.responseId,
                    aiModel: (params.generationRun?.reasoningModelId ?? params.aiProvider) as AiModelId,
                    imageModelProvider: params.imageModelProvider,
                    revisedPrompt: params.revisedPrompt || assignment.promptText,
                    responseMessageId: '',
                    ...generatedByLineage(assignment),
                    mediaModelId,
                },
            }
            const nodeResult = upsertNode(nextState.nodes, imageNode)
            nextState = { ...nextState, nodes: nodeResult.nodes }
            const edgeResult = addGeneratedMediaEdge(nextState, lineageParentNodeId, nodeId)
            nextState = edgeResult.state
            return {
                canvasState: nextState,
                changed: markerResult.changed || nodeResult.changed || edgeResult.changed,
            }
        },
    })
}

export async function upsertGeneratedVideoToCanvas(params: UpsertVideoInput): Promise<void> {
    const assignment = params.generationRun?.lineageAssignment
    if (!assignment) return

    await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertGeneratedVideoToCanvas',
        mutate: (canvasState) => {
            const markerResult = ensureMarkers(canvasState, markerNodesFromAssignment(assignment, params.aiChatThreadId, canvasState, params.canvasVisibleArea))
            let nextState = markerResult.state
            const existing = findGeneratedMediaNodeForRun(nextState.nodes, 'video', params.fileId, params.generationRun)
            const nodeId = existing?.nodeId ?? `node-${params.fileId}`
            const aspectRatio = parseAspectRatio(params.aspectRatio)
            const dimensions = existing?.dimensions ?? mediaDimensions(aspectRatio)
            const lineageParentNodeId = getLineageParentNodeId(assignment)
            const sourceNode = findNode(nextState.nodes, lineageParentNodeId)
            const videoNode: VideoCanvasNode = {
                nodeId,
                type: 'video',
                fileId: params.fileId,
                posterFileId: params.posterFileId,
                frameFileId: params.frameFileId,
                workspaceId: params.workspaceId,
                src: params.videoUrl,
                posterSrc: params.posterUrl,
                aspectRatio: isVideoNode(existing) ? existing.aspectRatio : aspectRatio,
                durationSeconds: params.durationSeconds,
                hasAudio: params.hasAudio,
                position: existing?.position ?? getGeneratedMediaPosition(sourceNode, nextState.nodes, dimensions, nextState.nodes.length, nextState, params.canvasVisibleArea),
                dimensions,
                generatedBy: {
                    aiChatThreadId: params.aiChatThreadId,
                    responseId: params.responseId,
                    videoModel: (params.generationRun?.mediaModelId ?? `${params.videoModelProvider}:${params.videoModelId}`) as AiModelId,
                    videoModelProvider: params.videoModelProvider,
                    revisedPrompt: params.revisedPrompt || assignment.promptText,
                    responseMessageId: '',
                    durationSeconds: params.durationSeconds,
                    aspectRatio: params.aspectRatio,
                    hasAudio: params.hasAudio,
                    ...generatedByLineage(assignment),
                    ...(params.generationRun?.mediaModelId ? { mediaModelId: params.generationRun.mediaModelId } : {}),
                },
            }
            const nodeResult = upsertNode(nextState.nodes, videoNode)
            nextState = { ...nextState, nodes: nodeResult.nodes }
            const edgeResult = addGeneratedMediaEdge(nextState, lineageParentNodeId, nodeId)
            nextState = edgeResult.state
            return {
                canvasState: nextState,
                changed: markerResult.changed || nodeResult.changed || edgeResult.changed,
            }
        },
    })
}

export function logCanvasProjectionError(context: string, error: unknown): void {
    err(`[media-generation-canvas-projection] ${context}:`, error)
}
