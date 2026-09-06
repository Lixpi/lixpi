// The single source of truth for motion timing across the whole ui-kit.
//
// The curves are the JS side of the ones declared in
// `@lixpi/ui-primitives/styles/transitions`. Anything that animates
// from code — d3 transitions, the Web Animations API, requestAnimationFrame
// loops, PIXI tweens, canvas chrome, SVG icons — needs an easing *function*
// rather than a CSS `cubic-bezier()` string, so the same control points are
// solved here. Consumers that hand timing back to CSS (inline styles, WAAPI
// options, generated keyframes) should use `TRANSITION_EASING_CSS` so both
// sides of a component stay on the identical curve.
//
// Never redeclare a curve locally in a component. Add it here.

export type EasingFunction = (t: number) => number

const NEWTON_ITERATIONS = 6
const NEWTON_MIN_SLOPE = 0.001
const SUBDIVISION_EPSILON = 0.0000001
const SUBDIVISION_ITERATIONS = 12

// Cubic polynomial coefficients for a unit cubic bezier with p0 = 0 and p3 = 1.
const coefficientA = (
    a1: number,
    a2: number,
): number => 1 - 3 * a2 + 3 * a1

const coefficientB = (
    a1: number,
    a2: number,
): number => 3 * a2 - 6 * a1

const coefficientC = (a1: number): number => 3 * a1

const bezierValue = (
    t: number,
    a1: number,
    a2: number,
): number => ((coefficientA(a1, a2) * t + coefficientB(a1, a2)) * t + coefficientC(a1)) * t

const bezierSlope = (
    t: number,
    a1: number,
    a2: number,
): number => 3 * coefficientA(a1, a2) * t * t + 2 * coefficientB(a1, a2) * t + coefficientC(a1)

const solveParameterByBisection = (
    x: number,
    x1: number,
    x2: number,
): number => {
    let lower = 0
    let upper = 1
    let guess = x

    for (let iteration = 0; iteration < SUBDIVISION_ITERATIONS; iteration += 1) {
        guess = (lower + upper) / 2
        const currentX = bezierValue(
            guess,
            x1,
            x2,
        ) - x

        if (Math.abs(currentX) < SUBDIVISION_EPSILON)
            return guess

        if (currentX > 0)
            upper = guess
        else
            lower = guess
    }

    return guess
}

const solveParameterForX = (
    x: number,
    x1: number,
    x2: number,
): number => {
    let guess = x

    for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration += 1) {
        const slope = bezierSlope(
            guess,
            x1,
            x2,
        )

        if (Math.abs(slope) < NEWTON_MIN_SLOPE)
            return solveParameterByBisection(
                x,
                x1,
                x2,
            )

        guess -= (bezierValue(
            guess,
            x1,
            x2,
        ) - x) / slope
    }

    return guess
}

// Builds the JS equivalent of the CSS `cubic-bezier(x1, y1, x2, y2)` timing function.
export const cubicBezierEasing = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): EasingFunction => {
    if (
        x1 === y1
        && x2 === y2
    )
        return (t: number) => t

    return (t: number): number => {
        if (t <= 0)
            return 0

        if (t >= 1)
            return 1

        return bezierValue(
            solveParameterForX(
                t,
                x1,
                x2,
            ),
            y1,
            y2,
        )
    }
}

export type CubicBezierControlPoints = readonly [number, number, number, number]

// Control points shared with `_transitions.scss`. Keep both files in step:
// - `pupOut` — `pupOutTransition()`, an overshoot-free snap that settles late.
// - `hover` — `hoverTransition()`, the default hover / affordance curve.
// - `clickToggleFeedback` — `clickToggleFeedbackAnimation()`, symmetric in/out.
export const TRANSITION_EASING_CONTROL_POINTS = {
    pupOut: [0.319, 1, 0.01, 1],
    hover: [0.19, 1, 0.22, 1],
    clickToggleFeedback: [0.85, 0, 0.15, 1],
} as const satisfies Record<string, CubicBezierControlPoints>

export type TransitionEasingName = keyof typeof TRANSITION_EASING_CONTROL_POINTS

export const cubicBezierCss = (points: CubicBezierControlPoints): string => `cubic-bezier(${points.join(', ')})`

const mapEasings = <Value>(map: (points: CubicBezierControlPoints) => Value): Record<TransitionEasingName, Value> => {
    return Object.fromEntries(
        Object.entries(TRANSITION_EASING_CONTROL_POINTS).map(([name, points]) => [name, map(points)]),
    ) as Record<TransitionEasingName, Value>
}

// Easing functions for code-driven animation (d3, rAF, WAAPI polyfills, PIXI).
export const TRANSITION_EASINGS: Record<TransitionEasingName, EasingFunction> = mapEasings(points => cubicBezierEasing(...points))

// The same curves as CSS timing-function strings, for inline styles, WAAPI
// options and generated keyframes.
export const TRANSITION_EASING_CSS: Record<TransitionEasingName, string> = mapEasings(cubicBezierCss)

export const easePupOut = TRANSITION_EASINGS.pupOut
export const easeHover = TRANSITION_EASINGS.hover
export const easeClickToggleFeedback = TRANSITION_EASINGS.clickToggleFeedback

// Mirrors `$defaultHoverTransitionDuration` from `_transitions.scss`.
export const DEFAULT_HOVER_TRANSITION_DURATION_MS = 150

// Reverses an easing curve, for the return leg of a two-way transition.
export const reverseEasing = (easing: EasingFunction): EasingFunction => (t: number) => 1 - easing(1 - t)

// Runs an easing curve out and back within a single 0→1 pass, for pulses,
// pinches and other symmetric feedback.
export const pingPongEasing = (easing: EasingFunction): EasingFunction => (t: number) => easing(1 - Math.abs(t * 2 - 1))
