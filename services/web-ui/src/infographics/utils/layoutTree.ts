// Pure, reusable left-to-right tidy-tree layout.
//
// Geometry-agnostic block-allocation algorithm: a simplified, provably
// overlap-free variant of Reingold–Tilford "Tidy Drawings of Trees" (1981).
// It knows nothing about the canvas, PIXI, Svelte, branchId, or media kinds —
// it only places abstract boxes that form a single tree. The workspace layer
// adapts concrete canvas nodes to the TreeLayoutNode shape, runs this, and maps
// the relative result back onto world positions.
//
// Orientation is left-to-right: depth grows along +X, siblings stack along +Y.
//   - depthGap              → horizontal gap between a parent's right edge and its children
//   - branchFanoutDepthGap  → extra horizontal gap per additional child of a branching parent
//   - siblingGap            → vertical gap between adjacent sibling subtrees
//
// Two passes, O(n):
//   1. Post-order band height — each subtree reserves a disjoint vertical band
//      tall enough to hold all its descendants, so cousins can never overlap.
//   2. Pre-order placement — X by depth; children stacked inside the parent's
//      band; the parent's vertical center is the midpoint between its first and
//      last child centers, so single-child chains stay perfectly collinear.

export type TreeLayoutNode = {
    id: string
    parentId: string | null // null ⇒ this node is the tree root
    width: number
    height: number
}

export type LayoutTreeOptions = {
    depthGap: number              // LR: horizontal gap between depth columns
    siblingGap: number            // LR: vertical gap between sibling bands
    branchFanoutDepthGap?: number // LR: extra depth gap for each child after the first
}

export type LayoutTreeResult = {
    // Top-left position of every node, relative to the root's top-left at
    // (0, 0). Values can be negative (siblings sitting above the root).
    positions: Map<string, { x: number; y: number }>
    rootId: string
    // Axis-aligned bounding box of the whole tree in the same relative space.
    bounds: { width: number; height: number }
}

export function layoutTree(
    nodes: TreeLayoutNode[],
    options: LayoutTreeOptions
): LayoutTreeResult {
    if (nodes.length === 0) {
        return { positions: new Map(), rootId: '', bounds: { width: 0, height: 0 } }
    }

    const { depthGap, siblingGap } = options
    const branchFanoutDepthGap = Math.max(0, options.branchFanoutDepthGap ?? 0)
    const depthGapForChildCount = (childCount: number): number =>
        depthGap + branchFanoutDepthGap * Math.max(0, childCount - 1)

    // Index nodes and build child lists, preserving input order so sibling
    // stacking is deterministic.
    const byId = new Map<string, TreeLayoutNode>()
    for (const node of nodes) byId.set(node.id, node)

    const childrenByParent = new Map<string, TreeLayoutNode[]>()
    const roots: TreeLayoutNode[] = []
    for (const node of nodes) {
        const parent = node.parentId !== null ? byId.get(node.parentId) : undefined
        if (!parent) {
            roots.push(node)
            continue
        }
        const siblings = childrenByParent.get(parent.id) ?? []
        siblings.push(node)
        childrenByParent.set(parent.id, siblings)
    }

    // A well-formed tree has exactly one root. If the caller passed a forest or
    // an orphan whose parent is missing, lay out from the first discovered root
    // and skip anything not reachable from it.
    const root = roots[0] ?? nodes[0]

    // Pass 1 — vertical band height of each subtree (post-order, memoized).
    const bandHeight = new Map<string, number>()
    const computeBand = (node: TreeLayoutNode): number => {
        const cached = bandHeight.get(node.id)
        if (cached !== undefined) return cached
        // Reserve the slot before recursing so a malformed cycle can't loop.
        bandHeight.set(node.id, node.height)

        const children = childrenByParent.get(node.id) ?? []
        if (children.length === 0) return node.height

        let stack = 0
        for (const child of children) stack += computeBand(child)
        stack += siblingGap * (children.length - 1)

        const band = Math.max(node.height, stack)
        bandHeight.set(node.id, band)
        return band
    }
    computeBand(root)

    // Pass 2 — assign X by depth and center-Y by stacking children inside the
    // parent's band (pre-order).
    const xById = new Map<string, number>()
    const centerYById = new Map<string, number>()
    const placed = new Set<string>()
    const place = (node: TreeLayoutNode, bandTop: number, depthX: number): void => {
        if (placed.has(node.id)) return // cycle guard
        placed.add(node.id)
        xById.set(node.id, depthX)

        const children = childrenByParent.get(node.id) ?? []
        if (children.length === 0) {
            centerYById.set(node.id, bandTop + node.height / 2)
            return
        }

        const band = bandHeight.get(node.id) ?? node.height
        let stack = 0
        for (const child of children) stack += bandHeight.get(child.id) ?? child.height
        stack += siblingGap * (children.length - 1)

        // Center the children stack within the parent's band, then lay each
        // child subtree into its own slice of that stack.
        let cursor = bandTop + (band - stack) / 2
        const childX = depthX + node.width + depthGapForChildCount(children.length)
        for (const child of children) {
            place(child, cursor, childX)
            cursor += (bandHeight.get(child.id) ?? child.height) + siblingGap
        }

        // Parent center = midpoint between first and last child centers; a
        // single child makes the parent inherit that child's center exactly.
        const first = children[0]
        const last = children[children.length - 1]
        const firstCenter = centerYById.get(first.id) ?? bandTop
        const lastCenter = centerYById.get(last.id) ?? bandTop
        centerYById.set(node.id, (firstCenter + lastCenter) / 2)
    }
    place(root, 0, 0)

    // Translate so the root's top-left sits at (0, 0), then collect positions
    // and the overall bounding box.
    const rootTop = (centerYById.get(root.id) ?? 0) - root.height / 2
    const positions = new Map<string, { x: number; y: number }>()
    let minTop = Infinity
    let maxRight = 0
    let maxBottom = -Infinity
    for (const node of nodes) {
        const nodeX = xById.get(node.id)
        const nodeCenterY = centerYById.get(node.id)
        if (nodeX === undefined || nodeCenterY === undefined) continue // unreachable orphan

        const top = nodeCenterY - node.height / 2 - rootTop
        positions.set(node.id, { x: nodeX, y: top })
        minTop = Math.min(minTop, top)
        maxRight = Math.max(maxRight, nodeX + node.width)
        maxBottom = Math.max(maxBottom, top + node.height)
    }

    return {
        positions,
        rootId: root.id,
        bounds: {
            width: maxRight,
            height: Number.isFinite(minTop) ? maxBottom - minTop : 0,
        },
    }
}
