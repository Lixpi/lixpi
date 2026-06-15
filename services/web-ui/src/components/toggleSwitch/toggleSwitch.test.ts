import { describe, it, expect, beforeEach, vi } from 'vitest'
import { select, selection } from 'd3-selection'
import { createToggleSwitch } from '$src/components/toggleSwitch/toggleSwitch.ts'

// `toggleSwitch` animates via `selection.transition()`. happy-dom does not implement
// SVGTransformList.consolidate, so a real d3-transition crashes when its timer flushes.
// Stub transitions with a chainable no-op: the component's synchronous state changes
// (checked flips, onChange callbacks) still run; only the cosmetic animation is skipped.
const makeChain = (): any => {
    const chain: any = {}
    for (const method of ['duration', 'ease', 'attr', 'style', 'select', 'delay', 'on', 'remove', 'tween']) {
        chain[method] = () => chain
    }
    return chain
}
;(selection.prototype as any).transition = () => makeChain()

const SVG_NS = 'http://www.w3.org/2000/svg'

function mountToggle(config: Partial<Parameters<typeof createToggleSwitch>[1]> = {}) {
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    document.body.appendChild(svg)
    const onChange = vi.fn()
    const toggle = createToggleSwitch(select(svg), { id: 't1', x: 0, y: 0, onChange, ...config })
    const group = svg.querySelector('.toggle-switch-group') as Element
    return { svg, toggle, onChange, group }
}

const clickGroup = (group: Element) => group.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('createToggleSwitch', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    it('reports its initial checked state', () => {
        expect(mountToggle({ checked: false }).toggle.getChecked()).toBe(false)
        document.body.innerHTML = ''
        expect(mountToggle({ checked: true }).toggle.getChecked()).toBe(true)
    })

    it('renders the switch into the parent SVG selection', () => {
        const { svg } = mountToggle()
        expect(svg.querySelector('.toggle-switch-group')).not.toBeNull()
        expect(svg.querySelector('.toggle-track')).not.toBeNull()
        expect(svg.querySelector('.toggle-knob')).not.toBeNull()
    })

    it('flips state and fires onChange with the new value and id on click', () => {
        const { toggle, onChange, group } = mountToggle({ checked: false })

        clickGroup(group)

        expect(toggle.getChecked()).toBe(true)
        expect(onChange).toHaveBeenCalledExactlyOnceWith(true, 't1')

        clickGroup(group)
        expect(toggle.getChecked()).toBe(false)
        expect(onChange).toHaveBeenLastCalledWith(false, 't1')
    })

    it('setChecked updates state without firing onChange', () => {
        const { toggle, onChange } = mountToggle({ checked: false })

        toggle.setChecked(true)

        expect(toggle.getChecked()).toBe(true)
        expect(onChange).not.toHaveBeenCalled()
    })

    it('does not respond to clicks when created disabled', () => {
        const { toggle, onChange, group } = mountToggle({ checked: false, disabled: true })

        clickGroup(group)

        expect(toggle.getChecked()).toBe(false)
        expect(onChange).not.toHaveBeenCalled()
    })

    it('stops responding to clicks after setDisabled(true)', () => {
        const { toggle, onChange, group } = mountToggle({ checked: false })

        toggle.setDisabled(true)
        clickGroup(group)

        expect(toggle.getChecked()).toBe(false)
        expect(onChange).not.toHaveBeenCalled()
    })

    it('removes its DOM on destroy', () => {
        const { svg, toggle } = mountToggle()
        toggle.destroy()
        expect(svg.querySelector('.toggle-switch-group')).toBeNull()
    })

    it('uses explicit dimensions and passes geometry to SVG attributes', () => {
        const { svg, group } = mountToggle({
            x: 7,
            y: 11,
            width: 40,
            height: 16,
            checked: false,
            className: 'custom-toggle'
        })

        const track = svg.querySelector('.toggle-track') as SVGRectElement
        const knob = svg.querySelector('.toggle-knob') as SVGCircleElement

        expect(track.getAttribute('width')).toBe('40')
        expect(track.getAttribute('height')).toBe('16')
        expect(track.getAttribute('rx')).toBe('8')
        expect(track.getAttribute('fill')).toBe('#d6d7d8')
        expect(knob.getAttribute('r')).toBe('5.6')
        expect(knob.getAttribute('cx')).toBe('8')
        expect(group.getAttribute('transform')).toBe('translate(7, 11)')
        expect(group.getAttribute('class')).toContain('custom-toggle')
    })

    it('derives width from size and starts checked geometry on the right', () => {
        const { svg } = mountToggle({ size: 20, checked: true })

        const track = svg.querySelector('.toggle-track') as SVGRectElement
        const knob = svg.querySelector('.toggle-knob') as SVGCircleElement

        expect(track.getAttribute('width')).toBe('36')
        expect(track.getAttribute('height')).toBe('20')
        expect(knob.getAttribute('cx')).toBe('26')
        expect(track.getAttribute('fill')).toBe('#55967c')
    })

    it('re-enables click handling after setDisabled(false)', () => {
        const { toggle, onChange, group } = mountToggle({ checked: false, disabled: true })

        toggle.setDisabled(false)
        clickGroup(group)

        expect(toggle.getChecked()).toBe(true)
        expect(onChange).toHaveBeenCalledExactlyOnceWith(true, 't1')
    })
})
