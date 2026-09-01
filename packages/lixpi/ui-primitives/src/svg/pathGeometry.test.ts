import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    flattenSvgPath,
    getPathLength,
    getPointAtPathLength,
    isPointNearPath,
} from './pathGeometry.ts'

describe('SVG path geometry', () => {
    it('reads relative commands, compact signed numbers and exponents', () => {
        const points = flattenSvgPath('M1e2-20 l10 0 v20 h-10 z')
        expect(points).toEqual([{ x: 100, y: -20 }, { x: 110, y: -20 }, { x: 110, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -20 }])
        expect(getPathLength(points)).toBe(60)
        expect(getPointAtPathLength(points, 15)).toEqual({ point: { x: 110, y: -15 }, tangent: { x: 0, y: 20 } })
        expect(isPointNearPath({ x: 108, y: -15 }, points, 3)).toBe(true)
        expect(isPointNearPath({ x: 90, y: -15 }, points, 3)).toBe(false)
    })

    it('samples cubic and quadratic curves without requiring a DOM', () => {
        const cubic = flattenSvgPath('M0 0 C0 100 100 100 100 0')
        expect(cubic.at(-1)).toEqual({ x: 100, y: 0 })
        expect(getPathLength(cubic)).toBeGreaterThan(190)
        const quadratic = flattenSvgPath('M0 0 q50 100 100 0')
        expect(quadratic.at(-1)).toEqual({ x: 100, y: 0 })
        expect(getPathLength(quadratic)).toBeGreaterThan(140)
    })

    it.each(['M0', 'M0 0 L2', 'M0 0 A10 10 0 0 1 20 20', 'M0 0 L10 10 M20 20 L30 30'])('rejects unsupported or incomplete geometry: %s', path => {
        expect(() => flattenSvgPath(path)).toThrow()
    })
})
