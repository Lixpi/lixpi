'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'
import { applyNodeGeometry } from './node-geometry.ts'
import {
    buildNodesById,
    computeWorldPosition,
} from './node-index.ts'

describe('generic scene geometry', () => {
    const node = {
        nodeId: 'task',
        position: { x: 3, y: 4 },
        dimensions: { width: 90, height: 40 },
        parentId: 'group',
        data: { label: 'Independent product', status: 'ready' },
    }

    it('preserves custom payloads and the source while applying geometry', () => {
        const result = applyNodeGeometry(node, {
            position: { x: 12, y: 18 },
            dimensions: { width: 120, height: 45 },
        })
        expect(result.changed).toBe(true)
        expect(result.node.data).toBe(node.data)
        expect(result.node.parentId).toBe('group')
        expect(node.position).toEqual({ x: 3, y: 4 })
    })

    it('distinguishes an omitted parent update from an explicit unparenting', () => {
        const unchanged = applyNodeGeometry(node, node)
        expect(unchanged.node).toBe(node)
        expect(unchanged.changed).toBe(false)
        const unparented = applyNodeGeometry(node, { ...node, parentId: null })
        expect(Object.hasOwn(unparented.node, 'parentId')).toBe(false)
        expect(unparented.changed).toBe(true)
    })

    it('accumulates parent offsets without reading component data', () => {
        const parent = { nodeId: 'group', position: { x: 20, y: -5 }, parentId: undefined }
        const nodes = buildNodesById([parent, node])
        expect(computeWorldPosition(node, nodes)).toEqual({ x: 23, y: -1 })
        expect(computeWorldPosition(node, buildNodesById([node]))).toEqual(node.position)
    })

    it('bounds traversal of malformed cyclic parent chains', () => {
        const first = { nodeId: 'a', position: { x: 5, y: 6 }, parentId: 'b' }
        const second = { nodeId: 'b', position: { x: 7, y: 8 }, parentId: 'a' }
        expect(computeWorldPosition(first, buildNodesById([first, second]))).toEqual({ x: 12, y: 14 })
    })
})
