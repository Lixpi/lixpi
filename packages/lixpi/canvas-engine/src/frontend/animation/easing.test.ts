'use strict'

import { describe, expect, it } from 'vitest'
import { Easing } from './easing.ts'

function expectMonotonic(ease: (progress: number) => number): void {
    let previous = ease(0)

    for (let i = 1; i <= 100; i++) {
        const value = ease(i / 100)
        expect(value).toBeGreaterThanOrEqual(previous)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
        previous = value
    }
}

describe('Easing', () => {
    it('evaluates linear cubic-bezier control points as identity', () => {
        for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
            expect(Easing.cubicBezierAtTime(0, 0, 1, 1, progress)).toBeCloseTo(progress, 2)
        }
    })

    it('clamps cubic-bezier input progress to the 0..1 range', () => {
        expect(Easing.cubicBezierAtTime(0, 0, 1, 1, -1)).toBeCloseTo(0, 5)
        expect(Easing.cubicBezierAtTime(0, 0, 1, 1, 2)).toBeCloseTo(1, 5)
    })

    it('keeps shared transition curves within valid monotonic progress bounds', () => {
        expectMonotonic(Easing.hoverTransition)
        expectMonotonic(Easing.shiftingGradientTransition)
        expectMonotonic(Easing.travelingOutlineTransition)
    })

    it('uses the hover transition curve as a fast ease-out', () => {
        expect(Easing.hoverTransition(0)).toBeCloseTo(0, 5)
        expect(Easing.hoverTransition(1)).toBeCloseTo(1, 5)
        expect(Easing.hoverTransition(0.5)).toBeGreaterThan(0.9)
    })

    it('uses the shifting gradient transition curve as an ease-out', () => {
        expect(Easing.shiftingGradientTransition(0)).toBeCloseTo(0, 5)
        expect(Easing.shiftingGradientTransition(1)).toBeCloseTo(1, 5)
        expect(Easing.shiftingGradientTransition(0.5)).toBeGreaterThan(0.5)
    })

    it('uses a gentle non-stalling pace pulse for traveling outlines', () => {
        expect(Easing.travelingOutlineTransition(0)).toBeCloseTo(0, 5)
        expect(Easing.travelingOutlineTransition(0.25)).toBeLessThan(0.25)
        expect(Easing.travelingOutlineTransition(0.5)).toBeCloseTo(0.5, 5)
        expect(Easing.travelingOutlineTransition(0.75)).toBeGreaterThan(0.75)
        expect(Easing.travelingOutlineTransition(1)).toBeCloseTo(1, 5)

        const increments = Array.from(
            { length: 100 },
            (_, index) => Easing.travelingOutlineTransition((index + 1) / 100) - Easing.travelingOutlineTransition(index / 100)
        )
        expect(Math.min(...increments)).toBeGreaterThan(0.005)
        expect(Math.max(...increments)).toBeLessThan(0.015)
    })
})
