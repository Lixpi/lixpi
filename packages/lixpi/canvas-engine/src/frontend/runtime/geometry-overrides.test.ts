import {
    describe,
    expect,
    it,
} from 'vitest'
import { GeometryOverrides } from './geometry-overrides.ts'

describe('GeometryOverrides', () => {
    it('combines parent-relative geometry with scoped world positions without applying a parent twice', () => {
        const overrides = new GeometryOverrides()
        const parent = { nodeId: 'parent', position: { x: 10, y: 20 }, dimensions: { width: 200, height: 100 } }
        const child = { nodeId: 'child', parentId: 'parent', position: { x: 5, y: 6 }, dimensions: { width: 30, height: 40 } }
        const nodes = new Map([['parent', parent], ['child', child]])
        const projection = overrides.createScope()
        projection.set('parent', { position: { x: 100, y: 200 } })
        expect(overrides.worldBounds(child, nodes)).toEqual({ x: 105, y: 206, width: 30, height: 40 })
        const drag = overrides.createScope(1)
        drag.set('child', { position: { x: 300, y: 400 }, dimensions: { width: 50, height: 60 } })
        expect(overrides.worldBounds(child, nodes)).toEqual({ x: 300, y: 400, width: 50, height: 60 })
        drag.destroy()
        expect(overrides.worldPosition(child, nodes)).toEqual({ x: 105, y: 206 })
        overrides.destroy()
    })

    it('restores product geometry after a gesture ends without clearing another scope', () => {
        const overrides = new GeometryOverrides()
        const product = overrides.createScope()
        const drag = overrides.createScope(1)
        product.set('a', { position: { x: 10, y: 20 }, dimensions: { width: 40, height: 50 } })
        drag.set('a', { position: { x: 100, y: 200 } })
        expect(overrides.get('a')).toEqual({ position: { x: 100, y: 200 }, dimensions: { width: 40, height: 50 } })
        drag.destroy()
        expect(overrides.get('a')?.position).toEqual({ x: 10, y: 20 })
        overrides.destroy()
    })

    it('expires stale writers on scene changes and copies caller geometry', () => {
        const overrides = new GeometryOverrides()
        const old = overrides.createScope()
        const input = { position: { x: 1, y: 2 } }
        old.set('a', input)
        input.position.x = 99
        expect(overrides.get('a')?.position?.x).toBe(1)
        overrides.clear()
        const current = overrides.createScope()
        current.set('a', { position: { x: 7, y: 8 } })
        old.set('a', input)
        old.destroy()
        expect(overrides.get('a')?.position?.x).toBe(7)
        expect(() => current.set('a', { dimensions: { width: NaN, height: 1 } })).toThrow()
        expect(overrides.get('a')?.position?.x).toBe(7)
        overrides.destroy()
    })
})
