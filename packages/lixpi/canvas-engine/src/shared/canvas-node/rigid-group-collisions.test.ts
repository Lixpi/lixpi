'use strict'

import type { CanvasNode } from '@lixpi/constants'
import { describe, expect, it } from 'vitest'

import { resolveRigidCanvasNodeGroupCollisions } from './rigid-group-collisions.ts'

function makeImageNode(
    nodeId: string,
    x: number,
    y: number,
): CanvasNode {
    return {
        nodeId,
        type: 'image',
        fileId: `file-${nodeId}`,
        workspaceId: 'workspace-1',
        src: `/api/images/${nodeId}`,
        aspectRatio: 1,
        position: { x, y },
        dimensions: { width: 100, height: 100 },
    }
}

// =============================================================================
// RIGID GROUP COLLISION RESOLUTION
// =============================================================================

describe('resolveRigidCanvasNodeGroupCollisions', () => {
    it('returns unchanged results for zero or one group', () => {
        const node = makeImageNode('node-1', 0, 0)
        const nodes = [node]
        const singleResult = resolveRigidCanvasNodeGroupCollisions(nodes, [
            {
                id: 'group:1',
                nodeIds: ['node-1'],
                rect: { x: 0, y: 0, width: 100, height: 100 },
            },
        ])

        expect(singleResult.changed).toBe(false)
        expect(singleResult.movedGroupCount).toBe(0)
        expect(singleResult.movedNodeCount).toBe(0)
        expect(singleResult.collisionIterations).toBe(0)
        expect(singleResult.nodes).toBe(nodes)
    })

    it('returns unchanged results when no groups are supplied', () => {
        const nodes = [
            makeImageNode('node-1', 0, 0),
            makeImageNode('node-2', 60, 0),
        ]
        const result = resolveRigidCanvasNodeGroupCollisions(nodes, [])

        expect(result.changed).toBe(false)
        expect(result.movedGroupCount).toBe(0)
        expect(result.movedNodeCount).toBe(0)
        expect(result.collisionIterations).toBe(0)
        expect(result.nodes).toBe(nodes)
    })

    it('returns no movement for non-overlapping groups', () => {
        const nodeA = makeImageNode('a', 0, 0)
        const nodeB = makeImageNode('b', 500, 0)
        const nodes = [nodeA, nodeB]

        const result = resolveRigidCanvasNodeGroupCollisions(nodes, [
            {
                id: 'group:a',
                nodeIds: ['a'],
                rect: { x: 0, y: 0, width: 100, height: 100 },
            },
            {
                id: 'group:b',
                nodeIds: ['b'],
                rect: { x: 500, y: 0, width: 100, height: 100 },
            },
        ])

        expect(result.changed).toBe(false)
        expect(result.movedGroupCount).toBe(0)
        expect(result.movedNodeCount).toBe(0)
        expect(result.collisionIterations).toBe(1)
        expect(result.nodes).toBe(nodes)
    })

    it('honors collision iteration budget of zero and skips all movement', () => {
        const nodeA = makeImageNode('a', 0, 0)
        const nodeB = makeImageNode('b', 20, 0)
        const nodes = [nodeA, nodeB]

        const result = resolveRigidCanvasNodeGroupCollisions(nodes, [
            {
                id: 'group:a',
                nodeIds: ['a'],
                rect: { x: 0, y: 0, width: 100, height: 100 },
            },
            {
                id: 'group:b',
                nodeIds: ['b'],
                rect: { x: 20, y: 0, width: 100, height: 100 },
            },
        ], {
            margin: 0,
            iterations: 0,
        })

        expect(result.changed).toBe(false)
        expect(result.movedGroupCount).toBe(0)
        expect(result.movedNodeCount).toBe(0)
        expect(result.collisionIterations).toBe(0)
        expect(result.nodes).toBe(nodes)
    })

    it('moves all nodes within collided groups by the same delta', () => {
        const nodeA = makeImageNode('a', 0, 0)
        const nodeB = makeImageNode('b', 20, 0)
        const nodeC = makeImageNode('c', 40, 0)
        const nodeD = makeImageNode('d', 400, 0)
        const nodes = [nodeA, nodeB, nodeC, nodeD]

        const result = resolveRigidCanvasNodeGroupCollisions(nodes, [
            {
                id: 'group:left',
                nodeIds: ['a', 'b'],
                rect: { x: 0, y: 0, width: 100, height: 100 },
            },
            {
                id: 'group:right',
                nodeIds: ['c'],
                rect: { x: 40, y: 0, width: 100, height: 100 },
            },
        ], {
            iterations: 1,
        })

        expect(result.changed).toBe(true)
        expect(result.movedGroupCount).toBe(2)
        expect(result.movedNodeCount).toBe(3)
        expect(result.collisionIterations).toBe(1)
        expect(result.nodes).toEqual([
            { ...nodeA, position: { x: -50, y: 0 } },
            { ...nodeB, position: { x: -30, y: 0 } },
            { ...nodeC, position: { x: 90, y: 0 } },
            nodeD,
        ])
    })

    it('uses group-level collision options and can suppress movement from box margins', () => {
        const nodes = [
            makeImageNode('a', 0, 0),
            makeImageNode('b', 130, 0),
        ]

        const result = resolveRigidCanvasNodeGroupCollisions(nodes, [
            {
                id: 'group:a',
                nodeIds: ['a'],
                rect: { x: 0, y: 0, width: 100, height: 100 },
                margin: 0,
            },
            {
                id: 'group:b',
                nodeIds: ['b'],
                rect: { x: 130, y: 0, width: 100, height: 100 },
                margin: 0,
            },
        ], {
            margin: 20,
        })

        expect(result.changed).toBe(false)
        expect(result.movedGroupCount).toBe(0)
        expect(result.nodes).toBe(nodes)
    })

    it('respects shouldResolvePair filtering and leaves nodes untouched when rejected', () => {
        const nodes = [makeImageNode('a', 0, 0), makeImageNode('b', 80, 0)]
        const seen: Array<{ a: { id: string; x: number; y: number; width: number; height: number }; b: { id: string; x: number; y: number; width: number; height: number } }> = []

        const result = resolveRigidCanvasNodeGroupCollisions(nodes, [
            {
                id: 'group:a',
                nodeIds: ['a'],
                rect: { x: 0, y: 0, width: 100, height: 100 },
            },
            {
                id: 'group:b',
                nodeIds: ['b'],
                rect: { x: 80, y: 0, width: 100, height: 100 },
            },
        ], {
            margin: 0,
            shouldResolvePair: (a, b) => {
                seen.push({
                    a: { id: a.id, x: a.x, y: a.y, width: a.width, height: a.height },
                    b: { id: b.id, x: b.x, y: b.y, width: b.width, height: b.height },
                })
                return false
            },
        })

        expect(seen).toEqual([
            {
                a: { id: 'group:a', x: 0, y: 0, width: 100, height: 100 },
                b: { id: 'group:b', x: 80, y: 0, width: 100, height: 100 },
            },
        ])
        expect(result.changed).toBe(false)
        expect(result.nodes).toBe(nodes)
    })
})
