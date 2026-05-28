// SVG sliding single-select, built with the same approach as `toggleSwitch`:
// it appends an SVG group into a provided d3 parent selection and animates numeric
// attributes. Domain-agnostic — consumers supply the options and the meaning of
// each value. No HTML, no stylesheet.

// Side-effect import: patches the d3-selection prototype so `.transition()` exists.
import 'd3-transition'

// @ts-ignore - runtime import
import { select } from 'd3-selection'
// @ts-ignore - runtime import
import { easeCubicOut } from 'd3-ease'

export type SlidingSwitchOption<Value extends string = string> = {
    label: string
    value: Value
}

type SlidingSwitchConfig<Value extends string = string> = {
    id: string
    x: number
    y: number
    width: number
    height?: number
    options: SlidingSwitchOption<Value>[]
    selectedValue?: Value
    className?: string
    onChange?: (value: Value, id: string) => void
}

type SlidingSwitchInstance<Value extends string = string> = {
    render: () => void
    setValue: (value: Value) => void
    getValue: () => Value
    destroy: () => void
}

const PADDING = 2
const TRANSITION_DURATION = 200

const COLORS = {
    track: 'rgba(105, 115, 133, 0.1)',
    indicator: 'rgba(255, 255, 255, 0.86)',
    optionText: 'rgba(49, 59, 78, 0.68)',
    optionTextActive: '#1a2744',
}

export function createSlidingSwitch<Value extends string = string>(
    parent: any,
    config: SlidingSwitchConfig<Value>
): SlidingSwitchInstance<Value> {
    const { id, x, y, width, height = 26, options, selectedValue, className = '', onChange } = config

    if (options.length === 0) {
        throw new Error('Sliding switch requires at least one option')
    }

    const indexOf = (value: Value): number => options.findIndex((option) => option.value === value)
    let currentValue = selectedValue !== undefined && indexOf(selectedValue) >= 0 ? selectedValue : options[0]!.value

    const trackRadius = height / 2
    const segmentWidth = (width - PADDING * 2) / options.length
    const indicatorHeight = height - PADDING * 2
    const indicatorRadius = indicatorHeight / 2
    const segmentX = (index: number): number => PADDING + index * segmentWidth

    const group = parent.append('g')
        .attr('class', `sliding-switch-group ${className}`)
        .attr('transform', `translate(${x}, ${y})`)
        .attr('data-sliding-switch-id', id)
        .style('cursor', 'pointer')

    group.append('rect')
        .attr('class', 'sliding-switch-track')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', width)
        .attr('height', height)
        .attr('rx', trackRadius)
        .attr('ry', trackRadius)
        .attr('fill', COLORS.track)

    const indicator = group.append('rect')
        .attr('class', 'sliding-switch-indicator')
        .attr('x', segmentX(indexOf(currentValue)))
        .attr('y', PADDING)
        .attr('width', segmentWidth)
        .attr('height', indicatorHeight)
        .attr('rx', indicatorRadius)
        .attr('ry', indicatorRadius)
        .attr('fill', COLORS.indicator)

    const labels = options.map((option, index) => {
        const label = group.append('text')
            .attr('class', 'sliding-switch-option')
            .attr('x', segmentX(index) + segmentWidth / 2)
            .attr('y', height / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-weight', 550)
            .attr('data-value', option.value)
            .attr('fill', option.value === currentValue ? COLORS.optionTextActive : COLORS.optionText)
            .text(option.label)

        group.append('rect')
            .attr('class', 'sliding-switch-hit')
            .attr('x', segmentX(index))
            .attr('y', PADDING)
            .attr('width', segmentWidth)
            .attr('height', indicatorHeight)
            .attr('fill', 'transparent')
            .attr('data-value', option.value)
            .on('click', (event: MouseEvent) => { event.stopPropagation(); applyValue(option.value, true) })
            .on('mouseenter', () => { if (option.value !== currentValue) label.attr('fill', COLORS.optionTextActive) })
            .on('mouseleave', () => { if (option.value !== currentValue) label.attr('fill', COLORS.optionText) })

        return label
    })

    function render(animate: boolean): void {
        const selectedIndex = indexOf(currentValue)

        labels.forEach((label, index) => {
            label.attr('fill', index === selectedIndex ? COLORS.optionTextActive : COLORS.optionText)
        })

        const targetX = segmentX(selectedIndex)
        if (animate) {
            indicator.transition().duration(TRANSITION_DURATION).ease(easeCubicOut).attr('x', targetX)
        } else {
            indicator.attr('x', targetX)
        }
    }

    function applyValue(value: Value, notify: boolean): void {
        if (indexOf(value) < 0) return
        const changed = value !== currentValue
        currentValue = value
        render(changed)
        if (changed && notify) onChange?.(value, id)
    }

    return {
        render: () => render(false),
        setValue: (value: Value) => applyValue(value, false),
        getValue: () => currentValue,
        destroy: () => group.remove(),
    }
}
