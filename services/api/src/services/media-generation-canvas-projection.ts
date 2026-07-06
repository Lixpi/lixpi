'use strict'

import {
    estimateBranchMarkerDimensions,
    fitDimensionsToAspectRatio,
    getGeneratedMediaChromeCollisionHeight,
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
    // Intrinsic aspect ratio of the stored image bytes (width / height). The API
    // persists final fitted dimensions so clients never re-fit after load.
    aspectRatio?: number
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
type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
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

// Markers are sized from their prompt text with the SAME shared estimator the
// WebUI renders with, so the authoritative layout reserves exactly the painted
// pill. Falls back to the legacy fixed projection size without prompt text.
function lineageMarkerDimensions(promptText: string | undefined, responseLine = false): { width: number; height: number } {
    if (!promptText) return markerDimensions()
    return estimateBranchMarkerDimensions(promptText, { responseLine })
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

function buildNodesById(nodes: CanvasNode[]): Map<string, CanvasNode> {
    return new Map(nodes.map(node => [node.nodeId, node]))
}

function isMarkerNode(node: CanvasNode): node is MarkerNode {
    return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
}

// Collision rect matches the WebUI exactly: node box plus the chrome strip
// reserved under generated media (shared metric settings).
function getLineageCollisionRect(node: CanvasNode, worldPosition: { x: number; y: number }): CanvasEngineRect {
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

// Mirrors the WebUI workspaceCollision.branchTree node-type settings: media and
// documents get a 20px margin / 0.5 overlap threshold, markers reserve the
// branch-lineage nodeGap with a 0 threshold.
function getLineageCollisionMargin(node: CanvasNode): number {
    return isMarkerNode(node) ? canvasProjectionSettings.nodeGap : 20
}

function getLineageCollisionOverlapThreshold(node: CanvasNode): number {
    return isMarkerNode(node) ? 0 : 0.5
}

// The authoritative layout pass: refresh marker dimensions from their prompt
// text (response row once the marker's turn has produced media), then run the
// SAME shared tidy-tree + rigid collision resolution the WebUI uses for local
// drag/delete rebalances. Persisted geometry is final — clients apply it.
function rebalanceLineageForest(state: CanvasState, context: string): { state: CanvasState; changed: boolean } {
    const { markerIdsWithGeneratedChildren } = getStartedLineageMarkerState(state.nodes)
    let markerDimensionsChanged = false
    const nodes = state.nodes.map((node): CanvasNode => {
        if (!isMarkerNode(node)) return node
        const promptText = node.provenance?.promptText
        if (!promptText) return node
        const dimensions = estimateBranchMarkerDimensions(promptText, {
            responseLine: markerIdsWithGeneratedChildren.has(node.nodeId),
        })
        if (node.dimensions.width === dimensions.width && node.dimensions.height === dimensions.height) return node
        markerDimensionsChanged = true
        return { ...node, dimensions } as CanvasNode
    })

    const resolvedNodes = rebalanceBranchTreesAndResolve(nodes, state.edges ?? [], {
        depthGap: canvasProjectionSettings.mediaToMediaGap,
        branchOriginDepthGap: canvasProjectionSettings.branchOriginToFirstMediaGap,
        rootMarkerDepthGap: canvasProjectionSettings.rootToFirstMediaGap,
        siblingGap: canvasProjectionSettings.branchRowGap,
        branchFanoutExtraGap: canvasProjectionSettings.branchFanoutExtraGap,
        branchOriginMarkerStackGap: canvasProjectionSettings.nodeGap,
        collisionIterations: 50,
        collisionMargin: 0,
        getNodeCollisionRect: getLineageCollisionRect,
        getNodeCollisionMargin: getLineageCollisionMargin,
        getNodeCollisionOverlapThreshold: getLineageCollisionOverlapThreshold,
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
}): Promise<CanvasGeometryUpdate | null> {
    let geometryNodes: CanvasNodeGeometry[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertMediaLineagePlanToCanvas',
        mutate: (canvasState) => {
            const markers = markerNodesFromLineagePlan(params.lineagePlan, params.aiChatThreadId, canvasState, params.canvasVisibleArea)
            const markerResult = ensureMarkers(canvasState, markers)
            const rebalanceResult = rebalanceLineageForest(markerResult.state, 'upsertMediaLineagePlanToCanvas')
            geometryNodes = diffCanvasGeometry(canvasState, rebalanceResult.state)
            return {
                canvasState: rebalanceResult.state,
                changed: markerResult.changed || rebalanceResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || geometryNodes.length === 0) return null
    return { layoutRevision: result.canvasStateUpdatedAt, nodes: geometryNodes }
}

export async function settleMediaGenerationRequestOnCanvas(params: {
    workspaceId: string
    generationRequestId: string
}): Promise<CanvasGeometryUpdate | null> {
    let geometryNodes: CanvasNodeGeometry[] = []
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
            // The settle pass is the final authoritative layout for the request:
            // clients load these persisted positions with no post-load movement.
            const rebalanceResult = rebalanceLineageForest({ ...canvasState, nodes }, 'settleMediaGenerationRequestOnCanvas')
            geometryNodes = diffCanvasGeometry(canvasState, rebalanceResult.state)
            return {
                canvasState: rebalanceResult.state,
                changed: changed || rebalanceResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || geometryNodes.length === 0) return null
    return { layoutRevision: result.canvasStateUpdatedAt, nodes: geometryNodes }
}

export async function upsertGeneratedImageToCanvas(params: UpsertImageInput): Promise<CanvasGeometryUpdate | null> {
    const assignment = params.generationRun?.lineageAssignment
    if (!assignment) return null

    let geometryNodes: CanvasNodeGeometry[] = []
    const result = await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertGeneratedImageToCanvas',
        mutate: (canvasState) => {
            const markerResult = ensureMarkers(canvasState, markerNodesFromAssignment(assignment, params.aiChatThreadId, canvasState, params.canvasVisibleArea))
            let nextState = markerResult.state
            const existing = findGeneratedMediaNodeForRun(nextState.nodes, 'image', params.fileId, params.generationRun)
            const nodeId = existing?.nodeId ?? `node-${params.fileId}`
            const intrinsicAspectRatio = Number.isFinite(params.aspectRatio) && Number(params.aspectRatio) > 0
                ? Number(params.aspectRatio)
                : undefined
            // Final fitted dimensions are persisted here so the client's
            // intrinsic-size handler is a no-op on load — no post-load movement.
            const dimensions = intrinsicAspectRatio
                ? fitDimensionsToAspectRatio(existing?.dimensions ?? mediaDimensions(), intrinsicAspectRatio)
                : existing?.dimensions ?? mediaDimensions()
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
                    ...(params.generationRun?.variantIndex !== undefined ? { variantIndex: params.generationRun.variantIndex } : {}),
                    mediaModelId,
                },
            }
            const nodeResult = upsertNode(nextState.nodes, imageNode)
            nextState = { ...nextState, nodes: nodeResult.nodes }
            const edgeResult = addGeneratedMediaEdge(nextState, lineageParentNodeId, nodeId)
            nextState = edgeResult.state
            const forestResult = rebalanceLineageForest(nextState, 'upsertGeneratedImageToCanvas')
            geometryNodes = diffCanvasGeometry(canvasState, forestResult.state)
            return {
                canvasState: forestResult.state,
                changed: markerResult.changed || nodeResult.changed || edgeResult.changed || forestResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || geometryNodes.length === 0) return null
    return { layoutRevision: result.canvasStateUpdatedAt, nodes: geometryNodes }
}

export async function upsertGeneratedVideoToCanvas(params: UpsertVideoInput): Promise<CanvasGeometryUpdate | null> {
    const assignment = params.generationRun?.lineageAssignment
    if (!assignment) return null

    let geometryNodes: CanvasNodeGeometry[] = []
    const result = await Workspace.mutateCanvasState({
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
                    ...(params.generationRun?.variantIndex !== undefined ? { variantIndex: params.generationRun.variantIndex } : {}),
                    ...(params.generationRun?.mediaModelId ? { mediaModelId: params.generationRun.mediaModelId } : {}),
                },
            }
            const nodeResult = upsertNode(nextState.nodes, videoNode)
            nextState = { ...nextState, nodes: nodeResult.nodes }
            const edgeResult = addGeneratedMediaEdge(nextState, lineageParentNodeId, nodeId)
            nextState = edgeResult.state
            const forestResult = rebalanceLineageForest(nextState, 'upsertGeneratedVideoToCanvas')
            geometryNodes = diffCanvasGeometry(canvasState, forestResult.state)
            return {
                canvasState: forestResult.state,
                changed: markerResult.changed || nodeResult.changed || edgeResult.changed || forestResult.changed,
            }
        },
    })
    if (!result.changed || result.canvasStateUpdatedAt === null || geometryNodes.length === 0) return null
    return { layoutRevision: result.canvasStateUpdatedAt, nodes: geometryNodes }
}

export function logCanvasProjectionError(context: string, error: unknown): void {
    err(`[media-generation-canvas-projection] ${context}:`, error)
}
