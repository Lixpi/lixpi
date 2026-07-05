export class Easing {
    private static clampProgress(value: number): number {
        return Math.max(0, Math.min(1, value))
    }

    static cubicBezierAtTime(x1: number, y1: number, x2: number, y2: number, time: number): number {
        const cx = 3 * x1
        const bx = 3 * (x2 - x1) - cx
        const ax = 1 - cx - bx
        const cy = 3 * y1
        const by = 3 * (y2 - y1) - cy
        const ay = 1 - cy - by

        const sampleCurveX = (value: number) => ((ax * value + bx) * value + cx) * value
        const sampleCurveY = (value: number) => ((ay * value + by) * value + cy) * value
        const sampleCurveDerivativeX = (value: number) => (3 * ax * value + 2 * bx) * value + cx

        let progress = Easing.clampProgress(time)
        for (let i = 0; i < 8; i++) {
            const x = sampleCurveX(progress) - time
            const derivative = sampleCurveDerivativeX(progress)
            if (Math.abs(x) < 1e-6 || Math.abs(derivative) < 1e-6) break
            progress -= x / derivative
        }

        return sampleCurveY(Easing.clampProgress(progress))
    }

    // Canvas and PIXI animations cannot consume Sass transition variables directly.
    // This mirrors `$hoverTransition` from `src/sass/_transitions.scss`.
    static hoverTransition(progress: number): number {
        return Easing.cubicBezierAtTime(0.19, 1, 0.22, 1, progress)
    }

    static shiftingGradientTransition(progress: number): number {
        return Easing.cubicBezierAtTime(0.33, 0, 0, 1, progress)
    }

    // A repeating outline needs character without pausing at the lap boundary.
    // This varies speed smoothly between 60% and 140% of linear motion.
    static travelingOutlineTransition(progress: number): number {
        const bounded = Easing.clampProgress(progress)
        const paceVariation = 0.4
        return bounded - paceVariation * Math.sin(2 * Math.PI * bounded) / (2 * Math.PI)
    }
}
