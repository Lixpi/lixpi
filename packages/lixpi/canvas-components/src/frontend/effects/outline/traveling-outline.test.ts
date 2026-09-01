'use strict'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasDrawingSurface,
    DrawingResources,
    MeshData,
    ResourceHandle,
    ResourceKind,
} from '@lixpi/canvas-engine/frontend/rendering'
import { TravelingOutline } from './traveling-outline.ts'
import type { TravelingOutlineDatum } from './outline-geometry.ts'

function createSurface() {
    const controller = new AbortController()
    const owner = Symbol()
    let nextId = 0
    const handle = <Kind extends ResourceKind>(kind: Kind): ResourceHandle<Kind> => ({ kind, id: String(++nextId), owner })
    const frames = new Set<(elapsed: number) => void>()
    const meshes = new Map<ResourceHandle, MeshData>()
    const resources = {
        createGroup: vi.fn(() => handle('group')),
        createTexture: vi.fn(() => handle('texture')),
        createMesh: vi.fn((_group, data: MeshData) => {
            const mesh = handle('mesh')
            meshes.set(mesh, structuredClone(data))
            return mesh
        }),
        updateMesh: vi.fn((mesh, data: MeshData) => meshes.set(mesh, structuredClone(data))),
        updateGroup: vi.fn(),
        setVisible: vi.fn(),
        release: vi.fn(),
    }
    const surface: CanvasDrawingSurface = {
        resources: resources as unknown as DrawingResources,
        layers: { media: handle('layer'), connectors: handle('layer'), foreground: handle('layer') },
        media: { acquireImage: vi.fn(), acquirePlayback: vi.fn() },
        signal: controller.signal,
        invalidate: vi.fn(),
        requestFrame: callback => {
            frames.add(callback)
            return () => {
                frames.delete(callback)
            }
        },
    }
    return { surface, resources, frames, meshes, controller }
}

function createOutline(surface: CanvasDrawingSurface) {
    return new TravelingOutline({
        surface,
        style: {
            radius: 12,
            gap: 3,
            snakeHeadWidth: 4,
            snakeTailWidthFraction: 0.2,
            snakeTailThinLengthFraction: 0.1,
            snakeWidthTaperPower: 0.86,
            snakeLengthFraction: 0.8,
            snakeHeadRoundLengthFraction: 0.5,
            edgeFeatherFraction: 0.5,
            durationMs: 1000,
        },
        texture: { kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array([255, 255, 255, 255]) },
        ease: value => value,
    })
}

const datum: TravelingOutlineDatum = { id: 'a', x: 10, y: 20, width: 100, height: 50, radius: 12, visible: true }

describe('TravelingOutline', () => {
    it('submits animated neutral geometry while keeping one public mesh per target', () => {
        const { surface, resources, meshes, frames } = createSurface()
        const outline = createOutline(surface)
        outline.sync([datum])
        const initial = Array.from(meshes.values())[0]
        expect(initial.positions.length).toBeGreaterThan(0)
        expect(initial.uvs.length).toBe(initial.positions.length)
        expect(initial.indices.some(value => value !== 0)).toBe(true)
        for (const frame of frames) frame(250)
        const animated = Array.from(meshes.values())[0]
        expect(animated.positions).not.toEqual(initial.positions)
        expect(animated.version).toBeGreaterThan(initial.version)
        expect(resources.createMesh).toHaveBeenCalledTimes(1)
        expect(resources.updateGroup).toHaveBeenLastCalledWith(expect.anything(), { position: { x: 5, y: 15 } })
        outline.destroy()
    })

    it('retains hidden entries and restarts animation when visibility returns', () => {
        const { surface, resources, frames } = createSurface()
        const outline = createOutline(surface)
        outline.sync([datum])
        expect(frames.size).toBe(1)
        outline.sync([])
        expect(frames.size).toBe(0)
        expect(resources.release).not.toHaveBeenCalled()
        outline.sync([datum])
        expect(frames.size).toBe(1)
        expect(resources.createMesh).toHaveBeenCalledTimes(1)
        outline.setVisible('a', false)
        expect(frames.size).toBe(0)
        outline.setVisible('a', true)
        expect(frames.size).toBe(1)
        outline.destroy()
    })

    it('paints live geometry updates without changing per-target animation options', () => {
        const { surface, resources, meshes } = createSurface()
        const outline = createOutline(surface)
        outline.sync([{ ...datum, direction: 'counterclockwise', durationMs: 500, snakeLengthFraction: 0.4 }])
        const initial = Array.from(meshes.values())[0]
        outline.updateGeometry('a', { x: 80, y: 90, width: 40, height: 30 })
        expect(resources.updateGroup).toHaveBeenLastCalledWith(expect.anything(), { position: { x: 75, y: 85 } })
        expect(Array.from(meshes.values())[0].positions).not.toEqual(initial.positions)
        outline.updateGeometry('missing', { x: 0, y: 0, width: 1, height: 1 })
        expect(resources.createMesh).toHaveBeenCalledTimes(1)
        outline.destroy()
    })

    it('ends only its own frame lease and allocations when the scope aborts', () => {
        const first = createSurface()
        const second = createSurface()
        const outline = createOutline(first.surface)
        const other = createOutline(second.surface)
        outline.sync([datum])
        other.sync([datum])
        first.controller.abort()
        outline.destroy()
        expect(first.frames.size).toBe(0)
        expect(first.resources.release).toHaveBeenCalledTimes(2)
        expect(second.frames.size).toBe(1)
        expect(second.resources.release).not.toHaveBeenCalled()
        outline.sync([datum])
        expect(first.resources.createMesh).toHaveBeenCalledTimes(1)
        other.destroy()
    })
})
