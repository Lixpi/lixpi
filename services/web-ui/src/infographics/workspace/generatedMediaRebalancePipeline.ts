import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    CanvasNode,
    ImageCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'
import { getGeneratedMediaPreFrameSize } from '@lixpi/canvas-engine'

import { getStartedLineageMarkerState } from '$src/infographics/workspace/branchLineageState.ts'
import { rebalanceBranchTreesAndResolve } from '$src/infographics/workspace/branchTreeLayout.ts'
import { computeLineageContinuationPositionToRightOfRect } from '$src/infographics/workspace/imagePositioning.ts'

export type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }
export type CanvasGeometry = { position: Point; dimensions: { width: number; height: number } }
export type GeneratedMediaRebalancePipelineConfig = {
    workspaceId: string
    mediaSize: number
    pendingMediaPreFrameScale: number
    depthGap: number
    branchOriginDepthGap: number
    rootMarkerDepthGap: number
    siblingGap: number
    branchFanoutExtraGap: number
    branchOriginMarkerStackGap: number
    collisionIterations: number
    collisionMargin: number
    getNodeWorldPosition: (node: CanvasNode, nodesById: Map<string, CanvasNode>) => Point
    getNodeWorldRect: (node: CanvasNode, nodesById: Map<string, CanvasNode>) => Rect
    getNodeCollisionRect: (node: CanvasNode, worldPosition: Point) => Rect
    getNodeConnectorAnchorRect: (node: CanvasNode, worldPosition: Point) => Rect
    getNodeCollisionMargin: (node: CanvasNode) => number
    getNodeCollisionOverlapThreshold: (node: CanvasNode) => number
    isPendingGeneratedMediaBeforeFrame: (node: CanvasNode) => boolean
}
export type GeneratedMediaRebalanceResult = {
    nodes: CanvasNode[]
    startedMarkerNodeIds: Set<string>
}

type PlannedMarkerMediaProxy = {
    markerNodeId: string
    proxyNodeId: string
    parentBranchNodeId: string
}
type RebalanceLayoutProxyPlan = {
    nodes: CanvasNode[]
    plannedMarkerProxiesByMarkerId: Map<string, PlannedMarkerMediaProxy>
}

const PLANNED_MEDIA_LAYOUT_PROXY_NODE_ID_SUFFIX = ':planned-media-layout-proxy'

// Canvas node arrays are the pipeline boundary. A local map gives every stage
// deterministic lookup without depending on WorkspaceCanvas closure helpers.
function getNodesById(nodes: CanvasNode[]): Map<string, CanvasNode> {
    return new Map(nodes.map((node: CanvasNode) => [node.nodeId, node]))
}

// Reasoning order is the canonical order for multi-model marker stacks. Falling
// back to position and id keeps reflow deterministic for older or partial state.
function getBranchMarkerReasoningIndex(marker: BranchMarkerNode): number | undefined {
    return marker.type === 'branchFork' || marker.type === 'branchLine'
        ? marker.reasoningIndex
        : marker.pendingState?.reasoningIndex
}

// Pending marker stacks must not jitter when text changes size. This comparator
// preserves the current visual top-to-bottom order before using semantic order.
function compareBranchMarkersByReasoningOrder(a: BranchMarkerNode, b: BranchMarkerNode): number {
    const indexDelta = (getBranchMarkerReasoningIndex(a) ?? Number.MAX_SAFE_INTEGER)
        - (getBranchMarkerReasoningIndex(b) ?? Number.MAX_SAFE_INTEGER)
    if (indexDelta !== 0) return indexDelta
    const positionDelta = a.position.y - b.position.y
    if (positionDelta !== 0) return positionDelta
    return a.nodeId.localeCompare(b.nodeId)
}

// Stack reflow starts from current geometry so live preview updates resize
// markers without reordering them underneath the user.
function compareBranchMarkersByStackPosition(a: BranchMarkerNode, b: BranchMarkerNode): number {
    const positionDelta = a.position.y - b.position.y
    if (positionDelta !== 0) return positionDelta
    return compareBranchMarkersByReasoningOrder(a, b)
}

// The reflow code centers a group around its previous occupied band unless a
// branch-origin parent gives it a stronger anchor below the origin marker.
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

// Pending branch markers stack by their immediate lineage parent. Root markers
// use generationRequestId so unrelated root prompts never reflow together.
function getBranchMarkerStackGroupKey(marker: BranchMarkerNode): string | null {
    if (marker.pendingState?.phase === 'preflight') return null
    if (marker.type !== 'branchFork' && marker.type !== 'branchLine') return null
    if (marker.parentBranchNodeId) return `parent:${marker.parentBranchNodeId}`
    if (marker.type === 'branchFork') return `root:${marker.generationRequestId}`
    return null
}

// Only pending, non-manual stacks are eligible for automatic reflow. Started
// markers are excluded because generated-media layout owns their final midpoint.
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

// Branch-origin stacks have a semantic anchor below the origin; other stacks
// keep their previous center so response-text growth does not drift the group.
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

// Reflows live branch-marker previews into a deterministic stack while leaving
// started and manually positioned markers untouched.
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

// Planned branch-origin child markers are restored to a compact stack below the
// origin. This offset mirrors the rendered marker body, not future media size.
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

// Proxy IDs should be stable but must not collide with real or already-proxied
// nodes. A deterministic suffix keeps test snapshots and persisted diffs legible.
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

// Planned proxy media needs enough provenance to participate in branch-tree
// parentage exactly like the future generated node would, without persisting it.
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

// Deterministic generated-media rebalance pipeline. WorkspaceCanvas supplies
// geometry adapters; this class owns the ordered data transforms so add/remove,
// pending-frame, and final-frame updates all pass through the same sequence.
export class GeneratedMediaRebalancePipeline {
    // All canvas-specific measurements are injected so the pipeline stays pure
    // and reusable across image/video dimensions, marker sizes, and node types.
    constructor(private readonly config: GeneratedMediaRebalancePipelineConfig) {}

    // Public entry point: normalize transient geometry, run branch-tree layout
    // and rigid collision resolution, then restore persisted geometry.
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
            getNodeConnectorAnchorRect: this.config.getNodeConnectorAnchorRect,
            getNodeCollisionMargin: this.config.getNodeCollisionMargin,
            getNodeCollisionOverlapThreshold: this.config.getNodeCollisionOverlapThreshold,
        })
        const restoredNodes = this.restorePersistedGeometry(resolvedNodes, proxyPlan)
        return {
            nodes: restoredNodes,
            startedMarkerNodeIds: getStartedLineageMarkerState(restoredNodes).markerIdsWithGeneratedChildren,
        }
    }

    // Pending media use the compact pre-frame circle for vertical spacing and
    // connector geometry while callers reserve the stable final media width for
    // horizontal layout. This stage only adds temporary future-media proxies for
    // planned sibling markers.
    private prepareLayoutProxyPlan(nodes: CanvasNode[]): RebalanceLayoutProxyPlan {
        const plannedMarkerProxiesByMarkerId = new Map<string, PlannedMarkerMediaProxy>()
        const proxyNodes = nodes
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
            plannedMarkerProxiesByMarkerId,
        }
    }

    // A planned marker with started siblings needs a placeholder media box so
    // the tidy tree reserves its future row before any real media node exists.
    private createPlannedBranchMarkerMediaLayoutProxy(
        markerNode: BranchForkCanvasNode | BranchLineCanvasNode,
        parentNode: CanvasNode,
        nodesById: Map<string, CanvasNode>,
        proxyNodeId: string,
    ): ImageCanvasNode {
        const proxySize = getGeneratedMediaPreFrameSize(
            { width: this.config.mediaSize, height: this.config.mediaSize },
            this.config.pendingMediaPreFrameScale,
        )
        const mediaDimensions = { width: proxySize, height: proxySize }
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
            assetId: proxyNodeId,
            position: {
                x: futureMediaPosition.x,
                y: futureMediaPosition.y,
            },
            dimensions: mediaDimensions,
            generatedBy: {
                conversationAssetId: markerNode.conversationAssetId ?? '',
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

    // The branch-tree resolver may move proxy geometry. This stage removes the
    // temporary planned-media proxy nodes and derives each planned marker's
    // midpoint position from where its proxy landed.
    private restorePersistedGeometry(
        nodes: CanvasNode[],
        proxyPlan: RebalanceLayoutProxyPlan,
    ): CanvasNode[] {
        if (proxyPlan.plannedMarkerProxiesByMarkerId.size === 0) return nodes

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
            const markerPosition = plannedMarkerPositionsById.get(node.nodeId)
            if (!markerPosition) return [node]
            return [{
                ...node,
                position: markerPosition,
            }]
        })
    }
}
