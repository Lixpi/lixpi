import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { CircularGlassMaterial } from '@lixpi/canvas-components/effects/glass'
import {
    BranchMediaModelCircleStyles,
    type BranchMediaModelCircleSettings,
} from './branch-media-model-circle-styles.ts'

afterEach(() => vi.restoreAllMocks())

function settings(): BranchMediaModelCircleSettings {
    return {
        glass: {
            textureSize: 128,
            translucency: 0.97,
            rimFeatherFraction: 0.04,
            fallbackColors: ['#06133A', '#0A49A7', '#1768D9', '#55A7FF'],
            brandColorAdjust: { saturationMultiplier: 1, minSaturation: 0, maxSaturation: 1, lightnessMultiplier: 1, minLightness: 0, maxLightness: 1 },
            brandColorStops: [{ targetColor: '#FFFFFF', amount: 0.5 }],
            material: {} as BranchMediaModelCircleSettings['glass']['material'],
            discMaterial: {},
        },
        texture: { fallbackColor: '#53616C', fillOpacity: 0.5, brandColorMix: { targetColor: '#FFFFFF', amount: 0.5 } },
    }
}

describe('BranchMediaModelCircleStyles', () => {
    it('caches unchanged treatments per instance and rebakes after settings changes or release', () => {
        const bake = vi.spyOn(CircularGlassMaterial.prototype, 'bakeDataUrl').mockReturnValue('data:image/png;base64,test')
        const config = settings()
        const a = new BranchMediaModelCircleStyles(config), b = new BranchMediaModelCircleStyles(settings())
        expect(a.getGlassImage('#123456')).toBe('url(data:image/png;base64,test)')
        a.getGlassImage('#123456')
        expect(bake).toHaveBeenCalledOnce()
        b.getGlassImage('#123456')
        config.glass.translucency = 0.5
        a.getGlassImage('#123456')
        expect(bake).toHaveBeenCalledTimes(3)
        a.clear()
        a.getGlassImage('#123456')
        b.getGlassImage('#123456')
        expect(bake).toHaveBeenCalledTimes(4)
    })

    it('uses the configured fallback when catalog colors are missing and encodes the UI-kit texture', () => {
        const view = new BranchMediaModelCircleStyles(settings())
        const fallback = view.getTextureImage(null)
        expect(view.getTextureImage('not-a-color')).toBe(fallback)
        const markup = decodeURIComponent(fallback.slice('url("data:image/svg+xml,'.length, -2))
        expect(markup).toContain('<path fill="#53616C" fill-opacity="0.5"')
        expect(view.getTextureImage('#000000')).not.toBe(fallback)
    })
})
