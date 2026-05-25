'use strict'

import { describe, expect, it } from 'vitest'
import { Easing } from '$src/utils/animations/easing.ts'
import {
    getRoundedOutlinePerimeter,
    getRoundedOutlinePoint,
    getTravelingOutlineHeadDistance,
    interpolateTravelingOutlineColor,
} from './pixiTravelingOutlineRenderer.ts'

describe('PixiTravelingOutlineRenderer', () => {
    it('calculates a rounded outline perimeter for the traveling segment', () => {
        expect(getRoundedOutlinePerimeter(200, 100, 10)).toBeCloseTo(2 * (200 + 100 - 40) + 20 * Math.PI)
    })

    it('samples points clockwise around straight and rounded perimeter sections', () => {
        expect(getRoundedOutlinePoint(200, 100, 10, 0)).toEqual({ x: 10, y: 0 })
        expect(getRoundedOutlinePoint(200, 100, 10, 180)).toEqual({ x: 190, y: 0 })
        const afterTopRightCorner = getRoundedOutlinePoint(200, 100, 10, 180 + 5 * Math.PI)
        expect(afterTopRightCorner.x).toBeCloseTo(200)
        expect(afterTopRightCorner.y).toBeCloseTo(10)
    })

    it('uses loop-safe traveling-outline motion by default for each lap', () => {
        const perimeter = getRoundedOutlinePerimeter(200, 100, 10)
        expect(getTravelingOutlineHeadDistance(0, 3200, perimeter)).toBe(0)
        expect(getTravelingOutlineHeadDistance(800, 3200, perimeter)).toBeCloseTo(Easing.travelingOutlineTransition(0.25) * perimeter)
        expect(getTravelingOutlineHeadDistance(1600, 3200, perimeter)).toBeCloseTo(Easing.travelingOutlineTransition(0.5) * perimeter)
        expect(getTravelingOutlineHeadDistance(3200, 3200, perimeter)).toBe(0)
    })

    it('interpolates the traveling segment palette independently of consumers', () => {
        expect(interpolateTravelingOutlineColor(['#000000', '#FFFFFF'], 0.5)).toBe(0x808080)
    })
})
