import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    adjustHexColor,
    hslToRgb,
    mixHexColors,
    normalizeHexColor,
    parseHexColor,
    rgbToHex,
    rgbToHsl,
} from './color.ts'

describe('color conversion and mixing', () => {
    it('normalizes six-digit colors and uses only the supplied fallback for invalid input', () => {
        expect(normalizeHexColor(' ab12ef ')).toBe('#AB12EF')
        expect(normalizeHexColor('#abc')).toBeNull()
        expect(normalizeHexColor(null)).toBeNull()
        expect(parseHexColor('invalid', '#123456')).toEqual({ r: 18, g: 52, b: 86 })
        expect(parseHexColor('invalid')).toEqual({ r: 0, g: 0, b: 0 })
    })

    it.each(['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#808080', '#123456', '#FACE12'])('preserves %s through HSL conversion', hex => {
        expect(rgbToHex(hslToRgb(rgbToHsl(parseHexColor(hex))))).toBe(hex)
    })

    it('mixes channels with clamped amounts and a finite fallback for invalid amounts', () => {
        expect(mixHexColors('#000000', '#FFFFFF', 0.5)).toBe('#808080')
        expect(mixHexColors('#123456', '#FFFFFF', -1)).toBe('#123456')
        expect(mixHexColors('#123456', '#FFFFFF', 2)).toBe('#FFFFFF')
        expect(mixHexColors('#123456', '#FFFFFF', NaN)).toBe('#123456')
        expect(mixHexColors('invalid', '#FFFFFF', 0, '#53616C')).toBe('#53616C')
    })

    it('applies saturation and lightness bounds without changing hue', () => {
        const adjusted = adjustHexColor('#FF0000', { saturationMultiplier: 1, minSaturation: 0, maxSaturation: 1, lightnessMultiplier: 0.5, minLightness: 0, maxLightness: 1 })
        expect(adjusted).toBe('#800000')
        const bounded = adjustHexColor('#FF0000', { saturationMultiplier: 3, minSaturation: 0, maxSaturation: 0, lightnessMultiplier: 3, minLightness: 0.5, maxLightness: 0.5 })
        expect(bounded).toBe('#808080')
    })
})
