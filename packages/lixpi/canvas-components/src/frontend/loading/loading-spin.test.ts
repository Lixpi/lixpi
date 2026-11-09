import {
    describe,
    expect,
    it,
} from 'vitest'
import { Easing } from '@lixpi/ui-primitives/animation'
import {
    createLoadingSpinKeyframes,
    planLoadingSpin,
} from './loading-spin.ts'

const cycle = {
    fastTurns: 2,
    slowTurnDurationFactor: 1.75,
    firstSlowdownMs: 40,
    slowdownGrowthFactor: 2,
    maxSlowTurnDurationMs: 2400,
}

describe('loading spin cycles', () => {
    it('runs two fast turns and one slow turn per cycle and slows every turn of each later cycle at once', () => {
        const plan = planLoadingSpin(
            400,
            cycle,
        )

        expect(plan.slowingTurnDurationsMs).toEqual([
            400,
            400,
            700,
            440,
            440,
            770,
            520,
            520,
            910,
            680,
            680,
            1190,
        ])
    })

    it('repeats the last cycle once the next slow turn would pass the limit', () => {
        const plan = planLoadingSpin(
            400,
            cycle,
        )
        // The cycle after it would add 640ms and make the slow turn 2870ms.
        expect(plan.repeatingTurnDurationsMs).toEqual([
            1000,
            1000,
            1750,
        ])
    })

    it('repeats the first cycle when no slowdown is configured', () => {
        expect(planLoadingSpin(
            400,
            {
                ...cycle,
                firstSlowdownMs: 0,
            },
        )).toEqual({
            slowingTurnDurationsMs: [],
            repeatingTurnDurationsMs: [
                400,
                400,
                700,
            ],
        })
    })

    it('stops slowing when a shrinking slowdown never reaches the limit', () => {
        const plan = planLoadingSpin(
            400,
            {
                ...cycle,
                slowdownGrowthFactor: 0.5,
            },
        )

        expect(plan.slowingTurnDurationsMs.length).toBeLessThanOrEqual(64 * 3)
        expect(plan.repeatingTurnDurationsMs[0]).toBeCloseTo(480)
    })
})

describe('loading spin keyframes', () => {
    it('places each whole turn at its share of the total time', () => {
        const keyframes = createLoadingSpinKeyframes([
            100,
            300,
        ])
        const turnStarts = keyframes.filter(keyframe => /rotate\(\d+turn\)/.test(String(keyframe.transform)))

        expect(turnStarts.map(keyframe => [
            keyframe.offset,
            keyframe.transform,
        ])).toEqual([
            [
                0,
                'rotate(0turn)',
            ],
            [
                0.25,
                'rotate(1turn)',
            ],
            [
                1,
                'rotate(2turn)',
            ],
        ])
    })

    it('eases each turn with compositor-friendly cubic Bezier segments that follow the turn easing', () => {
        const keyframes = createLoadingSpinKeyframes([1000])
        const quarter = keyframes.find(keyframe => keyframe.offset === 0.25)

        expect(quarter?.transform).toBe(`rotate(${Number(Easing.travelingOutlineTransition(0.25).toFixed(5))}turn)`)
        expect(keyframes.slice(0, -1).every(keyframe => String(keyframe.easing).startsWith('cubic-bezier('))).toBe(true)
    })
})
