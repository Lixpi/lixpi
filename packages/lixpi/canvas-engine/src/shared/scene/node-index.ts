'use strict'

import type { CanvasPositionedNode } from './types.ts'

export type WorldPoint = { x: number; y: number }

// Walks a node's parent chain and returns its absolute world position.
// Parent-relative positions accumulate offsets; the guard bounds malformed input.
export function computeWorldPosition<Node extends CanvasPositionedNode>(
    node: Node,
    nodesById: ReadonlyMap<string, Node>,
    getWorldOverride?: (nodeId: string) => WorldPoint | undefined,
): WorldPoint {
    let x = 0
    let y = 0
    const visited = new Set<string>()
    let current: Node | undefined = node
    while (current) {
        if (visited.has(current.nodeId)) break
        visited.add(current.nodeId)
        const override = getWorldOverride?.(current.nodeId)
        if (override) return { x: x + override.x, y: y + override.y }
        x += current.position.x
        y += current.position.y
        const parentId = current.parentId
        if (!parentId) break
        current = nodesById.get(parentId)
    }
    return { x, y }
}

export function buildNodesById<Node extends CanvasPositionedNode>(nodes: readonly Node[]): Map<string, Node> {
    return new Map(nodes.map(node => [node.nodeId, node]))
}
