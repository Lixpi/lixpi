// Toggle switch SVG component - renders interactive toggle switches as SVG elements
// Emits events on state changes for parent to handle

// @ts-ignore - runtime import
import { select } from 'd3-selection'
import 'd3-transition'
// @ts-ignore - runtime import
import { easeCubicOut } from 'd3-ease'
import { extractSvgPathIcon } from '$src/components/svgIconPaths.ts'
import { checkMarkIcon } from '$src/svgIcons/index.ts'

type ToggleSwitchConfig = {
    id: string
    x: number
    y: number
    width?: number
    height?: number
    size?: number
    checked?: boolean
    disabled?: boolean
    className?: string
    onChange?: (checked: boolean, id: string) => void
}

type ToggleSwitchState = {
    checked: boolean
    disabled: boolean
}

type ToggleSwitchInstance = {
    render: () => void
    setChecked: (checked: boolean) => void
    setDisabled: (disabled: boolean) => void
    getChecked: () => boolean
    destroy: () => void
}

// Toggle switch dimensions. `height`/`width` are pixels; `size` remains as
// the legacy pixel-height alias for existing callers.
const TOGGLE_WIDTH_RATIO = 1.8
const KNOB_SIZE_RATIO = 0.7      // Knob size relative to toggle height
const KNOB_PADDING = 0.15        // Padding around knob (as ratio of toggle height)

// Color constants
const COLORS = {
    active: {
        fill: '#5f8fcf',
        stroke: '#5f8fcf'
    },
    inactive: {
        fill: '#d6d7d8',
        stroke: '#9ea3a8'
    },
    knob: {
        fill: '#ffffff',
        stroke: '#ffffff'
    }
}

// Render a toggle switch as SVG group
export function createToggleSwitch(
    parent: any,
    config: ToggleSwitchConfig
): ToggleSwitchInstance {
    const {
        id,
        x,
        y,
        width,
        height,
        size = 24,
        checked = false,
        disabled = false,
        className = '',
        onChange
    } = config

    let state: ToggleSwitchState = {
        checked,
        disabled
    }

    // Calculate toggle dimensions
    const toggleHeight = height ?? size
    const toggleWidth = width ?? toggleHeight * TOGGLE_WIDTH_RATIO
    const knobSize = toggleHeight * KNOB_SIZE_RATIO
    const knobPadding = toggleHeight * KNOB_PADDING
    const knobRadius = knobSize / 2
    const trackRadius = toggleHeight / 2

    // Knob positions (center Y, X for unchecked and checked states)
    const knobCenterY = toggleHeight / 2
    const knobUncheckedX = trackRadius  // Aligned to left
    const knobCheckedX = toggleWidth - trackRadius  // Aligned to right

    // Create toggle group visible at its final position. The prompt model menu
    // mounts inside ProseMirror DOM where transition setup can be skipped during
    // hot updates; visibility must not depend on the entrance animation.
    const toggleGroup = parent.append('g')
        .attr('class', `toggle-switch-group toggle-switch ${className}`)
        .attr('transform', `translate(${x}, ${y})`)
        .attr('data-toggle-switch-id', id)
        .style('cursor', disabled ? 'not-allowed' : 'pointer')
        .style('opacity', 1)

    // Track (pill-shaped background)
    const track = toggleGroup.append('rect')
        .attr('class', 'toggle-track')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', toggleWidth)
        .attr('height', toggleHeight)
        .attr('rx', trackRadius)
        .attr('ry', trackRadius)
        .attr('fill', state.checked ? COLORS.active.fill : COLORS.inactive.fill)
        .attr('stroke', state.checked ? COLORS.active.stroke : COLORS.inactive.stroke)
        .attr('stroke-width', 1)

    // Knob (circular slider)
    const knob = toggleGroup.append('circle')
        .attr('class', 'toggle-knob')
        .attr('cx', state.checked ? knobCheckedX : knobUncheckedX)
        .attr('cy', knobCenterY)
        .attr('r', knobRadius)
        .attr('fill', COLORS.knob.fill)
        .attr('stroke', COLORS.knob.stroke)
        .attr('stroke-width', 1)

    // Checkmark icon inside knob (only visible when checked)
    const checkmarkIcon = extractSvgPathIcon(checkMarkIcon)
    const checkmarkIconSize = knobSize * 0.6  // Icon is 60% of knob size
    const checkmarkScale = checkmarkIconSize / Math.max(checkmarkIcon.width, checkmarkIcon.height)
    const checkmarkWidth = checkmarkIcon.width * checkmarkScale
    const checkmarkHeight = checkmarkIcon.height * checkmarkScale
    const checkmarkOffsetX = (knobSize - checkmarkWidth) / 2
    const checkmarkOffsetY = (knobSize - checkmarkHeight) / 2

    function getCheckmarkTransform(targetX: number): string {
        const x = targetX - knobRadius + checkmarkOffsetX
        const y = knobCenterY - knobRadius + checkmarkOffsetY
        return `translate(${x}, ${y}) scale(${checkmarkScale}) translate(${-checkmarkIcon.minX}, ${-checkmarkIcon.minY})`
    }

    const checkmark = toggleGroup.append('g')
        .attr('class', 'toggle-checkmark')
        .attr('opacity', state.checked ? 1 : 0)

    for (const pathData of checkmarkIcon.pathData) {
        checkmark.append('path')
            .attr('d', pathData)
            .attr('fill', COLORS.active.fill)
            .attr('transform', getCheckmarkTransform(state.checked ? knobCheckedX : knobUncheckedX))
    }

    // Click handler
    if (!state.disabled && onChange) {
        toggleGroup.on('click', (event: MouseEvent) => {
            event.stopPropagation()
            const newChecked = !state.checked
            setChecked(newChecked)
            onChange(newChecked, id)
        })
    }

    // Render function to update visual state with smooth transitions
    function render() {
        const duration = 200  // Smooth toggle animation

        // Animate track color
        track
            .transition()
            .duration(duration)
            .ease(easeCubicOut)
            .attr('fill', state.checked ? COLORS.active.fill : COLORS.inactive.fill)
            .attr('stroke', state.checked ? COLORS.active.stroke : COLORS.inactive.stroke)
            .attr('opacity', state.disabled ? 0.4 : 1)        // Animate knob position
        const targetX = state.checked ? knobCheckedX : knobUncheckedX
        knob
            .transition()
            .duration(duration)
            .ease(easeCubicOut)
            .attr('cx', targetX)

        // Animate checkmark opacity and position
        checkmark
            .transition()
            .duration(duration)
            .ease(easeCubicOut)
            .attr('opacity', state.checked ? 1 : 0)

        checkmark.selectAll('path')
            .transition()
            .duration(duration)
            .ease(easeCubicOut)
            .attr('transform', getCheckmarkTransform(targetX))

        toggleGroup
            .style('cursor', state.disabled ? 'not-allowed' : 'pointer')
    }

    // Public API
    function setChecked(checked: boolean) {
        state.checked = checked
        render()
    }

    function setDisabled(disabled: boolean) {
        state.disabled = disabled
        render()

        // Re-attach event handlers if needed
        if (disabled) {
            toggleGroup.on('click', null)
        } else if (onChange) {
            toggleGroup.on('click', (event: MouseEvent) => {
                event.stopPropagation()
                const newChecked = !state.checked
                setChecked(newChecked)
                onChange(newChecked, id)
            })
        }
    }

    function getChecked(): boolean {
        return state.checked
    }

    function destroy() {
        toggleGroup.remove()
    }

    // Initial render (without animation for initial state)
    // The entrance animation will handle the initial appearance

    return {
        render,
        setChecked,
        setDisabled,
        getChecked,
        destroy
    }
}
