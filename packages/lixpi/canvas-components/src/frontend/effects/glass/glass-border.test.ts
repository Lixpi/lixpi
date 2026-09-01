'use strict'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasDrawingSurface,
    CaptureSpec,
    DrawingResources,
    ResourceHandle,
    ResourceKind,
} from '@lixpi/canvas-engine/frontend/rendering'
import { GlassBorder } from './glass-border.ts'
import {
    bakeGlassDisplacementMap,
    createGlassBorderMeshGeometry,
    writeClosedRoundedBorderGeometry,
    type GlassBorderStyle,
} from './glass-border-geometry.ts'

const style: GlassBorderStyle = {
    enabled: true,
    widthPx: 10,
    displacementScalePx: 12,
    displacementMapMaxDimensionPx: 256,
    edgeRefractionStrength: 0.5,
    surfaceWaveStrength: 0.2,
    causticBandStrength: 0.1,
    displacementFrequencyX: 4.6,
    displacementFrequencyY: 3.8,
    bodyColor: '#ffffff',
    bodyAlpha: 0.1,
    highlightColor: '#ffffff',
    highlightAlpha: 0.3,
    shadowColor: '#415061',
    shadowAlpha: 0.2,
    edgeFeatherFraction: 0.5,
}
const datum = { id: 'toolbar', x: 20, y: 20, width: 120, height: 40, radius: 20, visible: true }

function fixture() {
    const controller = new AbortController()
    const owner = Symbol()
    let nextId = 0
    const handle = <Kind extends ResourceKind>(kind: Kind): ResourceHandle<Kind> => ({ kind, id: String(++nextId), owner })
    const releases: Array<ReturnType<typeof vi.fn>> = []
    const resources = {
        createGroup: vi.fn(() => handle('group')),
        createTexture: vi.fn(() => handle('texture')),
        createPath: vi.fn(() => handle('path')),
        createMesh: vi.fn(() => handle('mesh')),
        capture: vi.fn((_spec: CaptureSpec) => ({ handle: handle('capture'), texture: handle('texture') })),
        updateCapture: vi.fn(),
        updatePath: vi.fn(),
        updateTexture: vi.fn(),
        updateMesh: vi.fn(),
        setMask: vi.fn(),
        setVisible: vi.fn(),
        release: vi.fn(),
        displace: vi.fn(() => {
            const release = vi.fn()
            releases.push(release)
            return release
        }),
    }
    const surface: CanvasDrawingSurface = {
        resources: resources as unknown as DrawingResources,
        layers: { media: handle('layer'), connectors: handle('layer'), foreground: handle('layer') },
        media: { acquireImage: vi.fn(), acquirePlayback: vi.fn() },
        signal: controller.signal,
        invalidate: vi.fn(),
        requestFrame: vi.fn(),
    }
    const border = new GlassBorder({ surface, style, resolution: 2, texture: { kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array([255, 255, 255, 255]) } })
    return { border, resources, surface, releases, controller }
}

describe('GlassBorder', () => {
    it('declares excluded output and sample bounds while retaining stable resources across resize', () => {
        const { border, resources, surface, releases } = fixture()
        border.sync([datum], { width: 400, height: 300 })
        const root = resources.createGroup.mock.results[0].value
        expect(resources.capture).toHaveBeenCalledWith(expect.objectContaining({
            include: [surface.layers.media, surface.layers.connectors, surface.layers.foreground],
            exclude: [root],
            sampleBounds: [{ x: 2, y: 2, width: 156, height: 76 }],
            resolution: 2,
        }))
        const capture = resources.capture.mock.results[0].value
        const mapTexture = resources.updateTexture.mock.calls[0][0]
        border.sync([datum], { width: 800, height: 400 })
        expect(resources.capture).toHaveBeenCalledOnce()
        expect(resources.createTexture).toHaveBeenCalledTimes(2)
        expect(resources.updateTexture.mock.calls.at(-1)?.[0]).toBe(mapTexture)
        expect(resources.updateCapture).toHaveBeenLastCalledWith(capture.handle, expect.objectContaining({ bounds: { x: 0, y: 0, width: 800, height: 400 } }))
        expect(releases[0]).toHaveBeenCalledOnce()
        expect(resources.displace.mock.calls.at(-1)?.[1]).toBe(capture.texture)
        border.destroy()
    })

    it('does not rewrite unchanged masks, materials, or displacement pixels', () => {
        const { border, resources } = fixture()
        border.sync([datum], { width: 400, height: 300 })
        border.sync([datum], { width: 400, height: 300 })
        expect(resources.createMesh).toHaveBeenCalledOnce()
        expect(resources.updateMesh).not.toHaveBeenCalled()
        expect(resources.updateTexture).toHaveBeenCalledOnce()
        expect(resources.updatePath).toHaveBeenCalledTimes(2)
        expect(resources.updateCapture).not.toHaveBeenCalled()
        const mask = resources.updatePath.mock.calls[0][1][0]
        expect(mask.holes).toHaveLength(1)
        expect(mask.path).toContain('A25 25')
        expect(mask.holes[0]).toContain('A15 15')
        border.sync([{ ...datum, x: 40 }], { width: 400, height: 300 })
        expect(resources.createMesh).toHaveBeenCalledOnce()
        expect(resources.updateMesh).toHaveBeenCalledOnce()
        border.destroy()
    })

    it('pauses capture when targets are hidden and resumes the existing texture', () => {
        const { border, resources } = fixture()
        border.sync([], { width: 400, height: 300 })
        expect(resources.capture).not.toHaveBeenCalled()
        border.sync([datum], { width: 400, height: 300 })
        border.sync([{ ...datum, visible: false }], { width: 400, height: 300 })
        expect(resources.updateCapture).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: false }))
        border.sync([datum], { width: 400, height: 300 })
        expect(resources.capture).toHaveBeenCalledOnce()
        expect(resources.updateCapture).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: true }))
        border.destroy()
    })

    it('disposes only its own capture, textures, and displacement binding on abort', () => {
        const first = fixture()
        const second = fixture()
        first.border.sync([datum], { width: 400, height: 300 })
        second.border.sync([datum], { width: 400, height: 300 })
        first.controller.abort()
        first.border.destroy()
        expect(first.resources.release).toHaveBeenCalledTimes(4)
        expect(first.releases[0]).toHaveBeenCalledOnce()
        expect(second.resources.release).not.toHaveBeenCalled()
        second.border.destroy()
    })
})

describe('glass geometry and displacement', () => {
    it('keeps displacement neutral away from the rounded border and bounds map allocation', () => {
        const pixels = bakeGlassDisplacementMap([datum], { width: 1600, height: 800 }, style)
        expect(pixels.size).toEqual({ width: 256, height: 128 })
        expect(Array.from(pixels.rgba.slice(0, 4))).toEqual([128, 128, 128, 255])
        expect(Array.from(pixels.rgba.slice(-4))).toEqual([128, 128, 128, 255])
        expect(pixels.rgba.some((value, index) => index % 4 < 2 && value !== 128)).toBe(true)
        expect(pixels.rgba.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)
    })

    it('uses a closed strip with bounded vertex and index arrays', () => {
        const geometry = createGlassBorderMeshGeometry()
        writeClosedRoundedBorderGeometry(geometry, datum, style.widthPx, style.edgeFeatherFraction)
        expect(geometry.positions.every(Number.isFinite)).toBe(true)
        expect(geometry.indices.every(index => index < geometry.positions.length / 2)).toBe(true)
        expect(geometry.indices.some(index => index > 0)).toBe(true)
        expect(geometry.indices.at(-1)).toBe(0)
        const positions = geometry.positions
        writeClosedRoundedBorderGeometry(geometry, { ...datum, width: 80, height: 30 }, style.widthPx, style.edgeFeatherFraction)
        expect(geometry.positions).toBe(positions)
    })
})
