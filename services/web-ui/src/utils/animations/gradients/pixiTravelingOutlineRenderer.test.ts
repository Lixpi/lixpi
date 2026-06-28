'use strict'

import { describe, expect, it, vi } from 'vitest'
import { Easing } from '$src/utils/animations/easing.ts'
import { Container } from 'pixi.js'
import {
    PixiTravelingOutlineRenderer,
    getRoundedOutlinePerimeter,
    getRoundedOutlinePoint,
    getTravelingOutlineHeadDistance,
    interpolateTravelingOutlineColor,
} from './pixiTravelingOutlineRenderer.ts'

const meshInstances: Array<{
    destroy: ReturnType<typeof vi.fn>
    renderable: boolean
}> = []
const geometryInstances: Array<{
    destroy: ReturnType<typeof vi.fn>
    attributes: {
        aPosition: { buffer: { update: ReturnType<typeof vi.fn> } }
        aUV: { buffer: { update: ReturnType<typeof vi.fn> } }
    }
    indexBuffer: { update: ReturnType<typeof vi.fn> }
}> = []

vi.mock('pixi.js', () => {
    class FakeContainer {
        public children: any[] = []
        public parent: any = null
        public addChild = vi.fn((child: any): any => {
            this.children.push(child)
            child.parent = this
            return child
        })
        public removeChild = vi.fn((child: any): void => {
            this.children = this.children.filter((candidate) => candidate !== child)
            if (child) child.parent = null
        })
    }

    class FakeMeshGeometry {
        public positions = new Float32Array(0)
        public uvs = new Float32Array(0)
        public indices = new Uint32Array(0)
        public destroy = vi.fn()
        public attributes = {
            aPosition: { buffer: { update: vi.fn() } },
            aUV: { buffer: { update: vi.fn() } },
        }
        public indexBuffer = { update: vi.fn() }

        constructor(options: { positions?: Float32Array; uvs?: Float32Array; indices?: Uint32Array } = {}) {
            this.positions = options.positions ?? this.positions
            this.uvs = options.uvs ?? this.uvs
            this.indices = options.indices ?? this.indices
            geometryInstances.push(this)
        }
    }

    class FakeMesh {
        public position = {
            set: vi.fn(),
        }
        public renderable = true
        public eventMode = ''
        public label = ''
        public geometry: FakeMeshGeometry
        public texture: unknown
        public destroy = vi.fn()

        constructor(public options: { geometry: FakeMeshGeometry; texture: unknown }) {
            this.geometry = options.geometry
            this.texture = options.texture
            meshInstances.push(this)
        }
    }

    class FakeTexture {
        public static WHITE = new FakeTexture(255, 255, 255)
        public source = {}
        public static from = vi.fn(() => new FakeTexture(10, 10, 10))

        constructor(public width = 0, public height = 0, _red = 0) {}
        public destroy = vi.fn()
    }

    return {
        Container: FakeContainer,
        Mesh: FakeMesh,
        MeshGeometry: FakeMeshGeometry,
        Texture: FakeTexture,
    }
})

function createRenderer() {
    const onFrame = vi.fn()
    const renderer = new PixiTravelingOutlineRenderer({
        container: new Container(),
        style: {
            radius: 12,
            gap: 3,
            snakeHeadWidth: 4,
            snakeTailWidthFraction: 0.2,
            snakeTailThinLengthFraction: 0.1,
            snakeWidthTaperPower: 0.86,
            snakeLengthFraction: 0.8,
            snakeHeadRoundLengthFraction: 0.5,
            snakeTailAlpha: 0.35,
            snakeColors: ['#000000', '#FFFFFF'],
            glassMaterial: {
                shadowColor: '#000000',
                tailOpacityPower: 1,
                tailFadeFraction: 0.2,
                minTailOpacity: 0.1,
                edgeFeatherFraction: 0.5,
                edgeFeatherPower: 2,
                lensCorePower: 1,
                upperSpecularCenter: 0.3,
                upperSpecularDrift: 0,
                upperSpecularWidth: 0.12,
                upperSpecularFadeStart: 0,
                upperSpecularFadeEnd: 1,
                upperSpecularStrength: 0.2,
                headSpecularProgressCenter: 0.9,
                headSpecularProgressWidth: 0.2,
                headSpecularCrossSectionCenter: 0.4,
                headSpecularCrossSectionWidth: 0.22,
                headSpecularStrength: 0.17,
                lowerEdgeShadowCenter: 0.3,
                lowerEdgeShadowWidth: 0.2,
                lowerEdgeShadowStrength: 0.25,
                upperEdgeShadowCenter: 0.6,
                upperEdgeShadowWidth: 0.15,
                upperEdgeShadowStrength: 0.2,
                edgeShadowPower: 2,
                edgeShadowStrength: 0.3,
                lensHighlightStrength: 0.25,
                highlightWhiteMixMax: 0.4,
                shadowMixMax: 0.5,
                materialAlphaBase: 0.22,
                materialAlphaMax: 0.75,
                lensAlphaStrength: 0.35,
                upperSpecularAlphaStrength: 0.2,
                headSpecularAlphaStrength: 0.2,
            },
            durationMs: 1000,
        },
        onFrame,
        getStrokeScale: () => 1,
    })

    return { renderer, onFrame }
}

describe('PixiTravelingOutlineRenderer', () => {
    beforeEach(() => {
        meshInstances.length = 0
        geometryInstances.length = 0
        ;(globalThis as any).requestAnimationFrame = vi.fn(() => 1)
        ;(globalThis as any).cancelAnimationFrame = vi.fn(() => undefined)
    })

    it('calculates a rounded outline perimeter for the traveling segment', () => {
        expect(getRoundedOutlinePerimeter(200, 100, 10)).toBeCloseTo(2 * (200 + 100 - 40) + 20 * Math.PI)
    })

    it('clamps perimeter math when radius exceeds half the bounds', () => {
        expect(getRoundedOutlinePerimeter(10, 20, 99)).toBeCloseTo(2 * (10 + 20 - 4 * 5) + 2 * Math.PI * 5)
    })

    it('samples points clockwise around straight and rounded perimeter sections', () => {
        expect(getRoundedOutlinePoint(200, 100, 10, 0)).toEqual({ x: 10, y: 0 })
        expect(getRoundedOutlinePoint(200, 100, 10, 180)).toEqual({ x: 190, y: 0 })
        const afterTopRightCorner = getRoundedOutlinePoint(200, 100, 10, 180 + 5 * Math.PI)
        expect(afterTopRightCorner.x).toBeCloseTo(200)
        expect(afterTopRightCorner.y).toBeCloseTo(10)
    })

    it('tracks rasterized outline points even with oversized radius inputs', () => {
        expect(getRoundedOutlinePoint(20, 10, 99, 0)).toEqual({ x: 5, y: 0 })
        expect(getRoundedOutlinePoint(20, 10, 99, 5)).toEqual({ x: 10, y: 0 })
    })

    it('supports zero values for duration/perimeter without arithmetic errors', () => {
        expect(getTravelingOutlineHeadDistance(100, 0, 0)).toBe(0)
        expect(getTravelingOutlineHeadDistance(100, 1000, 0)).toBe(0)
    })

    it('uses loop-safe traveling-outline motion by default for each lap', () => {
        const perimeter = getRoundedOutlinePerimeter(200, 100, 10)
        expect(getTravelingOutlineHeadDistance(0, 3200, perimeter)).toBe(0)
        expect(getTravelingOutlineHeadDistance(800, 3200, perimeter)).toBeCloseTo(Easing.travelingOutlineTransition(0.25) * perimeter)
        expect(getTravelingOutlineHeadDistance(1600, 3200, perimeter)).toBeCloseTo(Easing.travelingOutlineTransition(0.5) * perimeter)
        expect(getTravelingOutlineHeadDistance(3200, 3200, perimeter)).toBe(0)
    })

    it('interpolates colors exactly when no interpolation progress', () => {
        expect(interpolateTravelingOutlineColor(['#000000'], 0.4)).toBe(0x000000)
        expect(interpolateTravelingOutlineColor(['#000000', '#FFFFFF'], 0.5)).toBe(0x808080)
        expect(interpolateTravelingOutlineColor(['#000000'], 1)).toBe(0x000000)
    })

    it('supports custom easing for head-distance progression', () => {
        const perimeter = getRoundedOutlinePerimeter(20, 20, 2)
        const ease = (value: number): number => value * value
        expect(getTravelingOutlineHeadDistance(250, 1000, perimeter, ease)).toBeCloseTo(ease(0.25) * perimeter)
    })

    it('creates a three-slot fixed geometry ring for each outline entry', () => {
        const { renderer } = createRenderer()

        renderer.sync([{ id: 'a', x: 0, y: 0, width: 100, height: 50, visible: true }])

        const entry = (renderer as any).entries.get('a')
        expect(entry.slots).toHaveLength(3)
        expect(meshInstances).toHaveLength(3)
        expect(geometryInstances).toHaveLength(3)
        expect(geometryInstances.every((geometry) => geometry.positions.length > 0)).toBe(true)
        expect(geometryInstances.every((geometry) => geometry.uvs.length === geometry.positions.length)).toBe(true)
        expect(geometryInstances.every((geometry) => geometry.indices.length > 0)).toBe(true)
        expect(entry.slots.filter((slot: { mesh: { renderable: boolean } }) => slot.mesh.renderable)).toHaveLength(1)
    })

    it('keeps stale outline entries allocated but hidden for future reuse', () => {
        const { renderer, onFrame } = createRenderer()
        ;(globalThis as any).requestAnimationFrame = vi.fn(() => 101)
        ;(globalThis as any).cancelAnimationFrame = vi.fn()

        renderer.sync([{ id: 'a', x: 0, y: 0, width: 100, height: 50, visible: true }])
        const firstEntry = (renderer as any).entries.get('a')
        renderer.sync([{ id: 'b', x: 5, y: 6, width: 42, height: 12, visible: false }])

        const internalEntries = (renderer as any).entries
        expect(internalEntries.size).toBe(2)
        expect(internalEntries.get('a')).toBe(firstEntry)
        expect(internalEntries.has('b')).toBe(true)
        expect(onFrame).toHaveBeenCalledTimes(2)
        expect(firstEntry.active).toBe(false)
        expect(firstEntry.slots.every((slot: { mesh: { renderable: boolean } }) => !slot.mesh.renderable)).toBe(true)
        expect(geometryInstances.every((geometry) => geometry.destroy.mock.calls.length === 0)).toBe(true)
        expect(meshInstances.every((mesh) => mesh.destroy.mock.calls.length === 0)).toBe(true)
    })

    it('updates only explicit entry geometry and visibility for known ids', () => {
        const { renderer } = createRenderer()
        renderer.updateGeometry('missing', { x: 1, y: 2, width: 3, height: 4 })
        renderer.setVisible('missing', false)

        renderer.sync([{ id: 'a', x: 1, y: 2, width: 10, height: 10, visible: true }])
        renderer.updateGeometry('a', {
            x: 9,
            y: 8,
            width: 7,
            height: 6,
            direction: 'counterclockwise',
            durationMs: 1200,
            snakeLengthFraction: 0.4,
        })
        renderer.setVisible('a', false)

        const entry = (renderer as any).entries.get('a')
        expect(entry?.x).toBe(9)
        expect(entry?.y).toBe(8)
        expect(entry?.width).toBe(7)
        expect(entry?.height).toBe(6)
        expect(entry?.direction).toBe('counterclockwise')
        expect(entry?.durationMs).toBe(1200)
        expect(entry?.snakeLengthFraction).toBe(0.4)
        expect(entry?.slots.every((slot: { mesh: { renderable: boolean } }) => !slot.mesh.renderable)).toBe(true)
    })

    it('reuses the same mesh and geometry when syncing an existing id', () => {
        const { renderer } = createRenderer()
        renderer.sync([{ id: 'a', x: 1, y: 2, width: 10, height: 10, visible: true }])

        const meshesAtStart = [...meshInstances]
        const geometriesAtStart = [...geometryInstances]

        renderer.sync([{
            id: 'a',
            x: 4,
            y: 8,
            width: 9,
            height: 6,
            visible: false,
            direction: 'counterclockwise',
            durationMs: 1500,
            snakeLengthFraction: 0.9,
        }])

        const entry = (renderer as any).entries.get('a')

        expect(meshInstances).toEqual(meshesAtStart)
        expect(geometryInstances).toEqual(geometriesAtStart)
        expect(entry?.x).toBe(4)
        expect(entry?.y).toBe(8)
        expect(entry?.width).toBe(9)
        expect(entry?.height).toBe(6)
        expect(entry?.direction).toBe('counterclockwise')
        expect(entry?.durationMs).toBe(1500)
        expect(entry?.snakeLengthFraction).toBe(0.9)
        expect(entry?.slots.every((slot: { mesh: { renderable: boolean } }) => !slot.mesh.renderable)).toBe(true)
        expect(meshInstances).toHaveLength(3)
        expect(geometryInstances).toHaveLength(3)
    })

    it('rotates rendering across the fixed mesh slots and only exposes the latest slot', () => {
        const { renderer } = createRenderer()
        renderer.sync([{ id: 'a', x: 0, y: 0, width: 20, height: 20, visible: true }])
        const entry = (renderer as any).entries.get('a')

        expect(entry.activeSlotIndex).toBe(0)
        expect(entry.slots.map((slot: { mesh: { renderable: boolean } }) => slot.mesh.renderable)).toEqual([true, false, false])

        ;(renderer as any).updateFrame(16)
        expect(entry.activeSlotIndex).toBe(1)
        expect(entry.slots.map((slot: { mesh: { renderable: boolean } }) => slot.mesh.renderable)).toEqual([false, true, false])

        ;(renderer as any).updateFrame(32)
        expect(entry.activeSlotIndex).toBe(2)
        expect(entry.slots.map((slot: { mesh: { renderable: boolean } }) => slot.mesh.renderable)).toEqual([false, false, true])

        ;(renderer as any).updateFrame(48)
        expect(entry.activeSlotIndex).toBe(0)
        expect(entry.slots.map((slot: { mesh: { renderable: boolean } }) => slot.mesh.renderable)).toEqual([true, false, false])
    })

    it('stops animating when no entries are renderable without destroying reusable slots', () => {
        ;(globalThis as any).requestAnimationFrame = vi.fn(() => 42)
        ;(globalThis as any).cancelAnimationFrame = vi.fn()
        const { renderer } = createRenderer()

        renderer.sync([{ id: 'a', x: 0, y: 0, width: 20, height: 20, visible: true }])
        expect((renderer as any).entries.size).toBe(1)

        renderer.sync([])
        const entry = (renderer as any).entries.get('a')
        expect((renderer as any).entries.size).toBe(1)
        expect(entry.active).toBe(false)
        expect(entry.slots.every((slot: { mesh: { renderable: boolean } }) => !slot.mesh.renderable)).toBe(true)
        expect((globalThis as any).cancelAnimationFrame).toHaveBeenCalledWith(42)
        expect((globalThis as any).cancelAnimationFrame).toHaveBeenCalledTimes(1)
        expect(meshInstances.every((mesh) => mesh.destroy.mock.calls.length === 0)).toBe(true)
        expect(geometryInstances.every((geometry) => geometry.destroy.mock.calls.length === 0)).toBe(true)

        renderer.destroy()
        expect(meshInstances.every((mesh) => mesh.destroy.mock.calls.length === 1)).toBe(true)
        expect(geometryInstances.every((geometry) => geometry.destroy.mock.calls.length === 1)).toBe(true)
        expect((renderer as any).animationRaf).toBe(null)
    })

    it('destroys remaining entries and releases animation loop state', () => {
        ;(globalThis as any).requestAnimationFrame = vi.fn(() => 77)
        ;(globalThis as any).cancelAnimationFrame = vi.fn()
        const { renderer } = createRenderer()

        renderer.sync([{ id: 'a', x: 0, y: 0, width: 20, height: 20, visible: true }])
        renderer.destroy()

        expect((renderer as any).entries.size).toBe(0)
        expect(geometryInstances.every((geometry) => geometry.destroy.mock.calls.length === 1)).toBe(true)
        expect(meshInstances.every((mesh) => mesh.destroy.mock.calls.length === 1)).toBe(true)
        expect((globalThis as any).cancelAnimationFrame).toHaveBeenCalledWith(77)
    })
})
