'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'
import { Easing } from '@lixpi/ui-primitives/animation'
import {
    getRoundedOutlinePerimeter,
    getRoundedOutlinePoint,
    getTravelingOutlineHeadDistance,
} from './outline-geometry.ts'

describe('outline geometry', () => {
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

    it('supports custom easing for head-distance progression', () => {
        const perimeter = getRoundedOutlinePerimeter(20, 20, 2)
        const ease = (value: number): number => value * value
        expect(getTravelingOutlineHeadDistance(250, 1000, perimeter, ease)).toBeCloseTo(ease(0.25) * perimeter)
    })
})
