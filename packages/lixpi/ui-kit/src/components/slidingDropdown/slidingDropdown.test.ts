import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { select, selection } from 'd3-selection'
import { easePupOut } from '../../animation/easings.ts'
import {
    createSlidingDropdown,
    type SlidingDropdownTransitionConfig,
} from './slidingDropdown.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'
const WIDTH = 156
const HEIGHT = 66
const OPTIONS = [
    { label: 'Square', value: 'square' },
    { label: 'Landscape', value: 'landscape' },
    { label: 'Portrait', value: 'portrait' },
    { label: 'Automatic', value: 'automatic' },
] as const

type Value = typeof OPTIONS[number]['value']

const IMMEDIATE_TRANSITION: Partial<SlidingDropdownTransitionConfig> = {
    durationMs: 0,
    minDurationMs: 0,
    snapDurationMs: 0,
}
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
    chain.style = (name: string, value: unknown) => {
        target.style(name, value)
        return chain
    }
    chain.tween = (_name: string, createTween: () => ((progress: number) => void) | null) => {
        createTween()?.(1)
        return chain
    }
    return chain
}

;(selection.prototype as any).transition = function(): any {
    return makeImmediateTransition(this)
}

function setRect(element: Element, rect: Partial<DOMRect>): void {
    const completeRect = {
        x: rect.left ?? 0,
        y: rect.top ?? 0,
        top: rect.top ?? 0,
        right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 0),
        bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 0),
        left: rect.left ?? 0,
        width: rect.width ?? 0,
        height: rect.height ?? 0,
        toJSON: () => ({}),
    }
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(completeRect)
}

function mount(
    selectedValue: Value = 'square',
    onChange = vi.fn(),
    transition: Partial<SlidingDropdownTransitionConfig> | null = IMMEDIATE_TRANSITION,
) {
    const host = document.createElement('div')
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    host.appendChild(svg)
    document.body.appendChild(host)
    setRect(host, {
        top: 550,
        left: 80,
        width: WIDTH * 2,
        height: HEIGHT * 2,
    })
    const slidingDropdown = createSlidingDropdown<Value>(select(svg), {
        id: 'dimensions',
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
        options: [...OPTIONS],
        selectedValue,
        observeParentResize: false,
        ...(transition === null ? {} : { transition }),
        onChange,
    })
    return { host, svg, slidingDropdown, onChange }
}

function optionHit(svg: SVGSVGElement, value: Value): SVGRectElement {
    return svg.querySelector(`.sliding-dropdown-option-group[data-value="${value}"] .sliding-dropdown-hit`)!
}

function renderedSvgTop(svg: SVGSVGElement): number {
    const scrollPortal = svg.closest('.sliding-dropdown-scroll-portal') as HTMLDivElement | null
    const svgTop = Number.parseFloat(svg.style.top)
    if (!scrollPortal) return svgTop
    return Number.parseFloat(scrollPortal.style.top) + svgTop - scrollPortal.scrollTop
}

function dispatchPointerClick(target: Element): void {
    target.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientY: 400,
        pointerId: 7,
    }))
    target.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        clientY: 400,
        pointerId: 7,
    }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
}

// =============================================================================
// POINTER SELECTION
// =============================================================================

describe('createSlidingDropdown — pointer selection', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        transitionDurations.length = 0
        transitionEasings.length = 0
        vi.useFakeTimers()
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('opens from the selected hit target and applies a clicked option', () => {
        const { svg, slidingDropdown, onChange } = mount('square')

        expect(optionHit(svg, 'square').getAttribute('pointer-events')).toBe('all')
        dispatchPointerClick(optionHit(svg, 'square'))
        vi.runAllTimers()
        expect(slidingDropdown.isOpen()).toBe(true)

        dispatchPointerClick(optionHit(svg, 'portrait'))
        vi.runAllTimers()

        expect(slidingDropdown.isOpen()).toBe(false)
        expect(slidingDropdown.getValue()).toBe('portrait')
        expect(onChange).toHaveBeenCalledExactlyOnceWith('portrait', 'dimensions')
    })
})

// =============================================================================
// PORTALED VIEWPORT GEOMETRY
// =============================================================================

describe('createSlidingDropdown — portaled viewport geometry', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        transitionDurations.length = 0
        transitionEasings.length = 0
        vi.useFakeTimers()
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 })
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: {
                height: HEIGHT * 2,
                offsetTop: 300,
            },
        })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    for (const selectedValue of OPTIONS.map(option => option.value)) {
        it(`shows the complete ordered tape when ${selectedValue} is initially selected`, () => {
            const { svg, slidingDropdown } = mount(selectedValue)
            const selectedIndex = OPTIONS.findIndex(option => option.value === selectedValue)

            slidingDropdown.setOpen(true)
            vi.runAllTimers()

            const scrollPortal = svg.closest('.sliding-dropdown-scroll-portal') as HTMLDivElement
            expect(scrollPortal.parentElement).toBe(document.body)
            expect(scrollPortal.style.pointerEvents).toBe('auto')
            expect(scrollPortal.style.overflowY).toBe('auto')
            expect(scrollPortal.scrollTop).toBe(selectedIndex * HEIGHT * 2)
            expect(svg.getAttribute('viewBox')).toBe(`0 0 ${WIDTH} ${OPTIONS.length * HEIGHT}`)
            expect(svg.style.position).toBe('absolute')
            expect(svg.style.height).toBe(`${OPTIONS.length * HEIGHT * 2}px`)
            expect(renderedSvgTop(svg)).toBe(550 - selectedIndex * HEIGHT * 2)
            expect(renderedSvgTop(svg)).toBeGreaterThanOrEqual(0)
            expect(renderedSvgTop(svg) + Number.parseFloat(svg.style.height)).toBeLessThanOrEqual(1200)
            expect(svg.querySelector('clipPath rect')?.getAttribute('height')).toBe(String(OPTIONS.length * HEIGHT))
            expect(Array.from(svg.querySelectorAll('.sliding-dropdown-option-group')).map(option => (
                option.getAttribute('data-value')
            ))).toEqual(OPTIONS.map(option => option.value))
        })
    }
})

// =============================================================================
// MOTION AND SNAP TIMING
// =============================================================================

describe('createSlidingDropdown — motion and snap timing', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        transitionDurations.length = 0
        transitionEasings.length = 0
        vi.useFakeTimers()
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('slides and collapses concurrently with doubled click motion duration', () => {
        const { svg, slidingDropdown, onChange } = mount('landscape', vi.fn(), null)

        slidingDropdown.setOpen(true)
        vi.advanceTimersByTime(100)
        const indicator = svg.querySelector('.sliding-dropdown-indicator')!
        const optionsGroup = svg.querySelector('.sliding-dropdown-options')!
        const viewportClip = svg.querySelector('clipPath rect')!
        const frameY = Number(indicator.getAttribute('y'))
        const frameScreenY = renderedSvgTop(svg) + frameY * 2

        dispatchPointerClick(optionHit(svg, 'automatic'))

        expect(slidingDropdown.isOpen()).toBe(false)
        expect(svg.style.height).toBe(`${OPTIONS.length * HEIGHT * 2}px`)
        expect(svg.getAttribute('viewBox')).toBe(`0 0 ${WIDTH} ${OPTIONS.length * HEIGHT}`)
        expect(renderedSvgTop(svg) + Number(indicator.getAttribute('y')) * 2).toBe(frameScreenY)
        expect(optionsGroup.getAttribute('transform')).toBe(`translate(0, ${-2 * HEIGHT})`)
        expect(
            Number(optionHit(svg, 'automatic').getAttribute('y')) - 2 * HEIGHT,
        ).toBe(frameY)
        expect(viewportClip.getAttribute('y')).toBe(String(HEIGHT))
        expect(viewportClip.getAttribute('height')).toBe(String(HEIGHT))
        expect(slidingDropdown.getValue()).toBe('landscape')
        expect(onChange).not.toHaveBeenCalled()

        vi.advanceTimersByTime(203)
        expect(slidingDropdown.getValue()).toBe('landscape')
        expect(onChange).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)

        expect(transitionEasings.length).toBeGreaterThan(0)
        expect(transitionEasings.every(easing => easing === easePupOut)).toBe(true)
        expect(Math.max(...transitionDurations)).toBe(204)
        expect(svg.style.height).toBe(`${HEIGHT}px`)
        expect(svg.getAttribute('viewBox')).toBe(`0 0 ${WIDTH} ${HEIGHT}`)
        expect(indicator.getAttribute('y')).toBe('2')
        expect(optionsGroup.getAttribute('transform')).toBe(`translate(0, ${-3 * HEIGHT})`)
        expect(slidingDropdown.getValue()).toBe('automatic')
        expect(onChange).toHaveBeenCalledExactlyOnceWith('automatic', 'dimensions')
    })

    it('keeps the current value fixed while an outside press closes the viewport', () => {
        const { svg, slidingDropdown, onChange } = mount('portrait', vi.fn(), null)

        slidingDropdown.setOpen(true)
        vi.advanceTimersByTime(100)
        const indicator = svg.querySelector('.sliding-dropdown-indicator')!
        const optionsGroup = svg.querySelector('.sliding-dropdown-options')!
        const viewportClip = svg.querySelector('clipPath rect')!
        const frameY = Number(indicator.getAttribute('y'))
        const frameScreenY = renderedSvgTop(svg) + frameY * 2

        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

        expect(slidingDropdown.isOpen()).toBe(false)
        expect(svg.style.height).toBe(`${OPTIONS.length * HEIGHT * 2}px`)
        expect(renderedSvgTop(svg) + Number(indicator.getAttribute('y')) * 2).toBe(frameScreenY)
        expect(optionsGroup.getAttribute('transform')).toBe('translate(0, 0)')
        expect(viewportClip.getAttribute('y')).toBe(String(2 * HEIGHT))
        expect(viewportClip.getAttribute('height')).toBe(String(HEIGHT))

        vi.advanceTimersByTime(140)

        expect(svg.style.height).toBe(`${HEIGHT}px`)
        expect(indicator.getAttribute('y')).toBe('2')
        expect(optionsGroup.getAttribute('transform')).toBe(`translate(0, ${-2 * HEIGHT})`)
        expect(slidingDropdown.getValue()).toBe('portrait')
        expect(onChange).not.toHaveBeenCalled()
    })

    it('waits for native scrollend before snapping while keeping the entire tape visible', () => {
        const { svg, slidingDropdown, onChange } = mount('square', vi.fn(), null)
        slidingDropdown.setOpen(true)
        vi.runAllTimers()
        const scrollPortal = svg.closest('.sliding-dropdown-scroll-portal') as HTMLDivElement

        let scrollTop = HEIGHT * 0.6 * 2
        Object.defineProperty(scrollPortal, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
            set: value => { scrollTop = value },
        })
        expect(scrollPortal.scrollTop).toBe(HEIGHT * 0.6 * 2)
        scrollPortal.dispatchEvent(new Event('scroll'))

        expect(renderedSvgTop(svg)).toBeCloseTo(470.8)
        vi.advanceTimersByTime(1_000)
        expect(renderedSvgTop(svg)).toBeCloseTo(470.8)
        scrollPortal.dispatchEvent(new Event('scrollend'))
        vi.runAllTimers()

        expect(transitionDurations).toContain(50)
        expect(renderedSvgTop(svg)).toBeCloseTo(418)
        expect(svg.getAttribute('viewBox')).toBe(`0 0 ${WIDTH} ${OPTIONS.length * HEIGHT}`)
        expect(svg.querySelector('clipPath rect')?.getAttribute('height')).toBe(String(OPTIONS.length * HEIGHT))
        expect(Array.from(svg.querySelectorAll('.sliding-dropdown-option-group')).map(option => (
            option.getAttribute('data-value')
        ))).toEqual(OPTIONS.map(option => option.value))
        expect(slidingDropdown.getValue()).toBe('square')

        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        vi.runAllTimers()
        expect(slidingDropdown.getValue()).toBe('landscape')
        expect(onChange).toHaveBeenCalledExactlyOnceWith('landscape', 'dimensions')
    })
})
