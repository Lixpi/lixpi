import 'd3-transition'

import { select, type Selection } from 'd3-selection'
import { html } from '../../dom/domTemplates.ts'

export type ProgressRippleIconConfig = {
    color?: string
    className?: string
}

export type ProgressRippleIconInstance = {
    readonly element: HTMLElement
    syncActive: () => void
    reset: () => void
    destroy: () => void
}

const PROGRESS_LINE_STEP_CIRCLE_PATHS = [
    'm432 240c0 106.039062-85.960938 192-192 192s-192-85.960938-192-192 85.960938-192 192-192 192 85.960938 192 192zm0 0',
    'm240 480c-132.546875 0-240-107.453125-240-240s107.453125-240 240-240 240 107.453125 240 240c-.148438 132.484375-107.515625 239.851562-240 240zm0-464c-123.710938 0-224 100.289062-224 224s100.289062 224 224 224 224-100.289062 224-224c-.140625-123.652344-100.347656-223.859375-224-224zm0 0',
    'm352 240c0 61.855469-50.144531 112-112 112s-112-50.144531-112-112 50.144531-112 112-112 112 50.144531 112 112zm0 0',
] as const

const DEFAULT_COLOR = '#cbbfff'
const CYCLE_MS = 1400
const OUTER_DELAY_MS = 220
const MIDDLE_DURATION_MS = 1280
const OUTER_DURATION_MS = 1600

type RippleSvg = Selection<SVGSVGElement, unknown, null, undefined>

function tintHex(color: string, whiteMix = 0.68): string {
    const match = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/iu)
    if (!match) return '#cfd2fc'

    const channels = match.slice(1).map(value => Number.parseInt(value, 16))
    const tinted = channels.map(channel => Math.round(channel + (255 - channel) * whiteMix))

    return `#${tinted.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

function centeredLayerScale(scale: number): string {
    return `translate(240 240) scale(${scale}) translate(-240 -240)`
}

function rippleEase(t: number): number {
    if (t <= 0.18) return 0.42 * Math.pow(t / 0.18, 1.35)

    return 0.42 + 0.58 * (1 - Math.pow(1 - (t - 0.18) / 0.82, 2.45))
}

class ProgressRippleIcon implements ProgressRippleIconInstance {
    readonly element: HTMLElement

    private readonly svg: RippleSvg
    private readonly outerTimeoutIds = new Set<number>()
    private cycleTimeoutId: number | undefined
    private destroyed = false

    constructor(config: ProgressRippleIconConfig) {
        const color = config.color ?? DEFAULT_COLOR
        this.element = html`
            <span
                className=${`progress-ripple-icon${config.className ? ` ${config.className}` : ''}`}
                aria-hidden="true"
            ></span>
        ` as HTMLSpanElement
        this.svg = select<HTMLElement, unknown>(this.element)
            .append<SVGSVGElement>('svg')
            .attr('class', 'progress-ripple-icon-svg')
            .attr('viewBox', '0 0 480 480')
            .attr('focusable', 'false')

        const layers = [
            {
                path: PROGRESS_LINE_STEP_CIRCLE_PATHS[0],
                className: 'marker-middle marker-animated-layer',
                fill: tintHex(color),
            },
            {
                path: PROGRESS_LINE_STEP_CIRCLE_PATHS[1],
                className: 'marker-outer marker-animated-layer',
                fill: color,
            },
            {
                path: PROGRESS_LINE_STEP_CIRCLE_PATHS[2],
                className: 'marker-center',
                fill: color,
            },
        ] as const
        layers.forEach(layer => {
            this.svg.append('g')
                .attr('class', layer.className)
                .append('path')
                .attr('d', layer.path)
                .attr('fill', layer.fill)
        })
        this.syncActive()
    }

    syncActive(): void {
        if (this.destroyed) return
        this.clearCycleTimeout()
        this.clearOuterTimeouts()
        this.runCycle()
        this.scheduleNextCycle()
    }

    reset(): void {
        this.clearCycleTimeout()
        this.clearOuterTimeouts()
        this.resetLayers('g.marker-animated-layer')
    }

    destroy(): void {
        if (this.destroyed) return
        this.reset()
        this.destroyed = true
        this.element.remove()
    }

    private resetLayers(selector: string): void {
        this.svg.selectAll<SVGGElement, unknown>(selector)
            .interrupt('progress-marker-middle')
            .interrupt('progress-marker-outer')
            .attr('opacity', 1)
            .attr('transform', centeredLayerScale(1))
    }

    private runCycle(): void {
        const middleLayers = this.svg.selectAll<SVGGElement, unknown>('g.marker-middle')
        if (!middleLayers.size()) return

        middleLayers
            .interrupt('progress-marker-middle')
            .attr('opacity', 1)
            .attr('transform', centeredLayerScale(1))
            .transition('progress-marker-middle')
            .duration(MIDDLE_DURATION_MS)
            .ease(rippleEase)
            .attr('opacity', 0)
            .attr('transform', centeredLayerScale(1.72))
            .on('end', function(this: SVGGElement) {
                select(this)
                    .attr('opacity', 0)
                    .attr('transform', centeredLayerScale(1.72))
            })

        const outerTimeoutId = window.setTimeout(() => {
            this.outerTimeoutIds.delete(outerTimeoutId)
            this.svg.selectAll<SVGGElement, unknown>('g.marker-outer')
                .interrupt('progress-marker-outer')
                .attr('opacity', 1)
                .attr('transform', centeredLayerScale(1))
                .transition('progress-marker-outer')
                .duration(OUTER_DURATION_MS)
                .ease(rippleEase)
                .attr('opacity', 0)
                .attr('transform', centeredLayerScale(2.05))
                .on('end', function(this: SVGGElement) {
                    select(this)
                        .attr('opacity', 0)
                        .attr('transform', centeredLayerScale(2.05))
                })
        }, OUTER_DELAY_MS)

        this.outerTimeoutIds.add(outerTimeoutId)
    }

    private scheduleNextCycle(): void {
        this.clearCycleTimeout()
        this.cycleTimeoutId = window.setTimeout(() => {
            this.cycleTimeoutId = undefined
            this.runCycle()
            this.scheduleNextCycle()
        }, CYCLE_MS)
    }

    private clearCycleTimeout(): void {
        if (this.cycleTimeoutId === undefined) return
        window.clearTimeout(this.cycleTimeoutId)
        this.cycleTimeoutId = undefined
    }

    private clearOuterTimeouts(): void {
        this.outerTimeoutIds.forEach(timeoutId => window.clearTimeout(timeoutId))
        this.outerTimeoutIds.clear()
    }
}

export function createProgressRippleIcon(
    config: ProgressRippleIconConfig = {},
): ProgressRippleIconInstance {
    return new ProgressRippleIcon(config)
}
