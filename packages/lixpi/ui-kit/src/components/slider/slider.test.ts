import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { select, selection } from 'd3-selection'
import { easeCubicOut } from 'd3-ease'
import { createSlider } from './slider.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'
const WIDTH = 200
const HEIGHT = 66
const RAIL_INSET = 16
const VALUE_BUBBLE_HEIGHT = 28

const OPTIONS = [
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
] as const

type Value = typeof OPTIONS[number]['value']

const transitionDurations: number[] = []
const transitionEasings: unknown[] = []

const makeImmediateTransition = (target: any): any => {
    const chain: any = {}
    chain.duration = (duration: number) => {
        transitionDurations.push(duration)
        return chain
    }
    chain.ease = (easing: unknown) => {
        transitionEasings.push(easing)
        return chain
    }
    chain.attr = (name: string, value: unknown) => {
        target.attr(name, value)
        return chain
    }
    return chain
}

;(selection.prototype as any).transition = function (): any {
    return makeImmediateTransition(this)
}

function setHitRect(hitEl: SVGRectElement, left: number, width: number): void {
    vi.spyOn(hitEl, 'getBoundingClientRect').mockReturnValue({
        x: left,
        y: 0,
        top: 0,
        bottom: HEIGHT,
        left,
        right: left + width,
        width,
        height: HEIGHT,
        toJSON: () => ({}),
    } as DOMRect)
}

function mount(
    options: readonly { label: string; value: Value; disabled?: boolean }[] = OPTIONS,
    selectedValue?: Value,
    onChange = vi.fn(),
    observeParentResize = false,
) {
    const host = document.createElement('div')
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    host.appendChild(svg)
    document.body.appendChild(host)

    const slider = createSlider<Value>(select(svg), {
        id: 'quality',
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
        options: [...options],
        selectedValue,
        observeParentResize,
        onChange,
    })

    const hit = svg.querySelector('.slider-hit') as SVGRectElement
    setHitRect(hit, 0, WIDTH)

    return { host, svg, slider, onChange, hit }
}

function dispatchPointerDown(target: Element, clientX: number, pointerId = 1): void {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX, pointerId }))
}

describe('createSlider — initial render', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        transitionDurations.length = 0
        transitionEasings.length = 0
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('positions the thumb, rail and value bubble at the selected option without a defined selectedValue', () => {
        const { svg } = mount(OPTIONS, undefined)

        const thumb = svg.querySelector('.slider-thumb')!
        const activeRail = svg.querySelector('.slider-rail-active')!
        const rail = svg.querySelector('.slider-rail')!
        const valueText = svg.querySelector('.slider-value-text')!

        expect(rail.getAttribute('x1')).toBe(String(RAIL_INSET))
        expect(rail.getAttribute('x2')).toBe(String(WIDTH - RAIL_INSET))
        expect(thumb.getAttribute('cx')).toBe(String(RAIL_INSET))
        expect(activeRail.getAttribute('x2')).toBe(String(RAIL_INSET))
        expect(valueText.textContent).toBe('Low')
    })

    it('positions the thumb at the middle option when selectedValue is medium', () => {
        const { svg } = mount(OPTIONS, 'medium')

        const thumb = svg.querySelector('.slider-thumb')!
        const expectedX = RAIL_INSET + 0.5 * (WIDTH - RAIL_INSET * 2)
        expect(thumb.getAttribute('cx')).toBe(String(expectedX))
    })

    it('falls back to the first enabled option when selectedValue is invalid', () => {
        const { slider } = mount(OPTIONS, 'nonexistent' as Value)
        expect(slider.getValue()).toBe('low')
    })

    it('falls back to the first enabled option when the initially selected option is disabled', () => {
        const optionsWithDisabledFirst = [
            { label: 'Low', value: 'low' as Value, disabled: true },
            { label: 'Medium', value: 'medium' as Value },
            { label: 'High', value: 'high' as Value },
        ]
        const { slider } = mount(optionsWithDisabledFirst, undefined)
        expect(slider.getValue()).toBe('medium')
    })

    it('sets aria attributes reflecting the selected index', () => {
        const { svg } = mount(OPTIONS, 'high')
        const group = svg.querySelector('.slider-group')!

        expect(group.getAttribute('role')).toBe('slider')
        expect(group.getAttribute('aria-valuemin')).toBe('0')
        expect(group.getAttribute('aria-valuemax')).toBe('2')
        expect(group.getAttribute('aria-valuenow')).toBe('2')
        expect(group.getAttribute('aria-valuetext')).toBe('High')
    })

    it('centers the single option on the rail when there is only one option', () => {
        const { svg } = mount([{ label: 'Only', value: 'only' as Value }], undefined)
        const thumb = svg.querySelector('.slider-thumb')!
        const midpoint = (RAIL_INSET + (WIDTH - RAIL_INSET)) / 2
        expect(thumb.getAttribute('cx')).toBe(String(midpoint))
    })

    it('throws when constructed with zero options', () => {
        const host = document.createElement('div')
        const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
        host.appendChild(svg)
        document.body.appendChild(host)

        expect(() => createSlider<Value>(select(svg), {
            id: 'empty',
            x: 0,
            y: 0,
            width: WIDTH,
            options: [],
        })).toThrow('Slider requires at least one option')
    })
})

describe('createSlider — pointer interaction', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        transitionDurations.length = 0
        transitionEasings.length = 0
    })

    afterEach(() => {
        vi.restoreAllMocks()
        window.removeEventListener('pointermove', () => undefined)
    })

    it('selects the nearest option on pointerdown and notifies onChange', () => {
        const { svg, slider, onChange, hit } = mount(OPTIONS, 'low')
        setHitRect(hit, 0, WIDTH)

        dispatchPointerDown(hit, WIDTH)

        expect(slider.getValue()).toBe('high')
        expect(onChange).toHaveBeenCalledExactlyOnceWith('high', 'quality')
        expect(transitionEasings.length).toBeGreaterThan(0)
        expect(transitionEasings.every(easing => easing === easeCubicOut)).toBe(true)
        expect(transitionDurations.every(duration => duration === 160)).toBe(true)

        const thumb = svg.querySelector('.slider-thumb')!
        expect(thumb.getAttribute('cx')).toBe(String(WIDTH - RAIL_INSET))
    })

    it('tracks pointermove on window while the drag is active and stops after pointerup', () => {
        const { slider, onChange, hit } = mount(OPTIONS, 'low')
        setHitRect(hit, 0, WIDTH)

        dispatchPointerDown(hit, 0, 5)
        expect(slider.getValue()).toBe('low')

        window.dispatchEvent(new PointerEvent('pointermove', { clientX: WIDTH / 2, pointerId: 5 }))
        expect(slider.getValue()).toBe('medium')

        window.dispatchEvent(new PointerEvent('pointerup', { clientX: WIDTH / 2, pointerId: 5 }))
        onChange.mockClear()

        window.dispatchEvent(new PointerEvent('pointermove', { clientX: WIDTH, pointerId: 5 }))
        expect(slider.getValue()).toBe('medium')
        expect(onChange).not.toHaveBeenCalled()
    })

    it('ignores pointermove and pointerup events from a different pointerId', () => {
        const { slider, hit } = mount(OPTIONS, 'low')
        setHitRect(hit, 0, WIDTH)

        dispatchPointerDown(hit, 0, 1)
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: WIDTH, pointerId: 99 }))

        expect(slider.getValue()).toBe('low')
    })

    it('skips a disabled middle option and snaps to the nearest enabled one', () => {
        const optionsWithDisabledMiddle = [
            { label: 'Low', value: 'low' as Value },
            { label: 'Medium', value: 'medium' as Value, disabled: true },
            { label: 'High', value: 'high' as Value },
        ]
        const { slider, hit } = mount(optionsWithDisabledMiddle, 'low')
        setHitRect(hit, 0, WIDTH)

        dispatchPointerDown(hit, WIDTH / 2)

        expect(slider.getValue()).toBe('low')
    })

    it('treats a zero-width hit rect as index 0', () => {
        const { slider, hit } = mount(OPTIONS, 'high')
        setHitRect(hit, 0, 0)

        dispatchPointerDown(hit, 50)

        expect(slider.getValue()).toBe('low')
    })
})

describe('createSlider — keyboard interaction', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        transitionDurations.length = 0
        transitionEasings.length = 0
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('moves to the next/previous option with arrow keys and notifies onChange', () => {
        const { svg, slider, onChange } = mount(OPTIONS, 'medium')
        const group = svg.querySelector('.slider-group')!

        group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(slider.getValue()).toBe('high')
        expect(onChange).toHaveBeenLastCalledWith('high', 'quality')

        group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
        group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
        expect(slider.getValue()).toBe('low')

        onChange.mockClear()
        group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
        expect(slider.getValue()).toBe('low')
        expect(onChange).not.toHaveBeenCalled()
    })

    it('jumps to the first/last option with Home/End', () => {
        const { svg, slider } = mount(OPTIONS, 'medium')
        const group = svg.querySelector('.slider-group')!

        group.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
        expect(slider.getValue()).toBe('high')

        group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
        expect(slider.getValue()).toBe('low')
    })

    it('treats ArrowUp/ArrowDown the same as ArrowRight/ArrowLeft', () => {
        const { svg, slider } = mount(OPTIONS, 'low')
        const group = svg.querySelector('.slider-group')!

        group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
        expect(slider.getValue()).toBe('medium')

        group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        expect(slider.getValue()).toBe('low')
    })

    it('ignores unrelated keys', () => {
        const { svg, slider, onChange } = mount(OPTIONS, 'low')
        const group = svg.querySelector('.slider-group')!

        group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))

        expect(slider.getValue()).toBe('low')
        expect(onChange).not.toHaveBeenCalled()
    })
})

describe('createSlider — public API', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        transitionDurations.length = 0
        transitionEasings.length = 0
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('setValue updates state without animating or notifying onChange', () => {
        const { svg, slider, onChange } = mount(OPTIONS, 'low')

        slider.setValue('high')

        expect(slider.getValue()).toBe('high')
        expect(onChange).not.toHaveBeenCalled()
        expect(transitionDurations).toHaveLength(0)
        const thumb = svg.querySelector('.slider-thumb')!
        expect(thumb.getAttribute('cx')).toBe(String(WIDTH - RAIL_INSET))
    })

    it('setValue is a no-op for the current value or an unknown/disabled value', () => {
        const optionsWithDisabled = [
            { label: 'Low', value: 'low' as Value },
            { label: 'Medium', value: 'medium' as Value, disabled: true },
            { label: 'High', value: 'high' as Value },
        ]
        const { slider, onChange } = mount(optionsWithDisabled, 'low')

        slider.setValue('low')
        slider.setValue('medium')
        slider.setValue('missing' as Value)

        expect(slider.getValue()).toBe('low')
        expect(onChange).not.toHaveBeenCalled()
    })

    it('resize updates host svg geometry and rail bounds', () => {
        const { svg, slider } = mount(OPTIONS, 'low')

        slider.resize(10, 20, 300, 80)

        expect(svg.getAttribute('width')).toBe('300')
        expect(svg.getAttribute('height')).toBe('80')
        expect(svg.getAttribute('viewBox')).toBe('0 0 300 80')
        const group = svg.querySelector('.slider-group')!
        expect(group.getAttribute('transform')).toBe('translate(10, 20)')
        const rail = svg.querySelector('.slider-rail')!
        expect(rail.getAttribute('x2')).toBe(String(300 - RAIL_INSET))
    })

    it('render() re-applies the current geometry without animating', () => {
        const { svg, slider } = mount(OPTIONS, 'medium')
        transitionDurations.length = 0

        slider.render()

        expect(transitionDurations).toHaveLength(0)
        const valueText = svg.querySelector('.slider-value-text')!
        expect(valueText.textContent).toBe('Medium')
    })

    it('destroy removes the group and stops responding to further interaction', () => {
        const { svg, slider, hit, onChange } = mount(OPTIONS, 'low')
        setHitRect(hit, 0, WIDTH)

        const removeSpy = vi.spyOn(window, 'removeEventListener')
        slider.destroy()

        expect(svg.querySelector('.slider-group')).toBeNull()
        expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
        expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
        expect(removeSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function))

        // Calling destroy again is a no-op and does not throw.
        expect(() => slider.destroy()).not.toThrow()
        expect(onChange).not.toHaveBeenCalled()
    })

    it('clamps the value bubble position for a very wide label near the edge', () => {
        const wideOptions = [
            { label: 'Low', value: 'low' as Value },
            { label: 'An Extremely Long Descriptive Label', value: 'long' as Value },
        ]
        const { svg } = mount(wideOptions, 'long')

        const valueBubble = svg.querySelector('.slider-value-bubble')!
        const match = valueBubble.getAttribute('transform')!.match(/translate\((-?[\d.]+), 0\)/)
        expect(match).not.toBeNull()
        const bubbleLeft = Number(match![1])
        expect(bubbleLeft).toBeGreaterThanOrEqual(0)
        expect(bubbleLeft).toBeLessThanOrEqual(WIDTH)
    })
})
