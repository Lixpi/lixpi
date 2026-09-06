import 'd3-transition'

import {
    select,
    type Selection,
} from 'd3-selection'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

export type ProgressRippleArtwork = {
    viewBox: {
        x: number
        y: number
        width: number
        height: number
    }
    paths: readonly [string, string, string]
}

export type ProgressRippleIconConfig = {
    artwork: ProgressRippleArtwork
    document?: Document
    color?: string
    className?: string
}

export type ProgressRippleIconInstance = {
    readonly element: HTMLElement
    syncActive: () => void
    reset: () => void
    destroy: () => void
}

const DEFAULT_COLOR = '#cbbfff'
const CYCLE_MS = 1400
const OUTER_DELAY_MS = 220
const MIDDLE_DURATION_MS = 1280
const OUTER_DURATION_MS = 1600

type RippleSvg = Selection<SVGSVGElement, unknown, null, undefined>

const tintHex = (
    color: string,
    whiteMix = 0.68,
): string => {
    const match = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/iu)

    if (!match)
        return '#cfd2fc'

    const channels = match.slice(1).map(value => Number.parseInt(value, 16))
    const tinted = channels.map(channel => Math.round(channel + (255 - channel) * whiteMix))

    return `#${tinted.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

const centeredLayerScale = (
    scale: number,
    artwork: ProgressRippleArtwork,
): string => {
    const {
        x,
        y,
        width,
        height,
    } = artwork.viewBox
    const cx = x + width / 2
    const cy = y + height / 2

    return `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`
}

const rippleEase = (t: number): number => {
    if (t <= 0.18)
        return 0.42 * Math.pow(t / 0.18, 1.35)

    return 0.42 + 0.58 * (1 - Math.pow(1 - (t - 0.18) / 0.82, 2.45))
}

class ProgressRippleIcon implements ProgressRippleIconInstance {
    readonly element: HTMLElement

    private readonly svg: RippleSvg
    private readonly outerTimeoutIds = new Set<number>()
    private cycleTimeoutId: number | undefined
    private destroyed = false

    constructor(private readonly config: ProgressRippleIconConfig) {
        const html = createDocumentHtml(config.document ?? document)
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
            .attr(
                'viewBox',
                [config.artwork.viewBox.x, config.artwork.viewBox.y, config.artwork.viewBox.width, config.artwork.viewBox.height].join(' '),
            )
            .attr('focusable', 'false')

        const layers = [
            {
                path: config.artwork.paths[0],
                className: 'marker-middle marker-animated-layer',
                fill: tintHex(color),
            },
            {
                path: config.artwork.paths[1],
                className: 'marker-outer marker-animated-layer',
                fill: color,
            },
            {
                path: config.artwork.paths[2],
                className: 'marker-center',
                fill: color,
            },
        ] as const
        layers.forEach(layer => {
            this.svg
                .append('g')
                .attr('class', layer.className)
                .append('path')
                .attr('d', layer.path)
                .attr('fill', layer.fill)
        })
        this.syncActive()
    }

    syncActive(): void {
        if (this.destroyed)
            return

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
        if (this.destroyed)
            return

        this.reset()
        this.destroyed = true
        this.element.remove()
    }

    private resetLayers(selector: string): void {
        const artwork = this.config.artwork
        this.svg
            .selectAll<SVGGElement, unknown>(selector)
            .interrupt('progress-marker-middle')
            .interrupt('progress-marker-outer')
            .attr('opacity', 1)
            .attr(
                'transform',
                centeredLayerScale(1, artwork),
            )
    }

    private runCycle(): void {
        const artwork = this.config.artwork
        const middleLayers = this.svg.selectAll<SVGGElement, unknown>('g.marker-middle')

        if (!middleLayers.size())
            return

        middleLayers
            .interrupt('progress-marker-middle')
            .attr('opacity', 1)
            .attr(
                'transform',
                centeredLayerScale(1, artwork),
            )
            .transition('progress-marker-middle')
            .duration(MIDDLE_DURATION_MS)
            .ease(rippleEase)
            .attr('opacity', 0)
            .attr(
                'transform',
                centeredLayerScale(1.72, artwork),
            )
            .on('end', function(this: SVGGElement) {
                select(this)
                    .attr('opacity', 0)
                    .attr(
                        'transform',
                        centeredLayerScale(1.72, artwork),
                    )
            })

        const outerTimeoutId = window.setTimeout(
            () => {
                this.outerTimeoutIds.delete(outerTimeoutId)
                this.svg
                    .selectAll<SVGGElement, unknown>('g.marker-outer')
                    .interrupt('progress-marker-outer')
                    .attr('opacity', 1)
                    .attr(
                        'transform',
                        centeredLayerScale(1, artwork),
                    )
                    .transition('progress-marker-outer')
                    .duration(OUTER_DURATION_MS)
                    .ease(rippleEase)
                    .attr('opacity', 0)
                    .attr(
                        'transform',
                        centeredLayerScale(2.05, artwork),
                    )
                    .on('end', function(this: SVGGElement) {
                        select(this)
                            .attr('opacity', 0)
                            .attr(
                                'transform',
                                centeredLayerScale(2.05, artwork),
                            )
                    })
            },
            OUTER_DELAY_MS,
        )

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
        if (this.cycleTimeoutId === undefined)
            return

        window.clearTimeout(this.cycleTimeoutId)
        this.cycleTimeoutId = undefined
    }

    private clearOuterTimeouts(): void {
        this.outerTimeoutIds.forEach(timeoutId => window.clearTimeout(timeoutId))
        this.outerTimeoutIds.clear()
    }
}

export const createProgressRippleIcon = (config: ProgressRippleIconConfig): ProgressRippleIconInstance => new ProgressRippleIcon(config)
