import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    ClosedGlassStripMaterial,
    CircularGlassMaterial,
    TravelingSnakeGlassMaterial,
    interpolateTravelingOutlineColor,
    type GlassMaterialStyle,
    type GlassPixels,
} from './glass-material.ts'

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

function alpha(pixels: GlassPixels, x: number, y: number): number {
    return pixels.rgba[(y * pixels.size.width + x) * 4 + 3]
}

afterEach(() => vi.unstubAllGlobals())

describe('glass material pixels', () => {
    it('interpolates hex colors and clamps progress', () => {
        expect(interpolateTravelingOutlineColor([], 0.5)).toBe(0xffffff)
        expect(interpolateTravelingOutlineColor(['#000000'], 0.5)).toBe(0x000000)
        expect(interpolateTravelingOutlineColor(['#ff0000', '#00ff00'], -0.2)).toBe(0xff0000)
        expect(interpolateTravelingOutlineColor(['#ff0000', '#00ff00'], 1.2)).toBe(0x00ff00)
        expect(interpolateTravelingOutlineColor(['#000000', '#ffffff'], 0.5)).toBe(0x808080)
    })

    it('bakes a fixed-size traveling strip without a DOM or GPU', () => {
        vi.stubGlobal('document', undefined)
        vi.stubGlobal('OffscreenCanvas', undefined)
        const pixels = new TravelingSnakeGlassMaterial(['#000000', '#ffffff'], 0.35, makeBaseGlassMaterialStyle()).bake()
        expect(pixels.kind).toBe('pixels')
        expect(pixels.size).toEqual({ width: 256, height: 64 })
        expect(pixels.rgba).toHaveLength(256 * 64 * 4)
        expect(alpha(pixels, 128, 32)).toBeGreaterThan(0)
        expect(alpha(pixels, 128, 0)).toBe(0)
    })

    it('bakes a closed strip without the traveling-snake tail seam', () => {
        const pixels = new ClosedGlassStripMaterial(
            ['#000000', '#ffffff'],
            0.05,
            makeBaseGlassMaterialStyle({
                materialAlphaBase: 0.5,
                materialAlphaMax: 0.8,
                tailFadeFraction: 0.4,
                minTailOpacity: 0.02,
            }),
            { width: 32, height: 16 },
        ).bake()
        expect(pixels.size).toEqual({ width: 32, height: 16 })
        const first = alpha(pixels, 0, 8)
        const middle = alpha(pixels, 16, 8)
        const last = alpha(pixels, 31, 8)
        expect(first).toBeGreaterThan(0)
        expect(last).toBeGreaterThan(0)
        expect(first).toBeGreaterThanOrEqual(Math.floor(middle * 0.5))
    })

    it('clamps circle size and translucency', () => {
        const pixels = new CircularGlassMaterial(['#112233'], 0.35, makeBaseGlassMaterialStyle(), { size: 1, translucency: 0, rimFeatherFraction: 0.8 }).bake()
        expect(pixels.size).toEqual({ width: 2, height: 2 })
        expect(alpha(pixels, 1, 1)).toBe(0)
    })

    it('keeps a translucent center and transparent corners on the disc', () => {
        const pixels = new CircularGlassMaterial(['#112233'], 0.35, makeBaseGlassMaterialStyle(), { size: 32, translucency: 1 }).bake()
        expect(alpha(pixels, 16, 16)).toBeGreaterThan(0)
        expect(alpha(pixels, 0, 0)).toBe(0)
    })

    it('uses the same pixels for the DOM image output', () => {
        const putImageData = vi.fn()
        const toDataURL = vi.fn(() => 'data:image/png;base64,test')
        vi.stubGlobal('document', {
            createElement: () => ({
                width: 0,
                height: 0,
                toDataURL,
                getContext: () => ({
                    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
                    clearRect: vi.fn(),
                    putImageData,
                }),
            }),
        })
        const material = new CircularGlassMaterial(['#112233'], 0.35, makeBaseGlassMaterialStyle(), { size: 32 })
        expect(material.bakeDataUrl()).toBe('data:image/png;base64,test')
        expect(putImageData.mock.calls[0][0].data).toEqual(material.bake().rgba)
        expect(toDataURL).toHaveBeenCalledWith('image/png')
    })
})
