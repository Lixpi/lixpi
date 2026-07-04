'use strict'

import {
    resolveRigidCanvasNodeGroupCollisions,
    type CanvasEngineRect,
    type RigidCanvasNodeGroup,
} from '@lixpi/canvas-engine'
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
type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
type LineageCollisionNode = MarkerNode | GeneratedMediaNode
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

function buildNodesById(nodes: CanvasNode[]): Map<string, CanvasNode> {
    return new Map(nodes.map(node => [node.nodeId, node]))
}

function isTopLevelNode(node: CanvasNode): boolean {
    return !node.parentId
}

function isMarkerNode(node: CanvasNode): node is MarkerNode {
    return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
}

function isGeneratedMediaLineageNode(node: CanvasNode): node is GeneratedMediaNode {
    return (node.type === 'image' || node.type === 'video') && Boolean(node.generatedBy?.branchId)
}

function getGeneratedMediaLineageParentNodeId(node: GeneratedMediaNode): string | undefined {
    return node.generatedBy?.branchLineNodeId
        ?? node.generatedBy?.branchForkNodeId
        ?? node.generatedBy?.branchOriginNodeId
        ?? node.generatedBy?.parentMediaNodeId
        ?? node.generatedBy?.parentImageNodeId
}

function isLineageCollisionNode(node: CanvasNode): node is LineageCollisionNode {
    return isTopLevelNode(node) && (isMarkerNode(node) || isGeneratedMediaLineageNode(node))
}

function getLineageCollisionLinks(node: LineageCollisionNode): Array<string | undefined> {
    if (node.type === 'branchFork' || node.type === 'branchLine') return [node.parentBranchNodeId]
    if (node.type === 'branchOrigin') return []

    return [
        node.generatedBy?.parentMediaNodeId,
        node.generatedBy?.parentImageNodeId,
        node.generatedBy?.branchOriginNodeId,
        node.generatedBy?.branchForkNodeId,
        node.generatedBy?.branchLineNodeId,
    ]
}

function getSetRoot(parentById: Map<string, string>, nodeId: string): string {
    const parentId = parentById.get(nodeId)
    if (!parentId || parentId === nodeId) return nodeId

    const rootId = getSetRoot(parentById, parentId)
    parentById.set(nodeId, rootId)
    return rootId
}

function unionSets(parentById: Map<string, string>, a: string, b: string): void {
    const rootA = getSetRoot(parentById, a)
    const rootB = getSetRoot(parentById, b)
    if (rootA === rootB) return
    parentById.set(rootB, rootA)
}

function getNodeRect(node: CanvasNode): CanvasEngineRect {
    return {
        x: getFiniteNumber(node.position.x, 0),
        y: getFiniteNumber(node.position.y, 0),
        width: Math.max(0, getFiniteNumber(node.dimensions.width, 0)),
        height: Math.max(0, getFiniteNumber(node.dimensions.height, 0)),
    }
}

function getGroupRect(nodeIds: string[], nodesById: Map<string, CanvasNode>): CanvasEngineRect | undefined {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId)
        if (!node) continue

        const rect = getNodeRect(node)
        minX = Math.min(minX, rect.x)
        minY = Math.min(minY, rect.y)
        maxX = Math.max(maxX, rect.x + rect.width)
        maxY = Math.max(maxY, rect.y + rect.height)
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return undefined
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    }
}

function getSortedGroupNodeIds(nodeIds: string[], nodesById: Map<string, CanvasNode>): string[] {
    return [...nodeIds].sort((a, b) => {
        const nodeA = nodesById.get(a)
        const nodeB = nodesById.get(b)
        const yDelta = getFiniteNumber(nodeA?.position.y, 0) - getFiniteNumber(nodeB?.position.y, 0)
        if (yDelta !== 0) return yDelta
        const xDelta = getFiniteNumber(nodeA?.position.x, 0) - getFiniteNumber(nodeB?.position.x, 0)
        if (xDelta !== 0) return xDelta
        return a.localeCompare(b)
    })
}

function buildCanvasProjectionCollisionGroups(state: CanvasState): RigidCanvasNodeGroup[] {
    const nodesById = buildNodesById(state.nodes)
    const lineageNodes = state.nodes.filter(isLineageCollisionNode)
    const lineageNodeIds = new Set(lineageNodes.map(node => node.nodeId))
    const parentById = new Map<string, string>()
    for (const nodeId of lineageNodeIds) parentById.set(nodeId, nodeId)

    for (const node of lineageNodes) {
        for (const linkedNodeId of getLineageCollisionLinks(node)) {
            if (linkedNodeId && lineageNodeIds.has(linkedNodeId)) {
                unionSets(parentById, node.nodeId, linkedNodeId)
            }
        }
    }

    for (const edge of state.edges ?? []) {
        if (!lineageNodeIds.has(edge.sourceNodeId) || !lineageNodeIds.has(edge.targetNodeId)) continue
        unionSets(parentById, edge.sourceNodeId, edge.targetNodeId)
    }

    const lineageGroupsByRoot = new Map<string, string[]>()
    for (const nodeId of lineageNodeIds) {
        const rootId = getSetRoot(parentById, nodeId)
        const group = lineageGroupsByRoot.get(rootId) ?? []
        group.push(nodeId)
        lineageGroupsByRoot.set(rootId, group)
    }

    const groups: RigidCanvasNodeGroup[] = []
    const groupedNodeIds = new Set<string>()
    for (const nodeIds of lineageGroupsByRoot.values()) {
        const sortedNodeIds = getSortedGroupNodeIds(nodeIds, nodesById)
        const rect = getGroupRect(sortedNodeIds, nodesById)
        if (!rect) continue

        for (const nodeId of sortedNodeIds) groupedNodeIds.add(nodeId)
        groups.push({
            id: `lineage:${sortedNodeIds[0]}`,
            nodeIds: sortedNodeIds,
            rect,
            margin: canvasProjectionSettings.nodeGap,
            overlapThreshold: 0,
        })
    }

    for (const node of state.nodes) {
        if (!isTopLevelNode(node) || groupedNodeIds.has(node.nodeId)) continue
        groups.push({
            id: `node:${node.nodeId}`,
            nodeIds: [node.nodeId],
            rect: getNodeRect(node),
            margin: 20,
            overlapThreshold: 0.5,
        })
    }

    return groups
}

function resolveCanvasProjectionCollisions(
    state: CanvasState,
    context: string,
): { state: CanvasState; changed: boolean } {
    const groups = buildCanvasProjectionCollisionGroups(state)
    const collisionResult = resolveRigidCanvasNodeGroupCollisions(state.nodes, groups, {
        iterations: 50,
        margin: 20,
        overlapThreshold: 0.5,
    })
    if (!collisionResult.changed) return { state, changed: false }

    console.info('[media-generation-canvas-projection] resolved canvas collisions', {
        context,
        groupCount: groups.length,
        movedGroupCount: collisionResult.movedGroupCount,
        movedNodeCount: collisionResult.movedNodeCount,
        collisionIterations: collisionResult.collisionIterations,
    })

    return {
        state: {
            ...state,
            nodes: collisionResult.nodes,
        },
        changed: true,
    }
}

function compareOptionalNumber(a: number | undefined, b: number | undefined): number {
    const normalizedA = Number.isFinite(a) ? Number(a) : Number.MAX_SAFE_INTEGER
    const normalizedB = Number.isFinite(b) ? Number(b) : Number.MAX_SAFE_INTEGER
    return normalizedA - normalizedB
}

function compareOptionalString(a: string | undefined, b: string | undefined): number {
    return (a ?? '').localeCompare(b ?? '')
}

function compareGeneratedMediaSiblingOrder(a: GeneratedMediaNode, b: GeneratedMediaNode): number {
    return compareOptionalNumber(a.generatedBy?.reasoningIndex, b.generatedBy?.reasoningIndex)
        || compareOptionalNumber(a.generatedBy?.createdAt, b.generatedBy?.createdAt)
        || compareOptionalNumber(a.generatedBy?.variantIndex, b.generatedBy?.variantIndex)
        || compareOptionalNumber(a.generatedBy?.mediaIndex, b.generatedBy?.mediaIndex)
        || compareOptionalString(a.generatedBy?.mediaType, b.generatedBy?.mediaType)
        || compareOptionalString(a.generatedBy?.mediaModelId, b.generatedBy?.mediaModelId)
        || compareOptionalString(a.generatedBy?.mediaRunId, b.generatedBy?.mediaRunId)
        || a.nodeId.localeCompare(b.nodeId)
}

function rebalanceGeneratedMediaChildren(
    state: CanvasState,
    lineageParentNodeId: string | undefined,
): { state: CanvasState; changed: boolean } {
    if (!lineageParentNodeId) return { state, changed: false }

    const parentNode = findNode(state.nodes, lineageParentNodeId)
    if (!parentNode) return { state, changed: false }

    const siblings = state.nodes
        .filter((node): node is GeneratedMediaNode => isGeneratedMediaLineageNode(node))
        .filter(node => getGeneratedMediaLineageParentNodeId(node) === lineageParentNodeId)
        .sort(compareGeneratedMediaSiblingOrder)

    if (siblings.length <= 1) return { state, changed: false }

    const totalHeight = siblings.reduce((height, node) => height + node.dimensions.height, 0)
        + canvasProjectionSettings.branchRowGap * Math.max(0, siblings.length - 1)
    const parentCenterY = parentNode.position.y + parentNode.dimensions.height / 2
    const childX = parentNode.position.x + parentNode.dimensions.width + getGapToGeneratedMedia(parentNode)
    let childY = parentCenterY - totalHeight / 2
    let changed = false
    const nextPositionsByNodeId = new Map<string, { x: number; y: number }>()

    for (const sibling of siblings) {
        const position = { x: childX, y: childY }
        nextPositionsByNodeId.set(sibling.nodeId, position)
        changed = changed || sibling.position.x !== position.x || sibling.position.y !== position.y
        childY += sibling.dimensions.height + canvasProjectionSettings.branchRowGap
    }

    if (!changed) return { state, changed: false }

    return {
        state: {
            ...state,
            nodes: state.nodes.map((node) => {
                const position = nextPositionsByNodeId.get(node.nodeId)
                return position ? { ...node, position } as CanvasNode : node
            }),
        },
        changed: true,
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
            reasoningIndex: assignment.reasoningIndex ?? 0,
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
            reasoningIndex: assignment.reasoningIndex ?? 0,
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
}): Promise<void> {
    await Workspace.mutateCanvasState({
        workspaceId: params.workspaceId,
        origin: 'upsertMediaLineagePlanToCanvas',
        mutate: (canvasState) => {
            const markers = markerNodesFromLineagePlan(params.lineagePlan, params.aiChatThreadId, canvasState, params.canvasVisibleArea)
            const markerResult = ensureMarkers(canvasState, markers)
            const collisionResult = resolveCanvasProjectionCollisions(markerResult.state, 'upsertMediaLineagePlanToCanvas')
            return {
                canvasState: collisionResult.state,
                changed: markerResult.changed || collisionResult.changed,
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
                    ...(params.generationRun?.variantIndex !== undefined ? { variantIndex: params.generationRun.variantIndex } : {}),
                    mediaModelId,
                },
            }
            const nodeResult = upsertNode(nextState.nodes, imageNode)
            nextState = { ...nextState, nodes: nodeResult.nodes }
            const edgeResult = addGeneratedMediaEdge(nextState, lineageParentNodeId, nodeId)
            nextState = edgeResult.state
            const rebalanceResult = rebalanceGeneratedMediaChildren(nextState, lineageParentNodeId)
            nextState = rebalanceResult.state
            const collisionResult = resolveCanvasProjectionCollisions(nextState, 'upsertGeneratedImageToCanvas')
            return {
                canvasState: collisionResult.state,
                changed: markerResult.changed || nodeResult.changed || edgeResult.changed || rebalanceResult.changed || collisionResult.changed,
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
                    ...(params.generationRun?.variantIndex !== undefined ? { variantIndex: params.generationRun.variantIndex } : {}),
                    ...(params.generationRun?.mediaModelId ? { mediaModelId: params.generationRun.mediaModelId } : {}),
                },
            }
            const nodeResult = upsertNode(nextState.nodes, videoNode)
            nextState = { ...nextState, nodes: nodeResult.nodes }
            const edgeResult = addGeneratedMediaEdge(nextState, lineageParentNodeId, nodeId)
            nextState = edgeResult.state
            const rebalanceResult = rebalanceGeneratedMediaChildren(nextState, lineageParentNodeId)
            nextState = rebalanceResult.state
            const collisionResult = resolveCanvasProjectionCollisions(nextState, 'upsertGeneratedVideoToCanvas')
            return {
                canvasState: collisionResult.state,
                changed: markerResult.changed || nodeResult.changed || edgeResult.changed || rebalanceResult.changed || collisionResult.changed,
            }
        },
    })
}

export function logCanvasProjectionError(context: string, error: unknown): void {
    err(`[media-generation-canvas-projection] ${context}:`, error)
}
