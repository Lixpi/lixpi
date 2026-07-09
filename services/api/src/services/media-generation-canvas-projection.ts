'use strict'

import {
    estimateBranchMarkerDimensions,
    fitDimensionsToAspectRatio,
    getGeneratedMediaChromeCollisionHeight,
    getPendingGeneratedMediaNodeId,
    getStartedLineageMarkerState,
    rebalanceBranchTreesAndResolve,
    type CanvasEngineRect,
} from '@lixpi/canvas-engine'
import {
    type AiModelId,
    type CanvasGeometryUpdate,
    type CanvasNodeGeometry,
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
    type WorkspaceCollisionFlowSettings,
    type WorkspaceCollisionNodeTypeSettings,
    type WorkspaceEdge,
} from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'
import {
    getBranchMarkerConversationPreviewFromThreadContent,
    shouldShowBranchMarkerConversationResponseLine,
    type BranchMarkerTurnDescriptor,
} from '@lixpi/prosemirror/shared/thread-doc'

import Workspace from '../models/workspace.ts'
import { settings } from '../settings.ts'

const canvasProjectionSettings = settings.mediaGenerationCanvasProjection
const workspaceCollisionSettings = settings.workspaceCollision

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
    // Intrinsic aspect ratio of the stored image bytes (width / height). The API
    // persists final fitted dimensions so clients never re-fit after load.
    aspectRatio?: number
    canvasVisibleArea?: CanvasVisibleArea
    generationRun?: MediaGenerationRunMeta
    proseMirrorThreadContent?: unknown
}

type UpsertPartialImageInput = {
    workspaceId: string
    aiChatThreadId: string
    imageUrl: string
    fileId: string
    aiProvider: string
    partialIndex: number
    aspectRatio?: number
    canvasVisibleArea?: CanvasVisibleArea
    generationRun?: MediaGenerationRunMeta
    proseMirrorThreadContent?: unknown
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
    proseMirrorThreadContent?: unknown
}

type MarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
type GeneratedByLineageMetadata = Partial<ImageGeneratedByMetadata & VideoGeneratedByMetadata>
type BranchMarkerSiblingSlot = {
    index: number
    count: number
}
type LineageForestContext = {
    proseMirrorThreadContent?: unknown
}

function markerDimensions(): { width: number; height: number } {
    return {
        width: canvasProjectionSettings.markerWidth,
        height: canvasProjectionSettings.markerHeight,
    }
}

// Markers are sized from their prompt text with the SAME shared estimator the
// WebUI renders with, so the authoritative layout reserves exactly the painted
// pill. Without prompt text, they use the shared default projection size.
function lineageMarkerDimensions(
    promptText: string | undefined,
    options: { responseLine?: boolean; responseText?: string } = {},
): { width: number; height: number } {
    if (!promptText) return markerDimensions()
    return estimateBranchMarkerDimensions(promptText, {
        responseLine: options.responseLine,
        responseText: options.responseText,
    })
}

function mediaDimensions(aspectRatio = 1): { width: number; height: number } {
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
    return {
        width: canvasProjectionSettings.generatedMediaSize,
        height: canvasProjectionSettings.generatedMediaSize / safeAspectRatio,
    }
}

function getPositiveAspectRatio(value: unknown): number | undefined {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function fitGeneratedMediaLayout(
    existing: GeneratedMediaNode | undefined,
    fallbackDimensions: { width: number; height: number },
    aspectRatio?: number,
): { dimensions: { width: number; height: number }; position?: { x: number; y: number } } {
    const dimensions = aspectRatio
        ? fitDimensionsToAspectRatio(existing?.dimensions ?? fallbackDimensions, aspectRatio)
        : existing?.dimensions ?? fallbackDimensions
    if (!existing) return { dimensions }

    return {
        dimensions,
        position: {
            x: existing.position.x + (existing.dimensions.width - dimensions.width) / 2,
            y: existing.position.y + (existing.dimensions.height - dimensions.height) / 2,
        },
    }
}

function parseReasoningIndex(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function getMarkerPromptText(node: MarkerNode): string {
    return node.provenance?.promptText ?? node.pendingState?.promptText ?? ''
}

function getMarkerTurnDescriptor(node: MarkerNode): BranchMarkerTurnDescriptor {
    const markerNodeAttr = node.type === 'branchOrigin'
        ? 'branchOriginNodeId' as const
        : node.type === 'branchFork'
            ? 'branchForkNodeId' as const
            : 'branchLineNodeId' as const
    const reasoningRunId = node.type === 'branchOrigin' ? '' : node.reasoningRunId ?? ''
    const reasoningModelId = node.type === 'branchOrigin' ? '' : node.reasoningModelId ?? ''
    const reasoningIndex = node.type === 'branchOrigin' ? null : parseReasoningIndex(node.reasoningIndex)

    return {
        ...(node.generationRequestId ? { generationRequestId: node.generationRequestId } : {}),
        ...(reasoningRunId ? { reasoningRunId } : {}),
        ...(reasoningModelId ? { reasoningModelId } : {}),
        reasoningIndex,
        markerNodeId: node.nodeId,
        markerNodeAttr,
    }
}

function getMarkerThreadPreview(node: MarkerNode, context: LineageForestContext = {}) {
    if (!node.aiChatThreadId || !context.proseMirrorThreadContent) return null
    return getBranchMarkerConversationPreviewFromThreadContent(
        context.proseMirrorThreadContent,
        node.aiChatThreadId,
        getMarkerTurnDescriptor(node),
    )
}

function getLineageMarkerDimensionsForNode(
    node: MarkerNode,
    context: LineageForestContext = {},
    options: { fallbackResponseLine?: boolean } = {},
): { width: number; height: number } {
    const preview = getMarkerThreadPreview(node, context)
    const promptText = preview?.userText || getMarkerPromptText(node)
    return lineageMarkerDimensions(promptText, {
        responseLine: shouldShowBranchMarkerConversationResponseLine(preview) || Boolean(options.fallbackResponseLine),
        responseText: preview?.responseText ?? '',
    })
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
    const futureCircleInset = getPendingGeneratedMediaBeforeFrameCircleInset(mediaBox)
    const futureCircleLeft = futureMediaPosition.x + futureCircleInset.x
    const parentAnchorX = parentNode.position.x + parentNode.dimensions.width
    const parentAnchorY = parentNode.position.y + parentNode.dimensions.height / 2

    if (parentNode.type === 'branchOrigin') {
        const stackIndex = siblingSlot?.index ?? 0
        return {
            x: (parentAnchorX + futureCircleLeft) / 2 - dimensions.width / 2,
            y: parentNode.position.y + parentNode.dimensions.height
                + canvasProjectionSettings.nodeGap
                + stackIndex * (dimensions.height + canvasProjectionSettings.nodeGap),
        }
    }

    const circleStep = futureCircleInset.size + canvasProjectionSettings.branchRowGap
    const circleStackHeight = futureCircleInset.size * siblingCount
        + canvasProjectionSettings.branchRowGap * Math.max(0, siblingCount - 1)
    const firstCircleCenterY = parentAnchorY - circleStackHeight / 2 + futureCircleInset.size / 2
    const futureCircleCenterY = siblingSlot
        ? firstCircleCenterY + circleStep * siblingSlot.index
        : futureMediaPosition.y + futureCircleInset.y + futureCircleInset.size / 2

    return {
        x: (parentAnchorX + futureCircleLeft) / 2 - dimensions.width / 2,
        y: (parentAnchorY + futureCircleCenterY) / 2 - dimensions.height / 2,
    }
}

function findNode(nodes: CanvasNode[], nodeId: string | undefined): CanvasNode | undefined {
    return nodeId ? nodes.find(node => node.nodeId === nodeId) : undefined
}

function buildNodesById(nodes: CanvasNode[]): Map<string, CanvasNode> {
    return new Map(nodes.map(node => [node.nodeId, node]))
}

function isMarkerNode(node: CanvasNode): node is MarkerNode {
    return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
}

function isGeneratedMediaNodeWaitingForFrame(node: CanvasNode): node is GeneratedMediaNode {
    if ((node.type !== 'image' && node.type !== 'video') || !node.generatedBy?.generationRequestId) return false
    if (node.fileId?.trim()) return false
    if (node.type === 'image') return !node.src?.trim()
    return !node.src?.trim()
        && !node.posterSrc?.trim()
        && !node.posterFileId?.trim()
        && !node.frameFileId?.trim()
}

function getPendingGeneratedMediaBeforeFrameCircleInset(dimensions: { width: number; height: number }): { x: number; y: number; size: number } {
    const configuredScale = Number(canvasProjectionSettings.preFrameCircleScale)
    const scale = Number.isFinite(configuredScale) && configuredScale > 0
        ? Math.min(1, configuredScale)
        : 1 / 3
    const size = Math.max(1, Math.min(dimensions.width, dimensions.height) * scale)
    return {
        x: (dimensions.width - size) / 2,
        y: (dimensions.height - size) / 2,
        size,
    }
}

function getPendingGeneratedMediaBeforeFrameCircleRect(
    node: GeneratedMediaNode,
    worldPosition: { x: number; y: number },
): CanvasEngineRect {
    const inset = getPendingGeneratedMediaBeforeFrameCircleInset(node.dimensions)
    return {
        x: worldPosition.x + inset.x,
        y: worldPosition.y + inset.y,
        width: inset.size,
        height: inset.size,
    }
}

// Collision rect matches the WebUI exactly: node box plus the chrome strip
// reserved under generated media (shared metric settings).
function getLineageCollisionRect(node: CanvasNode, worldPosition: { x: number; y: number }): CanvasEngineRect {
    if (isGeneratedMediaNodeWaitingForFrame(node)) {
        return getPendingGeneratedMediaBeforeFrameCircleRect(node, worldPosition)
    }

    const chromeHeight = node.type === 'image' || node.type === 'video'
        ? getGeneratedMediaChromeCollisionHeight(node.type)
        : 0
    return {
        x: worldPosition.x,
        y: worldPosition.y,
        width: node.dimensions.width,
        height: node.dimensions.height + chromeHeight,
    }
}

function getLineageConnectorAnchorRect(node: CanvasNode, worldPosition: { x: number; y: number }): CanvasEngineRect {
    if (isGeneratedMediaNodeWaitingForFrame(node)) {
        return getPendingGeneratedMediaBeforeFrameCircleRect(node, worldPosition)
    }

    return {
        x: worldPosition.x,
        y: worldPosition.y,
        width: node.dimensions.width,
        height: node.dimensions.height,
    }
}

function getBranchLineageCollisionSettings(
    nodeSettings: WorkspaceCollisionNodeTypeSettings,
): WorkspaceCollisionNodeTypeSettings {
    return { ...nodeSettings, margin: canvasProjectionSettings.nodeGap }
}

function getLineageCollisionSettings(
    node: CanvasNode,
    collisionSettings: WorkspaceCollisionFlowSettings,
): WorkspaceCollisionNodeTypeSettings {
    switch (node.type) {
        case 'image':
            return collisionSettings.nodeTypes.image
        case 'video':
            return collisionSettings.nodeTypes.video
        case 'branchOrigin':
            return getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchOrigin)
        case 'branchFork':
            return getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchFork)
        case 'branchLine':
            return getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchLine)
        case 'document':
        default:
            return collisionSettings.nodeTypes.document
    }
}

function getWorkspaceCollisionFlowIterations(collisionSettings: WorkspaceCollisionFlowSettings): number {
    return Math.max(
        ...Object.values(collisionSettings.nodeTypes)
            .map((nodeSettings: WorkspaceCollisionNodeTypeSettings) => nodeSettings.iterations),
    )
}

// The authoritative layout pass: refresh marker dimensions from their prompt
// text (response row once the marker's turn has produced media), then run the
// SAME shared tidy-tree + rigid collision resolution the WebUI uses for local
// drag/delete rebalances. Persisted geometry is final — clients apply it.
function rebalanceLineageForest(
    state: CanvasState,
    context: string,
    lineageContext: LineageForestContext = {},
): { state: CanvasState; changed: boolean } {
    const { markerIdsWithGeneratedChildren } = getStartedLineageMarkerState(state.nodes)
    let markerDimensionsChanged = false
    const nodes = state.nodes.map((node): CanvasNode => {
        if (!isMarkerNode(node)) return node
        const dimensions = getLineageMarkerDimensionsForNode(node, lineageContext, {
            fallbackResponseLine: markerIdsWithGeneratedChildren.has(node.nodeId),
        })
        if (node.dimensions.width === dimensions.width && node.dimensions.height === dimensions.height) return node
        markerDimensionsChanged = true
        return { ...node, dimensions } as CanvasNode
    })

    const collisionSettings = workspaceCollisionSettings.branchTree
    const resolvedNodes = rebalanceBranchTreesAndResolve(nodes, state.edges ?? [], {
        depthGap: canvasProjectionSettings.mediaToMediaGap,
        branchOriginDepthGap: canvasProjectionSettings.branchOriginToFirstMediaGap,
        rootMarkerDepthGap: canvasProjectionSettings.rootToFirstMediaGap,
        siblingGap: canvasProjectionSettings.branchRowGap,
        branchFanoutExtraGap: canvasProjectionSettings.branchFanoutExtraGap,
        getBranchFanoutExtraGap: (_parentNode, childNodes) =>
            childNodes.length > 0 && childNodes.every(isGeneratedMediaNodeWaitingForFrame)
                ? 0
                : canvasProjectionSettings.branchFanoutExtraGap,
        branchOriginMarkerStackGap: canvasProjectionSettings.nodeGap,
        collisionIterations: getWorkspaceCollisionFlowIterations(collisionSettings),
        collisionMargin: 0,
        getNodeCollisionRect: getLineageCollisionRect,
        getNodeConnectorAnchorRect: getLineageConnectorAnchorRect,
        getNodeCollisionMargin: (node: CanvasNode) => getLineageCollisionSettings(node, collisionSettings).margin,
        getNodeCollisionOverlapThreshold: (node: CanvasNode) =>
            getLineageCollisionSettings(node, collisionSettings).overlapThreshold,
    })

    const beforeById = buildNodesById(state.nodes)
    const changed = markerDimensionsChanged || resolvedNodes.some((node) => {
        const before = beforeById.get(node.nodeId)
        return !before
            || before.position.x !== node.position.x
            || before.position.y !== node.position.y
    })
    if (!changed) return { state, changed: false }

    console.info('[media-generation-canvas-projection] rebalanced lineage forest', {
        context,
        nodeCount: resolvedNodes.length,
        markerDimensionsChanged,
    })

    return {
        state: { ...state, nodes: resolvedNodes },
        changed: true,
    }
}

// Nodes whose geometry differs between the pre-mutation and resolved states —
// the exact set clients must apply (collision can move unrelated siblings).
function diffCanvasGeometry(before: CanvasState, after: CanvasState): CanvasNodeGeometry[] {
    const beforeById = buildNodesById(before.nodes)
    const changedGeometries: CanvasNodeGeometry[] = []
    for (const node of after.nodes) {
        const previous = beforeById.get(node.nodeId)
        if (previous
            && previous.position.x === node.position.x
            && previous.position.y === node.position.y
            && previous.dimensions.width === node.dimensions.width
            && previous.dimensions.height === node.dimensions.height) continue
        changedGeometries.push({
            nodeId: node.nodeId,
            position: { x: node.position.x, y: node.position.y },
            dimensions: { width: node.dimensions.width, height: node.dimensions.height },
            ...(node.parentId ? { parentNodeId: node.parentId } : {}),
        })
    }
    return changedGeometries
}

function canvasNodeToGeometry(node: CanvasNode): CanvasNodeGeometry {
    return {
        nodeId: node.nodeId,
        position: { x: node.position.x, y: node.position.y },
        dimensions: { width: node.dimensions.width, height: node.dimensions.height },
        ...(node.parentId ? { parentNodeId: node.parentId } : {}),
    }
}

function mergeProjectionGeometryNodes(
    changedGeometryNodes: CanvasNodeGeometry[],
    nodeSnapshots: CanvasNode[],
): CanvasNodeGeometry[] {
    const geometryByNodeId = new Map(changedGeometryNodes.map(node => [node.nodeId, node]))
    for (const snapshot of nodeSnapshots) {
        if (!geometryByNodeId.has(snapshot.nodeId)) {
            geometryByNodeId.set(snapshot.nodeId, canvasNodeToGeometry(snapshot))
        }
    }
    return [...geometryByNodeId.values()]
}

function getGeneratedMediaGenerationRequestId(node: CanvasNode): string | undefined {
    if (node.type !== 'image' && node.type !== 'video') return undefined
    return node.generatedBy?.generationRequestId
}

function isProjectionSnapshotNode(
    node: CanvasNode,
    generationRequestId: string,
    geometryNodeIds: Set<string>,
): boolean {
    if (geometryNodeIds.has(node.nodeId)) return true
    if (isMarkerNode(node) && node.generationRequestId === generationRequestId) return true
    return getGeneratedMediaGenerationRequestId(node) === generationRequestId
}

function getProjectionNodeSnapshots(params: {
    state: CanvasState
    generationRequestId: string
    geometryNodes: CanvasNodeGeometry[]
    removedNodeIds?: string[]
}): CanvasNode[] {
    const geometryNodeIds = new Set(params.geometryNodes.map(node => node.nodeId))
    const removedNodeIds = new Set(params.removedNodeIds ?? [])
    return params.state.nodes.filter(node =>
        !removedNodeIds.has(node.nodeId)
        && isProjectionSnapshotNode(node, params.generationRequestId, geometryNodeIds)
    )
}

function getProjectionEdgeSnapshots(params: {
    state: CanvasState
    geometryNodes: CanvasNodeGeometry[]
    nodeSnapshots: CanvasNode[]
    removedNodeIds?: string[]
}): WorkspaceEdge[] {
    const removedNodeIds = new Set(params.removedNodeIds ?? [])
    const projectionNodeIds = new Set([
        ...params.geometryNodes.map(node => node.nodeId),
        ...params.nodeSnapshots.map(node => node.nodeId),
    ])

    return (params.state.edges ?? []).filter(edge =>
        !removedNodeIds.has(edge.sourceNodeId)
        && !removedNodeIds.has(edge.targetNodeId)
        && (projectionNodeIds.has(edge.sourceNodeId) || projectionNodeIds.has(edge.targetNodeId))
    )
}

function getCompletedGeneratedMediaPendingNodeId(node: CanvasNode): string | undefined {
    if ((node.type !== 'image' && node.type !== 'video') || !node.fileId || !node.generatedBy?.generationRequestId) {
        return undefined
    }
    const pendingNodeId = getPendingGeneratedMediaNodeId({
        generationRequestId: node.generatedBy.generationRequestId,
        ...(node.generatedBy.reasoningRunId ? { reasoningRunId: node.generatedBy.reasoningRunId } : {}),
        ...(node.generatedBy.mediaRunId ? { mediaRunId: node.generatedBy.mediaRunId } : {}),
        ...(node.generatedBy.mediaModelId ? { mediaModelId: node.generatedBy.mediaModelId } : {}),
        mediaType: node.generatedBy.mediaType ?? node.type,
        ...(node.generatedBy.mediaIndex !== undefined ? { mediaIndex: node.generatedBy.mediaIndex } : {}),
        ...(node.generatedBy.reasoningIndex !== undefined ? { reasoningIndex: node.generatedBy.reasoningIndex } : {}),
    })
    return pendingNodeId === node.nodeId ? undefined : pendingNodeId
}

function getObsoletePendingGeneratedMediaNodeIds(state: CanvasState, generationRequestId: string): string[] {
    const pendingNodeIds = new Set<string>()
    for (const node of state.nodes) {
        if ((node.type !== 'image' && node.type !== 'video') || node.generatedBy?.generationRequestId !== generationRequestId) continue
        const pendingNodeId = getCompletedGeneratedMediaPendingNodeId(node)
        if (pendingNodeId) pendingNodeIds.add(pendingNodeId)
    }
    return [...pendingNodeIds].sort()
}

function isUnresolvedPendingGeneratedMediaNode(node: CanvasNode, generationRequestId: string): node is GeneratedMediaNode {
    if ((node.type !== 'image' && node.type !== 'video') || node.generatedBy?.generationRequestId !== generationRequestId) return false
    if (node.fileId?.trim()) return false
    if (node.type === 'image') return !node.src?.trim()
    return !node.src?.trim()
        && !node.posterSrc?.trim()
        && !node.posterFileId?.trim()
        && !node.frameFileId?.trim()
}

function getUnresolvedPendingGeneratedMediaNodeIds(state: CanvasState, generationRequestId: string): string[] {
    return state.nodes
        .filter(node => isUnresolvedPendingGeneratedMediaNode(node, generationRequestId))
        .map(node => node.nodeId)
        .sort()
}

function hasResolvedGeneratedMediaForRequest(state: CanvasState, generationRequestId: string): boolean {
    return state.nodes.some(node =>
        (node.type === 'image' || node.type === 'video')
        && node.generatedBy?.generationRequestId === generationRequestId
        && !isUnresolvedPendingGeneratedMediaNode(node, generationRequestId)
    )
}

function buildCanvasGeometryUpdate(params: {
    context: string
    layoutRevision: number
    state: CanvasState
    generationRequestId: string
    geometryNodes: CanvasNodeGeometry[]
    removedNodeIds?: string[]
}): CanvasGeometryUpdate {
    const requestedRemovedNodeIds = params.removedNodeIds?.filter(Boolean) ?? []
    const derivedRemovedPendingNodeIds = getObsoletePendingGeneratedMediaNodeIds(params.state, params.generationRequestId)
    const removedNodeIds = [...new Set([...requestedRemovedNodeIds, ...derivedRemovedPendingNodeIds])]
    const nodeSnapshots = getProjectionNodeSnapshots({
        state: params.state,
        generationRequestId: params.generationRequestId,
        geometryNodes: params.geometryNodes,
        removedNodeIds,
    })
    const authoritativeGeometryNodes = mergeProjectionGeometryNodes(params.geometryNodes, nodeSnapshots)
    const edgeSnapshots = getProjectionEdgeSnapshots({
        state: params.state,
        geometryNodes: authoritativeGeometryNodes,
        nodeSnapshots,
        removedNodeIds,
    })
    console.info('[media-generation-canvas-projection] canvas geometry update payload', {
        context: params.context,
        generationRequestId: params.generationRequestId,
        layoutRevision: params.layoutRevision,
        changedGeometryNodeCount: params.geometryNodes.length,
        changedGeometryNodeIds: params.geometryNodes.map(node => node.nodeId),
        geometryNodeCount: authoritativeGeometryNodes.length,
        geometryNodeIds: authoritativeGeometryNodes.map(node => node.nodeId),
        nodeSnapshotCount: nodeSnapshots.length,
        nodeSnapshotIds: nodeSnapshots.map(node => node.nodeId),
        edgeSnapshotCount: edgeSnapshots.length,
        edgeSnapshotIds: edgeSnapshots.map(edge => edge.edgeId),
        derivedRemovedPendingNodeIds,
        removedNodeIds,
    })
    return {
        layoutRevision: params.layoutRevision,
        nodes: authoritativeGeometryNodes,
        ...(nodeSnapshots.length > 0 ? { nodeSnapshots } : {}),
        ...(edgeSnapshots.length > 0 ? { edgeSnapshots } : {}),
        ...(removedNodeIds.length > 0 ? { removedNodeIds } : {}),
    }
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
        if (generationRun.mediaRunId && generatedBy.mediaRunId) {
            return generatedBy.mediaRunId === generationRun.mediaRunId
        }
        return Boolean(
            generationRun.generationRequestId
            && generatedBy.generationRequestId === generationRun.generationRequestId
            && generationRun.reasoningRunId
            && generatedBy.reasoningRunId === generationRun.reasoningRunId
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

function upsertNodeWithIncomingGeometry(nodes: CanvasNode[], nextNode: CanvasNode): { nodes: CanvasNode[]; changed: boolean } {
    const index = nodes.findIndex(node => node.nodeId === nextNode.nodeId)
    if (index < 0) return { nodes: [...nodes, nextNode], changed: true }

    const existing = nodes[index]
    const mergedNode = {
        ...existing,
        ...nextNode,
        position: nextNode.position,
        dimensions: nextNode.dimensions,
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
    const dimensions = lineageMarkerDimensions(plan.provenance.promptText)
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
    const dimensions = lineageMarkerDimensions(plan.provenance.promptText)
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
    const dimensions = lineageMarkerDimensions(plan.provenance.promptText)
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
            provenance: {
                kind: 'branch-root-fork-decision',
                promptText: assignment.promptText,
                referenceNodeIds: assignment.referenceNodeIds,
                sourceContextNodeIds: assignment.sourceContextNodeIds,
                forked: Boolean(assignment.branchForkNodeId),
                forkCount: assignment.branchForkNodeId ? 1 : 0,
            },
            position: fallbackPosition(state, markers.length, lineageMarkerDimensions(assignment.promptText), canvasVisibleArea),
            dimensions: lineageMarkerDimensions(assignment.promptText),
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
            reasoningIndex: assignment.reasoningIndex ?? 0,
            ...(parentBranchNodeId ? { parentBranchNodeId } : {}),
            provenance: {
                kind: 'reasoning-run',
                promptText: assignment.promptText,
                referenceNodeIds: assignment.referenceNodeIds,
                sourceContextNodeIds: assignment.sourceContextNodeIds,
                reasoningRunId: assignment.reasoningRunId ?? '',
                reasoningModelId: (assignment.reasoningModelId ?? '') as AiModelId,
                reasoningIndex: assignment.reasoningIndex ?? 0,
            },
            position: parentBranchNodeId
                ? positionBranchMarkerBeforeGeneratedMedia(parentNode, lineageMarkerDimensions(assignment.promptText), markers.length, state, canvasVisibleArea)
                : positionRightOf(parentNode, lineageMarkerDimensions(assignment.promptText), markers.length, state, canvasVisibleArea),
            dimensions: lineageMarkerDimensions(assignment.promptText),
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
            reasoningIndex: assignment.reasoningIndex ?? 0,
            ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
            ...(assignment.mediaModelId ? { mediaModelId: assignment.mediaModelId } : {}),
            ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
            ...(parentBranchNodeId ? { parentBranchNodeId } : {}),
            provenance: {
                kind: 'branch-continuation',
                promptText: assignment.promptText,
                referenceNodeIds: assignment.referenceNodeIds,
                sourceContextNodeIds: assignment.sourceContextNodeIds,
                reasoningRunId: assignment.reasoningRunId ?? '',
                reasoningModelId: (assignment.reasoningModelId ?? '') as AiModelId,
                reasoningIndex: assignment.reasoningIndex ?? 0,
                ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
                ...(assignment.mediaModelId ? { mediaModelId: assignment.mediaModelId } : {}),
                ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
            },
            position: parentBranchNodeId
                ? positionBranchMarkerBeforeGeneratedMedia(parentNode, lineageMarkerDimensions(assignment.promptText), markers.length, state, canvasVisibleArea)
                : positionRightOf(parentNode, lineageMarkerDimensions(assignment.promptText), markers.length, state, canvasVisibleArea),
            dimensions: lineageMarkerDimensions(assignment.promptText),
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
        ?? assignment.branchLineNodeId
        ?? assignment.branchForkNodeId
        ?? assignment.parentMediaNodeId
        ?? assignment.branchOriginNodeId
}

function generatedByLineage(assignment: MediaRunLineageAssignment | undefined): GeneratedByLineageMetadata {
    if (!assignment) return {}
    return {
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
    }
}

function getMediaTypeForAssignment(assignment: MediaRunLineageAssignment): 'image' | 'video' {
    return assignment.mediaType === 'video' ? 'video' : 'image'
}

function assignmentMatchesGeneratedMediaNode(
    node: CanvasNode,
    assignment: MediaRunLineageAssignment,
): node is GeneratedMediaNode {
    const mediaType = getMediaTypeForAssignment(assignment)
    if (node.type !== mediaType) return false
    const generatedBy = node.generatedBy
    if (!generatedBy) return false
    if (assignment.mediaRunId && generatedBy.mediaRunId === assignment.mediaRunId) return true
    if (generatedBy.generationRequestId !== assignment.generationRequestId) return false
    if (assignment.reasoningRunId && generatedBy.reasoningRunId && generatedBy.reasoningRunId !== assignment.reasoningRunId) return false
    if (assignment.mediaModelId && generatedBy.mediaModelId !== assignment.mediaModelId) return false
    if (assignment.branchForkNodeId && generatedBy.branchForkNodeId !== assignment.branchForkNodeId) return false
    if (assignment.branchLineNodeId && generatedBy.branchLineNodeId !== assignment.branchLineNodeId) return false
    return Boolean(assignment.reasoningRunId || assignment.mediaModelId || assignment.branchForkNodeId || assignment.branchLineNodeId)
}

function hasCompletedGeneratedMediaForAssignment(nodes: CanvasNode[], assignment: MediaRunLineageAssignment): boolean {
    return nodes.some((node) => {
        if (!assignmentMatchesGeneratedMediaNode(node, assignment)) return false
        return Boolean(node.fileId)
    })
}

function pendingImageNodeFromAssignment(params: {
    assignment: MediaRunLineageAssignment
    workspaceId: string
    aiChatThreadId: string
    sourceNode: CanvasNode | undefined
    existing: ImageCanvasNode | undefined
    state: CanvasState
    fallbackIndex: number
    canvasVisibleArea?: CanvasVisibleArea
}): ImageCanvasNode {
    const dimensions = params.existing?.dimensions ?? mediaDimensions()
    const position = params.existing?.position
        ?? getGeneratedMediaPosition(
            params.sourceNode,
            params.state.nodes,
            dimensions,
            params.fallbackIndex,
            params.state,
            params.canvasVisibleArea,
        )
    const mediaModelId = (params.assignment.mediaModelId ?? '') as AiModelId
    return {
        nodeId: params.existing?.nodeId ?? getPendingGeneratedMediaNodeId(params.assignment),
        type: 'image',
        fileId: '',
        workspaceId: params.workspaceId,
        src: '',
        aspectRatio: params.existing?.aspectRatio ?? 1,
        position,
        dimensions,
        generatedBy: {
            aiChatThreadId: params.aiChatThreadId,
            responseId: '',
            aiModel: (params.assignment.reasoningModelId ?? '') as AiModelId,
            revisedPrompt: params.assignment.promptText,
            responseMessageId: '',
            ...generatedByLineage(params.assignment),
            mediaModelId,
        },
    }
}

function pendingVideoNodeFromAssignment(params: {
    assignment: MediaRunLineageAssignment
    workspaceId: string
    aiChatThreadId: string
    sourceNode: CanvasNode | undefined
    existing: VideoCanvasNode | undefined
    state: CanvasState
    fallbackIndex: number
    canvasVisibleArea?: CanvasVisibleArea
}): VideoCanvasNode {
    const dimensions = params.existing?.dimensions ?? mediaDimensions()
    const position = params.existing?.position
        ?? getGeneratedMediaPosition(
            params.sourceNode,
            params.state.nodes,
            dimensions,
            params.fallbackIndex,
            params.state,
            params.canvasVisibleArea,
        )
    const mediaModelId = (params.assignment.mediaModelId ?? '') as AiModelId
    return {
        nodeId: params.existing?.nodeId ?? getPendingGeneratedMediaNodeId(params.assignment),
        type: 'video',
        fileId: '',
        posterFileId: '',
        frameFileId: '',
        workspaceId: params.workspaceId,
        src: '',
        posterSrc: '',
        aspectRatio: params.existing?.aspectRatio ?? 1,
        durationSeconds: params.existing?.durationSeconds ?? 0,
        hasAudio: params.existing?.hasAudio ?? false,
        position,
        dimensions,
        generatedBy: {
            aiChatThreadId: params.aiChatThreadId,
            responseId: '',
            videoModel: mediaModelId,
            revisedPrompt: params.assignment.promptText,
            responseMessageId: '',
            ...generatedByLineage(params.assignment),
            mediaModelId,
        },
    }
}

function pendingGeneratedMediaNodeFromAssignment(params: {
    assignment: MediaRunLineageAssignment
    workspaceId: string
    aiChatThreadId: string
    state: CanvasState
    fallbackIndex: number
    canvasVisibleArea?: CanvasVisibleArea
}): GeneratedMediaNode | null {
    if (hasCompletedGeneratedMediaForAssignment(params.state.nodes, params.assignment)) return null

    const existing = params.state.nodes.find((node): node is GeneratedMediaNode =>
        assignmentMatchesGeneratedMediaNode(node, params.assignment)
    )
    const lineageParentNodeId = getLineageParentNodeId(params.assignment)
    const sourceNode = findNode(params.state.nodes, lineageParentNodeId)
    if (!sourceNode) {
        console.info('[media-generation-canvas-projection] pending media projection missing lineage parent', {
            generationRequestId: params.assignment.generationRequestId,
            mediaRunId: params.assignment.mediaRunId,
            mediaType: params.assignment.mediaType,
            lineageParentNodeId,
        })
    }

    return getMediaTypeForAssignment(params.assignment) === 'video'
        ? pendingVideoNodeFromAssignment({
            ...params,
            sourceNode,
            existing: existing?.type === 'video' ? existing : undefined,
        })
        : pendingImageNodeFromAssignment({
            ...params,
            sourceNode,
            existing: existing?.type === 'image' ? existing : undefined,
        })
}

function upsertPendingGeneratedMediaNodes(
    state: CanvasState,
    params: {
        workspaceId: string
        aiChatThreadId: string
        lineagePlan: MediaBranchLineagePlan
        canvasVisibleArea?: CanvasVisibleArea
    },
): { state: CanvasState; changed: boolean; projectedCount: number; skippedCompletedCount: number; skippedPlanVideoCount: number } {
    let nextState = state
    let changed = false
    let projectedCount = 0
    let skippedCompletedCount = 0
    let skippedPlanVideoCount = 0
    const skippedPlanVideoAssignmentIds: string[] = []

    for (const assignment of params.lineagePlan.runAssignments) {
        if (getMediaTypeForAssignment(assignment) === 'video') {
            skippedPlanVideoCount += 1
            skippedPlanVideoAssignmentIds.push(assignment.mediaRunId ?? getPendingGeneratedMediaNodeId(assignment))
            continue
        }
        if (hasCompletedGeneratedMediaForAssignment(nextState.nodes, assignment)) {
            skippedCompletedCount += 1
            continue
        }
        const pendingNode = pendingGeneratedMediaNodeFromAssignment({
            assignment,
            workspaceId: params.workspaceId,
            aiChatThreadId: params.aiChatThreadId,
            state: nextState,
            fallbackIndex: nextState.nodes.length,
            canvasVisibleArea: params.canvasVisibleArea,
        })
        if (!pendingNode) continue
        const nodeResult = upsertNode(nextState.nodes, pendingNode)
        nextState = { ...nextState, nodes: nodeResult.nodes }
        changed = changed || nodeResult.changed
        projectedCount += 1

        const edgeResult = addGeneratedMediaEdge(nextState, getLineageParentNodeId(assignment), pendingNode.nodeId)
        nextState = edgeResult.state
        changed = changed || edgeResult.changed
    }

    if (projectedCount > 0 || skippedCompletedCount > 0 || skippedPlanVideoCount > 0) {
        console.info('[media-generation-canvas-projection] projected pending generated media from lineage plan', {
            generationRequestId: params.lineagePlan.generationRequestId,
            assignmentCount: params.lineagePlan.runAssignments.length,
            projectedCount,
            skippedCompletedCount,
            skippedPlanVideoCount,
            skippedPlanVideoAssignmentIds,
        })
    }

    return { state: nextState, changed, projectedCount, skippedCompletedCount, skippedPlanVideoCount }
}

function replaceExistingPendingGeneratedMediaNode(
    state: CanvasState,
    existing: GeneratedMediaNode | undefined,
    finalNodeId: string,
): { state: CanvasState; changed: boolean } {
    if (!existing || existing.nodeId === finalNodeId) return { state, changed: false }
    return {
        state: {
            ...state,
            nodes: state.nodes.filter((node) => node.nodeId !== existing.nodeId),
            edges: (state.edges ?? []).filter((edge) =>
                edge.sourceNodeId !== existing.nodeId && edge.targetNodeId !== existing.nodeId
            ),
        },
        changed: true,
    }
}

function addGeneratedMediaEdge(
    state: CanvasState,
    sourceNodeId: string | undefined,
    targetNodeId: string,
): { state: CanvasState; changed: boolean } {
    if (!sourceNodeId) return { state, changed: false }
    const markerNodeIds = new Set(state.nodes.filter(isMarkerNode).map(node => node.nodeId))
    const edges = state.edges ?? []
    const prunedEdges = edges.filter(edge => {
        if (edge.targetNodeId !== targetNodeId) return true
        if (edge.sourceNodeId === sourceNodeId) return true
        return !markerNodeIds.has(edge.sourceNodeId) && !edge.edgeId.startsWith('edge-branch-')
    })
    const edgeResult = addEdgeIfMissing(prunedEdges, {
        edgeId: `edge-${sourceNodeId}-${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
        sourceHandle: 'right',
        targetHandle: 'left',
    })
    return { state: { ...state, edges: edgeResult.edges }, changed: prunedEdges.length !== edges.length || edgeResult.changed }
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
    proseMirrorThreadContent?: unknown
}): Promise<CanvasGeometryUpdate | null> {
    let geometryNodes: CanvasNodeGeometry[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertMediaLineagePlanToCanvas',
        mutate: (canvasState) => {
            const markers = markerNodesFromLineagePlan(params.lineagePlan, params.aiChatThreadId, canvasState, params.canvasVisibleArea)
            const markerResult = ensureMarkers(canvasState, markers)
            const pendingMediaResult = upsertPendingGeneratedMediaNodes(markerResult.state, {
                workspaceId: params.workspaceId,
                aiChatThreadId: params.aiChatThreadId,
                lineagePlan: params.lineagePlan,
                canvasVisibleArea: params.canvasVisibleArea,
            })
            const rebalanceResult = rebalanceLineageForest(pendingMediaResult.state, 'upsertMediaLineagePlanToCanvas', {
                proseMirrorThreadContent: params.proseMirrorThreadContent,
            })
            geometryNodes = diffCanvasGeometry(canvasState, rebalanceResult.state)
            console.info('[media-generation-canvas-projection] lineage plan geometry diff', {
                generationRequestId: params.lineagePlan.generationRequestId,
                markerCount: markers.length,
                runAssignmentCount: params.lineagePlan.runAssignments.length,
                pendingMediaProjectedCount: pendingMediaResult.projectedCount,
                pendingVideoSkippedAtPlanCount: pendingMediaResult.skippedPlanVideoCount,
                geometryNodeCount: geometryNodes.length,
                geometryNodeIds: geometryNodes.map(node => node.nodeId),
            })
            return {
                canvasState: rebalanceResult.state,
                changed: markerResult.changed || pendingMediaResult.changed || rebalanceResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || !result.canvasState) return null
    return buildCanvasGeometryUpdate({
        context: 'upsertMediaLineagePlanToCanvas',
        layoutRevision: result.canvasStateUpdatedAt,
        state: result.canvasState,
        generationRequestId: params.lineagePlan.generationRequestId,
        geometryNodes,
    })
}

export async function settleMediaGenerationRequestOnCanvas(params: {
    workspaceId: string
    generationRequestId: string
    aiChatThreadId?: string
    proseMirrorThreadContent?: unknown
}): Promise<CanvasGeometryUpdate | null> {
    let geometryNodes: CanvasNodeGeometry[] = []
    let removedNodeIds: string[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'settleMediaGenerationRequestOnCanvas',
        mutate: (canvasState) => {
            let changed = false
            const nodes = canvasState.nodes.map((node: CanvasNode): CanvasNode => {
                if (!isMarkerNode(node) || node.generationRequestId !== params.generationRequestId || !node.pendingState) {
                    return node
                }
                const settledNode = { ...node }
                delete settledNode.pendingState
                changed = true
                return settledNode
            })
            const stateWithSettledMarkers = { ...canvasState, nodes }
            const shouldRemoveUnresolvedPendingNodes = hasResolvedGeneratedMediaForRequest(stateWithSettledMarkers, params.generationRequestId)
            removedNodeIds = shouldRemoveUnresolvedPendingNodes
                ? getUnresolvedPendingGeneratedMediaNodeIds(stateWithSettledMarkers, params.generationRequestId)
                : []
            const removedNodeIdSet = new Set(removedNodeIds)
            const settledState = removedNodeIds.length > 0
                ? {
                    ...canvasState,
                    nodes: nodes.filter(node => !removedNodeIdSet.has(node.nodeId)),
                    edges: (canvasState.edges ?? []).filter(edge =>
                        !removedNodeIdSet.has(edge.sourceNodeId) && !removedNodeIdSet.has(edge.targetNodeId)
                    ),
                }
                : { ...canvasState, nodes }
            // The settle pass is the final authoritative layout for the request:
            // clients load these persisted positions with no post-load movement.
            const rebalanceResult = rebalanceLineageForest(settledState, 'settleMediaGenerationRequestOnCanvas', {
                proseMirrorThreadContent: params.proseMirrorThreadContent,
            })
            geometryNodes = diffCanvasGeometry(canvasState, rebalanceResult.state)
            console.info('[media-generation-canvas-projection] settle request geometry diff', {
                generationRequestId: params.generationRequestId,
                shouldRemoveUnresolvedPendingNodes,
                removedUnresolvedPendingNodeCount: removedNodeIds.length,
                removedUnresolvedPendingNodeIds: removedNodeIds,
                geometryNodeCount: geometryNodes.length,
                geometryNodeIds: geometryNodes.map(node => node.nodeId),
            })
            return {
                canvasState: rebalanceResult.state,
                changed: changed || removedNodeIds.length > 0 || rebalanceResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || !result.canvasState) return null
    return buildCanvasGeometryUpdate({
        context: 'settleMediaGenerationRequestOnCanvas',
        layoutRevision: result.canvasStateUpdatedAt,
        state: result.canvasState,
        generationRequestId: params.generationRequestId,
        geometryNodes,
        removedNodeIds,
    })
}

export async function refreshMediaGenerationRequestCanvasGeometry(params: {
    workspaceId: string
    generationRequestId: string
    aiChatThreadId?: string
    proseMirrorThreadContent?: unknown
}): Promise<CanvasGeometryUpdate | null> {
    let geometryNodes: CanvasNodeGeometry[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'refreshMediaGenerationRequestCanvasGeometry',
        mutate: (canvasState) => {
            const hasRequestMarker = canvasState.nodes.some((node: CanvasNode) =>
                isMarkerNode(node) && node.generationRequestId === params.generationRequestId
            )
            if (!hasRequestMarker) {
                return {
                    canvasState,
                    changed: false,
                }
            }

            const rebalanceResult = rebalanceLineageForest(canvasState, 'refreshMediaGenerationRequestCanvasGeometry', {
                proseMirrorThreadContent: params.proseMirrorThreadContent,
            })
            geometryNodes = diffCanvasGeometry(canvasState, rebalanceResult.state)
            console.info('[media-generation-canvas-projection] stream refresh geometry diff', {
                generationRequestId: params.generationRequestId,
                geometryNodeCount: geometryNodes.length,
                geometryNodeIds: geometryNodes.map(node => node.nodeId),
            })
            return {
                canvasState: rebalanceResult.state,
                changed: rebalanceResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || !result.canvasState) return null
    return buildCanvasGeometryUpdate({
        context: 'refreshMediaGenerationRequestCanvasGeometry',
        layoutRevision: result.canvasStateUpdatedAt,
        state: result.canvasState,
        generationRequestId: params.generationRequestId,
        geometryNodes,
    })
}

export async function upsertPartialGeneratedImageToCanvas(params: UpsertPartialImageInput): Promise<CanvasGeometryUpdate | null> {
    const assignment = params.generationRun?.lineageAssignment
    if (!assignment) return null

    let geometryNodes: CanvasNodeGeometry[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertPartialGeneratedImageToCanvas',
        mutate: (canvasState) => {
            const pendingNodeId = getPendingGeneratedMediaNodeId(assignment)
            const existingBeforeMarkers = findGeneratedMediaNodeForRun(canvasState.nodes, 'image', params.fileId, params.generationRun)
            if (isImageNode(existingBeforeMarkers) && existingBeforeMarkers.nodeId !== pendingNodeId && hasCompletedGeneratedMediaForAssignment(canvasState.nodes, assignment)) {
                console.info('[media-generation-canvas-projection] skip stale partial after completed image', {
                    generationRequestId: assignment.generationRequestId,
                    mediaRunId: assignment.mediaRunId,
                    partialIndex: params.partialIndex,
                    existingNodeId: existingBeforeMarkers.nodeId,
                    pendingNodeId,
                    partialFileId: params.fileId,
                })
                return {
                    canvasState,
                    changed: false,
                }
            }

            const markerResult = ensureMarkers(canvasState, markerNodesFromAssignment(assignment, params.aiChatThreadId, canvasState, params.canvasVisibleArea))
            let nextState = markerResult.state
            const existing = findGeneratedMediaNodeForRun(nextState.nodes, 'image', params.fileId, params.generationRun)
            const intrinsicAspectRatio = getPositiveAspectRatio(params.aspectRatio)
            const layout = fitGeneratedMediaLayout(
                isImageNode(existing) ? existing : undefined,
                mediaDimensions(intrinsicAspectRatio ?? (isImageNode(existing) ? existing.aspectRatio : 1)),
                intrinsicAspectRatio,
            )
            const lineageParentNodeId = getLineageParentNodeId(assignment)
            const sourceNode = findNode(nextState.nodes, lineageParentNodeId)
            const mediaModelId = (params.generationRun?.mediaModelId ?? assignment.mediaModelId ?? '') as AiModelId
            const imageNode: ImageCanvasNode = {
                nodeId: pendingNodeId,
                type: 'image',
                fileId: params.fileId || (isImageNode(existing) ? existing.fileId : ''),
                workspaceId: params.workspaceId,
                src: params.imageUrl || (isImageNode(existing) ? existing.src : ''),
                aspectRatio: intrinsicAspectRatio ?? (isImageNode(existing) ? existing.aspectRatio : 1),
                position: layout.position ?? getGeneratedMediaPosition(sourceNode, nextState.nodes, layout.dimensions, nextState.nodes.length, nextState, params.canvasVisibleArea),
                dimensions: layout.dimensions,
                generatedBy: {
                    aiChatThreadId: params.aiChatThreadId,
                    responseId: isImageNode(existing) ? existing.generatedBy?.responseId ?? '' : '',
                    aiModel: (params.generationRun?.reasoningModelId ?? params.aiProvider) as AiModelId,
                    imageModelProvider: params.aiProvider,
                    revisedPrompt: assignment.promptText,
                    responseMessageId: isImageNode(existing) ? existing.generatedBy?.responseMessageId ?? '' : '',
                    ...generatedByLineage(assignment),
                    ...(params.generationRun?.variantIndex !== undefined ? { variantIndex: params.generationRun.variantIndex } : {}),
                    mediaModelId,
                },
            }
            const nodeResult = upsertNodeWithIncomingGeometry(nextState.nodes, imageNode)
            nextState = { ...nextState, nodes: nodeResult.nodes }
            const edgeResult = addGeneratedMediaEdge(nextState, lineageParentNodeId, pendingNodeId)
            nextState = edgeResult.state
            const forestResult = rebalanceLineageForest(nextState, 'upsertPartialGeneratedImageToCanvas', {
                proseMirrorThreadContent: params.proseMirrorThreadContent,
            })
            geometryNodes = diffCanvasGeometry(canvasState, forestResult.state)
            console.info('[media-generation-canvas-projection] upsert partial image geometry diff', {
                generationRequestId: assignment.generationRequestId,
                mediaRunId: assignment.mediaRunId,
                partialIndex: params.partialIndex,
                pendingNodeId,
                fileId: params.fileId,
                imageUrlPresent: Boolean(params.imageUrl),
                intrinsicAspectRatio,
                geometryNodeCount: geometryNodes.length,
                geometryNodeIds: geometryNodes.map(node => node.nodeId),
            })
            return {
                canvasState: forestResult.state,
                changed: markerResult.changed || nodeResult.changed || edgeResult.changed || forestResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || !result.canvasState) return null
    return buildCanvasGeometryUpdate({
        context: 'upsertPartialGeneratedImageToCanvas',
        layoutRevision: result.canvasStateUpdatedAt,
        state: result.canvasState,
        generationRequestId: assignment.generationRequestId,
        geometryNodes,
    })
}

export async function upsertGeneratedImageToCanvas(params: UpsertImageInput): Promise<CanvasGeometryUpdate | null> {
    const assignment = params.generationRun?.lineageAssignment
    if (!assignment) return null

    let geometryNodes: CanvasNodeGeometry[] = []
    let removedNodeIds: string[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertGeneratedImageToCanvas',
        mutate: (canvasState) => {
            const markerResult = ensureMarkers(canvasState, markerNodesFromAssignment(assignment, params.aiChatThreadId, canvasState, params.canvasVisibleArea))
            let nextState = markerResult.state
            const existing = findGeneratedMediaNodeForRun(nextState.nodes, 'image', params.fileId, params.generationRun)
            const nodeId = params.fileId ? `node-${params.fileId}` : existing?.nodeId ?? getPendingGeneratedMediaNodeId(assignment)
            const replacementResult = replaceExistingPendingGeneratedMediaNode(nextState, existing, nodeId)
            removedNodeIds = replacementResult.changed && existing ? [existing.nodeId] : []
            nextState = replacementResult.state
            const intrinsicAspectRatio = getPositiveAspectRatio(params.aspectRatio)
            // Final fitted dimensions are persisted here so the client's
            // intrinsic-size handler is a no-op on load — no post-load movement.
            const layout = fitGeneratedMediaLayout(
                isImageNode(existing) ? existing : undefined,
                mediaDimensions(intrinsicAspectRatio ?? (isImageNode(existing) ? existing.aspectRatio : 1)),
                intrinsicAspectRatio,
            )
            const lineageParentNodeId = getLineageParentNodeId(assignment)
            const sourceNode = findNode(nextState.nodes, lineageParentNodeId)
            const mediaModelId = (params.generationRun?.mediaModelId ?? `${params.imageModelProvider}:${params.imageModelId}`) as AiModelId
            const imageNode: ImageCanvasNode = {
                nodeId,
                type: 'image',
                fileId: params.fileId,
                workspaceId: params.workspaceId,
                src: params.imageUrl,
                aspectRatio: intrinsicAspectRatio ?? (isImageNode(existing) ? existing.aspectRatio : 1),
                position: layout.position ?? getGeneratedMediaPosition(sourceNode, nextState.nodes, layout.dimensions, nextState.nodes.length, nextState, params.canvasVisibleArea),
                dimensions: layout.dimensions,
                generatedBy: {
                    aiChatThreadId: params.aiChatThreadId,
                    responseId: params.responseId,
                    aiModel: (params.generationRun?.reasoningModelId ?? params.aiProvider) as AiModelId,
                    imageModelProvider: params.imageModelProvider,
                    revisedPrompt: params.revisedPrompt || assignment.promptText,
                    responseMessageId: '',
                    ...generatedByLineage(assignment),
                    ...(params.generationRun?.variantIndex !== undefined ? { variantIndex: params.generationRun.variantIndex } : {}),
                    mediaModelId,
                },
            }
            const nodeResult = upsertNode(nextState.nodes, imageNode)
            nextState = { ...nextState, nodes: nodeResult.nodes }
            const edgeResult = addGeneratedMediaEdge(nextState, lineageParentNodeId, nodeId)
            nextState = edgeResult.state
            const forestResult = rebalanceLineageForest(nextState, 'upsertGeneratedImageToCanvas', {
                proseMirrorThreadContent: params.proseMirrorThreadContent,
            })
            geometryNodes = diffCanvasGeometry(canvasState, forestResult.state)
            console.info('[media-generation-canvas-projection] upsert generated image geometry diff', {
                generationRequestId: assignment.generationRequestId,
                mediaRunId: assignment.mediaRunId,
                pendingNodeId: existing?.nodeId ?? '',
                finalNodeId: nodeId,
                replacedPendingNode: replacementResult.changed,
                removedNodeIds,
                geometryNodeCount: geometryNodes.length,
                geometryNodeIds: geometryNodes.map(node => node.nodeId),
            })
            return {
                canvasState: forestResult.state,
                changed: markerResult.changed || replacementResult.changed || nodeResult.changed || edgeResult.changed || forestResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || !result.canvasState) return null
    return buildCanvasGeometryUpdate({
        context: 'upsertGeneratedImageToCanvas',
        layoutRevision: result.canvasStateUpdatedAt,
        state: result.canvasState,
        generationRequestId: assignment.generationRequestId,
        geometryNodes,
        removedNodeIds,
    })
}

export async function upsertGeneratedVideoToCanvas(params: UpsertVideoInput): Promise<CanvasGeometryUpdate | null> {
    const assignment = params.generationRun?.lineageAssignment
    if (!assignment) return null

    let geometryNodes: CanvasNodeGeometry[] = []
    let removedNodeIds: string[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertGeneratedVideoToCanvas',
        mutate: (canvasState) => {
            const markerResult = ensureMarkers(canvasState, markerNodesFromAssignment(assignment, params.aiChatThreadId, canvasState, params.canvasVisibleArea))
            let nextState = markerResult.state
            const existing = findGeneratedMediaNodeForRun(nextState.nodes, 'video', params.fileId, params.generationRun)
            const nodeId = params.fileId ? `node-${params.fileId}` : existing?.nodeId ?? getPendingGeneratedMediaNodeId(assignment)
            const replacementResult = replaceExistingPendingGeneratedMediaNode(nextState, existing, nodeId)
            removedNodeIds = replacementResult.changed && existing ? [existing.nodeId] : []
            nextState = replacementResult.state
            const aspectRatio = parseAspectRatio(params.aspectRatio)
            const layout = fitGeneratedMediaLayout(
                isVideoNode(existing) ? existing : undefined,
                mediaDimensions(aspectRatio),
                aspectRatio,
            )
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
                aspectRatio,
                durationSeconds: params.durationSeconds,
                hasAudio: params.hasAudio,
                position: layout.position ?? getGeneratedMediaPosition(sourceNode, nextState.nodes, layout.dimensions, nextState.nodes.length, nextState, params.canvasVisibleArea),
                dimensions: layout.dimensions,
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
                    ...(params.generationRun?.variantIndex !== undefined ? { variantIndex: params.generationRun.variantIndex } : {}),
                    ...(params.generationRun?.mediaModelId ? { mediaModelId: params.generationRun.mediaModelId } : {}),
                },
            }
            const nodeResult = upsertNode(nextState.nodes, videoNode)
            nextState = { ...nextState, nodes: nodeResult.nodes }
            const edgeResult = addGeneratedMediaEdge(nextState, lineageParentNodeId, nodeId)
            nextState = edgeResult.state
            const forestResult = rebalanceLineageForest(nextState, 'upsertGeneratedVideoToCanvas', {
                proseMirrorThreadContent: params.proseMirrorThreadContent,
            })
            geometryNodes = diffCanvasGeometry(canvasState, forestResult.state)
            console.info('[media-generation-canvas-projection] upsert generated video geometry diff', {
                generationRequestId: assignment.generationRequestId,
                mediaRunId: assignment.mediaRunId,
                pendingNodeId: existing?.nodeId ?? '',
                finalNodeId: nodeId,
                replacedPendingNode: replacementResult.changed,
                aspectRatio,
                removedNodeIds,
                geometryNodeCount: geometryNodes.length,
                geometryNodeIds: geometryNodes.map(node => node.nodeId),
            })
            return {
                canvasState: forestResult.state,
                changed: markerResult.changed || replacementResult.changed || nodeResult.changed || edgeResult.changed || forestResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || !result.canvasState) return null
    return buildCanvasGeometryUpdate({
        context: 'upsertGeneratedVideoToCanvas',
        layoutRevision: result.canvasStateUpdatedAt,
        state: result.canvasState,
        generationRequestId: assignment.generationRequestId,
        geometryNodes,
        removedNodeIds,
    })
}

export function logCanvasProjectionError(context: string, error: unknown): void {
    err(`[media-generation-canvas-projection] ${context}:`, error)
}
