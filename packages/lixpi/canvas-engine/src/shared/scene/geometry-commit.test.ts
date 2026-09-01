import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    computeGeometryChanges,
    type GeometryCommitOptions,
} from './geometry-commit.ts'
import {
    buildNodesById,
    computeWorldPosition,
} from './node-index.ts'
import {
    type EngineNode,
    type NodeGeometryPolicy,
} from './types.ts'

function node(nodeId: string, x = 0, parentId?: string): EngineNode {
    return { nodeId, type: 'note', ports: [], data: null, position: { x, y: 0 }, dimensions: { width: 100, height: 50 }, parentId }
}
const policy: NodeGeometryPolicy = {
    movable: true,
    resize: { min: { width: 1, height: 1 }, preserveAspectRatio: false },
    measure: node => {
        const bounds = { ...node.position, ...node.dimensions }
        return { visualBounds: bounds, hitBounds: bounds, selectionBounds: bounds, connectorBounds: bounds, collisionBounds: { ...bounds, height: bounds.height + 20 } }
    },
}
function options(nodes: EngineNode[], overrides: Partial<GeometryCommitOptions> = {}): GeometryCommitOptions {
    const byId = buildNodesById(nodes)
    return { geometry: () => policy, worldBounds: node => ({ ...computeWorldPosition(node, byId), ...node.dimensions }), ...overrides }
}

describe('computeGeometryChanges', () => {
    it('keeps child offsets unchanged when their ancestor moves', () => {
        const nodes = [node('child', 10, 'parent'), node('parent', 100)]
        const result = computeGeometryChanges(nodes, new Map([['parent', { x: 150, y: 20, width: 100, height: 50 }]]), options(nodes))
        expect(result).toEqual([{ nodeId: 'parent', position: { x: 150, y: 20 }, dimensions: { width: 100, height: 50 } }])
    })

    it('uses collision footprints and preserves rigid groups without moving fixed obstacles', () => {
        const nodes = [node('a'), node('b', 150), { ...node('fixed'), position: { x: 20, y: 60 } }]
        const result = computeGeometryChanges(
            nodes,
            new Map([['a', { x: 0, y: 10, width: 100, height: 50 }]]),
            options(nodes, {
                geometry: node => node.nodeId === 'fixed' ? { ...policy, movable: false } : { ...policy, collisionGroup: 'pair' },
                collisions: { margin: 0, overlapThreshold: 0 },
            }),
        )
        expect(result.some(change => change.nodeId === 'fixed')).toBe(false)
        const a = result.find(change => change.nodeId === 'a')
        const b = result.find(change => change.nodeId === 'b')
        expect(a!.position.y).toBe(-10)
        expect(b!.position.y).toBe(-20)
        expect(a!.position.x).toBe(0)
        expect(b!.position.x).toBe(150)
    })

    it('rejects invalid proposed bounds and keeps input node geometry untouched', () => {
        const nodes = [node('a')]
        expect(() => computeGeometryChanges(nodes, new Map([['a', { x: NaN, y: 0, width: 100, height: 50 }]]), options(nodes))).toThrow()
        expect(nodes[0].position.x).toBe(0)
        expect(computeGeometryChanges(nodes, new Map(), options(nodes))).toEqual([])
    })
})
