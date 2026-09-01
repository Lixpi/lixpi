import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    Texture,
    type Mesh,
} from 'pixi.js'
import { PixiMeshResource } from './pixi-mesh-resource.ts'
import {
    type MeshData,
} from './resources.ts'

function triangle(x = 0): MeshData {
    return { positions: new Float32Array([x, 0, x + 10, 0, x, 10]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), version: x }
}

describe('Pixi mesh staging', () => {
    it('copies caller arrays and rotates independent buffers with one visible slot', () => {
        const data = triangle()
        const resource = new PixiMeshResource(data, Texture.EMPTY, dispose => dispose())
        const initial = resource.container.children.find(child => child.renderable) as Mesh
        data.positions[0] = 100
        expect(initial.geometry.getBuffer('aPosition').data[0]).toBe(0)
        resource.update(data)
        const active = resource.container.children.filter(child => child.renderable) as Mesh[]
        expect(active).toHaveLength(1)
        expect(active[0]).not.toBe(initial)
        expect(active[0].geometry.getBuffer('aPosition').data[0]).toBe(100)
        expect(initial.geometry.getBuffer('aPosition').data[0]).toBe(0)
        resource.destroy()
    })

    it('keeps buffers fixed-size when input geometry shrinks', () => {
        const resource = new PixiMeshResource(triangle(), Texture.EMPTY, dispose => dispose())
        const buffers = resource.container.children.map(child => (child as Mesh).geometry.getIndex())
        resource.update({ positions: new Float32Array([0, 0]), uvs: new Float32Array([0, 0]), indices: new Uint32Array(), version: 2 })
        expect(resource.container.children.map(child => (child as Mesh).geometry.getIndex())).toEqual(buffers)
        const active = resource.container.children.find(child => child.renderable) as Mesh
        expect(Array.from(active.geometry.getIndex().data)).toEqual([0, 0, 0])
        resource.destroy()
    })

    it('detaches growing geometry before deferring destruction of its previous buffers', () => {
        const retirements: Array<() => void> = []
        const resource = new PixiMeshResource(triangle(), Texture.EMPTY, dispose => {
            retirements.push(dispose)
        })
        const previous = [...resource.container.children]
        resource.update({ positions: new Float32Array(8), uvs: new Float32Array(8), indices: new Uint32Array([0, 1, 2, 1, 2, 3]), version: 2 })
        expect(retirements).toHaveLength(1)
        expect(previous.every(child => child.parent === null && !child.destroyed)).toBe(true)
        retirements[0]()
        expect(previous.every(child => child.destroyed)).toBe(true)
        resource.destroy()
    })
})
