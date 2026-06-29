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

const MARKER_WIDTH = 280
const MARKER_HEIGHT = 64
const MEDIA_WIDTH = 600
const MEDIA_HEIGHT = 600
const HORIZONTAL_GAP = 384
const ROW_GAP = 220

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
    generationRun?: MediaGenerationRunMeta
}

type MarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
type GeneratedByLineageMetadata = Partial<ImageGeneratedByMetadata & VideoGeneratedByMetadata>

function markerDimensions(): { width: number; height: number } {
    return { width: MARKER_WIDTH, height: MARKER_HEIGHT }
}

function mediaDimensions(aspectRatio = 1): { width: number; height: number } {
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
    return { width: MEDIA_WIDTH, height: MEDIA_WIDTH / safeAspectRatio }
}

function parseAspectRatio(value: string): number {
    const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value)
    if (!match) return 1
    const width = Number(match[1])
    const height = Number(match[2])
    return Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : 1
}

function fallbackPosition(index: number, dimensions: { width: number; height: number }): { x: number; y: number } {
    return { x: 0, y: index * (dimensions.height + ROW_GAP) }
}

function positionRightOf(
    sourceNode: CanvasNode | undefined,
    dimensions: { width: number; height: number },
    fallbackIndex: number,
): { x: number; y: number } {
    if (!sourceNode) return fallbackPosition(fallbackIndex, dimensions)
    return {
        x: sourceNode.position.x + sourceNode.dimensions.width + HORIZONTAL_GAP,
        y: sourceNode.position.y + sourceNode.dimensions.height / 2 - dimensions.height / 2,
    }
}

function findNode(nodes: CanvasNode[], nodeId: string | undefined): CanvasNode | undefined {
    return nodeId ? nodes.find(node => node.nodeId === nodeId) : undefined
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
    anchorNodeId?: string,
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
        position: positionRightOf(findNode(nodes, anchorNodeId), dimensions, fallbackIndex),
        dimensions,
        temporary: true,
    }
}

function branchForkNodeFromPlan(
    plan: BranchForkLineagePlan,
    aiChatThreadId: string,
    nodes: CanvasNode[],
    fallbackIndex: number,
): BranchForkCanvasNode {
    const dimensions = markerDimensions()
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
        position: positionRightOf(findNode(nodes, plan.parentBranchNodeId), dimensions, fallbackIndex),
        dimensions,
        temporary: true,
    }
}

function branchLineNodeFromPlan(
    plan: BranchLineLineagePlan,
    aiChatThreadId: string,
    nodes: CanvasNode[],
    fallbackIndex: number,
): BranchLineCanvasNode {
    const dimensions = markerDimensions()
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
        position: positionRightOf(findNode(nodes, plan.parentBranchNodeId), dimensions, fallbackIndex),
        dimensions,
        temporary: true,
    }
}

function markerNodesFromLineagePlan(
    lineagePlan: MediaBranchLineagePlan,
    aiChatThreadId: string,
    state: CanvasState,
): MarkerNode[] {
    const markers: MarkerNode[] = []
    const anchorNodeId = lineagePlan.placementAnchorNodeId ?? lineagePlan.sourceNodeId
    if (lineagePlan.branchOrigin) {
        markers.push(branchOriginNodeFromPlan(lineagePlan.branchOrigin, aiChatThreadId, state.nodes, markers.length, anchorNodeId))
    }
    for (const fork of lineagePlan.branchForks) {
        markers.push(branchForkNodeFromPlan(fork, aiChatThreadId, [...state.nodes, ...markers], markers.length))
    }
    for (const line of lineagePlan.branchLines) {
        markers.push(branchLineNodeFromPlan(line, aiChatThreadId, [...state.nodes, ...markers], markers.length))
    }
    return markers
}

function markerNodesFromAssignment(
    assignment: MediaRunLineageAssignment,
    aiChatThreadId: string,
    state: CanvasState,
): MarkerNode[] {
    const markers: MarkerNode[] = []
    if (assignment.branchOriginNodeId) {
        markers.push({
            nodeId: assignment.branchOriginNodeId,
            type: 'branchOrigin',
            branchId: assignment.branchId,
            generationRequestId: assignment.generationRequestId,
            aiChatThreadId,
            position: fallbackPosition(markers.length, markerDimensions()),
            dimensions: markerDimensions(),
            temporary: true,
        })
    }
    if (assignment.branchForkNodeId) {
        const parentBranchNodeId = assignment.branchOriginNodeId
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
            position: positionRightOf(findNode([...state.nodes, ...markers], parentBranchNodeId), markerDimensions(), markers.length),
            dimensions: markerDimensions(),
            temporary: true,
        })
    }
    if (assignment.branchLineNodeId) {
        const parentBranchNodeId = assignment.parentMediaNodeId ?? assignment.branchOriginNodeId
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
            position: positionRightOf(findNode([...state.nodes, ...markers], parentBranchNodeId), markerDimensions(), markers.length),
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
}): Promise<void> {
    await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertMediaLineagePlanToCanvas',
        mutate: (canvasState) => {
            const markers = markerNodesFromLineagePlan(params.lineagePlan, params.aiChatThreadId, canvasState)
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
            const markerResult = ensureMarkers(canvasState, markerNodesFromAssignment(assignment, params.aiChatThreadId, canvasState))
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
                position: existing?.position ?? positionRightOf(sourceNode, dimensions, nextState.nodes.length),
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
            const markerResult = ensureMarkers(canvasState, markerNodesFromAssignment(assignment, params.aiChatThreadId, canvasState))
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
                position: existing?.position ?? positionRightOf(sourceNode, dimensions, nextState.nodes.length),
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
