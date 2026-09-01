'use strict'

import {
    Container,
    type Renderer,
} from 'pixi.js'
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { PixiDrawingResources } from './pixi-drawing-resources.ts'
import type { MeshData } from './resources.ts'

const triangle: MeshData = { positions: new Float32Array([0, 0, 10, 0, 0, 10]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), version: 1 }

function fixture() {
    const stage = new Container()
    const pending: Array<() => void> = []
    const resources = new PixiDrawingResources(stage, dispose => {
        pending.push(dispose)
    }, vi.fn())
    const layer = resources.addLayer()
    return { stage, resources, layer, pending }
}

describe('Pixi drawing backend', () => {
    it('releases groups immediately from the scene but delays physical disposal', () => {
        const { resources, layer, stage, pending } = fixture()
        const group = resources.createGroup({ layer, space: 'screen' })
        const container = stage.children[1].children[0]
        const texture = resources.createTexture({ kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array([255, 0, 0, 255]) })
        resources.createMesh(group, triangle, texture)
        resources.release(group)
        expect(container.parent).toBeNull()
        expect(container.destroyed).toBe(false)
        for (const dispose of pending.splice(0)) dispose()
        expect(container.destroyed).toBe(true)
        resources.release(group)
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('protects engine layers and other canvas instances', () => {
        const first = fixture()
        const second = fixture()
        const group = first.resources.createGroup({ layer: first.layer, space: 'world' })
        expect(() => first.resources.release(first.layer)).toThrow('borrowed')
        expect(() => second.resources.release(group)).toThrow('Unknown')
        first.resources.destroy()
        second.resources.destroy()
        for (const dispose of [...first.pending, ...second.pending]) dispose()
    })

    it('retains an owned image source until its last mesh is physically disposed', () => {
        const { resources, layer, pending } = fixture()
        const group = resources.createGroup({ layer, space: 'screen' })
        const close = vi.fn()
        const texture = resources.createOwnedTexture({ kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array([255, 0, 0, 255]), mipmaps: true }, close)
        resources.createMesh(group, triangle, texture)
        resources.release(texture)
        expect(close).not.toHaveBeenCalled()
        resources.release(group)
        expect(close).not.toHaveBeenCalled()
        for (const dispose of pending.splice(0)) dispose()
        expect(close).toHaveBeenCalledOnce()
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('clears mesh paint without keeping a released image source alive', () => {
        const { resources, layer, pending } = fixture()
        const group = resources.createGroup({ layer, space: 'screen' })
        const close = vi.fn()
        const texture = resources.createOwnedTexture({ kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array([255, 0, 0, 255]) }, close)
        const mesh = resources.createMesh(group, triangle, null)
        resources.setPaint(mesh, texture)
        resources.release(texture)
        expect(close).not.toHaveBeenCalled()
        resources.setPaint(mesh, null)
        for (const dispose of pending.splice(0)) dispose()
        expect(close).toHaveBeenCalledOnce()
        expect(() => resources.updateMesh(mesh, { ...triangle, version: 2 })).not.toThrow()
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('excludes capture output and restores visibility even when rendering fails', () => {
        const { resources, layer, stage, pending } = fixture()
        const output = resources.createGroup({ layer, space: 'screen' })
        const container = stage.children[1].children[0]
        resources.capture({ include: [layer], exclude: [output], space: 'screen', bounds: { x: 0, y: 0, width: 100, height: 80 } })
        const render = vi.fn(() => {
            expect(container.renderable).toBe(false)
            throw new Error('capture failed')
        })
        expect(() => resources.renderCaptures({ render } as unknown as Renderer)).toThrow('capture failed')
        expect(container.renderable).toBe(true)
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('captures after resizing without replacing the capture texture', () => {
        const { resources, layer, pending } = fixture()
        const capture = resources.capture({ include: [layer], exclude: [], space: 'screen', bounds: { x: 0, y: 0, width: 100, height: 80 } })
        const render = vi.fn()
        const renderer = { render } as unknown as Renderer
        resources.renderCaptures(renderer)
        const target = render.mock.calls[0][0].target
        resources.updateCapture(capture.handle, { include: [layer], exclude: [], space: 'screen', bounds: { x: 0, y: 0, width: 200, height: 120 } })
        resources.renderCaptures(renderer)
        expect(render.mock.calls[1][0].target).toBe(target)
        expect(target.width).toBe(200)
        expect(target.height).toBe(120)
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('rejects recursive capture feedback before submitting a draw', () => {
        const { resources, layer, pending } = fixture()
        const output = resources.createGroup({ layer, space: 'screen' })
        const capture = resources.capture({ include: [layer], exclude: [], space: 'screen', bounds: { x: 0, y: 0, width: 100, height: 80 } })
        resources.createMesh(output, triangle, capture.texture)
        const render = vi.fn()
        expect(() => resources.renderCaptures({ render } as unknown as Renderer)).toThrow('Cyclic')
        expect(render).not.toHaveBeenCalled()
        resources.updateCapture(capture.handle, { include: [layer], exclude: [output], space: 'screen', bounds: { x: 0, y: 0, width: 100, height: 80 } })
        resources.renderCaptures({ render } as unknown as Renderer)
        expect(render).toHaveBeenCalledOnce()
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('disposes a group with its own mask without retaining a dependency cycle', () => {
        const { resources, layer, stage, pending } = fixture()
        const group = resources.createGroup({ layer, space: 'screen' })
        const container = stage.children[1].children[0]
        const mask = resources.createPath(group, [{ path: 'M0 0 L10 0 L10 10 L0 10 Z', fill: { color: '#ffffff' } }])
        resources.setMask(group, mask)
        resources.release(group)
        for (const dispose of pending.splice(0)) dispose()
        expect(container.destroyed).toBe(true)
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('refreshes captures only when included content overlaps, including the old position after a move', () => {
        const { resources, layer, pending } = fixture()
        const group = resources.createGroup({ layer, space: 'screen' })
        const path = resources.createPath(group, [{ path: 'M0 0 L10 0 L10 10 L0 10 Z', fill: { color: '#ffffff' } }])
        resources.updateGroup(group, { position: { x: 400, y: 400 } })
        resources.capture({ include: [layer], exclude: [], space: 'screen', bounds: { x: 0, y: 0, width: 100, height: 100 } })
        const render = vi.fn()
        const renderer = { render } as unknown as Renderer
        resources.renderCaptures(renderer)
        resources.updatePath(path, [{ path: 'M0 0 L20 0 L20 20 L0 20 Z', fill: { color: '#ff0000' } }])
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledOnce()
        resources.updateGroup(group, { position: { x: 30, y: 30 } })
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledTimes(2)
        resources.updateGroup(group, { position: { x: 400, y: 400 } })
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledTimes(3)
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('does not refresh a capture for changes to its excluded output', () => {
        const { resources, layer, pending } = fixture()
        const output = resources.createGroup({ layer, space: 'screen' })
        const path = resources.createPath(output, [{ path: 'M0 0 L10 0 L0 10 Z', fill: { color: '#ffffff' } }])
        resources.capture({ include: [layer], exclude: [output], space: 'screen', bounds: { x: 0, y: 0, width: 100, height: 100 } })
        const render = vi.fn()
        const renderer = { render } as unknown as Renderer
        resources.renderCaptures(renderer)
        resources.updatePath(path, [{ path: 'M0 0 L20 0 L0 20 Z', fill: { color: '#ffffff' } }])
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledOnce()
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('keeps the full capture texture while invalidating only declared sample regions', () => {
        const { resources, layer, pending } = fixture()
        const group = resources.createGroup({ layer, space: 'screen' })
        resources.createPath(group, [{ path: 'M0 0 L10 0 L0 10 Z', fill: { color: '#ffffff' } }])
        const bounds = { x: 0, y: 0, width: 400, height: 300 }
        const sampleBounds = [{ x: 100, y: 100, width: 50, height: 30 }]
        const spec = { include: [layer], exclude: [], space: 'screen' as const, bounds, sampleBounds }
        const capture = resources.capture(spec)
        const render = vi.fn()
        const renderer = { render } as unknown as Renderer
        resources.renderCaptures(renderer)
        const texture = render.mock.calls[0][0].target
        resources.updateGroup(group, { position: { x: 30, y: 30 } })
        resources.renderCaptures(renderer)
        resources.invalidateCaptures({ x: 10, y: 10, width: 5, height: 5 })
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledOnce()
        resources.updateGroup(group, { position: { x: 110, y: 110 } })
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledTimes(2)
        resources.updateCapture(capture.handle, { ...spec, enabled: false })
        resources.invalidateCaptures()
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledTimes(2)
        resources.updateCapture(capture.handle, { ...spec, enabled: true })
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledTimes(3)
        expect(render.mock.calls.at(-1)[0].target).toBe(texture)
        expect(texture.width).toBe(400)
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('projects world-space sample bounds before matching screen invalidation', () => {
        const { resources, layer, pending } = fixture()
        resources.setViewport({ x: 100, y: 200, zoom: 2 })
        resources.capture({
            include: [layer],
            exclude: [],
            space: 'world',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            sampleBounds: [{ x: 10, y: 20, width: 10, height: 10 }],
        })
        const render = vi.fn()
        const renderer = { render } as unknown as Renderer
        resources.renderCaptures(renderer)
        resources.invalidateCaptures({ x: 10, y: 20, width: 1, height: 1 })
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledOnce()
        resources.invalidateCaptures({ x: 125, y: 245, width: 1, height: 1 })
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledTimes(2)
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('refreshes dependent captures when an input capture changes', () => {
        const { resources, layer, pending } = fixture()
        const input = resources.createGroup({ layer, space: 'screen' })
        const output = resources.createGroup({ layer, space: 'screen' })
        const path = resources.createPath(input, [{ path: 'M0 0 L10 0 L0 10 Z', fill: { color: '#ffffff' } }])
        const first = resources.capture({ include: [input], exclude: [], space: 'screen', bounds: { x: 0, y: 0, width: 20, height: 20 } })
        resources.createMesh(output, triangle, first.texture)
        resources.capture({ include: [output], exclude: [], space: 'screen', bounds: { x: 0, y: 0, width: 20, height: 20 } })
        const render = vi.fn()
        const renderer = { render } as unknown as Renderer
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledTimes(2)
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledTimes(2)
        resources.updatePath(path, [{ path: 'M0 0 L10 0 L0 10 Z', fill: { color: '#ff0000' } }])
        resources.renderCaptures(renderer)
        expect(render).toHaveBeenCalledTimes(4)
        resources.destroy()
        for (const dispose of pending) dispose()
    })

    it('removes masks and capture references when their ancestor is released', () => {
        const { resources, layer, pending } = fixture()
        const parent = resources.createGroup({ layer, space: 'world' })
        const child = resources.createGroup({ layer: parent, space: 'world' })
        const mask = resources.createPath(child, [{ path: 'M0 0 L10 0 L0 10 Z', fill: { color: '#ffffff' } }])
        resources.setMask(child, mask)
        const capture = resources.capture({ include: [child], exclude: [], space: 'world', bounds: { x: 0, y: 0, width: 20, height: 20 } })
        expect(() => resources.release(capture.texture)).toThrow('borrowed')
        resources.release(parent)
        expect(() => resources.release(mask)).not.toThrow()
        const render = vi.fn()
        resources.renderCaptures({ render } as unknown as Renderer)
        expect(render).toHaveBeenCalledOnce()
        resources.destroy()
        for (const dispose of pending) dispose()
    })
})
