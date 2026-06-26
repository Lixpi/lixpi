import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    CanvasNode,
    ImageCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'

import {
    getStartedLineageMarkerState,
    isGeneratedMediaNode,
    type GeneratedMediaNode,
} from '$src/infographics/workspace/branchLineageState.ts'
import { rebalanceBranchTreesAndResolve } from '$src/infographics/workspace/branchTreeLayout.ts'
import { computeLineageContinuationPositionToRightOfRect } from '$src/infographics/workspace/imagePositioning.ts'

export type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }
export type CanvasGeometry = { position: Point; dimensions: { width: number; height: number } }
export type GeneratedMediaRebalancePipelineConfig = {
    workspaceId: string
    mediaSize: number
    depthGap: number
    branchOriginDepthGap: number
    rootMarkerDepthGap: number
    siblingGap: number
    branchFanoutExtraGap: number
    branchOriginMarkerStackGap: number
    collisionIterations: number
    collisionMargin: number
    getPendingGeneratedMediaLayoutGeometry: (node: GeneratedMediaNode) => CanvasGeometry | null
    getPendingGeneratedMediaCircleInset: (dimensions: { width: number; height: number }) => { x: number; y: number; size: number }
    getNodeWorldPosition: (node: CanvasNode, nodesById: Map<string, CanvasNode>) => Point
    getNodeWorldRect: (node: CanvasNode, nodesById: Map<string, CanvasNode>) => Rect
    getNodeCollisionRect: (node: CanvasNode, worldPosition: Point) => Rect
    getNodeCollisionMargin: (node: CanvasNode) => number
    getNodeCollisionOverlapThreshold: (node: CanvasNode) => number
}
export type GeneratedMediaRebalanceResult = {
    nodes: CanvasNode[]
    startedMarkerNodeIds: Set<string>
}

type PendingMediaGeometryProxy = {
    offset: Point
    dimensions: { width: number; height: number }
}
type PlannedMarkerMediaProxy = {
    markerNodeId: string
    proxyNodeId: string
    parentBranchNodeId: string
}
type RebalanceLayoutProxyPlan = {
    nodes: CanvasNode[]
    pendingMediaProxiesByNodeId: Map<string, PendingMediaGeometryProxy>
    plannedMarkerProxiesByMarkerId: Map<string, PlannedMarkerMediaProxy>
}

const PLANNED_MEDIA_LAYOUT_PROXY_NODE_ID_SUFFIX = ':planned-media-layout-proxy'

function getNodesById(nodes: CanvasNode[]): Map<string, CanvasNode> {
    return new Map(nodes.map((node: CanvasNode) => [node.nodeId, node]))
}

function getBranchMarkerReasoningIndex(marker: BranchMarkerNode): number | undefined {
    return marker.type === 'branchFork' || marker.type === 'branchLine'
        ? marker.reasoningIndex
        : marker.pendingState?.reasoningIndex
}

function compareBranchMarkersByReasoningOrder(a: BranchMarkerNode, b: BranchMarkerNode): number {
    const indexDelta = (getBranchMarkerReasoningIndex(a) ?? Number.MAX_SAFE_INTEGER)
        - (getBranchMarkerReasoningIndex(b) ?? Number.MAX_SAFE_INTEGER)
    if (indexDelta !== 0) return indexDelta
    const positionDelta = a.position.y - b.position.y
    if (positionDelta !== 0) return positionDelta
    return a.nodeId.localeCompare(b.nodeId)
}

function compareBranchMarkersByStackPosition(a: BranchMarkerNode, b: BranchMarkerNode): number {
    const positionDelta = a.position.y - b.position.y
    if (positionDelta !== 0) return positionDelta
    return compareBranchMarkersByReasoningOrder(a, b)
}

function getBranchMarkerStackHeight(markers: BranchMarkerNode[], gap: number): number {
    if (markers.length === 0) return 0
    return markers.reduce((height: number, marker: BranchMarkerNode) => height + marker.dimensions.height, 0)
        + Math.max(0, markers.length - 1) * gap
}

type BranchMarkerStackGroup = {
    markers: BranchMarkerNode[]
}
export type ReflowStackedBranchMarkersOptions = {
    markers: BranchMarkerNode[]
    allNodes: CanvasNode[]
    manuallyPositionedMarkerNodeIds: Set<string>
    branchMarkerStackGap: number
    getNodeWorldRect: (node: CanvasNode, nodesById: Map<string, CanvasNode>) => Rect
}

function getBranchMarkerStackGroupKey(marker: BranchMarkerNode): string | null {
    if (marker.pendingState?.phase === 'preflight') return null
    if (marker.type !== 'branchFork' && marker.type !== 'branchLine') return null
    if (marker.parentBranchNodeId) return `parent:${marker.parentBranchNodeId}`
    if (marker.type === 'branchFork') return `root:${marker.generationRequestId}`
    return null
}

function getBranchMarkerStackGroups(options: ReflowStackedBranchMarkersOptions): BranchMarkerStackGroup[] {
    const groupsByKey = new Map<string, BranchMarkerNode[]>()
    const { markerIdsWithGeneratedChildren } = getStartedLineageMarkerState(options.allNodes)
    for (const marker of options.markers) {
        if (markerIdsWithGeneratedChildren.has(marker.nodeId)) continue
        const key = getBranchMarkerStackGroupKey(marker)
        if (!key) continue
        const group = groupsByKey.get(key) ?? []
        group.push(marker)
        groupsByKey.set(key, group)
    }
    return [...groupsByKey.values()]
        .filter((markersInGroup: BranchMarkerNode[]) => markersInGroup.length > 1)
        .filter((markersInGroup: BranchMarkerNode[]) => markersInGroup.some((marker: BranchMarkerNode) => Boolean(marker.pendingState)))
        .filter((markersInGroup: BranchMarkerNode[]) =>
            !markersInGroup.some((marker: BranchMarkerNode) => options.manuallyPositionedMarkerNodeIds.has(marker.nodeId))
        )
        .map((markersInGroup: BranchMarkerNode[]) => ({
            markers: [...markersInGroup].sort(compareBranchMarkersByStackPosition),
        }))
}

function getBranchMarkerStackAnchorTop(
    group: BranchMarkerStackGroup,
    options: ReflowStackedBranchMarkersOptions,
    nodesById: Map<string, CanvasNode>,
): number {
    const firstMarker = group.markers[0]
    const parentBranchNodeId = firstMarker && (firstMarker.type === 'branchFork' || firstMarker.type === 'branchLine')
        ? firstMarker.parentBranchNodeId
        : undefined
    const parentNode = parentBranchNodeId
        ? nodesById.get(parentBranchNodeId)
        : undefined
    if (parentNode?.type === 'branchOrigin') {
        const parentRect = options.getNodeWorldRect(parentNode, nodesById)
        return parentRect.y + parentRect.height + options.branchMarkerStackGap
    }

    const top = Math.min(...group.markers.map((marker: BranchMarkerNode) => marker.position.y))
    const bottom = Math.max(...group.markers.map((marker: BranchMarkerNode) => marker.position.y + marker.dimensions.height))
    return ((top + bottom) / 2) - getBranchMarkerStackHeight(group.markers, options.branchMarkerStackGap) / 2
}

export function reflowStackedBranchMarkers(options: ReflowStackedBranchMarkersOptions): Map<string, BranchMarkerNode> {
    const reflowedMarkers = new Map<string, BranchMarkerNode>()
    const groups = getBranchMarkerStackGroups(options)
    if (groups.length === 0) return reflowedMarkers

    const nodesById = getNodesById(options.allNodes)
    for (const marker of options.markers) nodesById.set(marker.nodeId, marker)

    for (const group of groups) {
        let y = getBranchMarkerStackAnchorTop(group, options, nodesById)
        for (const marker of group.markers) {
            const nextMarker = {
                ...marker,
                position: {
                    ...marker.position,
                    y,
                },
            }
            reflowedMarkers.set(marker.nodeId, nextMarker)
            nodesById.set(marker.nodeId, nextMarker)
            y += marker.dimensions.height + options.branchMarkerStackGap
        }
    }

    return reflowedMarkers
}

function getBranchMarkerStackOffset(
    markerIds: string[],
    nodesById: Map<string, CanvasNode>,
    markerNodeId: string,
    gap: number,
): number | null {
    let offset = gap
    for (const id of markerIds) {
        if (id === markerNodeId) return offset
        const markerNode = nodesById.get(id)
        if (!markerNode) continue
        offset += markerNode.dimensions.height + gap
    }
    return null
}

function getUniquePlannedMediaLayoutProxyNodeId(markerNodeId: string, nodesById: Map<string, CanvasNode>): string {
    const baseNodeId = `${markerNodeId}${PLANNED_MEDIA_LAYOUT_PROXY_NODE_ID_SUFFIX}`
    if (!nodesById.has(baseNodeId)) return baseNodeId

    let index = 2
    let nodeId = `${baseNodeId}:${index}`
    while (nodesById.has(nodeId)) {
        index += 1
        nodeId = `${baseNodeId}:${index}`
    }
    return nodeId
}

function getPlannedMediaProxyLineageParentAttrs(
    parentNode: CanvasNode,
    markerNode: BranchForkCanvasNode | BranchLineCanvasNode,
): Pick<
    NonNullable<ImageCanvasNode['generatedBy']>,
    'parentMediaNodeId' | 'parentImageNodeId' | 'branchOriginNodeId' | 'branchForkNodeId' | 'branchLineNodeId'
> {
    const attrs: Pick<
        NonNullable<ImageCanvasNode['generatedBy']>,
        'parentMediaNodeId' | 'parentImageNodeId' | 'branchOriginNodeId' | 'branchForkNodeId' | 'branchLineNodeId'
    > = {}

    if (parentNode.type === 'image' || parentNode.type === 'video') {
        attrs.parentMediaNodeId = parentNode.nodeId
        attrs.parentImageNodeId = parentNode.nodeId
    } else if (parentNode.type === 'branchOrigin') {
        attrs.branchOriginNodeId = parentNode.nodeId
    } else if (parentNode.type === 'branchFork') {
        attrs.branchForkNodeId = parentNode.nodeId
    } else if (parentNode.type === 'branchLine') {
        attrs.branchLineNodeId = parentNode.nodeId
    }

    if (markerNode.type === 'branchFork') attrs.branchForkNodeId = markerNode.nodeId
    else attrs.branchLineNodeId = markerNode.nodeId

    return attrs
}

export class GeneratedMediaRebalancePipeline {
    constructor(private readonly config: GeneratedMediaRebalancePipelineConfig) {}

    rebalance(nodes: CanvasNode[], edges: WorkspaceEdge[]): GeneratedMediaRebalanceResult {
        const proxyPlan = this.prepareLayoutProxyPlan(nodes)
        const resolvedNodes = rebalanceBranchTreesAndResolve(proxyPlan.nodes, edges, {
            depthGap: this.config.depthGap,
            branchOriginDepthGap: this.config.branchOriginDepthGap,
            rootMarkerDepthGap: this.config.rootMarkerDepthGap,
            siblingGap: this.config.siblingGap,
            branchFanoutExtraGap: this.config.branchFanoutExtraGap,
            branchOriginMarkerStackGap: this.config.branchOriginMarkerStackGap,
            collisionIterations: this.config.collisionIterations,
            collisionMargin: this.config.collisionMargin,
            getNodeCollisionRect: this.config.getNodeCollisionRect,
            getNodeCollisionMargin: this.config.getNodeCollisionMargin,
            getNodeCollisionOverlapThreshold: this.config.getNodeCollisionOverlapThreshold,
        })
        const restoredNodes = this.restorePersistedGeometry(resolvedNodes, proxyPlan)
        return {
            nodes: restoredNodes,
            startedMarkerNodeIds: getStartedLineageMarkerState(restoredNodes).markerIdsWithGeneratedChildren,
        }
    }

    private prepareLayoutProxyPlan(nodes: CanvasNode[]): RebalanceLayoutProxyPlan {
        const pendingMediaProxiesByNodeId = new Map<string, PendingMediaGeometryProxy>()
        const plannedMarkerProxiesByMarkerId = new Map<string, PlannedMarkerMediaProxy>()
        const proxyNodes = nodes.map((node: CanvasNode) => {
            if (!isGeneratedMediaNode(node)) return node
            const proxyGeometry = this.config.getPendingGeneratedMediaLayoutGeometry(node)
            if (!proxyGeometry) return node

            pendingMediaProxiesByNodeId.set(node.nodeId, {
                offset: {
                    x: proxyGeometry.position.x - node.position.x,
                    y: proxyGeometry.position.y - node.position.y,
                },
                dimensions: node.dimensions,
            })
            return {
                ...node,
                position: proxyGeometry.position,
                dimensions: proxyGeometry.dimensions,
            }
        })
        const nodesById = getNodesById(proxyNodes)
        const { markerIdsWithGeneratedChildren, parentIdsWithStartedMarkerChildren } = getStartedLineageMarkerState(proxyNodes)
        const plannedProxyNodes: ImageCanvasNode[] = []

        for (const node of proxyNodes) {
            if (node.type !== 'branchFork' && node.type !== 'branchLine') continue
            if (node.pendingState?.phase !== 'planned' || !node.parentBranchNodeId) continue
            if (markerIdsWithGeneratedChildren.has(node.nodeId)) continue
            if (!parentIdsWithStartedMarkerChildren.has(node.parentBranchNodeId)) continue

            const parentNode = nodesById.get(node.parentBranchNodeId)
            if (!parentNode) continue

            const proxyNodeId = getUniquePlannedMediaLayoutProxyNodeId(node.nodeId, nodesById)
            const proxyNode = this.createPlannedBranchMarkerMediaLayoutProxy(node, parentNode, nodesById, proxyNodeId)
            plannedMarkerProxiesByMarkerId.set(node.nodeId, {
                markerNodeId: node.nodeId,
                proxyNodeId: proxyNode.nodeId,
                parentBranchNodeId: node.parentBranchNodeId,
            })
            plannedProxyNodes.push(proxyNode)
            nodesById.set(proxyNode.nodeId, proxyNode)
        }

        return {
            nodes: plannedProxyNodes.length > 0 ? [...proxyNodes, ...plannedProxyNodes] : proxyNodes,
            pendingMediaProxiesByNodeId,
            plannedMarkerProxiesByMarkerId,
        }
    }

    private createPlannedBranchMarkerMediaLayoutProxy(
        markerNode: BranchForkCanvasNode | BranchLineCanvasNode,
        parentNode: CanvasNode,
        nodesById: Map<string, CanvasNode>,
        proxyNodeId: string,
    ): ImageCanvasNode {
        const mediaDimensions = { width: this.config.mediaSize, height: this.config.mediaSize }
        const circleInset = this.config.getPendingGeneratedMediaCircleInset(mediaDimensions)
        const parentRect = this.config.getNodeWorldRect(parentNode, nodesById)
        const mediaGap = parentNode.type === 'branchOrigin'
            ? this.config.branchOriginDepthGap
            : this.config.depthGap
        const futureMediaPosition = computeLineageContinuationPositionToRightOfRect(
            parentRect,
            mediaDimensions.height,
            mediaGap,
        )
        const reasoningModelId = markerNode.reasoningModelId
            ?? markerNode.pendingState?.reasoningModelId
            ?? markerNode.pendingState?.reasoningModelIds[0]
            ?? 'unknown:planned-media-layout-proxy'
        const reasoningIndex = markerNode.reasoningIndex ?? markerNode.pendingState?.reasoningIndex ?? 0
        const promptText = markerNode.pendingState?.promptText ?? markerNode.provenance?.promptText

        return {
            nodeId: proxyNodeId,
            type: 'image',
            fileId: proxyNodeId,
            workspaceId: this.config.workspaceId,
            src: '',
            aspectRatio: 1,
            position: {
                x: futureMediaPosition.x,
                y: futureMediaPosition.y + circleInset.y,
            },
            dimensions: { width: circleInset.size, height: circleInset.size },
            generatedBy: {
                aiChatThreadId: markerNode.aiChatThreadId ?? '',
                responseId: '',
                aiModel: reasoningModelId,
                revisedPrompt: promptText ?? '',
                generationRequestId: markerNode.generationRequestId,
                ...(markerNode.reasoningRunId ? { reasoningRunId: markerNode.reasoningRunId } : {}),
                reasoningModelId,
                reasoningIndex,
                variantIndex: reasoningIndex,
                branchId: markerNode.branchId,
                ...(promptText ? { promptText } : {}),
                ...(markerNode.promptFingerprint ? { promptFingerprint: markerNode.promptFingerprint } : {}),
                createdAt: reasoningIndex,
                ...getPlannedMediaProxyLineageParentAttrs(parentNode, markerNode),
            },
        }
    }

    private restorePersistedGeometry(
        nodes: CanvasNode[],
        proxyPlan: RebalanceLayoutProxyPlan,
    ): CanvasNode[] {
        if (proxyPlan.pendingMediaProxiesByNodeId.size === 0 && proxyPlan.plannedMarkerProxiesByMarkerId.size === 0) return nodes

        const nodesById = getNodesById(nodes)
        const plannedProxyNodeIds = new Set<string>()
        const plannedMarkerPositionsById = new Map<string, Point>()
        const branchOriginMarkerIdsByParentId = new Map<string, string[]>()
        for (const node of nodes) {
            if (node.type !== 'branchFork' && node.type !== 'branchLine') continue
            if (!node.parentBranchNodeId) continue
            const parentNode = nodesById.get(node.parentBranchNodeId)
            if (parentNode?.type !== 'branchOrigin') continue
            const markerIds = branchOriginMarkerIdsByParentId.get(node.parentBranchNodeId) ?? []
            markerIds.push(node.nodeId)
            branchOriginMarkerIdsByParentId.set(node.parentBranchNodeId, markerIds)
        }
        for (const markerIds of branchOriginMarkerIdsByParentId.values()) {
            markerIds.sort((a: string, b: string) => {
                const aNode = nodesById.get(a) as BranchForkCanvasNode | BranchLineCanvasNode | undefined
                const bNode = nodesById.get(b) as BranchForkCanvasNode | BranchLineCanvasNode | undefined
                if (aNode && bNode) return compareBranchMarkersByStackPosition(aNode, bNode)
                return a.localeCompare(b)
            })
        }
        for (const proxy of proxyPlan.plannedMarkerProxiesByMarkerId.values()) {
            plannedProxyNodeIds.add(proxy.proxyNodeId)

            const markerNode = nodesById.get(proxy.markerNodeId)
            const parentNode = nodesById.get(proxy.parentBranchNodeId)
            const proxyNode = nodesById.get(proxy.proxyNodeId)
            if (!markerNode || !parentNode || !proxyNode) continue

            const parentRect = this.config.getNodeWorldRect(parentNode, nodesById)
            const proxyPosition = this.config.getNodeWorldPosition(proxyNode, nodesById)
            const parentAnchorX = parentRect.x + parentRect.width
            const parentAnchorY = parentRect.y + parentRect.height / 2
            const proxyAnchorX = proxyPosition.x
            const proxyAnchorY = proxyPosition.y + proxyNode.dimensions.height / 2
            const branchOriginMarkerIds = parentNode.type === 'branchOrigin'
                ? branchOriginMarkerIdsByParentId.get(parentNode.nodeId)
                : undefined
            const branchOriginStackIndex = branchOriginMarkerIds?.indexOf(proxy.markerNodeId) ?? -1
            const branchOriginStackOffset = branchOriginStackIndex >= 0 && branchOriginMarkerIds
                ? getBranchMarkerStackOffset(branchOriginMarkerIds, nodesById, proxy.markerNodeId, this.config.branchOriginMarkerStackGap)
                : null
            plannedMarkerPositionsById.set(proxy.markerNodeId, {
                x: (parentAnchorX + proxyAnchorX) / 2 - markerNode.dimensions.width / 2,
                y: branchOriginStackOffset !== null
                    ? parentRect.y + parentRect.height + branchOriginStackOffset
                    : (parentAnchorY + proxyAnchorY) / 2 - markerNode.dimensions.height / 2,
            })
        }

        return nodes.flatMap((node: CanvasNode) => {
            if (plannedProxyNodeIds.has(node.nodeId)) return []
            const proxy = proxyPlan.pendingMediaProxiesByNodeId.get(node.nodeId)
            const markerPosition = plannedMarkerPositionsById.get(node.nodeId)
            let restoredNode = proxy ? {
                ...node,
                position: {
                    x: node.position.x - proxy.offset.x,
                    y: node.position.y - proxy.offset.y,
                },
                dimensions: proxy.dimensions,
            } : node
            if (markerPosition) {
                restoredNode = {
                    ...restoredNode,
                    position: markerPosition,
                }
            }
            return [restoredNode]
        })
    }
}
