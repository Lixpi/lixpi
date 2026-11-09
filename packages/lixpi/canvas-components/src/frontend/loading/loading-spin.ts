import { Easing } from '@lixpi/ui-primitives/animation'

// The spinner turns in repeating cycles. A cycle is `fastTurns` full turns at
// the fast duration followed by one slow turn that takes
// `slowTurnDurationFactor` times the fast duration. The first cycle uses the
// configured fast turn duration. Each later cycle adds a slowdown to every
// turn in it at once: `firstSlowdownMs` for the second cycle, then the
// previous slowdown times `slowdownGrowthFactor` for each cycle after that.
// When the next cycle's slow turn would take longer than
// `maxSlowTurnDurationMs`, the spinner repeats the current cycle forever.
export type LoadingSpinCycle = {
    fastTurns: number
    slowTurnDurationFactor: number
    firstSlowdownMs: number
    slowdownGrowthFactor: number
    maxSlowTurnDurationMs: number
}

export type LoadingSpinPlan = {
    // Every turn of the cycles that play once, getting slower each cycle.
    slowingTurnDurationsMs: number[]
    // The turns of the final cycle, which loops until loading ends.
    repeatingTurnDurationsMs: number[]
}

// A growth factor below one shrinks the slowdown, so the slow turn could
// approach the limit forever. The slowing cycles stop at this count anyway.
const MAX_SLOWING_CYCLES = 64

// Every turn is cut into a few cubic Bezier segments that follow the turn
// easing. Browsers run cubic Bezier keyframes on the compositor, so the
// spinner keeps turning while the main thread renders the loaded content.
const SEGMENTS_PER_TURN = 4

const createCycle = (
    fastTurnDurationMs: number,
    cycle: LoadingSpinCycle,
): number[] => [
    ...Array.from(
        { length: Math.max(
            0,
            Math.round(cycle.fastTurns),
        ) },
        () => fastTurnDurationMs,
    ),
    fastTurnDurationMs * cycle.slowTurnDurationFactor,
]

export const planLoadingSpin = (
    firstFastTurnDurationMs: number,
    cycle: LoadingSpinCycle,
): LoadingSpinPlan => {
    const slowingTurnDurationsMs: number[] = []
    let fastTurnDurationMs = firstFastTurnDurationMs
    let slowdownMs = cycle.firstSlowdownMs

    if (slowdownMs <= 0)
        return {
            slowingTurnDurationsMs,
            repeatingTurnDurationsMs: createCycle(fastTurnDurationMs, cycle),
        }

    for (let index = 0; index < MAX_SLOWING_CYCLES; index++) {
        const nextFastTurnDurationMs = fastTurnDurationMs + slowdownMs

        if (nextFastTurnDurationMs * cycle.slowTurnDurationFactor > cycle.maxSlowTurnDurationMs)
            break

        slowingTurnDurationsMs.push(...createCycle(fastTurnDurationMs, cycle))
        fastTurnDurationMs = nextFastTurnDurationMs
        slowdownMs *= cycle.slowdownGrowthFactor
    }

    return {
        slowingTurnDurationsMs,
        repeatingTurnDurationsMs: createCycle(fastTurnDurationMs, cycle),
    }
}

const formatNumber = (value: number): string => String(
    Number(
        value.toFixed(5),
    ),
)

const slopeAt = (
    ease: (progress: number) => number,
    progress: number,
): number => {
    const step = 1e-4
    const start = Math.max(0, progress - step)
    const end = Math.min(1, progress + step)

    return (ease(end) - ease(start)) / (end - start)
}

// Hermite segment between two eased points. Its control points sit at a third
// of the segment in time, so the curve leaves and arrives with the easing's
// own speed.
const segmentEasing = (
    ease: (progress: number) => number,
    from: number,
    to: number,
): string => {
    const rise = ease(to) - ease(from)

    if (rise <= 0)
        return 'linear'

    const scale = (to - from) / rise
    const startSlope = slopeAt(ease, from) * scale
    const endSlope = slopeAt(ease, to) * scale

    return `cubic-bezier(${formatNumber(1 / 3)}, ${formatNumber(startSlope / 3)}, ${formatNumber(2 / 3)}, ${formatNumber(1 - endSlope / 3)})`
}

export const createLoadingSpinKeyframes = (
    turnDurationsMs: number[],
    ease: (progress: number) => number = Easing.travelingOutlineTransition,
): Keyframe[] => {
    const totalMs = turnDurationsMs.reduce((total, duration) => total + duration, 0)
    const keyframes: Keyframe[] = []
    let startMs = 0

    for (const [turn, durationMs] of turnDurationsMs.entries()) {
        for (let segment = 0; segment < SEGMENTS_PER_TURN; segment++) {
            const from = segment / SEGMENTS_PER_TURN
            const to = (segment + 1) / SEGMENTS_PER_TURN
            keyframes.push({
                offset: totalMs > 0 ? (startMs + durationMs * from) / totalMs : 0,
                transform: `rotate(${formatNumber(turn + ease(from))}turn)`,
                easing: segmentEasing(
                    ease,
                    from,
                    to,
                ),
            })
        }

        startMs += durationMs
    }

    keyframes.push({
        offset: 1,
        transform: `rotate(${turnDurationsMs.length}turn)`,
    })

    return keyframes
}
