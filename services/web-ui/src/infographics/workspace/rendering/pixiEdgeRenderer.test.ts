'use strict'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPixiEdgeRenderer } from './pixiEdgeRenderer.ts'
import { worldPointToScreenPoint, type PixiEdgeRenderDatum } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'
import type { CanvasViewport } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

type SpyCall = {
    name: string
    args: unknown[]
}

const { FakeContainer, FakeGraphics } = vi.hoisted(() => {
    class FakeContainer {
        public children: Array<unknown> = []
        public positionX = 0
        public positionY = 0
        public position = {
            set: (x: number, y: number) => {
                this.positionX = x
                this.positionY = y
            },
        }
        public label = ''
        public eventMode = ''

        public addChild(child: unknown): unknown {
            this.children.push(child)
            return child
        }

        public removeChild(child: unknown): void {
            this.children = this.children.filter((candidate) => candidate !== child)
        }
    }

    class FakeGraphics extends FakeContainer {
        public readonly calls: SpyCall[] = []
        public renderable = true

        private record(name: string, args: unknown[]): void {
            this.calls.push({ name, args })
        }

        public clear = (...args: unknown[]): void => this.record('clear', args)
        public beginPath = (...args: unknown[]): void => this.record('beginPath', args)
        public moveTo = (...args: unknown[]): void => this.record('moveTo', args)
        public lineTo = (...args: unknown[]): void => this.record('lineTo', args)
        public bezierCurveTo = (...args: unknown[]): void => this.record('bezierCurveTo', args)
        public quadraticCurveTo = (...args: unknown[]): void => this.record('quadraticCurveTo', args)
        public closePath = (...args: unknown[]): void => this.record('closePath', args)
        public stroke = (...args: unknown[]): void => this.record('stroke', args)
        public fill = (...args: unknown[]): void => this.record('fill', args)
        public poly = (...args: unknown[]): void => this.record('poly', args)
        public destroy = (...args: unknown[]): void => this.record('destroy', args)
        public roundRect = (...args: unknown[]): void => this.record('roundRect', args)
    }

    return { FakeContainer, FakeGraphics }
})

vi.mock('pixi.js', () => ({
    Container: FakeContainer,
    Graphics: FakeGraphics,
}))

vi.mock('$src/settings.ts', () => ({
    settings: {
        connector: {
            scaling: {
                zoomScaling: {
                    minZoom: 0.4,
                },
            },
        },
    },
}))

function makeViewport(overrides: Partial<CanvasViewport> = {}): CanvasViewport {
    return {
        x: 0,
        y: 0,
        zoom: 1,
        ...overrides,
    }
}

function makeEdge(id: string, overrides: Partial<PixiEdgeRenderDatum> = {}): PixiEdgeRenderDatum {
    return {
        id,
        svgPath: 'M 0 0',
        strokeColor: '#123456',
        baseScreenStrokeWidth: 2,
        strokeWidth: 2,
        isDashed: false,
        arrowEnd: null,
        arrowStart: null,
        ...overrides,
    }
}

function project(worldX: number, worldY: number, viewport: CanvasViewport): [number, number] {
    const point = worldPointToScreenPoint({ x: worldX, y: worldY }, viewport)
    return [point.x, point.y]
}

const dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
const originalDpr = window.devicePixelRatio

function setDevicePixelRatio(value: number): void {
    Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        get: () => value,
    })
}

function restoreDevicePixelRatio(): void {
    if (dprDescriptor) {
        Object.defineProperty(window, 'devicePixelRatio', dprDescriptor)
    } else {
        setDevicePixelRatio(originalDpr)
    }
}

// =============================================================================
// PIXI edge renderer behavior
// =============================================================================

describe('pixiEdgeRenderer', () => {
    let container: FakeContainer

    beforeEach(() => {
        container = new FakeContainer()
        restoreDevicePixelRatio()
    })

    afterEach(() => {
        vi.clearAllMocks()
        restoreDevicePixelRatio()
    })

    it('renders SVG edge paths in world→screen coordinates with expected draw command coverage', () => {
        const renderer = createPixiEdgeRenderer(container)
        const viewport = makeViewport({ x: 10, y: -7, zoom: 2 })
        const edge = makeEdge('edge-path', {
            svgPath: 'M 1 2 L 3 4 H 8 V 5 C 6 7 8 9 10 11 Q 12 13 14 15 Z',
        })

        renderer.render([edge], viewport)
        const drawn = container.children[0] as FakeGraphics

        const clear = drawn.calls.find((entry) => entry.name === 'clear')
        const begin = drawn.calls.find((entry) => entry.name === 'beginPath')
        const close = drawn.calls.find((entry) => entry.name === 'closePath')
        const stroke = drawn.calls.find((entry) => entry.name === 'stroke')
        expect(drawn.calls[0]).toEqual(clear)
        expect(drawn.calls.some((entry) => entry.name === 'moveTo')).toBe(true)
        expect(drawn.calls.some((entry) => entry.name === 'lineTo')).toBe(true)
        expect(drawn.calls.some((entry) => entry.name === 'bezierCurveTo')).toBe(true)
        expect(drawn.calls.some((entry) => entry.name === 'quadraticCurveTo')).toBe(true)
        expect(begin).toBeTruthy()
        expect(close).toBeTruthy()
        expect(stroke).toBeTruthy()
        expect(stroke?.args[0]).toMatchObject({ width: 2, cap: 'round', join: 'round', color: '#123456' })

        const moveTo = drawn.calls.find((entry) => entry.name === 'moveTo')?.args as [number, number]
        const lineTos = drawn.calls.filter((entry) => entry.name === 'lineTo').map((entry) => entry.args as [number, number])
        const bezier = drawn.calls.find((entry) => entry.name === 'bezierCurveTo')?.args as [number, number, number, number, number, number]
        const quadratic = drawn.calls.find((entry) => entry.name === 'quadraticCurveTo')?.args as [number, number, number, number]

        expect(moveTo).toEqual(project(1, 2, viewport))
        expect(lineTos).toEqual([
            project(3, 4, viewport),
            project(8, 4, viewport),
            project(8, 5, viewport),
        ])
        expect(bezier).toEqual([
            ...project(6, 7, viewport),
            ...project(8, 9, viewport),
            ...project(10, 11, viewport),
        ])
        expect(quadratic).toEqual([
            ...project(12, 13, viewport),
            ...project(14, 15, viewport),
        ])
    })

    it('snaps screen geometry to device-pixel aligned coordinates', () => {
        setDevicePixelRatio(2)
        const renderer = createPixiEdgeRenderer(container)
        const viewport = makeViewport({ x: 0, y: 0, zoom: 1 })

        renderer.render([makeEdge('edge-subpixel', { svgPath: 'M 0.74 0.74 L 1.24 1.24' })], viewport)

        const drawn = container.children[0] as FakeGraphics
        const calls = drawn.calls.filter((entry) => entry.name === 'moveTo' || entry.name === 'lineTo')

        expect(calls).toHaveLength(2)
        expect(calls[0].args).toEqual([0.5, 0.5])
        expect(calls[1].args).toEqual([1, 1])
    })

    it('renders both start and end arrowheads and fills their polygons', () => {
        const renderer = createPixiEdgeRenderer(container)
        const viewport = makeViewport({ x: 0, y: 0, zoom: 1 })
        const arrow = {
            x: 5,
            y: 5,
            angle: 0,
            baseScreenSize: 20,
            size: 20,
        }

        renderer.render([makeEdge('edge-arrow', {
            svgPath: 'M 0 0 L 10 10',
            strokeColor: '#ff9900',
            arrowStart: arrow,
            arrowEnd: arrow,
            baseScreenStrokeWidth: 3,
            strokeWidth: 3,
        })], viewport)

        const drawn = container.children[0] as FakeGraphics
        const fillCalls = drawn.calls.filter((entry) => entry.name === 'fill')
        const polyCalls = drawn.calls.filter((entry) => entry.name === 'poly')

        expect(fillCalls).toHaveLength(2)
        expect(fillCalls[0].args).toEqual(['#ff9900'])
        expect(fillCalls[1].args).toEqual(['#ff9900'])
        expect(polyCalls).toHaveLength(2)
        expect(polyCalls[0].args[0]).toBeInstanceOf(Array)
        expect(polyCalls[1].args[0]).toBeInstanceOf(Array)
    })

    it('reuses Graphics instances for unchanged edges and repaints only on datum changes', () => {
        const renderer = createPixiEdgeRenderer(container)
        const viewport = makeViewport({ zoom: 1.25 })
        const edge = makeEdge('edge-stable', {
            svgPath: 'M 0 0 L 5 5',
            strokeColor: '#ffffff',
            baseScreenStrokeWidth: 2,
            strokeWidth: 2,
        })

        renderer.render([edge], viewport)
        const graphics = container.children[0] as FakeGraphics
        const clearCountAfterFirstRender = graphics.calls.filter((entry) => entry.name === 'clear').length

        renderer.render([edge], viewport)
        expect(graphics).toBe(container.children[0])
        expect(graphics.calls.filter((entry) => entry.name === 'clear')).toHaveLength(clearCountAfterFirstRender)

        const updated = makeEdge('edge-stable', {
            ...edge,
            strokeColor: '#111111',
        })
        renderer.render([updated], viewport)
        expect(graphics.calls.filter((entry) => entry.name === 'clear').length).toBeGreaterThan(clearCountAfterFirstRender)
    })

    it('hides stale edges for reuse and destroys graphics only during teardown', () => {
        const renderer = createPixiEdgeRenderer(container)
        const viewport = makeViewport()
        const first = makeEdge('first')
        const second = makeEdge('second')

        renderer.render([first, second], viewport)
        expect(container.children).toHaveLength(2)

        const firstGraphics = container.children[0] as FakeGraphics
        const secondGraphics = container.children[1] as FakeGraphics

        renderer.render([second], viewport)
        expect(container.children).toHaveLength(2)
        expect(container.children[0]).toBe(firstGraphics)
        expect(container.children[1]).toBe(secondGraphics)
        expect(firstGraphics.renderable).toBe(false)
        expect(secondGraphics.renderable).toBe(true)
        expect(firstGraphics.calls.some((entry) => entry.name === 'destroy')).toBe(false)

        renderer.render([first, second], viewport)
        expect(firstGraphics.renderable).toBe(true)
        expect(container.children[0]).toBe(firstGraphics)

        renderer.destroy()
        expect(container.children).toHaveLength(0)
        expect(firstGraphics.calls.some((entry) => entry.name === 'destroy')).toBe(true)
        expect(secondGraphics.calls.some((entry) => entry.name === 'destroy')).toBe(true)
    })
})
