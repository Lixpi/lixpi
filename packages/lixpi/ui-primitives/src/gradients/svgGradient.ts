import { Easing } from '../animation/index.ts'

type SvgGradientSelection = any

export type SvgGradientAnimation = {
    stop: () => void
}

type SvgGradientPoint = {
    x: number
    y: number
}

export class SvgGradientRenderer {
    static appendLinearGradientStops(
        gradient: SvgGradientSelection,
        colors: ReadonlyArray<string>,
        options: { idPrefix?: string } = {},
    ): void {
        const offsetDenominator = Math.max(colors.length - 1, 1)

        colors.forEach((color, index) => {
            const stop = gradient.append('stop')
                .attr('offset', `${index / offsetDenominator * 100}%`)
                .style('stop-color', color)

            if (options.idPrefix)
                stop.attr('id', `${options.idPrefix}-${index}`)
        })
    }

    static appendRepeatingLinearGradientStops(
        gradient: SvgGradientSelection,
        colors: ReadonlyArray<string>,
        repeats = 2,
    ): void {
        if (colors.length === 0)
            return

        const loopedColors = [...colors, colors[0]]
        const stopCount = repeats * loopedColors.length

        for (let i = 0; i <= stopCount; i++) {
            gradient.append('stop')
                .attr('offset', `${i / stopCount * 100}%`)
                .style('stop-color', loopedColors[i % loopedColors.length])
        }
    }

    static startRotatingLinearGradient(
        gradient: SvgGradientSelection,
        options: {
            center: SvgGradientPoint
            radius: number
            duration: number
            angleStep?: number
            ease?: (progress: number) => number
        },
    ): SvgGradientAnimation {
        const {
            center,
            radius,
            duration,
            angleStep = -0.1,
            ease = Easing.hoverTransition,
        } = options
        let running = true
        let angle = 0

        const animate = () => {
            if (!running)
                return

            const x1 = center.x + radius * Math.cos(angle)
            const y1 = center.y + radius * Math.sin(angle)
            const x2 = center.x + radius * Math.cos(angle + Math.PI)
            const y2 = center.y + radius * Math.sin(angle + Math.PI)

            gradient
                .transition()
                .duration(duration)
                .ease(ease)
                .attr('x1', x1)
                .attr('y1', y1)
                .attr('x2', x2)
                .attr('y2', y2)
                .on('end', () => {
                    angle += angleStep

                    if (running)
                        animate()
                })
        }

        animate()

        return {
            stop: () => {
                running = false
                gradient.interrupt()
            },
        }
    }
}
