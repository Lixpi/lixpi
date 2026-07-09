'use strict'

import type { CanvasNode } from '@lixpi/constants'

export type WorldPoint = { x: number; y: number }

// Walks a node's parent chain and returns its absolute world position.
// Context-region children store `position` relative to their parent, so world
// coordinates must accumulate parent offsets (cycle-guarded).
export function computeWorldPosition(
    node: CanvasNode,
    nodesById: Map<string, CanvasNode>
): WorldPoint {
    let x = 0
    let y = 0
    const visited = new Set<string>()
    let current: CanvasNode | undefined = node
    while (current) {
        if (visited.has(current.nodeId)) break
        visited.add(current.nodeId)
        x += current.position.x
        y += current.position.y
        const parentId = current.parentId
        if (!parentId) break
        current = nodesById.get(parentId)
    }
    return { x, y }
}

export function buildNodesById(nodes: ReadonlyArray<CanvasNode>): Map<string, CanvasNode> {
    return new Map(nodes.map((node: CanvasNode) => [node.nodeId, node]))
}
