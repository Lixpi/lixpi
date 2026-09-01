import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { ResourceRegistry } from './resource-registry.ts'

describe('drawing resource ownership', () => {
    it('rejects foreign and copied handles', () => {
        const first = new ResourceRegistry(dispose => dispose())
        const second = new ResourceRegistry(dispose => dispose())
        const handle = first.add('texture', { pixels: 1 }, () => {})
        expect(() => second.get(handle, 'texture')).toThrow('Unknown')
        expect(() => first.get({ ...handle }, 'texture')).toThrow('Unknown')
        first.destroy()
        second.destroy()
    })

    it('retains a released texture until its mesh releases it', () => {
        const retire: Array<() => void> = []
        const registry = new ResourceRegistry(dispose => {
            retire.push(dispose)
        })
        const textureDispose = vi.fn()
        const meshDispose = vi.fn()
        const texture = registry.add('texture', {}, textureDispose)
        const mesh = registry.add('mesh', {}, meshDispose, { dependencies: [texture] })
        registry.release(texture)
        expect(() => registry.get(texture, 'texture')).toThrow('released')
        expect(retire).toHaveLength(0)
        registry.release(mesh)
        expect(retire).toHaveLength(2)
        expect(meshDispose).not.toHaveBeenCalled()
        for (const dispose of retire) dispose()
        expect(textureDispose).toHaveBeenCalledOnce()
        expect(meshDispose).toHaveBeenCalledOnce()
        registry.release(texture)
        registry.destroy()
    })

    it('releases an old paint dependency when a mesh changes paint', () => {
        const registry = new ResourceRegistry(dispose => dispose())
        const oldDispose = vi.fn()
        const oldPaint = registry.add('texture', {}, oldDispose)
        const newPaint = registry.add('texture', {}, () => {})
        const mesh = registry.add('mesh', {}, () => {}, { dependencies: [oldPaint] })
        registry.release(oldPaint)
        registry.replaceDependencies(mesh, [newPaint])
        expect(oldDispose).toHaveBeenCalledOnce()
        registry.destroy()
    })

    it('releases descendants before their owning group', () => {
        const order: string[] = []
        const registry = new ResourceRegistry(dispose => dispose())
        const group = registry.add('group', {}, () => {
            order.push('group')
        })
        registry.add('path', {}, () => {
            order.push('path')
        }, { parent: group })
        registry.release(group)
        expect(order).toEqual(['path', 'group'])
        registry.destroy()
    })

    it('rejects dependency cycles before replacing existing dependencies', () => {
        const registry = new ResourceRegistry(dispose => dispose())
        const first = registry.add('group', {}, () => {})
        const second = registry.add('group', {}, () => {}, { dependencies: [first] })
        expect(() => registry.replaceDependencies(first, [second])).toThrow('Cyclic')
        registry.destroy()
    })
})
