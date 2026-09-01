import { assertCanvasBounds } from './validation.ts'
import { buildNodesById } from './node-index.ts'
import { topoSortByParent } from './parent-order.ts'
import { unionRectangles } from '../geometry/rectangles.ts'
import {
    resolveCollisions,
    type CollisionOptions,
} from '../collision/index.ts'
import type { CanvasEngineRect } from '../geometry/types.ts'
import type {
    EngineNode,
    NodeGeometryChange,
    NodeGeometryPolicy,
} from './types.ts'

export type GeometryCommitOptions = {
    geometry: (node: EngineNode) => NodeGeometryPolicy | undefined
    worldBounds: (node: EngineNode) => CanvasEngineRect
    collisions?: CollisionOptions
}

// Proposed positions are world coordinates. Intents remain parent-relative and
// contain only changed geometry, including any displaced collision groups.
export function computeGeometryChanges(nodes: readonly EngineNode[], proposed: ReadonlyMap<string, CanvasEngineRect>, options: GeometryCommitOptions): NodeGeometryChange[] {
    const byId = buildNodesById(nodes)
    const world = new Map<string, CanvasEngineRect>()
    for (const node of topoSortByParent(nodes)) {
        const bounds = options.worldBounds(node)
        const parent = node.parentId ? byId.get(node.parentId) : undefined
        const originalParent = parent ? options.worldBounds(parent) : undefined
        const nextParent = parent ? world.get(parent.nodeId) : undefined
        const next = proposed.get(node.nodeId) ?? { ...bounds, x: bounds.x + (nextParent && originalParent ? nextParent.x - originalParent.x : 0), y: bounds.y + (nextParent && originalParent ? nextParent.y - originalParent.y : 0) }
        assertCanvasBounds(next, node.nodeId)
        world.set(node.nodeId, { ...next })
    }
    if (options.collisions) {
        const keys = new Map<string, string>()
        const groups = new Map<string, { nodes: string[]; bounds: CanvasEngineRect[]; fixed: boolean }>()
        for (const node of topoSortByParent(nodes)) {
            const policy = options.geometry(node)
            const key = node.parentId ? keys.get(node.parentId)! : policy?.collisionGroup ? `group:${policy.collisionGroup}` : `node:${node.nodeId}`
            keys.set(node.nodeId, key)
            const bounds = world.get(node.nodeId)!
            const measurement = policy?.measure({ ...node, parentId: undefined, position: { x: bounds.x, y: bounds.y }, dimensions: { width: bounds.width, height: bounds.height } })?.collisionBounds ?? bounds
            assertCanvasBounds(measurement, node.nodeId)
            const group = groups.get(key) ?? { nodes: [], bounds: [], fixed: false }
            group.nodes.push(node.nodeId)
            group.bounds.push(measurement)
            group.fixed ||= !policy?.movable
            groups.set(key, group)
        }
        const boxes = Array.from(groups, ([id, group]) => ({ id, ...unionRectangles(group.bounds)!, fixed: group.fixed }))
        const resolved = resolveCollisions(boxes, options.collisions)
        for (const box of boxes) {
            const moved = resolved.nodes.get(box.id)
            if (!moved) continue
            for (const id of groups.get(box.id)!.nodes) {
                const bounds = world.get(id)!
                world.set(id, { ...bounds, x: bounds.x + moved.x - box.x, y: bounds.y + moved.y - box.y })
            }
        }
    }
    const changes: NodeGeometryChange[] = []
    for (const node of nodes) {
        const bounds = world.get(node.nodeId)!
        const parent = node.parentId ? world.get(node.parentId) : undefined
        const position = { x: bounds.x - (parent?.x ?? 0), y: bounds.y - (parent?.y ?? 0) }
        if (position.x === node.position.x && position.y === node.position.y && bounds.width === node.dimensions.width && bounds.height === node.dimensions.height) continue
        changes.push({ nodeId: node.nodeId, position, dimensions: { width: bounds.width, height: bounds.height } })
    }
    return changes
}
