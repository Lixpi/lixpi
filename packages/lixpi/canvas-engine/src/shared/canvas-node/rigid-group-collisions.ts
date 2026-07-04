'use strict'

import type { CanvasNode } from '@lixpi/constants'

import {
    resolveCollisions,
    type CollisionBox,
    type CollisionOptions,
} from '../collision/index.ts'
import type { CanvasEnginePoint } from '../geometry/index.ts'

import type {
    RigidCanvasNodeCollisionResult,
    RigidCanvasNodeGroup,
} from './types.ts'

export function resolveRigidCanvasNodeGroupCollisions(
    nodes: CanvasNode[],
    groups: RigidCanvasNodeGroup[],
    options: CollisionOptions = {},
): RigidCanvasNodeCollisionResult {
    if (groups.length <= 1) {
        return {
            nodes,
            changed: false,
            movedGroupCount: 0,
            movedNodeCount: 0,
            collisionIterations: 0,
        }
    }

    const boxes: CollisionBox[] = groups.map(group => ({
        id: group.id,
        x: group.rect.x,
        y: group.rect.y,
        width: group.rect.width,
        height: group.rect.height,
        ...(group.margin == null ? {} : { margin: group.margin }),
        ...(group.overlapThreshold == null ? {} : { overlapThreshold: group.overlapThreshold }),
    }))
    const collisionResult = resolveCollisions(boxes, options)
    if (!collisionResult.hasChanges) {
        return {
            nodes,
            changed: false,
            movedGroupCount: 0,
            movedNodeCount: 0,
            collisionIterations: collisionResult.numIterations,
        }
    }

    const deltaByNodeId = new Map<string, CanvasEnginePoint>()
    let movedGroupCount = 0
    for (const group of groups) {
        const moved = collisionResult.nodes.get(group.id)
        if (!moved) continue

        const dx = moved.x - group.rect.x
        const dy = moved.y - group.rect.y
        if (dx === 0 && dy === 0) continue

        movedGroupCount++
        for (const nodeId of group.nodeIds) {
            deltaByNodeId.set(nodeId, { x: dx, y: dy })
        }
    }

    if (deltaByNodeId.size === 0) {
        return {
            nodes,
            changed: false,
            movedGroupCount: 0,
            movedNodeCount: 0,
            collisionIterations: collisionResult.numIterations,
        }
    }

    return {
        nodes: nodes.map((node) => {
            const delta = deltaByNodeId.get(node.nodeId)
            if (!delta) return node
            return {
                ...node,
                position: {
                    x: node.position.x + delta.x,
                    y: node.position.y + delta.y,
                },
            } as CanvasNode
        }),
        changed: true,
        movedGroupCount,
        movedNodeCount: deltaByNodeId.size,
        collisionIterations: collisionResult.numIterations,
    }
}
