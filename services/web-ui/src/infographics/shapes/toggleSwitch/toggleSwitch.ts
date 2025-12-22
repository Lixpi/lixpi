// Toggle switch SVG primitive - renders interactive toggle switches as SVG elements
// Emits events on state changes for parent to handle

// @ts-ignore - runtime import
import { select } from 'd3-selection'
// @ts-ignore - runtime import
import { easeCubicOut, easeCubicIn } from 'd3-ease'
import { ENTRANCE_ANIMATION_DURATION } from '../../animationConstants.ts'
import { checkMarkIcon } from '../../../../../../../svgIcons/index.ts'

type ToggleSwitchConfig = {
    id: string
    x: number
    y: number
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

// Toggle switch dimensions (based on standard toggle proportions)
// Width is ~2x height for proper pill shape
const TOGGLE_HEIGHT_RATIO = 1.0  // Height relative to size
const TOGGLE_WIDTH_RATIO = 1.8   // Width relative to size
const KNOB_SIZE_RATIO = 0.7      // Knob size relative to toggle height
const KNOB_PADDING = 0.15        // Padding around knob (as ratio of toggle height)

// Color constants
const COLORS = {
    active: {
        fill: 'rgba(85, 150, 124, 0.95)',
        fillHover: 'rgba(85, 150, 124, 1)',
        stroke: 'rgba(85, 150, 124, 1)'
    },
    inactive: {
        fill: 'rgba(128, 128, 128, 0.4)',
        fillHover: 'rgba(128, 128, 128, 0.5)',
        stroke: 'rgba(128, 128, 128, 0.6)'
    },
    knob: {
        fill: 'rgba(255, 255, 255, 0.98)',
        stroke: 'rgba(255, 255, 255, 0.2)'
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
    const toggleHeight = size * TOGGLE_HEIGHT_RATIO
    const toggleWidth = size * TOGGLE_WIDTH_RATIO
    const knobSize = toggleHeight * KNOB_SIZE_RATIO
    const knobPadding = toggleHeight * KNOB_PADDING
    const knobRadius = knobSize / 2
    const trackRadius = toggleHeight / 2

    // Knob positions (center Y, X for unchecked and checked states)
    const knobCenterY = toggleHeight / 2
    const knobUncheckedX = trackRadius  // Aligned to left
    const knobCheckedX = toggleWidth - trackRadius  // Aligned to right

    // Create toggle group - start invisible and off-screen
    const toggleGroup = parent.append('g')
        .attr('class', `toggle-switch-group toggle-switch ${className}`)
        .attr('transform', `translate(${x - 30}, ${y})`)  // Start 30px left
        .attr('data-toggle-switch-id', id)
        .style('cursor', disabled ? 'not-allowed' : 'pointer')
        .style('opacity', 0)  // Start invisible

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
    // Parse the SVG icon and extract the path
    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(checkMarkIcon, 'image/svg+xml')
    const pathElement = svgDoc.querySelector('path')
    const checkmarkPath = pathElement ? pathElement.getAttribute('d') : ''

    const checkmarkIconSize = knobSize * 0.6  // Icon is 60% of knob size
    const checkmarkScale = checkmarkIconSize / 24  // checkMarkIcon is 24x24
    const checkmarkOffsetX = (knobSize - checkmarkIconSize) / 2
    const checkmarkOffsetY = (knobSize - checkmarkIconSize) / 2

    const checkmark = toggleGroup.append('g')
        .attr('class', 'toggle-checkmark')
        .attr('opacity', state.checked ? 1 : 0)

    checkmark.append('path')
        .attr('d', checkmarkPath)
        .attr('fill', COLORS.active.fill)
        .attr('transform', `translate(${(state.checked ? knobCheckedX : knobUncheckedX) - knobRadius + checkmarkOffsetX}, ${knobCenterY - knobRadius + checkmarkOffsetY}) scale(${checkmarkScale})`)

    // Animate toggle into view with entrance transition
    toggleGroup
        .transition()
        .duration(ENTRANCE_ANIMATION_DURATION)
        .ease(easeCubicIn)
        .attr('transform', `translate(${x}, ${y})`)  // Slide to final position
        .style('opacity', 1)  // Fade in

    // Hover effect (only if not disabled)
    if (!state.disabled) {
        toggleGroup
            .on('mouseenter', () => {
                track.attr('fill', state.checked ? COLORS.active.fillHover : COLORS.inactive.fillHover)
            })
            .on('mouseleave', () => {
                track.attr('fill', state.checked ? COLORS.active.fill : COLORS.inactive.fill)
            })
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

        checkmark.select('path')
            .transition()
            .duration(duration)
            .ease(easeCubicOut)
            .attr('transform', `translate(${targetX - knobRadius + checkmarkOffsetX}, ${knobCenterY - knobRadius + checkmarkOffsetY}) scale(${checkmarkScale})`)

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
            toggleGroup.on('mouseenter', null)
            toggleGroup.on('mouseleave', null)
        } else if (onChange) {
            toggleGroup.on('click', (event: MouseEvent) => {
                event.stopPropagation()
                const newChecked = !state.checked
                setChecked(newChecked)
                onChange(newChecked, id)
            })
            toggleGroup
                .on('mouseenter', () => {
                    track.attr('fill', state.checked ? COLORS.active.fillHover : COLORS.inactive.fillHover)
                })
                .on('mouseleave', () => {
                    track.attr('fill', state.checked ? COLORS.active.fill : COLORS.inactive.fill)
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
