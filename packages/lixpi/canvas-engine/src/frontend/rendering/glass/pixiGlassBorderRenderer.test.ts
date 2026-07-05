// @vitest-environment happy-dom
'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Container } from 'pixi.js'
import {
    PixiGlassBorderRenderer,
    type PixiGlassBorderStyle,
} from './pixiGlassBorderRenderer.ts'
import type { GlassMaterialStyle } from './pixiGlassMaterial.ts'

type MockImageData = {
    data: Uint8ClampedArray
    width: number
    height: number
}

type MockCanvasContext = {
    createImageData: ReturnType<typeof vi.fn>
    fillRect: ReturnType<typeof vi.fn>
    putImageData: ReturnType<typeof vi.fn>
    getImageData: (x: number, y: number, width: number, height: number) => MockImageData
    fillStyle: string
}

type MockCanvas = {
    width: number
    height: number
    lastImageData: MockImageData | null
    context: MockCanvasContext
    getContext: (type: string) => MockCanvasContext | null
}

type MockTextureSource = {
    resize: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    width: number
    height: number
}

type MockTexture = {
    source: MockTextureSource
    destroy: ReturnType<typeof vi.fn>
}

const {
    createdCanvases,
    textureFromCalls,
    renderTextureCreates,
    displacementFilters,
    meshInstances,
    geometryInstances,
    materialTexture,
    closedGlassMaterialBake,
    MockContainer,
    MockGraphics,
    MockMeshGeometry,
    MockMesh,
    MockRenderTexture,
} = vi.hoisted(() => {
    const createdCanvases: MockCanvas[] = []
    const textureFromCalls: Array<{ source: unknown; mipmap: unknown; texture: MockTexture }> = []
    const renderTextureCreates: Array<{ width: number; height: number; resolution?: number; dynamic?: boolean; texture: MockRenderTexture }> = []
    const displacementFilters: Array<{ sprite: unknown; scale: number }> = []
    const meshInstances: MockMesh[] = []
    const geometryInstances: MockMeshGeometry[] = []
    const materialTexture: MockTexture = {
        source: {
            width: 256,
            height: 64,
            resize: vi.fn(),
            update: vi.fn(),
        },
        destroy: vi.fn(),
    }
    const closedGlassMaterialBake = vi.fn(() => materialTexture)

    class MockContainer {
        public children: unknown[] = []
        public parent: MockContainer | null = null
        public label = ''
        public eventMode = ''
        public renderable = true
        public destroy = vi.fn()

        constructor(options: { label?: string } = {}) {
            this.label = options.label ?? ''
        }

        public addChild(child: any): any {
            this.children.push(child)
            child.parent = this
            return child
        }

        public removeChild(child: any): void {
            this.children = this.children.filter((candidate) => candidate !== child)
            if (child) child.parent = null
        }
    }

    class MockGraphics extends MockContainer {
        public clear = vi.fn()
        public roundRect = vi.fn()
        public fill = vi.fn()
        public cut = vi.fn()
        public stroke = vi.fn()
        public destroy = vi.fn()
    }

    class MockMeshGeometry {
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

    class MockMesh {
        public renderable = true
        public eventMode = ''
        public label = ''
        public destroy = vi.fn()

        constructor(public options: { geometry: MockMeshGeometry; texture: MockTexture }) {
            meshInstances.push(this)
        }

        get geometry(): MockMeshGeometry {
            return this.options.geometry
        }

        get texture(): MockTexture {
            return this.options.texture
        }
    }

    class MockRenderTexture {
        public destroy = vi.fn()
        public resize = vi.fn((width: number, height: number, resolution?: number) => {
            this.width = width
            this.height = height
            this.resolution = resolution
        })

        constructor(public width: number, public height: number, public resolution?: number) {}
    }

    return {
        createdCanvases,
        textureFromCalls,
        renderTextureCreates,
        displacementFilters,
        meshInstances,
        geometryInstances,
        materialTexture,
        closedGlassMaterialBake,
        MockContainer,
        MockGraphics,
        MockMeshGeometry,
        MockMesh,
        MockRenderTexture,
    }
})

vi.mock('pixi.js', () => {
    class FakeTexture {
        public static WHITE = {
            source: { width: 1, height: 1, resize: vi.fn(), update: vi.fn() },
            destroy: vi.fn(),
        }
        public static EMPTY = {
            source: { width: 0, height: 0, resize: vi.fn(), update: vi.fn() },
            destroy: vi.fn(),
        }
        public static from = vi.fn((source: MockCanvas, mipmap: unknown) => {
            const texture: MockTexture = {
                source: {
                    width: source.width,
                    height: source.height,
                    resize: vi.fn((width: number, height: number) => {
                        texture.source.width = width
                        texture.source.height = height
                    }),
                    update: vi.fn(),
                },
                destroy: vi.fn(),
            }
            textureFromCalls.push({ source, mipmap, texture })
            return texture
        })
    }

    class FakeSprite extends MockContainer {
        public label = ''
        public eventMode = ''
        public renderable = true
        public mask: unknown = null
        public width = 0
        public height = 0
        public position = { set: vi.fn() }
        public destroy = vi.fn()

        constructor(public texture: unknown) {
            super()
        }
    }

    class FakeDisplacementFilter {
        constructor(public options: { sprite: unknown; scale: number }) {
            displacementFilters.push(options)
        }
    }

    class FakeRenderTexture {
        public static create = vi.fn((options: { width: number; height: number; resolution?: number; dynamic?: boolean }) => {
            const texture = new MockRenderTexture(options.width, options.height, options.resolution)
            renderTextureCreates.push({ ...options, texture })
            return texture
        })
    }

    return {
        Container: MockContainer,
        DisplacementFilter: FakeDisplacementFilter,
        Graphics: MockGraphics,
        Mesh: MockMesh,
        MeshGeometry: MockMeshGeometry,
        RenderTexture: FakeRenderTexture,
        Sprite: FakeSprite,
        Texture: FakeTexture,
    }
})

vi.mock('./pixiGlassMaterial.ts', async () => {
    const actual = await vi.importActual<typeof import('./pixiGlassMaterial.ts')>('./pixiGlassMaterial.ts')

    return {
        ...actual,
        ClosedGlassStripMaterial: class FakeClosedGlassStripMaterial {
            public constructor(
                public colors: ReadonlyArray<string>,
                public tailAlpha: number,
                public style: GlassMaterialStyle,
            ) {}

            public bake(): MockTexture {
                return closedGlassMaterialBake()
            }
        },
    }
})

function createMockImageData(width: number, height: number): MockImageData {
    return {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
    }
}

function createMockCanvas(width = 1, height = 1): MockCanvas {
    const canvas = {
        width,
        height,
        lastImageData: null as MockImageData | null,
        context: {} as MockCanvasContext,
        getContext: (type: string) => (type === '2d' ? canvas.context : null),
    }
    canvas.context = {
        fillStyle: '',
        createImageData: vi.fn((imageWidth: number, imageHeight: number) => createMockImageData(imageWidth, imageHeight)),
        fillRect: vi.fn(),
        putImageData: vi.fn((imageData: MockImageData) => {
            canvas.lastImageData = {
                data: new Uint8ClampedArray(imageData.data),
                width: imageData.width,
                height: imageData.height,
            }
        }),
        getImageData: (x: number, y: number, getWidth: number, getHeight: number) => {
            const imageData = canvas.lastImageData
            const result = createMockImageData(getWidth, getHeight)
            if (!imageData) return result

            for (let py = 0; py < getHeight; py++) {
                for (let px = 0; px < getWidth; px++) {
                    const sourceX = x + px
                    const sourceY = y + py
                    if (sourceX < 0 || sourceY < 0 || sourceX >= imageData.width || sourceY >= imageData.height) continue
                    const sourceOffset = (sourceY * imageData.width + sourceX) * 4
                    const targetOffset = (py * getWidth + px) * 4
                    result.data[targetOffset] = imageData.data[sourceOffset]
                    result.data[targetOffset + 1] = imageData.data[sourceOffset + 1]
                    result.data[targetOffset + 2] = imageData.data[sourceOffset + 2]
                    result.data[targetOffset + 3] = imageData.data[sourceOffset + 3]
                }
            }

            return result
        },
    }
    createdCanvases.push(canvas)
    return canvas
}

function makeGlassMaterialStyle(overrides: Partial<GlassMaterialStyle> = {}): GlassMaterialStyle {
    return {
        shadowColor: '#112233',
        tailOpacityPower: 1,
        tailFadeFraction: 0.2,
        minTailOpacity: 0.1,
        edgeFeatherFraction: 0.2,
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
        ...overrides,
    }
}

function makeStyle(overrides: Partial<PixiGlassBorderStyle> = {}): PixiGlassBorderStyle {
    return {
        enabled: true,
        widthPx: 10,
        displacementScalePx: 34,
        displacementMapMaxDimensionPx: 800,
        edgeRefractionStrength: 0.95,
        surfaceWaveStrength: 0.26,
        causticBandStrength: 0.34,
        displacementFrequencyX: 4.8,
        displacementFrequencyY: 3.9,
        bodyColor: '#ffffff',
        bodyAlpha: 0.035,
        highlightColor: '#ffffff',
        highlightAlpha: 0.2,
        shadowColor: '#415061',
        shadowAlpha: 0.1,
        materialColors: ['#ffffff', '#f7fbff'],
        materialTailAlpha: 1,
        glassMaterial: makeGlassMaterialStyle(),
        ...overrides,
    }
}

function readPixel(imageData: MockImageData | null, x: number, y: number): [number, number, number, number] {
    if (!imageData) return [0, 0, 0, 0]
    const offset = (y * imageData.width + x) * 4
    return [
        imageData.data[offset],
        imageData.data[offset + 1],
        imageData.data[offset + 2],
        imageData.data[offset + 3],
    ]
}

function countNonNeutralPixels(imageData: MockImageData | null): number {
    if (!imageData) return 0
    let count = 0
    for (let offset = 0; offset < imageData.data.length; offset += 4) {
        if (
            imageData.data[offset] !== 128
            || imageData.data[offset + 1] !== 128
            || imageData.data[offset + 2] !== 128
            || imageData.data[offset + 3] !== 255
        ) {
            count++
        }
    }
    return count
}

function createRenderer(style: PixiGlassBorderStyle = makeStyle()): PixiGlassBorderRenderer {
    return new PixiGlassBorderRenderer({
        container: new Container(),
        style,
    })
}

let originalOffscreenCanvasDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
    originalOffscreenCanvasDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: undefined,
        writable: true,
        configurable: true,
        enumerable: true,
    })
    createdCanvases.length = 0
    textureFromCalls.length = 0
    renderTextureCreates.length = 0
    displacementFilters.length = 0
    meshInstances.length = 0
    geometryInstances.length = 0
    materialTexture.destroy.mockReset()
    materialTexture.source.resize.mockReset()
    materialTexture.source.update.mockReset()
    closedGlassMaterialBake.mockClear()
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'canvas') return createMockCanvas() as unknown as HTMLCanvasElement
        return createElement(tagName)
    })
})

afterEach(() => {
    vi.restoreAllMocks()
    if (originalOffscreenCanvasDescriptor) {
        Object.defineProperty(globalThis, 'OffscreenCanvas', originalOffscreenCanvasDescriptor)
    } else {
        delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    }
})

// =============================================================================
// DISPLACEMENT TEXTURE LIFETIME
// =============================================================================

describe('PixiGlassBorderRenderer — displacement texture lifetime', () => {
    it('keeps one displacement texture stable and updates its source in place across syncs', () => {
        const renderer = createRenderer()
        const texture = textureFromCalls[0]?.texture
        const displacementCanvas = textureFromCalls[0]?.source as MockCanvas

        renderer.sync([{
            id: 'composer',
            x: 20,
            y: 20,
            width: 80,
            height: 40,
            radius: 14,
            visible: true,
        }], { width: 140, height: 100 })

        expect(textureFromCalls).toHaveLength(1)
        expect(displacementFilters[0]).toMatchObject({
            scale: 34,
        })
        expect(texture.source.resize).toHaveBeenCalledWith(140, 100)
        expect(texture.source.update).toHaveBeenCalledTimes(1)
        expect((renderer as any).displacementSprite.texture).toBe(texture)
        expect(displacementCanvas.width).toBe(140)
        expect(displacementCanvas.height).toBe(100)

        renderer.sync([{
            id: 'composer',
            x: 20,
            y: 20,
            width: 80,
            height: 40,
            radius: 14,
            visible: true,
        }], { width: 140, height: 100 })

        expect(textureFromCalls).toHaveLength(1)
        expect(texture.source.resize).toHaveBeenCalledTimes(1)
        expect(texture.source.update).toHaveBeenCalledTimes(1)

        renderer.sync([{
            id: 'composer',
            x: 24,
            y: 20,
            width: 80,
            height: 40,
            radius: 14,
            visible: true,
        }], { width: 160, height: 120 })

        expect(textureFromCalls).toHaveLength(1)
        expect((renderer as any).displacementSprite.texture).toBe(texture)
        expect(texture.source.resize).toHaveBeenCalledWith(160, 120)
        expect(texture.source.update).toHaveBeenCalledTimes(2)
        expect(texture.destroy).not.toHaveBeenCalled()

        renderer.destroy()
        expect(texture.destroy).toHaveBeenCalledWith(true)
    })

    it('writes liquid displacement only into border pixels and leaves non-glass pixels neutral', () => {
        const renderer = createRenderer()
        const displacementCanvas = textureFromCalls[0]?.source as MockCanvas

        renderer.sync([{
            id: 'button',
            x: 20,
            y: 20,
            width: 80,
            height: 40,
            radius: 18,
            visible: true,
        }], { width: 140, height: 100 })

        expect(displacementCanvas.lastImageData?.width).toBe(140)
        expect(displacementCanvas.lastImageData?.height).toBe(100)
        expect(readPixel(displacementCanvas.lastImageData, 1, 1)).toEqual([128, 128, 128, 255])
        expect(readPixel(displacementCanvas.lastImageData, 60, 40)).toEqual([128, 128, 128, 255])
        expect(countNonNeutralPixels(displacementCanvas.lastImageData)).toBeGreaterThan(100)
    })
})

// =============================================================================
// VISIBILITY, CAPTURE, AND MESH LIFECYCLE
// =============================================================================

describe('PixiGlassBorderRenderer — visibility, capture, and meshes', () => {
    it('creates a capture texture only when a target is visible in the pane', () => {
        const renderer = createRenderer()
        const container = (renderer as any).container as MockContainer

        renderer.sync([{
            id: 'hidden',
            x: 0,
            y: 0,
            width: 100,
            height: 44,
            radius: 22,
            visible: false,
        }], { width: 200, height: 100 })

        expect(container.renderable).toBe(false)
        expect(renderer.getCaptureTexture()).toBeNull()
        expect(renderTextureCreates).toHaveLength(0)

        renderer.sync([{
            id: 'composer',
            x: 10,
            y: 20,
            width: 100,
            height: 44,
            radius: 22,
            visible: true,
        }], { width: 200, height: 100 })

        expect(container.renderable).toBe(true)
        expect(renderer.getCaptureTexture()).toBe(renderTextureCreates[0]?.texture)
        expect(renderTextureCreates[0]).toMatchObject({
            width: 200,
            height: 100,
            dynamic: true,
        })

        renderer.setCapturing(true)
        expect(container.renderable).toBe(false)
        renderer.setCapturing(false)
        expect(container.renderable).toBe(true)

        renderer.sync([{
            id: 'offscreen',
            x: 400,
            y: 20,
            width: 100,
            height: 44,
            radius: 22,
            visible: true,
        }], { width: 200, height: 100 })

        expect(container.renderable).toBe(false)
        expect(renderer.getCaptureTexture()).toBeNull()
    })

    it('reuses target meshes by id, hides stale entries during sync, and destroys on teardown', () => {
        const renderer = createRenderer()

        renderer.sync([{
            id: 'composer',
            x: 10,
            y: 20,
            width: 100,
            height: 44,
            radius: 22,
            visible: true,
        }], { width: 200, height: 100 })

        const firstMesh = meshInstances.at(-1)
        const firstGeometry = geometryInstances.at(-1)
        expect(meshInstances).toHaveLength(1)
        expect(firstGeometry?.positions.length).toBeGreaterThan(0)
        expect(firstGeometry?.uvs.length).toBe(firstGeometry?.positions.length)
        expect(firstGeometry?.indices.length).toBeGreaterThan(0)

        renderer.sync([{
            id: 'composer',
            x: 12,
            y: 24,
            width: 120,
            height: 48,
            radius: 24,
            visible: true,
        }], { width: 220, height: 110 })

        expect(meshInstances).toHaveLength(1)
        expect(geometryInstances).toHaveLength(1)
        expect(meshInstances.at(-1)).toBe(firstMesh)
        expect(geometryInstances.at(-1)).toBe(firstGeometry)
        expect(firstMesh?.destroy).not.toHaveBeenCalled()

        renderer.sync([{
            id: 'button',
            x: 150,
            y: 24,
            width: 44,
            height: 44,
            radius: 22,
            visible: true,
        }], { width: 220, height: 110 })

        expect(meshInstances).toHaveLength(2)
        expect(firstMesh?.renderable).toBe(false)
        expect(meshInstances.at(-1)?.renderable).toBe(true)
        expect(firstMesh?.destroy).not.toHaveBeenCalled()
        expect(firstGeometry?.destroy).not.toHaveBeenCalled()
        expect((renderer as any).entries.has('composer')).toBe(true)
        expect((renderer as any).entries.has('button')).toBe(true)

        renderer.destroy()
        expect(firstMesh?.destroy).toHaveBeenCalled()
        expect(firstGeometry?.destroy).toHaveBeenCalled()
        expect(meshInstances.at(-1)?.destroy).toHaveBeenCalled()
        expect(geometryInstances.at(-1)?.destroy).toHaveBeenCalled()
    })

    it('clears draw state and stale meshes when style disables the glass border', () => {
        const style = makeStyle()
        const renderer = createRenderer(style)
        const container = (renderer as any).container as MockContainer

        renderer.sync([{
            id: 'composer',
            x: 10,
            y: 20,
            width: 100,
            height: 44,
            radius: 22,
            visible: true,
        }], { width: 200, height: 100 })
        expect(meshInstances).toHaveLength(1)

        ;(style as { enabled: boolean }).enabled = false
        ;((renderer as any).maskGraphics as MockGraphics).clear.mockClear()
        ;((renderer as any).highlightGraphics as MockGraphics).clear.mockClear()
        renderer.sync([{
            id: 'composer',
            x: 10,
            y: 20,
            width: 100,
            height: 44,
            radius: 22,
            visible: true,
        }], { width: 200, height: 100 })

        expect(container.renderable).toBe(false)
        expect(renderer.getCaptureTexture()).toBeNull()
        expect(meshInstances).toHaveLength(1)
        expect(meshInstances[0].renderable).toBe(false)
        expect(((renderer as any).maskGraphics as MockGraphics).clear).toHaveBeenCalled()
        expect(((renderer as any).highlightGraphics as MockGraphics).clear).toHaveBeenCalled()
    })
})
