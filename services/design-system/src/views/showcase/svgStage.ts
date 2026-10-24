// D3 SVG controls render into a caller-owned SVG. A stage is the HTML host plus
// that root SVG, sized for the control it carries.

import {
    select,
    type Selection,
} from 'd3-selection'
import { html } from '@lixpi/ui-primitives/dom'

export type SvgStageSelection = Selection<SVGSVGElement, unknown, null, undefined>

export type SvgStageConfig = {
    height: number
    width: number
}

export type SvgStage = {
    host: HTMLDivElement
    svg: SvgStageSelection
}

export const createSvgStage = (config: SvgStageConfig): SvgStage => {
    const host = html`<div className="design-system-svg-stage"></div>` as HTMLDivElement
    const svg = select(host)
        .append('svg')
        .attr('class', 'design-system-svg-stage-root')
        .attr('width', config.width)
        .attr('height', config.height)
        .attr('viewBox', `0 0 ${config.width} ${config.height}`)

    return {
        host,
        svg,
    }
}
