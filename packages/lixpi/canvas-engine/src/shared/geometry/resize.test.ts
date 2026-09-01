import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    computeResizedBounds,
    growParentBounds,
} from './resize.ts'

describe('Resize geometry', () => {
    it('rejects invalid deltas and contradictory constraints before producing geometry', () => {
        const start = { x: 0, y: 0, width: 100, height: 50 }
        const constraints = { min: { width: 1, height: 1 }, preserveAspectRatio: false }
        expect(() => computeResizedBounds(start, { x: NaN, y: 0 }, 'right', constraints)).toThrow()
        expect(() => computeResizedBounds(start, { x: 0, y: 0 }, 'right', { ...constraints, max: { width: 0, height: 10 } })).toThrow()
        expect(() => computeResizedBounds(start, { x: 0, y: 0 }, 'right', { ...constraints, aspectRatio: 0 })).toThrow()
    })

    it('keeps the opposite corner fixed while clamping minimum and maximum dimensions', () => {
        const start = { x: 100, y: 200, width: 300, height: 150 }
        const constraints = { min: { width: 100, height: 50 }, max: { width: 400, height: 200 }, preserveAspectRatio: false }
        expect(computeResizedBounds(start, { x: 500, y: 500 }, 'top-left', constraints)).toEqual({ x: 300, y: 300, width: 100, height: 50 })
        expect(computeResizedBounds(start, { x: -500, y: -500 }, 'top-left', constraints)).toEqual({ x: 0, y: 150, width: 400, height: 200 })
    })

    it('preserves the supplied content aspect ratio under diagonal movement and constraints', () => {
        const start = { x: 10, y: 20, width: 300, height: 150 }
        const result = computeResizedBounds(start, { x: 60, y: 30 }, 'bottom-right', { min: { width: 50, height: 25 }, preserveAspectRatio: true, aspectRatio: 2 })
        expect(result).toEqual({ x: 10, y: 20, width: 340, height: 170 })
        expect(growParentBounds({ x: 100, y: 100, width: 200, height: 100 }, { x: 220, y: 130, width: 180, height: 90 }, 20)).toEqual({ width: 320, height: 140 })
    })
})
