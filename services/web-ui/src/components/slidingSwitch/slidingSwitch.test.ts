import { describe, it, expect, beforeEach, vi } from 'vitest'
import { select, selection } from 'd3-selection'
import { createSlidingSwitch } from '$src/components/slidingSwitch/slidingSwitch.ts'

// The indicator slide uses a d3 transition on the rect's `x`. happy-dom drives d3
// timers awkwardly, so stub transitions with a chainable no-op: state (value/onChange)
// and label fills update synchronously; the initial indicator position is set without
// a transition, so it stays assertable.
const makeChain = (): any => {
    const chain: any = {}
    for (const method of ['duration', 'ease', 'attr', 'style', 'tween']) {
        chain[method] = () => chain
    }
    return chain
}
;(selection.prototype as any).transition = () => makeChain()

const SVG_NS = 'http://www.w3.org/2000/svg'

type View = 'list' | 'grid' | 'timeline'

const options = [
    { label: 'List', value: 'list' as View },
    { label: 'Grid', value: 'grid' as View },
    { label: 'Timeline', value: 'timeline' as View },
]

// width 304, padding 2 -> segmentWidth 100, so segment x = 2 + index * 100.
const WIDTH = 304
const segmentX = (index: number) => 2 + index * 100

function mount(selectedValue: View = 'list', onChange = vi.fn()) {
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    document.body.appendChild(svg)
    const slidingSwitch = createSlidingSwitch<View>(select(svg), {
        id: 'view-mode', x: 0, y: 0, width: WIDTH, height: 26, options, selectedValue, onChange,
    })
    return { svg, slidingSwitch, onChange }
}

const hitRects = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.sliding-switch-hit'))
const labels = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.sliding-switch-option'))
const indicatorX = (svg: SVGSVGElement) => svg.querySelector('.sliding-switch-indicator')!.getAttribute('x')

describe('createSlidingSwitch', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    it('appends an SVG group with a track, indicator, and one label + hit area per option', () => {
        const { svg } = mount()
        expect(svg.querySelector('.sliding-switch-group')).not.toBeNull()
        expect(svg.querySelector('.sliding-switch-track')).not.toBeNull()
        expect(svg.querySelector('.sliding-switch-indicator')).not.toBeNull()
        expect(labels(svg)).toHaveLength(3)
        expect(hitRects(svg)).toHaveLength(3)
    })

    it('reflects the selected value and positions the indicator over it', () => {
        const { svg, slidingSwitch } = mount('timeline')
        expect(slidingSwitch.getValue()).toBe('timeline')
        expect(indicatorX(svg)).toBe(String(segmentX(2)))
        expect(labels(svg)[2]!.getAttribute('fill')).toBe('#1a2744')
        expect(labels(svg)[0]!.getAttribute('fill')).not.toBe('#1a2744')
    })

    it('falls back to the first option when the selected value is unknown', () => {
        const { svg, slidingSwitch } = mount('nope' as View)
        expect(slidingSwitch.getValue()).toBe('list')
        expect(indicatorX(svg)).toBe(String(segmentX(0)))
    })

    it('throws when constructed with no options', () => {
        const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
        expect(() => createSlidingSwitch(select(svg), { id: 'v', x: 0, y: 0, width: WIDTH, options: [] })).toThrow()
    })

    it('clicking a segment selects it, fires onChange, and recolors the labels', () => {
        const { svg, slidingSwitch, onChange } = mount('list')

        hitRects(svg)[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(slidingSwitch.getValue()).toBe('grid')
        expect(onChange).toHaveBeenCalledExactlyOnceWith('grid', 'view-mode')
        expect(labels(svg)[1]!.getAttribute('fill')).toBe('#1a2744')
        expect(labels(svg)[0]!.getAttribute('fill')).not.toBe('#1a2744')
    })

    it('does not fire onChange when the active segment is clicked again', () => {
        const { svg, slidingSwitch, onChange } = mount('list')
        hitRects(svg)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(onChange).not.toHaveBeenCalled()
        expect(slidingSwitch.getValue()).toBe('list')
    })

    it('highlights a non-active label on hover and restores it on leave', () => {
        const { svg } = mount('list')
        const grid = hitRects(svg)[1]!

        grid.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        expect(labels(svg)[1]!.getAttribute('fill')).toBe('#1a2744')

        grid.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
        expect(labels(svg)[1]!.getAttribute('fill')).not.toBe('#1a2744')
    })

    it('setValue selects without firing onChange', () => {
        const { svg, slidingSwitch, onChange } = mount('list')
        slidingSwitch.setValue('timeline')
        expect(slidingSwitch.getValue()).toBe('timeline')
        expect(onChange).not.toHaveBeenCalled()
        expect(labels(svg)[2]!.getAttribute('fill')).toBe('#1a2744')
    })

    it('removes its group on destroy', () => {
        const { svg, slidingSwitch } = mount()
        slidingSwitch.destroy()
        expect(svg.querySelector('.sliding-switch-group')).toBeNull()
    })
})
