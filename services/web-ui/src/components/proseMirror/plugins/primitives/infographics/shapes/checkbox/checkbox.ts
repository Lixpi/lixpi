// Checkbox SVG primitive - renders interactive checkboxes as SVG elements
// Emits events on state changes for parent to handle

// @ts-ignore - runtime import
import { select } from 'd3-selection'
// @ts-ignore - runtime import
import { easeCubicOut, easeCubicIn } from 'd3-ease'
import { ENTRANCE_ANIMATION_DURATION } from '../../animationConstants.ts'

type CheckboxConfig = {
    id: string
    x: number
    y: number
    size?: number
    checked?: boolean
    disabled?: boolean
    className?: string
    onChange?: (checked: boolean, id: string) => void
}

type CheckboxState = {
    checked: boolean
    disabled: boolean
}

type CheckboxInstance = {
    render: () => void
    setChecked: (checked: boolean) => void
    setDisabled: (disabled: boolean) => void
    getChecked: () => boolean
    destroy: () => void
}

// SVG path for checkmark icon (scaled for 24x24 viewport)
const CHECKMARK_PATH = 'M20 6L9 17l-5-5'

// Render a checkbox as SVG group
export function createCheckbox(
    parent: any,
    config: CheckboxConfig
): CheckboxInstance {
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

    let state: CheckboxState = {
        checked,
        disabled
    }

    // Create checkbox group - start invisible and off-screen
    const checkboxGroup = parent.append('g')
        .attr('class', `checkbox-group ${className}`)
        .attr('transform', `translate(${x - 30}, ${y})`)  // Start 30px left
        .attr('data-checkbox-id', id)
        .style('cursor', disabled ? 'not-allowed' : 'pointer')
        .style('opacity', 0)  // Start invisible

    // Outer square/circle container
    const box = checkboxGroup.append('rect')
        .attr('class', 'checkbox-box')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', size)
        .attr('height', size)
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('fill', 'rgba(19, 26, 41, 0.88)')
        .attr('stroke', state.checked ? 'rgba(96, 165, 250, 0.95)' : 'rgba(255, 255, 255, 0.18)')
        .attr('stroke-width', state.checked ? 2 : 1.25)

    // Checkmark path (visible when checked)
    const checkmark = checkboxGroup.append('path')
        .attr('class', 'checkbox-checkmark')
        .attr('d', CHECKMARK_PATH)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(96, 165, 250, 0.95)')
        .attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('opacity', state.checked ? 1 : 0)
        .attr('transform', `translate(${size * 0.08}, ${size * 0.08}) scale(${size / 24})`)

    // Animate checkbox into view with entrance transition
    checkboxGroup
        .transition()
        .duration(ENTRANCE_ANIMATION_DURATION)
        .ease(easeCubicIn)
        .attr('transform', `translate(${x}, ${y})`)  // Slide to final position
        .style('opacity', 1)  // Fade in

    // Hover effect (only if not disabled)
    if (!state.disabled) {
        checkboxGroup
            .on('mouseenter', () => {
                box.attr('stroke', state.checked ? 'rgba(96, 165, 250, 1)' : 'rgba(255, 255, 255, 0.3)')
            })
            .on('mouseleave', () => {
                box.attr('stroke', state.checked ? 'rgba(96, 165, 250, 0.95)' : 'rgba(255, 255, 255, 0.18)')
            })
    }

    // Click handler
    if (!state.disabled && onChange) {
        checkboxGroup.on('click', (event: MouseEvent) => {
            event.stopPropagation()
            const newChecked = !state.checked
            setChecked(newChecked)
            onChange(newChecked, id)
        })
    }

    // Render function to update visual state
    function render() {
        box
            .attr('stroke', state.checked ? 'rgba(96, 165, 250, 0.95)' : 'rgba(255, 255, 255, 0.18)')
            .attr('stroke-width', state.checked ? 2 : 1.25)
            .attr('opacity', state.disabled ? 0.4 : 1)

        checkmark
            .attr('opacity', state.checked ? 1 : 0)
            .attr('stroke', state.disabled ? 'rgba(96, 165, 250, 0.5)' : 'rgba(96, 165, 250, 0.95)')

        checkboxGroup
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
            checkboxGroup.on('click', null)
            checkboxGroup.on('mouseenter', null)
            checkboxGroup.on('mouseleave', null)
        } else if (onChange) {
            checkboxGroup.on('click', (event: MouseEvent) => {
                event.stopPropagation()
                const newChecked = !state.checked
                setChecked(newChecked)
                onChange(newChecked, id)
            })
            checkboxGroup
                .on('mouseenter', () => {
                    box.attr('stroke', state.checked ? 'rgba(96, 165, 250, 1)' : 'rgba(255, 255, 255, 0.3)')
                })
                .on('mouseleave', () => {
                    box.attr('stroke', state.checked ? 'rgba(96, 165, 250, 0.95)' : 'rgba(255, 255, 255, 0.18)')
                })
        }
    }

    function getChecked(): boolean {
        return state.checked
    }

    function destroy() {
        checkboxGroup.remove()
    }

    // Initial render
    render()

    return {
        render,
        setChecked,
        setDisabled,
        getChecked,
        destroy
    }
}
