'use strict'

// Branch-lineage tree layout — the shared adapter between the canvas graph and
// the pure tidy-tree algorithm. Runs identically in the API (authoritative
// generation-driven layout) and the WebUI (local drag/delete rebalance).
//
// A "branch tree" is a connected component of top-level generated-media nodes
// (image/video carrying generatedBy.branchId, no parentId) and temporary
// branch-origin / branch-fork / branch-line markers linked by lineage. A
// generated member's in-tree parent is its generatedBy.parentMediaNodeId, then
// its generatedBy.branchOriginNodeId, then its API-assigned branchFork/branchLine
// marker when that marker is the only visible lineage parent; otherwise the
// member is a tree root. A parentless branchFork is also a tree root.
//
// This module is pure: it reads node positions/sizes + API-assigned lineage
// fields and returns new node arrays. It never touches PIXI, the DOM, or canvas
// closures — it reuses the geometry-agnostic pure helpers (layoutTree,
// resolveCollisions, computeWorldPosition) so it stays testable and reusable.

import type {
    CanvasNode,
    BranchOriginCanvasNode,
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'
import { layoutTree, type TreeLayoutNode } from '../tree-layout/index.ts'
import { resolveCollisions } from '../collision/index.ts'

import { computeWorldPosition, buildNodesById } from './canvas-node-helpers.ts'
import {
    getGeneratedMediaMidpointMarkerId,
    getStartedLineageMarkerState,
    isBranchLineageMarkerNode,
    type BranchLineageMarkerNode,
    type GeneratedOutputNode,
} from './branch-lineage-state.ts'

type BranchTreeMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
type BranchTreeMemberNode = GeneratedOutputNode | BranchTreeMarkerNode
type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type CollisionEnvelope = Rect & { overlapThreshold?: number }
type CollisionBox = {
    id: string
    x: number
    y: number
    width: number
    height: number
    margin?: number
    overlapThreshold?: number
}
type MarkerCollisionEntry = {
    node: BranchLineageMarkerNode
    position: Point
    rect: Rect
    originalIndex: number
}
type LayoutBox = {
    width: number
    height: number
    offset: Point
}

export type BranchTree = {
    rootId: string
    memberIds: string[]                       // every top-level generated-media / origin member
    childrenByParentId: Map<string, string[]> // in-tree parent → ordered children
}

export type BranchTreeLayoutOptions = {
    depthGap: number                  // LR horizontal gap — mediaBranchLineage.mediaToMediaGap
    branchOriginDepthGap?: number     // LR horizontal gap from a branchOrigin marker to its first generated media node
    rootMarkerDepthGap?: number       // LR horizontal gap from a parentless branch root marker to its first generated media node
    siblingGap: number                // LR vertical gap — mediaBranchLineage.branchRowGap
    branchFanoutExtraGap?: number     // LR extra depth gap for forked generated media nodes
    branchOriginMarkerStackGap?: number // Vertical gap between a branchOrigin and child fork/line markers
    collisionMargin?: number          // resolver breathing room; defaults to the resolver's own 20
    collisionIterations?: number      // resolver iteration limit; defaults to the resolver's own 50
    collisionOverlapThreshold?: number // fallback resolver overlap threshold; defaults to the resolver's own 0.5
    getNodeCollisionRect?: (
        node: CanvasNode,
        worldPosition: { x: number; y: number },
    ) => { x: number; y: number; width: number; height: number }
    getNodeConnectorAnchorRect?: (
        node: CanvasNode,
        worldPosition: { x: number; y: number },
    ) => { x: number; y: number; width: number; height: number }
    getNodeCollisionMargin?: (node: CanvasNode) => number
    getNodeCollisionOverlapThreshold?: (node: CanvasNode) => number
}

// Matches the resolver's default margin so callers that omit it get the exact
// completion-handler behavior that was in place before tree rebalancing.
const DEFAULT_COLLISION_MARGIN = 20

function isGeneratedMediaBranchMember(node: CanvasNode): node is GeneratedOutputNode {
    return (node.type === 'image' || node.type === 'video' || node.type === 'capabilityArtifact')
        && !node.parentId
        && Boolean(node.generatedBy?.branchId)
}

function isBranchOriginMember(node: CanvasNode): node is BranchOriginCanvasNode {
    return node.type === 'branchOrigin' && !node.parentId && Boolean(node.branchId)
}

function isBranchForkMember(node: CanvasNode): node is BranchForkCanvasNode {
    return node.type === 'branchFork' && !node.parentId && Boolean(node.branchId)
}

function isBranchLineMember(node: CanvasNode): node is BranchLineCanvasNode {
    return node.type === 'branchLine' && !node.parentId && Boolean(node.branchId)
}

function isBranchTreeMember(node: CanvasNode): node is BranchTreeMemberNode {
    return isGeneratedMediaBranchMember(node) || isBranchOriginMember(node) || isBranchForkMember(node) || isBranchLineMember(node)
}

// A branchFork (split) and a branchLine (continuation) are normally
// mid-connector markers: the child keeps the original parent media / branch
// origin as its in-tree parent so it stays one normal gap away, and the marker is
// positioned at the midpoint of that single connector (see positionLineageMarkers).
// If the API marker is the only visible branch-tree parent, the marker becomes
// the layout root for those generated media nodes so the tree still moves as one
// API-declared lineage group.
function isMidpointMarker(node: CanvasNode | undefined): node is BranchForkCanvasNode | BranchLineCanvasNode {
    return Boolean(node) && (node!.type === 'branchFork' || node!.type === 'branchLine')
}

function getGeneratedMediaParentCandidates(node: GeneratedOutputNode): Array<string | undefined> {
    return [
        node.generatedBy?.parentMediaNodeId,
        node.generatedBy?.branchOriginNodeId,
        node.generatedBy?.branchForkNodeId,
        node.generatedBy?.branchLineNodeId,
    ]
}

function getBranchMarkerParentCandidates(node: BranchTreeMarkerNode): Array<string | undefined> {
    if (node.type !== 'branchFork' && node.type !== 'branchLine') return []
    return [node.parentBranchNodeId]
}

function firstExistingMemberId(candidates: Array<string | undefined>, memberIds: Set<string>): string | null {
    for (const candidate of candidates) {
        if (candidate && memberIds.has(candidate)) return candidate
    }
    return null
}

// Build the generated-media forest from API-assigned lineage fields, never by
// grouping on branchId or inferring parents from connector edges, so a forked
// branchId is still one correct tree.
export function buildBranchTrees(nodes: CanvasNode[], _edges: WorkspaceEdge[]): BranchTree[] {
    const members = nodes.filter(isBranchTreeMember)
    if (members.length === 0) return []

    const memberIds = new Set(members.map((node: BranchTreeMemberNode) => node.nodeId))

    const inTreeParentById = new Map<string, string | null>()
    for (const node of members) {
        const parentCandidates = isGeneratedMediaBranchMember(node)
            ? getGeneratedMediaParentCandidates(node)
            : getBranchMarkerParentCandidates(node)
        const parentId = firstExistingMemberId(parentCandidates, memberIds)
        inTreeParentById.set(node.nodeId, parentId)
    }

    // Walk up parent links to find a member's root (cycle-guarded).
    const rootOf = (startId: string): string => {
        let currentId = startId
        const seen = new Set<string>()
        while (true) {
            if (seen.has(currentId)) return currentId
            seen.add(currentId)
            const parentId = inTreeParentById.get(currentId) ?? null
            if (parentId === null) return currentId
            currentId = parentId
        }
    }

    const treesByRoot = new Map<string, BranchTree>()
    const ensureTree = (rootId: string): BranchTree => {
        const existing = treesByRoot.get(rootId)
        if (existing) return existing
        const tree: BranchTree = { rootId, memberIds: [], childrenByParentId: new Map() }
        treesByRoot.set(rootId, tree)
        return tree
    }

    for (const node of members) {
        const tree = ensureTree(rootOf(node.nodeId))
        tree.memberIds.push(node.nodeId)
        const parentId = inTreeParentById.get(node.nodeId) ?? null
        // Fork/line markers belong to the tree (so they move rigidly and survive
        // pruning) but are never a tidy-layout child when they have a visible
        // parent. They do not add a depth column; positionLineageMarkers places
        // them at the connector midpoint instead.
        if (parentId !== null && !isMidpointMarker(node)) {
            const siblings = tree.childrenByParentId.get(parentId) ?? []
            siblings.push(node.nodeId)
            tree.childrenByParentId.set(parentId, siblings)
        }
    }

    // Deterministic sibling order: reasoning order first, then canonical matrix
    // media order (mediaIndex), then variant order, then oldest first (createdAt
    // asc), then nodeId tie-break. mediaIndex precedes variantIndex because the
    // matrix assigns it in authoring order while variantIndex can reflect
    // arrival order for parallel runs.
    const variantIndexById = new Map<string, number | undefined>()
    const mediaIndexById = new Map<string, number | undefined>()
    const reasoningIndexById = new Map<string, number | undefined>()
    const createdAtById = new Map<string, number>()
    for (const node of members) {
        variantIndexById.set(node.nodeId, isGeneratedMediaBranchMember(node) ? node.generatedBy?.variantIndex : undefined)
        mediaIndexById.set(node.nodeId, isGeneratedMediaBranchMember(node) ? node.generatedBy?.mediaIndex : undefined)
        reasoningIndexById.set(node.nodeId, isBranchForkMember(node) || isBranchLineMember(node)
            ? node.reasoningIndex
            : isGeneratedMediaBranchMember(node) ? node.generatedBy?.reasoningIndex : undefined)
        createdAtById.set(node.nodeId, isGeneratedMediaBranchMember(node) ? node.generatedBy?.createdAt ?? 0 : 0)
    }
    const compareOptionalIndex = (a: number | undefined, b: number | undefined): number => {
        if (a === undefined && b === undefined) return 0
        return (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER)
    }
    const compareSiblings = (a: string, b: string): number => {
        const reasoningDelta = compareOptionalIndex(reasoningIndexById.get(a), reasoningIndexById.get(b))
        if (reasoningDelta !== 0) return reasoningDelta
        const mediaDelta = compareOptionalIndex(mediaIndexById.get(a), mediaIndexById.get(b))
        if (mediaDelta !== 0) return mediaDelta
        const variantDelta = compareOptionalIndex(variantIndexById.get(a), variantIndexById.get(b))
        if (variantDelta !== 0) return variantDelta
        const delta = (createdAtById.get(a) ?? 0) - (createdAtById.get(b) ?? 0)
        if (delta !== 0) return delta
        return a < b ? -1 : a > b ? 1 : 0
    }
    for (const tree of treesByRoot.values()) {
        for (const siblings of tree.childrenByParentId.values()) siblings.sort(compareSiblings)
    }

    return [...treesByRoot.values()]
}

// Invert childrenByParentId into a child → parent lookup.
function parentByChildOf(tree: BranchTree): Map<string, string> {
    const parentByChild = new Map<string, string>()
    for (const [parentId, children] of tree.childrenByParentId) {
        for (const childId of children) parentByChild.set(childId, parentId)
    }
    return parentByChild
}

function getNodeCollisionRect(
    node: CanvasNode,
    worldPosition: Point,
    options: BranchTreeLayoutOptions,
): Rect {
    return options.getNodeCollisionRect?.(node, worldPosition) ?? {
        x: worldPosition.x,
        y: worldPosition.y,
        width: node.dimensions.width,
        height: node.dimensions.height,
    }
}

function getNodeConnectorAnchorRect(
    node: CanvasNode,
    worldPosition: Point,
    options: BranchTreeLayoutOptions,
): Rect {
    return options.getNodeConnectorAnchorRect?.(node, worldPosition) ?? {
        x: worldPosition.x,
        y: worldPosition.y,
        width: node.dimensions.width,
        height: node.dimensions.height,
    }
}

function getNodeCollisionMargin(node: CanvasNode, options: BranchTreeLayoutOptions): number {
    const margin = options.getNodeCollisionMargin?.(node) ?? 0
    return Number.isFinite(margin) ? Math.max(0, margin) : 0
}

function getNodeCollisionOverlapThreshold(node: CanvasNode, options: BranchTreeLayoutOptions): number | undefined {
    const threshold = options.getNodeCollisionOverlapThreshold?.(node)
    return threshold !== undefined && Number.isFinite(threshold) ? Math.max(0, threshold) : undefined
}

function expandRect(rect: Rect, margin: number): Rect {
    return {
        x: rect.x - margin,
        y: rect.y - margin,
        width: rect.width + margin * 2,
        height: rect.height + margin * 2,
    }
}

function getNodeLayoutBox(
    node: CanvasNode,
    options: BranchTreeLayoutOptions,
): LayoutBox {
    const rect = getNodeCollisionRect(node, { x: 0, y: 0 }, options)
    const visualCenter = {
        x: node.dimensions.width / 2,
        y: node.dimensions.height / 2,
    }
    const halfWidth = Math.max(
        1,
        visualCenter.x - rect.x,
        rect.x + rect.width - visualCenter.x,
    )
    const halfHeight = Math.max(
        1,
        visualCenter.y - rect.y,
        rect.y + rect.height - visualCenter.y,
    )
    return {
        width: halfWidth * 2,
        height: halfHeight * 2,
        offset: {
            x: halfWidth - visualCenter.x,
            y: halfHeight - visualCenter.y,
        },
    }
}

function getLineageMarkerStackGap(options: BranchTreeLayoutOptions): number {
    const gap = options.branchOriginMarkerStackGap ?? 0
    return Number.isFinite(gap) ? Math.max(0, gap) : 0
}

function getPlannedNodePosition(
    node: CanvasNode,
    nodesById: Map<string, CanvasNode>,
    nextPositionById: Map<string, Point>,
): Point {
    return nextPositionById.get(node.nodeId) ?? computeWorldPosition(node, nodesById)
}

function buildMarkerCollisionEntry(
    node: BranchLineageMarkerNode,
    nodesById: Map<string, CanvasNode>,
    nextPositionById: Map<string, Point>,
    originalIndex: number,
    options: BranchTreeLayoutOptions,
): MarkerCollisionEntry {
    const position = getPlannedNodePosition(node, nodesById, nextPositionById)
    return {
        node,
        position,
        rect: getNodeCollisionRect(node, position, options),
        originalIndex,
    }
}

function compareMarkerCollisionEntries(a: MarkerCollisionEntry, b: MarkerCollisionEntry): number {
    const yDelta = a.rect.y - b.rect.y
    if (yDelta !== 0) return yDelta
    return a.originalIndex - b.originalIndex
}

function markerEntriesNeedSeparation(entries: MarkerCollisionEntry[], gap: number): boolean {
    let previousBottom = -Infinity
    for (const entry of entries) {
        if (entry.rect.y < previousBottom + gap) return true
        previousBottom = Math.max(previousBottom, entry.rect.y + entry.rect.height)
    }
    return false
}

function markerEntriesCollide(a: MarkerCollisionEntry, b: MarkerCollisionEntry, gap: number): boolean {
    const horizontalOverlap = a.rect.x < b.rect.x + b.rect.width
        && b.rect.x < a.rect.x + a.rect.width
    if (!horizontalOverlap) return false

    return a.rect.y < b.rect.y + b.rect.height + gap
        && b.rect.y < a.rect.y + a.rect.height + gap
}

function findMarkerCollisionComponents(entries: MarkerCollisionEntry[], gap: number): MarkerCollisionEntry[][] {
    const parentIndices = entries.map((_, index: number) => index)
    const find = (index: number): number => {
        let current = index
        while (parentIndices[current] !== current) current = parentIndices[current]
        return current
    }
    const unite = (a: number, b: number): void => {
        const rootA = find(a)
        const rootB = find(b)
        if (rootA !== rootB) parentIndices[rootB] = rootA
    }

    for (let a = 0; a < entries.length; a += 1) {
        for (let b = a + 1; b < entries.length; b += 1) {
            if (markerEntriesCollide(entries[a], entries[b], gap)) unite(a, b)
        }
    }

    const componentsByRoot = new Map<number, MarkerCollisionEntry[]>()
    for (let index = 0; index < entries.length; index += 1) {
        const root = find(index)
        const component = componentsByRoot.get(root) ?? []
        component.push(entries[index])
        componentsByRoot.set(root, component)
    }

    return [...componentsByRoot.values()]
}

function separateLineageMarkerEntries(
    entries: MarkerCollisionEntry[],
    gap: number,
    nodesById: Map<string, CanvasNode>,
    nextPositionById: Map<string, Point>,
    treeMemberIdsByRootId: Map<string, string[]>,
): void {
    const top = Math.min(...entries.map((entry: MarkerCollisionEntry) => entry.rect.y))
    const bottom = Math.max(...entries.map((entry: MarkerCollisionEntry) => entry.rect.y + entry.rect.height))
    const stackHeight = entries.reduce((sum: number, entry: MarkerCollisionEntry) => sum + entry.rect.height, 0)
        + Math.max(0, entries.length - 1) * gap
    let nextRectY = (top + bottom - stackHeight) / 2

    const markerNodeIds = new Set(entries.map((entry: MarkerCollisionEntry) => entry.node.nodeId))
    const nextPositionsByMarkerId = new Map<string, Point>()
    for (const entry of entries) {
        const positionToRectOffsetY = entry.position.y - entry.rect.y
        nextPositionsByMarkerId.set(entry.node.nodeId, {
            x: entry.position.x,
            y: nextRectY + positionToRectOffsetY,
        })
        nextRectY += entry.rect.height + gap
    }

    for (const entry of entries) {
        const nextPosition = nextPositionsByMarkerId.get(entry.node.nodeId)
        if (!nextPosition) continue
        const memberIds = treeMemberIdsByRootId.get(entry.node.nodeId)
        const dx = nextPosition.x - entry.position.x
        const dy = nextPosition.y - entry.position.y

        if (memberIds && memberIds.length > 1) {
            for (const memberId of memberIds) {
                if (markerNodeIds.has(memberId)) continue
                const member = nodesById.get(memberId)
                if (!member) continue
                const memberPosition = getPlannedNodePosition(member, nodesById, nextPositionById)
                nextPositionById.set(memberId, {
                    x: memberPosition.x + dx,
                    y: memberPosition.y + dy,
                })
            }
        }
    }

    for (const [markerId, nextPosition] of nextPositionsByMarkerId) {
        nextPositionById.set(markerId, nextPosition)
    }
}

function resolveLineageMarkerOverlaps(
    nodes: CanvasNode[],
    nodesById: Map<string, CanvasNode>,
    nextPositionById: Map<string, Point>,
    treeMemberIdsByRootId: Map<string, string[]>,
    options: BranchTreeLayoutOptions,
): void {
    const markerEntries: MarkerCollisionEntry[] = []
    const { markerIdsWithGeneratedChildren } = getStartedLineageMarkerState(nodes)
    for (const [index, node] of nodes.entries()) {
        if (!isBranchLineageMarkerNode(node)) continue
        if (!node.pendingState) continue
        if (markerIdsWithGeneratedChildren.has(node.nodeId)) continue
        markerEntries.push(buildMarkerCollisionEntry(node, nodesById, nextPositionById, index, options))
    }
    if (markerEntries.length <= 1) return

    const gap = getLineageMarkerStackGap(options)
    markerEntries.sort(compareMarkerCollisionEntries)
    for (const component of findMarkerCollisionComponents(markerEntries, gap)) {
        if (component.length <= 1) continue
        component.sort(compareMarkerCollisionEntries)
        if (!markerEntriesNeedSeparation(component, gap)) continue
        separateLineageMarkerEntries(component, gap, nodesById, nextPositionById, treeMemberIdsByRootId)
    }
}

// Deterministic tidy layout for every tree; each root keeps its current anchor
// and its descendants fan out to the right. Single-node trees are left as-is.
export function applyBranchTreeLayout(
    nodes: CanvasNode[],
    edges: WorkspaceEdge[],
    options: BranchTreeLayoutOptions
): CanvasNode[] {
    const trees = buildBranchTrees(nodes, edges)
    if (trees.length === 0) return nodes

    const nodesById = buildNodesById(nodes)
    const nextPositionById = new Map<string, Point>()
    const treeMemberIdsByRootId = new Map<string, string[]>()
    const layoutBoxesById = new Map<string, LayoutBox>()

    for (const tree of trees) {
        treeMemberIdsByRootId.set(tree.rootId, tree.memberIds)
        if (tree.memberIds.length <= 1) continue // single node: root stays put

        const parentByChild = parentByChildOf(tree)
        const layoutMemberIds = new Set(tree.memberIds
            .filter((id: string) => {
                const node = nodesById.get(id)
                return !isMidpointMarker(node) || tree.childrenByParentId.has(id)
            }))
        // layoutTree preserves input order for siblings, so members must be fed
        // in the sorted childrenByParentId order (DFS from the root), never in
        // canvas-state insertion order — parallel runs complete out of order.
        const orderedLayoutMemberIds: string[] = []
        const visited = new Set<string>()
        const visitInSiblingOrder = (id: string): void => {
            if (visited.has(id)) return
            visited.add(id)
            if (layoutMemberIds.has(id)) orderedLayoutMemberIds.push(id)
            for (const childId of tree.childrenByParentId.get(id) ?? []) visitInSiblingOrder(childId)
        }
        visitInSiblingOrder(tree.rootId)
        for (const id of tree.memberIds) visitInSiblingOrder(id)
        const layoutNodes: TreeLayoutNode[] = orderedLayoutMemberIds
            .map((id: string) => {
                const node = nodesById.get(id) as BranchTreeMemberNode
                const parentId = parentByChild.get(id)
                const layoutBox = getNodeLayoutBox(node, options)
                layoutBoxesById.set(id, layoutBox)
                return {
                    id,
                    parentId: parentId && layoutMemberIds.has(parentId) ? parentId : null,
                    width: layoutBox.width,
                    height: layoutBox.height,
                }
            })

        const result = layoutTree(layoutNodes, {
            depthGap: options.depthGap,
            siblingGap: options.siblingGap,
            branchFanoutDepthGap: options.branchFanoutExtraGap,
        })

        // Anchor the relative layout (root at 0,0) onto the root's current world
        // position so the root never jumps on add/remove.
        const rootNode = nodesById.get(tree.rootId)
        if (!rootNode) continue
        const anchor = computeWorldPosition(rootNode, nodesById)
        const rootDepthGap = rootNode.type === 'branchOrigin'
            ? options.branchOriginDepthGap
            : rootNode.type === 'branchFork' && !rootNode.parentBranchNodeId
                ? options.rootMarkerDepthGap
                : undefined
        const rootDepthAdjustment = rootDepthGap !== undefined ? options.depthGap - rootDepthGap : 0
        for (const [id, relative] of result.positions) {
            const layoutBox = layoutBoxesById.get(id) ?? { width: 0, height: 0, offset: { x: 0, y: 0 } }
            const rootLayoutBox = layoutBoxesById.get(tree.rootId) ?? { width: 0, height: 0, offset: { x: 0, y: 0 } }
            nextPositionById.set(id, {
                x: anchor.x - rootLayoutBox.offset.x + relative.x + layoutBox.offset.x - (id === tree.rootId ? 0 : rootDepthAdjustment),
                y: anchor.y - rootLayoutBox.offset.y + relative.y + layoutBox.offset.y,
            })
        }
    }

    positionLineageMarkers(nodes, nodesById, nextPositionById, options)
    resolveLineageMarkerOverlaps(nodes, nodesById, nextPositionById, treeMemberIdsByRootId, options)

    if (nextPositionById.size === 0) return nodes
    return nodes.map((node: CanvasNode) => {
        const position = nextPositionById.get(node.nodeId)
        return position ? { ...node, position } : node
    })
}

// Fork (split) and line (continuation) markers are one regular connector broken
// in half: the parent media / branch origin and each generated media node is
// laid out one normal gap apart, and the marker sits at the midpoint of the
// connector between the parent's right edge and the child's left edge. This
// keeps splits as compact as continuations instead of adding a wide second depth
// column.
function positionLineageMarkers(
    nodes: CanvasNode[],
    nodesById: Map<string, CanvasNode>,
    nextPositionById: Map<string, Point>,
    options: BranchTreeLayoutOptions,
): void {
    const childrenByMarkerId = new Map<string, GeneratedOutputNode[]>()
    for (const node of nodes) {
        if (node.type !== 'image' && node.type !== 'video' && node.type !== 'capabilityArtifact') continue
        const markerId = getGeneratedMediaMidpointMarkerId(node)
        if (!markerId) continue
        const children = childrenByMarkerId.get(markerId) ?? []
        children.push(node)
        childrenByMarkerId.set(markerId, children)
    }

    const worldOf = (id: string): Point => {
        const planned = nextPositionById.get(id)
        if (planned) return planned
        const node = nodesById.get(id)
        return node ? computeWorldPosition(node, nodesById) : { x: 0, y: 0 }
    }

    for (const node of nodes) {
        if (!isMidpointMarker(node)) continue
        const parentId = node.parentBranchNodeId
        const children = childrenByMarkerId.get(node.nodeId)
        if (!children?.length) continue
        if (!parentId) {
            let childAnchorY = 0
            for (const child of children) {
                const childPos = worldOf(child.nodeId)
                const childRect = getNodeConnectorAnchorRect(child, childPos, options)
                childAnchorY += childRect.y + childRect.height / 2
            }
            childAnchorY /= children.length
            const markerPos = worldOf(node.nodeId)
            nextPositionById.set(node.nodeId, {
                x: markerPos.x,
                y: childAnchorY - node.dimensions.height / 2,
            })
            continue
        }
        const parent = nodesById.get(parentId)
        if (!parent) continue

        // Midpoint of the connector group: parent right-edge anchor → average
        // left-edge anchor for every generated media node sharing this marker.
        const parentPos = worldOf(parentId)
        const parentRect = getNodeConnectorAnchorRect(parent, parentPos, options)
        const parentAnchorX = parentRect.x + parentRect.width
        const parentAnchorY = parentRect.y + parentRect.height / 2
        let childAnchorX = 0
        let childAnchorY = 0
        for (const child of children) {
            const childPos = worldOf(child.nodeId)
            const childRect = getNodeConnectorAnchorRect(child, childPos, options)
            childAnchorX += childRect.x
            childAnchorY += childRect.y + childRect.height / 2
        }
        childAnchorX /= children.length
        childAnchorY /= children.length
        nextPositionById.set(node.nodeId, {
            x: (parentAnchorX + childAnchorX) / 2 - node.dimensions.width / 2,
            y: (parentAnchorY + childAnchorY) / 2 - node.dimensions.height / 2,
        })
    }
}

function computeTreeAabb(
    tree: BranchTree,
    nodesById: Map<string, CanvasNode>,
    options: BranchTreeLayoutOptions,
): CollisionEnvelope {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let overlapThreshold = Infinity
    for (const id of tree.memberIds) {
        const node = nodesById.get(id)
        if (!node) continue
        const world = computeWorldPosition(node, nodesById)
        const rect = expandRect(getNodeCollisionRect(node, world, options), getNodeCollisionMargin(node, options))
        minX = Math.min(minX, rect.x)
        minY = Math.min(minY, rect.y)
        maxX = Math.max(maxX, rect.x + rect.width)
        maxY = Math.max(maxY, rect.y + rect.height)
        overlapThreshold = Math.min(overlapThreshold, getNodeCollisionOverlapThreshold(node, options) ?? Infinity)
    }
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        ...(Number.isFinite(overlapThreshold) ? { overlapThreshold } : {}),
    }
}

function toParentRelativePosition(
    worldPosition: Point,
    parentId: string,
    nodesById: Map<string, CanvasNode>
): Point {
    const parentNode = nodesById.get(parentId)
    if (!parentNode) return worldPosition
    const parentWorld = computeWorldPosition(parentNode, nodesById)
    return { x: worldPosition.x - parentWorld.x, y: worldPosition.y - parentWorld.y }
}

// Tidy every tree, then separate trees + loose nodes through the UNCHANGED
// resolver by feeding it one rigid bounding box per tree (id = root id) plus one
// box per non-member node. Moved trees translate as a single block (every member
// shifts by the same delta) so a tree never loses its balance when something
// unrelated pushes it. With no trees present this collapses to the exact
// all-node de-overlap the completion handlers ran before.
export function rebalanceBranchTreesAndResolve(
    nodes: CanvasNode[],
    edges: WorkspaceEdge[],
    options: BranchTreeLayoutOptions
): CanvasNode[] {
    const tidied = applyBranchTreeLayout(nodes, edges, options)
    const trees = buildBranchTrees(tidied, edges)

    const nodesById = buildNodesById(tidied)
    const memberToRoot = new Map<string, string>()
    for (const tree of trees) {
        for (const id of tree.memberIds) memberToRoot.set(id, tree.rootId)
    }

    const boxes: CollisionBox[] = []
    const treeBoxOriginById = new Map<string, Point>()
    for (const tree of trees) {
        const aabb = computeTreeAabb(tree, nodesById, options)
        boxes.push({
            id: tree.rootId,
            x: aabb.x,
            y: aabb.y,
            width: aabb.width,
            height: aabb.height,
            margin: 0,
            ...(aabb.overlapThreshold !== undefined ? { overlapThreshold: aabb.overlapThreshold } : {}),
        })
        treeBoxOriginById.set(tree.rootId, { x: aabb.x, y: aabb.y })
    }

    const excludePairs = new Set<string>()
    const looseNodeCollisionOffsetById = new Map<string, Point>()
    for (const node of tidied) {
        if (memberToRoot.has(node.nodeId)) continue // already covered by its tree box
        const world = computeWorldPosition(node, nodesById)
        const rect = getNodeCollisionRect(node, world, options)
        boxes.push({
            id: node.nodeId,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            margin: getNodeCollisionMargin(node, options),
            ...(getNodeCollisionOverlapThreshold(node, options) !== undefined
                ? { overlapThreshold: getNodeCollisionOverlapThreshold(node, options) }
                : {}),
        })
        looseNodeCollisionOffsetById.set(node.nodeId, { x: world.x - rect.x, y: world.y - rect.y })
        if (node.parentId) excludePairs.add(`${node.parentId}-${node.nodeId}`)
    }

    const collisionResult = resolveCollisions(boxes, {
        iterations: options.collisionIterations,
        overlapThreshold: options.collisionOverlapThreshold,
        margin: options.collisionMargin ?? DEFAULT_COLLISION_MARGIN,
        excludePairs: excludePairs.size > 0 ? excludePairs : undefined,
    })
    if (!collisionResult.hasChanges) return tidied

    return tidied.map((node: CanvasNode) => {
        const rootId = memberToRoot.get(node.nodeId)
        if (rootId !== undefined) {
            // Tree member: rigidly translate by its tree box's delta.
            const moved = collisionResult.nodes.get(rootId)
            const origin = treeBoxOriginById.get(rootId)
            if (!moved || !origin) return node
            const dx = moved.x - origin.x
            const dy = moved.y - origin.y
            if (dx === 0 && dy === 0) return node
            return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }
        }

        // Loose node: move individually, mapping back to parent-relative space.
        const moved = collisionResult.nodes.get(node.nodeId)
        if (!moved) return node
        const offset = looseNodeCollisionOffsetById.get(node.nodeId) ?? { x: 0, y: 0 }
        const nodeWorldPosition = { x: moved.x + offset.x, y: moved.y + offset.y }
        const position = node.parentId
            ? toParentRelativePosition(nodeWorldPosition, node.parentId, nodesById)
            : nodeWorldPosition
        return { ...node, position }
    })
}
