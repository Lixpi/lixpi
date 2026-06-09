// Branch-lineage tree layout — the workspace adapter between the canvas graph
// and the pure tidy-tree algorithm in utils/layoutTree.ts.
//
// A "branch tree" is a connected component of top-level generated-media nodes
// (image/video carrying generatedBy.branchId, no parentId) linked by lineage.
// A member's in-tree parent is its generatedBy.parentImageNodeId when that
// points at another member, otherwise the source of its incoming lineage edge
// when that source is a member; if neither, the member is a tree root (its real
// parent is a chat thread, a reference group, or nothing).
//
// This module is pure: it reads node positions/sizes + lineage edges and returns
// new node arrays. It never touches PIXI, the DOM, or canvas closures — it reuses
// the geometry-agnostic pure helpers (layoutTree, resolveCollisions,
// computeWorldPosition) so it stays testable and reusable.

import type {
    CanvasNode,
    ImageCanvasNode,
    VideoCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'

import { layoutTree, type TreeLayoutNode } from '$src/infographics/utils/layoutTree.ts'
import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'
import { computeWorldPosition, buildNodesById } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type CollisionBox = { id: string; x: number; y: number; width: number; height: number }

export type BranchTree = {
    rootId: string
    memberIds: string[]                       // every top-level generated-media member
    childrenByParentId: Map<string, string[]> // in-tree parent → ordered children
}

export type BranchTreeLayoutOptions = {
    depthGap: number                  // LR horizontal gap — imageBranchLineage.imageToImageGap
    siblingGap: number                // LR vertical gap — imageBranchLineage.branchToBranchGap
    branchFanoutDepthGap?: number     // LR extra depth gap for each child after the first
    collisionMargin?: number          // resolver breathing room; defaults to the resolver's own 20
}

// Matches the resolver's default margin so callers that omit it get the exact
// completion-handler behavior that was in place before tree rebalancing.
const DEFAULT_COLLISION_MARGIN = 20

// A node is a branch-tree member when it is a top-level generated image/video.
// Mirrors WorkspaceCanvas.isGeneratedMediaNode (branchId-gated) plus the
// top-level-only rule from getGeneratedChildOutputs.
function isBranchTreeMember(node: CanvasNode): node is GeneratedMediaNode {
    return (node.type === 'image' || node.type === 'video')
        && !node.parentId
        && Boolean(node.generatedBy?.branchId)
}

// Build the generated-media forest from canvas nodes + lineage edges. Trees are
// derived from graph connectivity (parentImageNodeId / lineage edges), never by
// grouping on branchId, so a forked branchId is still one correct tree.
export function buildBranchTrees(nodes: CanvasNode[], edges: WorkspaceEdge[]): BranchTree[] {
    const members = nodes.filter(isBranchTreeMember)
    if (members.length === 0) return []

    const memberIds = new Set(members.map((node: GeneratedMediaNode) => node.nodeId))

    // First incoming lineage-edge source per node — the fallback parent used when
    // generatedBy.parentImageNodeId is absent (mirrors the anchor lookup).
    const edgeSourceByTarget = new Map<string, string>()
    for (const edge of edges) {
        if (!edgeSourceByTarget.has(edge.targetNodeId)) {
            edgeSourceByTarget.set(edge.targetNodeId, edge.sourceNodeId)
        }
    }

    const inTreeParentById = new Map<string, string | null>()
    for (const node of members) {
        const metadataParent = node.generatedBy?.parentImageNodeId
        const edgeParent = edgeSourceByTarget.get(node.nodeId)
        const parentId = metadataParent && memberIds.has(metadataParent)
            ? metadataParent
            : edgeParent && memberIds.has(edgeParent)
                ? edgeParent
                : null
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
        if (parentId !== null) {
            const siblings = tree.childrenByParentId.get(parentId) ?? []
            siblings.push(node.nodeId)
            tree.childrenByParentId.set(parentId, siblings)
        }
    }

    // Deterministic sibling order: matrix variant order first, then oldest first
    // (createdAt asc), then nodeId tie-break.
    const variantIndexById = new Map<string, number | undefined>()
    const createdAtById = new Map<string, number>()
    for (const node of members) {
        variantIndexById.set(node.nodeId, node.generatedBy?.variantIndex)
        createdAtById.set(node.nodeId, node.generatedBy?.createdAt ?? 0)
    }
    const compareSiblings = (a: string, b: string): number => {
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

        const memberSet = new Set(tree.memberIds)
        const parentByChild = parentByChildOf(tree)
        const layoutNodes: TreeLayoutNode[] = tree.memberIds.map((id: string) => {
            const node = nodesById.get(id) as GeneratedMediaNode
            const parentId = parentByChild.get(id)
            return {
                id,
                parentId: parentId && memberSet.has(parentId) ? parentId : null,
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
        for (const [id, relative] of result.positions) {
            nextPositionById.set(id, { x: anchor.x + relative.x, y: anchor.y + relative.y })
        }
    }

    if (nextPositionById.size === 0) return nodes
    return nodes.map((node: CanvasNode) => {
        const position = nextPositionById.get(node.nodeId)
        return position ? { ...node, position } : node
    })
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
