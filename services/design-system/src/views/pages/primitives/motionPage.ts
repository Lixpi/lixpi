// Shared timing from @lixpi/ui-primitives/animation: the cubic-bezier curves
// that mirror the Sass transition helpers, and the curves used by canvas
// effects. Each curve is plotted and drives a short D3 transition on demand.

import 'd3-transition'
import {
    type Selection,
} from 'd3-selection'
import {
    DEFAULT_HOVER_TRANSITION_DURATION_MS,
    Easing,
    TRANSITION_EASING_CONTROL_POINTS,
    TRANSITION_EASING_CSS,
    TRANSITION_EASINGS,
    cubicBezierCss,
    cubicBezierEasing,
    easeClickToggleFeedback,
    easeHover,
    easePupOut,
    pingPongEasing,
    reverseEasing,
    type EasingFunction,
} from '@lixpi/ui-primitives/animation'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaCode } from '@lixpi/ui-kit-gentelella/components/foundation'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import {
    createSvgStage,
    type SvgStageSelection,
} from '$src/views/showcase/svgStage.ts'

const PLOT_WIDTH = 180
const PLOT_HEIGHT = 120
const PLOT_PADDING = 12
const PLOT_SAMPLES = 64
const CURVE_COLOR = '#3d649c'
const AXIS_COLOR = '#c8ced6'
const RUN_DURATION_MS = 900

type EasingSample = {
    easing: EasingFunction
    label: string
}

class EasingPlot {
    readonly element: HTMLElement

    private readonly svg: SvgStageSelection
    private readonly marker: Selection<SVGCircleElement, unknown, null, undefined>

    constructor(private readonly sample: EasingSample) {
        const stage = createSvgStage({
            height: PLOT_HEIGHT,
            width: PLOT_WIDTH,
        })
        this.svg = stage.svg
        const innerWidth = PLOT_WIDTH - PLOT_PADDING * 2
        const innerHeight = PLOT_HEIGHT - PLOT_PADDING * 2
        const toX = (t: number): number => PLOT_PADDING + t * innerWidth
        const toY = (value: number): number => PLOT_PADDING + (1 - value) * innerHeight
        const path = Array.from(
            { length: PLOT_SAMPLES + 1 },
            (_, index) => {
                const t = index / PLOT_SAMPLES

                return `${index === 0 ? 'M' : 'L'}${toX(t).toFixed(2)} ${toY(
                    sample.easing(t),
                ).toFixed(2)}`
            },
        ).join(' ')

        this.svg
            .append('rect')
            .attr('x', PLOT_PADDING)
            .attr('y', PLOT_PADDING)
            .attr('width', innerWidth)
            .attr('height', innerHeight)
            .attr('fill', 'none')
            .attr('stroke', AXIS_COLOR)
            .attr('stroke-dasharray', '3 3')
        this.svg
            .append('path')
            .attr('d', path)
            .attr('fill', 'none')
            .attr('stroke', CURVE_COLOR)
            .attr('stroke-width', 2)
        this.marker = this.svg
            .append('circle')
            .attr(
                'cx',
                toX(0),
            )
            .attr('cy', PLOT_HEIGHT - 4)
            .attr('r', 4)
            .attr('fill', CURVE_COLOR)
        this.element = createShowcaseSpecimen({
            content: stage.host,
            label: sample.label,
        })
    }

    run(): void {
        this.marker
            .interrupt()
            .attr('cx', PLOT_PADDING)
            .transition()
            .duration(RUN_DURATION_MS)
            .ease(this.sample.easing)
            .attr('cx', PLOT_WIDTH - PLOT_PADDING)
    }

    destroy(): void {
        this.marker.interrupt()
        this.svg.remove()
    }
}

export const createMotionPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-primitives/animation',
        title: 'Motion and easing',
        description: 'Code-driven animation in D3, canvas effects and WAAPI uses these functions. Sass transitions use the same control points through @lixpi/ui-primitives/styles/transitions.',
    })
    const plots = (samples: EasingSample[]): EasingPlot[] => samples.map(
        sample => page.own(
            new EasingPlot(sample),
        ),
    )
    const runAll = (items: EasingPlot[]): HTMLElement =>
        page.own(
            createGentelellaButton({
                label: 'Play transitions',
                onClick: () => items.forEach(item => item.run()),
                variant: 'primary',
            }),
        ).el

    const transitionPlots = plots([
        {
            easing: easePupOut,
            label: `easePupOut · ${TRANSITION_EASING_CSS.pupOut}`,
        },
        {
            easing: easeHover,
            label: `easeHover · ${TRANSITION_EASING_CSS.hover}`,
        },
        {
            easing: easeClickToggleFeedback,
            label: `easeClickToggleFeedback · ${TRANSITION_EASING_CSS.clickToggleFeedback}`,
        },
    ])
    page.addSection({
        title: 'Transition curves',
        description: `TRANSITION_EASINGS holds the three curves shared with _transitions.scss. Hover transitions default to ${DEFAULT_HOVER_TRANSITION_DURATION_MS} ms.`,
        columns: 3,
        content: transitionPlots.map(plot => plot.element),
    })
    page.el.append(
        runAll(transitionPlots),
    )

    const effectPlots = plots([
        {
            easing: Easing.hoverTransition,
            label: 'Easing.hoverTransition',
        },
        {
            easing: Easing.shiftingGradientTransition,
            label: 'Easing.shiftingGradientTransition',
        },
        {
            easing: Easing.travelingOutlineTransition,
            label: 'Easing.travelingOutlineTransition',
        },
    ])
    page.addSection({
        title: 'Canvas and gradient curves',
        description: 'The Easing class evaluates curves for canvas work: hover affordances, gradient phase changes and the lap-safe traveling outline.',
        columns: 3,
        content: effectPlots.map(plot => plot.element),
    })
    page.el.append(
        runAll(effectPlots),
    )

    const derivedPlots = plots([
        {
            easing: reverseEasing(TRANSITION_EASINGS.hover),
            label: 'reverseEasing(hover)',
        },
        {
            easing: pingPongEasing(TRANSITION_EASINGS.pupOut),
            label: 'pingPongEasing(pupOut)',
        },
        {
            easing: cubicBezierEasing(
                0.85,
                0,
                0.15,
                1,
            ),
            label: 'cubicBezierEasing(0.85, 0, 0.15, 1)',
        },
        {
            easing: progress => Easing.cubicBezierAtTime(
                0.33,
                0,
                0,
                1,
                progress,
            ),
            label: 'Easing.cubicBezierAtTime(0.33, 0, 0, 1)',
        },
    ])
    page.addSection({
        title: 'Derived curves',
        description: 'Helpers build return legs, symmetric pulses and arbitrary CSS-equivalent curves.',
        columns: 4,
        content: derivedPlots.map(plot => plot.element),
    })
    page.el.append(
        runAll(derivedPlots),
    )

    const controlPoints = Object.entries(TRANSITION_EASING_CONTROL_POINTS).map(([name, points]) => `${name}: ${cubicBezierCss(points)}`)
        .join('\n')
    page.addSection({
        title: 'Control points',
        description: 'TRANSITION_EASING_CONTROL_POINTS rendered through cubicBezierCss.',
        content: page.own(
            createGentelellaCode({ code: controlPoints }),
        ).el,
    })

    return page
}
