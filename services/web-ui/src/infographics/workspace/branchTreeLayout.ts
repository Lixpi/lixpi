// Branch-lineage tree layout — the workspace adapter between the canvas graph
// and the pure tidy-tree algorithm in utils/layoutTree.ts.
//
// A "branch tree" is a connected component of top-level generated-media nodes
// (image/video carrying generatedBy.branchId, no parentId) and temporary
// branch-origin / branch-fork markers linked by lineage. A generated member's
// in-tree parent is its generatedBy.parentMediaNodeId, then its
// generatedBy.branchOriginNodeId, then its API-assigned branchFork/branchLine
// marker when that marker is the only visible lineage parent; otherwise the
// member is a tree root.
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
    ImageCanvasNode,
    VideoCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'

import { layoutTree, type TreeLayoutNode } from '$src/infographics/utils/layoutTree.ts'
import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'
import { computeWorldPosition, buildNodesById } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
type BranchTreeMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
type BranchTreeMemberNode = GeneratedMediaNode | BranchTreeMarkerNode
type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type CollisionBox = { id: string; x: number; y: number; width: number; height: number }

export type BranchTree = {
    rootId: string
    memberIds: string[]                       // every top-level generated-media / origin member
    childrenByParentId: Map<string, string[]> // in-tree parent → ordered children
}

export type BranchTreeLayoutOptions = {
    depthGap: number                  // LR horizontal gap — imageBranchLineage.imageToImageGap
    branchOriginDepthGap?: number     // LR horizontal gap from a branchOrigin marker to its first generated child
    siblingGap: number                // LR vertical gap — imageBranchLineage.branchToBranchGap
    branchFanoutDepthGap?: number     // LR extra depth gap for each child after the first
    collisionMargin?: number          // resolver breathing room; defaults to the resolver's own 20
}

// Matches the resolver's default margin so callers that omit it get the exact
// completion-handler behavior that was in place before tree rebalancing.
const DEFAULT_COLLISION_MARGIN = 20

function isGeneratedMediaBranchMember(node: CanvasNode): node is GeneratedMediaNode {
    return (node.type === 'image' || node.type === 'video') && !node.parentId && Boolean(node.generatedBy?.branchId)
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
// the layout root for those generated children so the tree still moves as one
// API-declared lineage group.
function isMidpointMarker(node: CanvasNode | undefined): node is BranchForkCanvasNode | BranchLineCanvasNode {
    return Boolean(node) && (node!.type === 'branchFork' || node!.type === 'branchLine')
}

function getGeneratedMediaParentCandidates(node: GeneratedMediaNode): Array<string | undefined> {
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
        // pruning) but are never a tidy-layout child — they don't add a depth
        // column or fan their parent; positionLineageMarkers places them at the
        // connector midpoint instead.
        if (parentId !== null && !isMidpointMarker(node)) {
            const siblings = tree.childrenByParentId.get(parentId) ?? []
            siblings.push(node.nodeId)
            tree.childrenByParentId.set(parentId, siblings)
        }
    }

    // Deterministic sibling order: matrix variant order first, then oldest first
    // (createdAt asc), then nodeId tie-break.
    const variantIndexById = new Map<string, number | undefined>()
    const reasoningIndexById = new Map<string, number | undefined>()
    const createdAtById = new Map<string, number>()
    for (const node of members) {
        variantIndexById.set(node.nodeId, isGeneratedMediaBranchMember(node) ? node.generatedBy?.variantIndex : undefined)
        reasoningIndexById.set(node.nodeId, isBranchForkMember(node) ? node.reasoningIndex : undefined)
        createdAtById.set(node.nodeId, isGeneratedMediaBranchMember(node) ? node.generatedBy?.createdAt ?? 0 : 0)
    }
    const compareSiblings = (a: string, b: string): number => {
        const reasoningA = reasoningIndexById.get(a)
        const reasoningB = reasoningIndexById.get(b)
        if (reasoningA !== undefined || reasoningB !== undefined) {
            const reasoningDelta = (reasoningA ?? Number.MAX_SAFE_INTEGER) - (reasoningB ?? Number.MAX_SAFE_INTEGER)
            if (reasoningDelta !== 0) return reasoningDelta
        }
        const variantA = variantIndexById.get(a)
        const variantB = variantIndexById.get(b)
        if (variantA !== undefined || variantB !== undefined) {
            const variantDelta = (variantA ?? Number.MAX_SAFE_INTEGER) - (variantB ?? Number.MAX_SAFE_INTEGER)
            if (variantDelta !== 0) return variantDelta
        }
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

    for (const tree of trees) {
        if (tree.memberIds.length <= 1) continue // single node: root stays put

        const parentByChild = parentByChildOf(tree)
        const layoutMemberIds = new Set(tree.memberIds
            .filter((id: string) => {
                const node = nodesById.get(id)
                return !isMidpointMarker(node) || tree.childrenByParentId.has(id)
            }))
        const layoutNodes: TreeLayoutNode[] = [...layoutMemberIds]
            .map((id: string) => {
                const node = nodesById.get(id) as BranchTreeMemberNode
                const parentId = parentByChild.get(id)
                return {
                    id,
                    parentId: parentId && layoutMemberIds.has(parentId) ? parentId : null,
                    width: node.dimensions.width,
                    height: node.dimensions.height,
                }
            })

        const result = layoutTree(layoutNodes, {
            depthGap: options.depthGap,
            siblingGap: options.siblingGap,
            branchFanoutDepthGap: options.branchFanoutDepthGap,
        })

        // Anchor the relative layout (root at 0,0) onto the root's current world
        // position so the root never jumps on add/remove.
        const rootNode = nodesById.get(tree.rootId)
        if (!rootNode) continue
        const anchor = computeWorldPosition(rootNode, nodesById)
        const rootIsBranchOrigin = rootNode.type === 'branchOrigin'
        const originDepthAdjustment = rootIsBranchOrigin
            ? Math.max(0, options.depthGap - (options.branchOriginDepthGap ?? options.depthGap))
            : 0
        for (const [id, relative] of result.positions) {
            nextPositionById.set(id, {
                x: anchor.x + relative.x - (id === tree.rootId ? 0 : originDepthAdjustment),
                y: anchor.y + relative.y,
            })
        }
    }

    positionLineageMarkers(nodes, nodesById, nextPositionById)

    if (nextPositionById.size === 0) return nodes
    return nodes.map((node: CanvasNode) => {
        const position = nextPositionById.get(node.nodeId)
        return position ? { ...node, position } : node
    })
}

// Fork (split) and line (continuation) markers are one regular connector broken
// in half: the parent media / branch origin and each generated child are laid out
// one normal gap apart, and the marker sits at the midpoint of the connector
// between the parent's right edge and the child's left edge — on the parent's
// center line for a continuation, on the diagonal for a split. This keeps splits
// as compact as continuations instead of adding a wide second depth column.
function positionLineageMarkers(
    nodes: CanvasNode[],
    nodesById: Map<string, CanvasNode>,
    nextPositionById: Map<string, Point>,
): void {
    const childrenByMarkerId = new Map<string, GeneratedMediaNode[]>()
    for (const node of nodes) {
        if (node.type !== 'image' && node.type !== 'video') continue
        const markerId = node.generatedBy?.branchForkNodeId ?? node.generatedBy?.branchLineNodeId
        if (!markerId) continue
        const children = childrenByMarkerId.get(markerId) ?? []
        children.push(node as GeneratedMediaNode)
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
        if (!parentId || !children?.length) continue
        const parent = nodesById.get(parentId)
        if (!parent) continue

        // Midpoint of the connector group: parent right-edge anchor → average
        // left-edge anchor for every generated child sharing this marker.
        const parentPos = worldOf(parentId)
        const parentAnchorX = parentPos.x + parent.dimensions.width
        const parentAnchorY = parentPos.y + parent.dimensions.height / 2
        let childAnchorX = 0
        let childAnchorY = 0
        for (const child of children) {
            const childPos = worldOf(child.nodeId)
            childAnchorX += childPos.x
            childAnchorY += childPos.y + child.dimensions.height / 2
        }
        childAnchorX /= children.length
        childAnchorY /= children.length
        nextPositionById.set(node.nodeId, {
            x: (parentAnchorX + childAnchorX) / 2 - node.dimensions.width / 2,
            y: (parentAnchorY + childAnchorY) / 2 - node.dimensions.height / 2,
        })
    }
}

function computeTreeAabb(tree: BranchTree, nodesById: Map<string, CanvasNode>): Rect {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const id of tree.memberIds) {
        const node = nodesById.get(id)
        if (!node) continue
        const world = computeWorldPosition(node, nodesById)
        minX = Math.min(minX, world.x)
        minY = Math.min(minY, world.y)
        maxX = Math.max(maxX, world.x + node.dimensions.width)
        maxY = Math.max(maxY, world.y + node.dimensions.height)
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
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
        const aabb = computeTreeAabb(tree, nodesById)
        boxes.push({ id: tree.rootId, x: aabb.x, y: aabb.y, width: aabb.width, height: aabb.height })
        treeBoxOriginById.set(tree.rootId, { x: aabb.x, y: aabb.y })
    }

    const excludePairs = new Set<string>()
    for (const node of tidied) {
        if (memberToRoot.has(node.nodeId)) continue // already covered by its tree box
        const world = computeWorldPosition(node, nodesById)
        boxes.push({ id: node.nodeId, x: world.x, y: world.y, width: node.dimensions.width, height: node.dimensions.height })
        if (node.parentId) excludePairs.add(`${node.parentId}-${node.nodeId}`)
    }

    const collisionResult = resolveCollisions(boxes, {
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
        const position = node.parentId
            ? toParentRelativePosition(moved, node.parentId, nodesById)
            : moved
        return { ...node, position }
    })
}
