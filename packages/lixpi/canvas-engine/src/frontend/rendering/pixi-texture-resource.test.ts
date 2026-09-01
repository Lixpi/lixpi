'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'
import { PixiTextureResource } from './pixi-texture-resource.ts'

describe('Pixi texture resources', () => {
    it('stages pixel arrays so caller mutation cannot change queued uploads', () => {
        const pixels = new Uint8Array([10, 20, 30, 255])
        const resource = new PixiTextureResource({ kind: 'pixels', size: { width: 1, height: 1 }, rgba: pixels })
        pixels.fill(0)
        expect(Array.from(resource.texture.source.resource as Uint8Array)).toEqual([10, 20, 30, 255])
        expect(resource.texture.source.format).toBe('rgba8unorm')
        resource.destroy()
    })

    it('keeps texture and source identity when the pixel dimensions change', () => {
        const resource = new PixiTextureResource({ kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array(4) })
        const texture = resource.texture
        const source = texture.source
        resource.update({ kind: 'pixels', size: { width: 2, height: 3 }, rgba: new Uint8Array(24).fill(128) })
        expect(resource.texture).toBe(texture)
        expect(resource.texture.source).toBe(source)
        expect(texture.width).toBe(2)
        expect(texture.height).toBe(3)
        expect((source.resource as Uint8Array).length).toBe(24)
        resource.destroy()
        resource.destroy()
        expect(() => resource.update({ kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array(4) })).toThrow('disposed')
    })

    it('premultiplies transparent pixel colors consistently on creation and update', () => {
        const rgba = new Uint8Array([200, 100, 50, 128, 255, 255, 255, 0])
        const resource = new PixiTextureResource({ kind: 'pixels', size: { width: 2, height: 1 }, rgba })
        expect(Array.from(resource.texture.source.resource as Uint8Array)).toEqual([100, 50, 25, 128, 0, 0, 0, 0])
        expect(resource.texture.source.alphaMode).toBe('premultiplied-alpha')
        expect(rgba[0]).toBe(200)
        resource.update({ kind: 'pixels', size: { width: 2, height: 1 }, rgba })
        expect(Array.from(resource.texture.source.resource as Uint8Array)).toEqual([100, 50, 25, 128, 0, 0, 0, 0])
        resource.destroy()
    })
})
