'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    CircularGlassMaterial,
    type GlassMaterialStyle,
    TravelingSnakeGlassMaterial,
    interpolateTravelingOutlineColor,
} from './pixiGlassMaterial.ts'

const textureFromCalls: Array<{ source: unknown; mipmap: unknown }> = []
type MockCanvasImageData = {
    data: Uint8ClampedArray
    width: number
    height: number
}

type MockCanvasContext = {
    createImageData: (width: number, height: number) => MockCanvasImageData
    clearRect: (x: number, y: number, width: number, height: number) => void
    putImageData: (imageData: MockCanvasImageData) => void
    getImageData: (x: number, y: number, width: number, height: number) => MockCanvasImageData
}

vi.mock('pixi.js', () => {
    class FakeTexture {
        public static WHITE = new FakeTexture()
        public static from = vi.fn((source: unknown, mipmap: unknown) => {
            textureFromCalls.push({ source, mipmap })
            return new FakeTexture()
        })
        public destroy = vi.fn()
    }

    return { Texture: FakeTexture }
})

import { Texture } from 'pixi.js'

type MockCanvas = {
    width: number
    height: number
    getContext: (type: string) => MockCanvasContext | null
    toDataURL: () => string
}

function createMockCanvas(initialWidth = 1, initialHeight = 1): MockCanvas {
    let width = initialWidth
    let height = initialHeight
    let imageData: MockCanvasImageData | null = null

    const context: MockCanvasContext = {
        createImageData: (canvasWidth, canvasHeight) => {
            return {
                data: new Uint8ClampedArray(canvasWidth * canvasHeight * 4),
                width: canvasWidth,
                height: canvasHeight,
            }
        },
        clearRect: () => {},
        putImageData: (nextImageData) => {
            imageData = {
                data: new Uint8ClampedArray(nextImageData.data),
                width: nextImageData.width,
                height: nextImageData.height,
            }
        },
        getImageData: (x, y, getWidth, getHeight) => {
            if (!imageData) {
                return {
                    data: new Uint8ClampedArray(getWidth * getHeight * 4),
                    width: getWidth,
                    height: getHeight,
                }
            }

            const nextImageData = new Uint8ClampedArray(getWidth * getHeight * 4)
            for (let py = 0; py < getHeight; py++) {
                for (let px = 0; px < getWidth; px++) {
                    const sourceX = x + px
                    const sourceY = y + py
                    if (sourceX < 0 || sourceY < 0 || sourceX >= imageData.width || sourceY >= imageData.height) continue
                    const sourceOffset = (sourceY * imageData.width + sourceX) * 4
                    const targetOffset = (py * getWidth + px) * 4
                    nextImageData[targetOffset] = imageData.data[sourceOffset]
                    nextImageData[targetOffset + 1] = imageData.data[sourceOffset + 1]
                    nextImageData[targetOffset + 2] = imageData.data[sourceOffset + 2]
                    nextImageData[targetOffset + 3] = imageData.data[sourceOffset + 3]
                }
            }

            return {
                data: nextImageData,
                width: getWidth,
                height: getHeight,
            }
        },
    }

    return {
        get width() {
            return width
        },
        set width(value) {
            width = value
        },
        get height() {
            return height
        },
        set height(value) {
            height = value
        },
        getContext: (type: string) => (type === '2d' ? context : null),
        toDataURL: () => 'data:image/png;base64,bW9jay10ZXh0',
    }
}

function makeBaseGlassMaterialStyle(overrides: Partial<GlassMaterialStyle> = {}): GlassMaterialStyle {
    return {
        shadowColor: '#112233',
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
        ...overrides,
    }
}

function readPixelAlpha(
    canvas: { getContext: (type: string) => MockCanvasContext | null } | undefined,
    x: number,
    y: number,
): number {
    if (!canvas) return 0
    const context = canvas.getContext('2d')
    if (!context) return 0
    const pixel = context.getImageData(x, y, 1, 1).data
    return pixel[3]
}

function mockCanvasElements(): ReturnType<typeof vi.spyOn> {
    const createElement = document.createElement
    return vi.spyOn(document, 'createElement').mockImplementation(
        (tagName: string, options?: HTMLElementTagNameMap[string] | { is?: string }) => {
            if (tagName === 'canvas') {
                return createMockCanvas() as unknown as HTMLCanvasElement
            }
            return createElement.call(document, tagName, options)
        },
    )
}

let offscreenCanvasDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
    offscreenCanvasDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: undefined,
        writable: true,
        configurable: true,
        enumerable: true,
    })
    textureFromCalls.length = 0
    vi.clearAllMocks()
    mockCanvasElements()
})

afterEach(() => {
    vi.restoreAllMocks()
    if (offscreenCanvasDescriptor) {
        Object.defineProperty(globalThis, 'OffscreenCanvas', offscreenCanvasDescriptor)
    } else {
        delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    }
})

describe('interpolateTravelingOutlineColor', () => {
    it('interpolates between hex colors and clamps progress', () => {
        expect(interpolateTravelingOutlineColor([], 0.5)).toBe(0xffffff)
        expect(interpolateTravelingOutlineColor(['#000000'], 0.5)).toBe(0x000000)
        expect(interpolateTravelingOutlineColor(['#ff0000', '#00ff00'], -0.2)).toBe(0xff0000)
        expect(interpolateTravelingOutlineColor(['#ff0000', '#00ff00'], 1.2)).toBe(0x00ff00)
        expect(interpolateTravelingOutlineColor(['#000000', '#ffffff'], 0.5)).toBe(0x808080)
    })
})

describe('TravelingSnakeGlassMaterial', () => {
    it('bakes a fixed-size texture through PIXI from canvas data', () => {
        const material = new TravelingSnakeGlassMaterial(
            ['#000000', '#ffffff'],
            0.35,
            makeBaseGlassMaterialStyle(),
        )
        const texture = material.bake()

        expect(texture).toEqual(expect.any(Object))
        expect((Texture as { from: typeof vi.fn }).from).toHaveBeenCalledTimes(1)

        const call = textureFromCalls[0]
        const source = call?.source as { width: number; height: number }
        expect(source?.width).toBe(256)
        expect(source?.height).toBe(64)
        expect(call?.mipmap).toBe(true)
    })
})

describe('CircularGlassMaterial', () => {
    it('clamps size and opacity and keeps bake output addressable as texture data', () => {
        const zeroTranslucency = new CircularGlassMaterial(
            ['#112233'],
            0.35,
            makeBaseGlassMaterialStyle(),
            {
                size: 1,
                translucency: 0,
                rimFeatherFraction: 0.8,
            },
        )
        const transparent = zeroTranslucency.bake()

        expect(transparent).toEqual(expect.any(Object))
        const zeroCall = textureFromCalls[0]
        const zeroCanvas = zeroCall?.source as { width: number; height: number }
        expect(zeroCanvas?.width).toBe(2)
        expect(zeroCanvas?.height).toBe(2)
        expect(readPixelAlpha(zeroCall?.source as { getContext: (type: string) => FakeCanvasContext | null }, 1, 1)).toBe(0)
    })

    it('responds to translucency and emits opaque-enough center pixels at full transmission', () => {
        const fullTranslucency = new CircularGlassMaterial(
            ['#112233'],
            0.35,
            makeBaseGlassMaterialStyle(),
            {
                size: 32,
                translucency: 1,
            },
        )
        const opaque = fullTranslucency.bake()
        expect(opaque).toEqual(expect.any(Object))

        const opacityCall = textureFromCalls[0]
        const opacityCanvas = opacityCall?.source as { width: number; height: number; getContext: (type: string) => FakeCanvasContext | null }
        const centerX = Math.floor(opacityCanvas.width / 2)
        const centerY = Math.floor(opacityCanvas.height / 2)
        expect(readPixelAlpha(opacityCanvas, centerX, centerY)).toBeGreaterThan(0)
        expect(fullTranslucency.bakeDataUrl()).toMatch(/^data:image\/png;base64,/)
    })
})
