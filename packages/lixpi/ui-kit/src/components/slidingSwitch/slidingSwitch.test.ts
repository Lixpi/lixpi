import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { select, selection } from 'd3-selection'
import { createTagPill } from '../tagPill/tagPill.ts'
import {
    createSlidingSwitch,
    SLIDING_SWITCH_TRANSITION_DURATION_MS,
} from './slidingSwitch.ts'
import type { SlidingSwitchReshuffleItemsOnValueChange } from './index.ts'

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

function mount(
    selectedValue: View = 'list',
    onChange = vi.fn(),
    config: Partial<Parameters<typeof createSlidingSwitch>[1]> = {}
) {
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    document.body.appendChild(svg)
    const slidingSwitch = createSlidingSwitch<View>(select(svg), {
        id: 'view-mode', x: 0, y: 0, width: WIDTH, height: 26, options, selectedValue, onChange,
        ...config,
    })
    return { svg, slidingSwitch, onChange }
}

const hitRects = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.sliding-switch-hit'))
const labels = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.sliding-switch-option'))
const optionGroups = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.sliding-switch-option-group'))
const closeGroups = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.sliding-switch-option-close'))
const indicatorX = (svg: SVGSVGElement) => svg.querySelector('.sliding-switch-indicator')!.getAttribute('x')
const optionValues = (svg: SVGSVGElement) => optionGroups(svg).map((group) => group.getAttribute('data-value'))

const reshuffleToRight = {
    enable: true,
    selectedElementPosition: 'right',
} satisfies SlidingSwitchReshuffleItemsOnValueChange

describe('createSlidingSwitch', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    afterEach(() => {
        vi.useRealTimers()
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

    it('supports closable options without selecting the segment', () => {
        const onChange = vi.fn()
        const onClose = vi.fn()
        const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
        document.body.appendChild(svg)
        const slidingSwitch = createSlidingSwitch<View>(select(svg), {
            id: 'view-mode',
            x: 0,
            y: 0,
            width: WIDTH,
            height: 26,
            options: options.map((option) => ({ ...option, closable: option.value === 'grid' })),
            selectedValue: 'list',
            onChange,
            onClose,
        })

        svg.querySelectorAll('.sliding-switch-option-close')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(slidingSwitch.getValue()).toBe('list')
        expect(onChange).not.toHaveBeenCalled()
        expect(onClose).toHaveBeenCalledExactlyOnceWith('grid', 'view-mode', expect.objectContaining({ value: 'grid' }))
    })

    it('supports keyboard selection across options', () => {
        const { svg, slidingSwitch, onChange } = mount('list')

        hitRects(svg)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

        expect(slidingSwitch.getValue()).toBe('grid')
        expect(onChange).toHaveBeenCalledExactlyOnceWith('grid', 'view-mode')
    })

    it('supports Home and End keyboard selection', () => {
        const { svg, slidingSwitch, onChange } = mount('grid')

        optionGroups(svg)[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))

        expect(slidingSwitch.getValue()).toBe('list')
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenLastCalledWith('list', 'view-mode')

        onChange.mockClear()
        optionGroups(svg)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))

        expect(slidingSwitch.getValue()).toBe('timeline')
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenLastCalledWith('timeline', 'view-mode')
    })

    it('fires close via keyboard on the close control', () => {
        const onChange = vi.fn()
        const onClose = vi.fn()
        const { svg, slidingSwitch } = mount('list', onChange, {
            options: options.map((option) => ({ ...option, closable: option.value === 'grid' })),
            onClose,
        })
        slidingSwitch.setValue('list')

        closeGroups(svg)[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(slidingSwitch.getValue()).toBe('list')
        expect(onChange).not.toHaveBeenCalled()
        expect(onClose).toHaveBeenCalledExactlyOnceWith('grid', 'view-mode', expect.objectContaining({ value: 'grid' }))
    })

    it('does not dispatch selection when a click event is already default-prevented', () => {
        const { slidingSwitch, onChange } = mount('list')
        const option = { value: 'grid' as View }
        const event = { defaultPrevented: true } as Event

        ;(slidingSwitch as any).selectOption(option, event)

        expect(slidingSwitch.getValue()).toBe('list')
        expect(onChange).not.toHaveBeenCalled()
    })

    it('does not close disabled options', () => {
        const onClose = vi.fn()
        const { svg, slidingSwitch, onChange } = mount('list', vi.fn(), {
            options: options.map((option, index) => ({
                ...option,
                closable: true,
                disabled: index === 1,
            })),
            onClose,
        })

        closeGroups(svg)[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(slidingSwitch.getValue()).toBe('list')
        expect(onChange).not.toHaveBeenCalled()
        expect(onClose).toHaveBeenCalledTimes(0)
    })

    it('ignores setValue calls for values that are not represented', () => {
        const { slidingSwitch, onChange } = mount('grid', vi.fn())
        slidingSwitch.setValue('missing' as View)

        expect(slidingSwitch.getValue()).toBe('grid')
        expect(onChange).not.toHaveBeenCalled()
    })

    it('does not select disabled options and wraps through keyboard to the next enabled option', () => {
        const onChange = vi.fn()
        const { svg, slidingSwitch } = mount('list', onChange, {
            options: options.map((option, index) => index === 1 ? { ...option, disabled: true } : option),
        })

        hitRects(svg)[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(slidingSwitch.getValue()).toBe('list')
        expect(onChange).not.toHaveBeenCalled()

        optionGroups(svg)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

        expect(slidingSwitch.getValue()).toBe('timeline')
        expect(onChange).toHaveBeenCalledExactlyOnceWith('timeline', 'view-mode')
    })

    it('honors role and selected aria attribute overrides', () => {
        const { svg } = mount('list', vi.fn(), {
            role: 'menu',
            optionRole: 'menuitemradio',
            selectedAriaAttribute: 'aria-selected',
        })

        const group = svg.querySelector('.sliding-switch-group')!
        expect(group.getAttribute('role')).toBe('menu')

        const firstOption = optionGroups(svg)[0]!
        const thirdOption = optionGroups(svg)[2]!
        expect(firstOption.getAttribute('role')).toBe('menuitemradio')
        expect(firstOption.getAttribute('aria-selected')).toBe('true')
        expect(thirdOption.getAttribute('aria-checked')).toBeNull()
        expect(firstOption.getAttribute('aria-disabled')).toBe('false')
    })

    it('supports min-option width sizing and resize-driven dimension updates', () => {
        const { svg, slidingSwitch } = mount('list', vi.fn(), {
            minOptionWidth: 120,
            width: 150,
            height: 28,
        })

        expect(slidingSwitch.getContentWidth()).toBe(3 * 120 + 4)
        expect(slidingSwitch.getOuterHeight()).toBe(28)

        slidingSwitch.resize(0, 0, 260, 30)
        expect(slidingSwitch.getContentWidth()).toBe(3 * 120 + 4)
        expect(slidingSwitch.getOuterHeight()).toBe(30)
        expect(indicatorX(svg)).toBe(String(segmentX(0)))
    })

    it('adds outer-geometry padding when shadows are configured', () => {
        const { slidingSwitch } = mount('list', vi.fn(), {
            indicatorBoxShadow: '0 0 8px rgba(0, 0, 0, 0.25)',
            indicatorInsetShadow: {
                topColor: 'rgba(255, 255, 255, 0.8)',
                bottomColor: 'rgba(0, 0, 0, 0)',
            },
        })

        expect(slidingSwitch.getOuterHeight()).toBe(36)
    })

    it('lets a custom renderer inherit selected state and close behavior', () => {
        const onClose = vi.fn()
        const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
        document.body.appendChild(svg)
        const slidingSwitch = createSlidingSwitch<View>(select(svg), {
            id: 'view-mode',
            x: 0,
            y: 0,
            width: WIDTH,
            height: 26,
            options: options.map((option) => ({ ...option, closable: option.value === 'grid' })),
            selectedValue: 'list',
            onClose,
            renderOption: (parent, state) => createTagPill(parent, {
                id: state.id,
                x: state.x,
                y: state.y,
                width: state.width,
                height: state.height,
                label: state.option.label,
                selected: state.selected,
                hovered: state.hovered,
                closable: state.closable,
                closeAriaLabel: state.option.closeAriaLabel,
                onClose: (_id, event) => state.onClose(event),
            }),
        })

        expect(svg.querySelectorAll('.tag-pill-group')).toHaveLength(3)
        slidingSwitch.setValue('timeline')
        expect(svg.querySelectorAll('.tag-pill-background')[2]!.getAttribute('stroke')).toBe('rgba(105, 115, 133, 0.12)')

        svg.querySelectorAll('.tag-pill-close')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(onClose).toHaveBeenCalledExactlyOnceWith('grid', 'view-mode', expect.objectContaining({ value: 'grid' }))
    })

    // =============================================================================
    // RESHUFFLE BEHAVIOR
    // =============================================================================

    it('moves the initial selected option to the configured right edge', () => {
        const { svg, slidingSwitch } = mount('list', vi.fn(), {
            reshuffleItemsOnValueChange: reshuffleToRight,
        })

        expect(slidingSwitch.getValue()).toBe('list')
        expect(optionValues(svg)).toEqual(['grid', 'timeline', 'list'])
        expect(indicatorX(svg)).toBe(String(segmentX(2)))
    })

    it('moves the initial selected option to the configured left edge', () => {
        const { svg, slidingSwitch } = mount('timeline', vi.fn(), {
            reshuffleItemsOnValueChange: {
                enable: true,
                selectedElementPosition: 'left',
            },
        })

        expect(slidingSwitch.getValue()).toBe('timeline')
        expect(optionValues(svg)).toEqual(['timeline', 'list', 'grid'])
        expect(indicatorX(svg)).toBe(String(segmentX(0)))
    })

    it('sequentially reshuffles the newly selected option to the configured edge', () => {
        vi.useFakeTimers()
        const { svg, slidingSwitch, onChange } = mount('list', vi.fn(), {
            reshuffleItemsOnValueChange: reshuffleToRight,
        })

        hitRects(svg)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        vi.runAllTimers()

        expect(slidingSwitch.getValue()).toBe('grid')
        expect(optionValues(svg)).toEqual(['timeline', 'list', 'grid'])
        expect(indicatorX(svg)).toBe(String(segmentX(2)))
        expect(onChange).toHaveBeenCalledExactlyOnceWith('grid', 'view-mode')
    })

    it('uses the full 150 ms transition budget for a two-option reshuffle', () => {
        vi.useFakeTimers()
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
        const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
        document.body.appendChild(svg)
        const onChange = vi.fn()
        const mediaModeSwitch = createSlidingSwitch(select(svg), {
            id: 'media-mode',
            x: 0,
            y: 0,
            width: 204,
            options: [
                { label: 'Image', value: 'image' },
                { label: 'Video', value: 'video' },
            ],
            selectedValue: 'image',
            onChange,
            reshuffleItemsOnValueChange: reshuffleToRight,
        })

        hitRects(svg)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        vi.advanceTimersByTime(62)

        const reshuffleTimers = setTimeoutSpy.mock.calls.slice(-2)
        const reshuffleDelay = Number(setTimeoutSpy.mock.calls[1]![1])
        const finalStepDuration = Number(reshuffleTimers[0]![1])

        expect(reshuffleDelay + finalStepDuration).toBe(SLIDING_SWITCH_TRANSITION_DURATION_MS)
        expect(Number(reshuffleTimers[1]![1])).toBe(finalStepDuration)
        setTimeoutSpy.mockRestore()

        vi.runAllTimers()

        expect(mediaModeSwitch.getValue()).toBe('video')
        expect(optionValues(svg)).toEqual(['image', 'video'])
        expect(indicatorX(svg)).toBe(String(102))
        expect(onChange).toHaveBeenCalledExactlyOnceWith('video', 'media-mode')
    })

    it('preserves the standard switch behavior when reshuffling is disabled', () => {
        vi.useFakeTimers()
        const { svg, slidingSwitch, onChange } = mount('list', vi.fn(), {
            reshuffleItemsOnValueChange: {
                enable: false,
                selectedElementPosition: 'right',
            },
        })

        hitRects(svg)[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        vi.runAllTimers()

        expect(slidingSwitch.getValue()).toBe('grid')
        expect(optionValues(svg)).toEqual(['list', 'grid', 'timeline'])
        expect(indicatorX(svg)).toBe(String(segmentX(1)))
        expect(onChange).toHaveBeenCalledExactlyOnceWith('grid', 'view-mode')
    })

    it('cancels an in-flight reshuffle before applying the next selection', () => {
        vi.useFakeTimers()
        const { svg, slidingSwitch, onChange } = mount('list', vi.fn(), {
            reshuffleItemsOnValueChange: reshuffleToRight,
        })

        hitRects(svg)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        vi.advanceTimersByTime(10)
        hitRects(svg)[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        vi.runAllTimers()

        expect(slidingSwitch.getValue()).toBe('timeline')
        expect(optionValues(svg)).toEqual(['grid', 'list', 'timeline'])
        expect(onChange).toHaveBeenNthCalledWith(1, 'grid', 'view-mode')
        expect(onChange).toHaveBeenNthCalledWith(2, 'timeline', 'view-mode')
    })

    it('keeps render safe after destroy', () => {
        const { svg, slidingSwitch } = mount()
        slidingSwitch.destroy()
        expect(() => slidingSwitch.render()).not.toThrow()
        expect(svg.querySelector('.sliding-switch-group')).toBeNull()
    })

    it('removes its group on destroy', () => {
        const { svg, slidingSwitch } = mount()
        slidingSwitch.destroy()
        expect(svg.querySelector('.sliding-switch-group')).toBeNull()
    })
})
