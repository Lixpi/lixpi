import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { select, selection } from 'd3-selection'
import { easePupOut } from '../../animation/easings.ts'
import { uiKitSettings } from '../../runtime-settings.ts'
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
const shadowTransitionDurations: number[] = []
const shadowTransitionEasings: unknown[] = []
const transitionTweenProgresses = [1]
let transitionTweenObserver: ((name: string, progress: number) => void) | null = null

const makeImmediateTransition = (target: any): any => {
    const chain: any = {}
    const isOpenShadowTransition = target.node?.()?.classList?.contains('sliding-dropdown-open-shadow') ?? false
    chain.duration = (duration: number) => {
        transitionDurations.push(duration)
        if (isOpenShadowTransition) shadowTransitionDurations.push(duration)
        return chain
    }
    chain.ease = (easing: unknown) => {
        transitionEasings.push(easing)
        if (isOpenShadowTransition) shadowTransitionEasings.push(easing)
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
    chain.tween = (name: string, createTween: () => ((progress: number) => void) | null) => {
        const tween = createTween()
        for (const progress of transitionTweenProgresses) {
            tween?.(progress)
            transitionTweenObserver?.(name, progress)
        }
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
    dimensions: { width: number; height: number } = { width: WIDTH, height: HEIGHT },
) {
    const host = document.createElement('div')
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    host.appendChild(svg)
    document.body.appendChild(host)
    setRect(host, {
        top: 550,
        left: 80,
        width: dimensions.width * 2,
        height: dimensions.height * 2,
    })
    const slidingDropdown = createSlidingDropdown<Value>(select(svg), {
        id: 'dimensions',
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height,
        options: [...OPTIONS],
        selectedValue,
        observeParentResize: false,
        ...(transition === null ? {} : { transition }),
        onChange,
    })
    return { host, svg, slidingDropdown, onChange }
}

function mountWithOptions(
    options: Array<{ label: string; value: string }>,
    selectedValue: string,
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
    const slidingDropdown = createSlidingDropdown(select(svg), {
        id: 'intrinsic-width',
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
        options,
        selectedValue,
        observeParentResize: false,
        ...(transition === null ? {} : { transition }),
    })
    return { host, svg, slidingDropdown }
}

function optionHit(svg: SVGSVGElement, value: Value): SVGRectElement {
    return svg.querySelector(`.sliding-dropdown-option-group[data-value="${value}"] .sliding-dropdown-hit`)!
}

function optionLabel(svg: SVGSVGElement, value: string): SVGTextElement {
    return svg.querySelector(`.sliding-dropdown-option-group[data-value="${value}"] text`)! as SVGTextElement
}

function surfaceWidth(svg: SVGSVGElement): number {
    return Number(svg.querySelector('.sliding-dropdown-track')?.getAttribute('width'))
}

function translationX(element: Element): number {
    const transform = element.getAttribute('transform') ?? ''
    const match = /translate\(([-\d.]+)/.exec(transform)
    return Number(match?.[1])
}

function resetTransitionInspection(): void {
    transitionTweenProgresses.splice(0, transitionTweenProgresses.length, 1)
    transitionTweenObserver = null
}

let originalSlidingDropdownStyles: typeof uiKitSettings.slidingDropdown.styles

beforeEach(() => {
    originalSlidingDropdownStyles = structuredClone(uiKitSettings.slidingDropdown.styles)
})

afterEach(() => {
    uiKitSettings.slidingDropdown.styles = originalSlidingDropdownStyles
})

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
        shadowTransitionDurations.length = 0
        shadowTransitionEasings.length = 0
        resetTransitionInspection()
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
// INTRINSIC WIDTH AND CHEVRON
// =============================================================================

describe('createSlidingDropdown — intrinsic width and chevron', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        transitionDurations.length = 0
        transitionEasings.length = 0
        shadowTransitionDurations.length = 0
        shadowTransitionEasings.length = 0
        resetTransitionInspection()
        vi.useFakeTimers()
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('keeps a short selected value anchored while the wider option tape opens and closes', () => {
        const options = [
            { label: '1:1', value: 'short' },
            { label: 'Ultra wide cinematic ratio', value: 'long' },
        ]
        const { host, svg, slidingDropdown } = mountWithOptions(options, 'short', null)
        const shortLabel = optionLabel(svg, 'short')
        const closedSurfaceWidth = surfaceWidth(svg)
        const closedHostWidth = host.style.width
        const closedLabelX = shortLabel.getAttribute('x')
        const widthTweenSnapshots: Array<{ labelX: string | null; hostWidth: string }> = []

        transitionTweenProgresses.splice(0, transitionTweenProgresses.length, 0, 0.5, 1)
        transitionTweenObserver = (name) => {
            if (name !== 'sliding-dropdown-width') return
            widthTweenSnapshots.push({
                labelX: shortLabel.getAttribute('x'),
                hostWidth: host.style.width,
            })
        }

        slidingDropdown.setOpen(true)

        expect(surfaceWidth(svg)).toBeGreaterThan(closedSurfaceWidth)
        expect(widthTweenSnapshots).toHaveLength(3)
        expect(new Set(widthTweenSnapshots.map(snapshot => snapshot.labelX))).toEqual(new Set([closedLabelX]))
        expect(new Set(widthTweenSnapshots.map(snapshot => snapshot.hostWidth))).toEqual(new Set([closedHostWidth]))
        expect(host.style.alignSelf).toBe('flex-start')
        expect(host.style.justifySelf).toBe('start')

        vi.advanceTimersByTime(200)
        widthTweenSnapshots.length = 0
        slidingDropdown.setOpen(false)

        expect(widthTweenSnapshots).toHaveLength(3)
        expect(new Set(widthTweenSnapshots.map(snapshot => snapshot.labelX))).toEqual(new Set([closedLabelX]))
        expect(new Set(widthTweenSnapshots.map(snapshot => snapshot.hostWidth))).toEqual(new Set([closedHostWidth]))

        vi.runAllTimers()

        expect(surfaceWidth(svg)).toBe(closedSurfaceWidth)
        expect(host.style.width).toBe(closedHostWidth)
        expect(shortLabel.getAttribute('x')).toBe(closedLabelX)
    })

    it('keeps the chevron outside the row, portals it while scrolling, and restores it when closed', () => {
        const { svg, slidingDropdown } = mount('square')
        const chevronControl = svg.querySelector('.sliding-dropdown-chevron-control') as SVGGElement
        const chevronIcon = svg.querySelector('.sliding-dropdown-chevron-icon') as SVGGElement
        const indicator = svg.querySelector('.sliding-dropdown-indicator') as SVGRectElement
        const indicatorOuterRight = Number(indicator.getAttribute('x'))
            + Number(indicator.getAttribute('width'))
            + uiKitSettings.slidingDropdown.styles.indicator.openBorderWidth / 2

        expect(translationX(chevronControl) - indicatorOuterRight).toBe(11)
        expect(chevronIcon.getAttribute('transform')).toBe('rotate(0)')

        dispatchPointerClick(chevronControl.querySelector('.sliding-dropdown-chevron-hit')!)
        vi.advanceTimersByTime(200)

        const fixedChevron = document.querySelector('.sliding-dropdown-chevron-portal') as SVGSVGElement
        const scrollPortal = svg.closest('.sliding-dropdown-scroll-portal') as HTMLDivElement
        expect(slidingDropdown.isOpen()).toBe(true)
        expect(fixedChevron.contains(chevronControl)).toBe(true)
        expect(chevronIcon.getAttribute('transform')).toBe('rotate(90)')

        const fixedChevronTop = fixedChevron.style.top
        scrollPortal.scrollTop = HEIGHT
        scrollPortal.dispatchEvent(new Event('scroll'))

        expect(fixedChevron.style.top).toBe(fixedChevronTop)

        dispatchPointerClick(chevronControl.querySelector('.sliding-dropdown-chevron-hit')!)
        vi.runAllTimers()

        expect(slidingDropdown.isOpen()).toBe(false)
        expect(svg.querySelector('.sliding-dropdown-chevron-control')).toBe(chevronControl)
        expect(chevronIcon.getAttribute('transform')).toBe('rotate(0)')
    })

    it('layers its open portal below help tooltips', () => {
        const { svg, slidingDropdown } = mount('square')

        slidingDropdown.setOpen(true)
        vi.runAllTimers()

        const scrollPortal = svg.closest('.sliding-dropdown-scroll-portal') as HTMLDivElement
        const chevronPortal = document.querySelector('.sliding-dropdown-chevron-portal') as SVGSVGElement
        expect(scrollPortal.style.zIndex).toBe('10110')
        expect(chevronPortal.style.zIndex).toBe('10110')
    })

    it('keeps content padding and the chevron gap when the selected border is enabled', () => {
        uiKitSettings.slidingDropdown.styles.indicator.closedBorderWidth = 4
        uiKitSettings.slidingDropdown.styles.indicator.openBorderWidth = 4
        const { svg } = mountWithOptions([{ label: 'Bordered', value: 'bordered' }], 'bordered')
        const label = optionLabel(svg, 'bordered')
        const chevronControl = svg.querySelector('.sliding-dropdown-chevron-control') as SVGGElement
        const indicator = svg.querySelector('.sliding-dropdown-indicator') as SVGRectElement
        const borderWidth = uiKitSettings.slidingDropdown.styles.indicator.closedBorderWidth
        const indicatorOuterRight = Number(indicator.getAttribute('x'))
            + Number(indicator.getAttribute('width'))
            + borderWidth / 2

        expect(Number(label.getAttribute('x'))).toBe(2 + borderWidth / 2 + 12)
        expect(translationX(chevronControl) - indicatorOuterRight).toBe(11)
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
        shadowTransitionDurations.length = 0
        shadowTransitionEasings.length = 0
        resetTransitionInspection()
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
            const expandedSurfaceWidth = surfaceWidth(svg)
            expect(scrollPortal.parentElement).toBe(document.body)
            expect(scrollPortal.style.pointerEvents).toBe('auto')
            expect(scrollPortal.style.overflowY).toBe('auto')
            expect(scrollPortal.scrollTop).toBe(selectedIndex * HEIGHT * 2)
            expect(svg.getAttribute('viewBox')).toBe(`0 0 ${expandedSurfaceWidth} ${OPTIONS.length * HEIGHT}`)
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

    it('preserves row height and corner radius while content exceeds the requested width', () => {
        const { svg, slidingDropdown } = mount(
            'landscape',
            vi.fn(),
            IMMEDIATE_TRANSITION,
            { width: HEIGHT, height: HEIGHT },
        )
        const indicator = svg.querySelector('.sliding-dropdown-indicator')!
        const viewportClip = svg.querySelector('clipPath rect')!
        const closedSurfaceWidth = surfaceWidth(svg)

        expect(closedSurfaceWidth).toBeGreaterThan(HEIGHT)
        expect(indicator.getAttribute('width')).toBe(String(closedSurfaceWidth - 4))
        expect(indicator.getAttribute('height')).toBe(String(HEIGHT - 4))
        expect(indicator.getAttribute('rx')).toBe(String((HEIGHT - 4) / 2))
        expect(viewportClip.getAttribute('width')).toBe(String(closedSurfaceWidth))
        expect(viewportClip.getAttribute('rx')).toBe(String(HEIGHT / 2))

        slidingDropdown.setOpen(true)
        vi.runAllTimers()

        const expandedSurfaceWidth = surfaceWidth(svg)
        expect(indicator.getAttribute('width')).toBe(String(expandedSurfaceWidth - 4))
        expect(indicator.getAttribute('height')).toBe(String(HEIGHT - 4))
        expect(indicator.getAttribute('rx')).toBe(String((HEIGHT - 4) / 2))
        for (const option of svg.querySelectorAll('.sliding-dropdown-hit')) {
            expect(option.getAttribute('width')).toBe(String(expandedSurfaceWidth - 4))
            expect(option.getAttribute('height')).toBe(String(HEIGHT - 4))
            expect(option.getAttribute('rx')).toBe(String((HEIGHT - 4) / 2))
        }
    })

    it('uses configured surface, indicator, border, and option styles for each state', () => {
        const { svg, slidingDropdown } = mount('landscape')
        const styles = uiKitSettings.slidingDropdown.styles
        const track = svg.querySelector('.sliding-dropdown-track')!
        const indicator = svg.querySelector('.sliding-dropdown-indicator')!
        const indicatorBorder = svg.querySelector('.sliding-dropdown-indicator-inset-shadow')!
        const selectedLabel = svg.querySelector('.sliding-dropdown-option-group[data-value="landscape"] text')!

        expect(track.getAttribute('fill')).toBe(styles.surface.closedBackgroundColor)
        expect(indicator.getAttribute('fill')).toBe(styles.indicator.backgroundColor)
        expect(indicatorBorder.getAttribute('stroke')).toBe(styles.indicator.closedBorderColor)
        expect(styles.indicator.closedBorderWidth).toBe(0)
        expect(indicatorBorder.getAttribute('stroke-width')).toBe(String(styles.indicator.closedBorderWidth))
        expect(selectedLabel.getAttribute('fill')).toBe(styles.option.activeTextColor)
        expect(selectedLabel.getAttribute('font-size')).toBe(String(styles.option.fontSize))
        expect(selectedLabel.getAttribute('font-weight')).toBe(String(styles.option.selectedFontWeight))

        slidingDropdown.setOpen(true)
        vi.runAllTimers()

        expect(track.getAttribute('fill')).toBe(styles.surface.openBackgroundColor)
        expect(indicatorBorder.getAttribute('stroke')).toBe(styles.indicator.openBorderColor)
        expect(indicatorBorder.getAttribute('stroke-width')).toBe(String(styles.indicator.openBorderWidth))

        slidingDropdown.setOpen(false)

        expect(track.getAttribute('fill')).toBe(styles.surface.closedBackgroundColor)
        expect(indicatorBorder.getAttribute('stroke')).toBe(styles.indicator.closedBorderColor)
        expect(indicatorBorder.getAttribute('stroke-width')).toBe(String(styles.indicator.closedBorderWidth))
    })

    it('starts its separate shadow with opening and removes it on the first closing frame', () => {
        const { svg, slidingDropdown } = mount('landscape', vi.fn(), null)
        const openShadow = svg.querySelector('.sliding-dropdown-open-shadow') as SVGRectElement
        const shadowFilter = svg.querySelector('.sliding-dropdown-open-shadow-filter') as SVGFilterElement
        const shadowStyle = uiKitSettings.slidingDropdown.styles.openShadow

        expect(openShadow.getAttribute('display')).toBe('none')
        expect(openShadow.getAttribute('filter')).toBe(`url(#${shadowFilter.id})`)
        expect(shadowFilter.querySelector('feMorphology')?.getAttribute('radius')).toBe(String(shadowStyle.spreadRadius))
        expect(shadowFilter.querySelector('feGaussianBlur')?.getAttribute('stdDeviation')).toBe(String(shadowStyle.blurRadius / 2))
        expect(shadowFilter.querySelector('feOffset')?.getAttribute('dx')).toBe(String(shadowStyle.offsetX))
        expect(shadowFilter.querySelector('feOffset')?.getAttribute('dy')).toBe(String(shadowStyle.offsetY))
        expect(shadowFilter.querySelector('feFlood')?.getAttribute('flood-color')).toBe(shadowStyle.color)
        expect(shadowFilter.querySelector('feFlood')?.getAttribute('flood-opacity')).toBe(String(shadowStyle.opacity))

        slidingDropdown.setOpen(true)

        expect(openShadow.getAttribute('display')).toBeNull()
        expect(shadowTransitionDurations).toEqual([200])
        expect(shadowTransitionEasings).toEqual([easePupOut])

        vi.advanceTimersByTime(200)

        slidingDropdown.setOpen(false)
        expect(openShadow.getAttribute('display')).toBe('none')
        expect(shadowTransitionDurations).toEqual([200])
        expect(shadowTransitionEasings).toEqual([easePupOut])

        vi.advanceTimersByTime(139)
        expect(openShadow.getAttribute('display')).toBe('none')

        vi.advanceTimersByTime(1)
        expect(openShadow.getAttribute('display')).toBe('none')
    })
})

// =============================================================================
// MOTION AND SNAP TIMING
// =============================================================================

describe('createSlidingDropdown — motion and snap timing', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        transitionDurations.length = 0
        transitionEasings.length = 0
        shadowTransitionDurations.length = 0
        shadowTransitionEasings.length = 0
        resetTransitionInspection()
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
        const expandedSurfaceWidth = surfaceWidth(svg)
        const frameY = Number(indicator.getAttribute('y'))
        const frameScreenY = renderedSvgTop(svg) + frameY * 2

        dispatchPointerClick(optionHit(svg, 'automatic'))

        expect(slidingDropdown.isOpen()).toBe(false)
        expect(svg.style.height).toBe(`${OPTIONS.length * HEIGHT * 2}px`)
        expect(svg.getAttribute('viewBox')).toBe(`0 0 ${expandedSurfaceWidth} ${OPTIONS.length * HEIGHT}`)
        expect(renderedSvgTop(svg) + Number(indicator.getAttribute('y')) * 2).toBe(frameScreenY)
        expect(optionsGroup.getAttribute('transform')).toBe(`translate(0, ${-2 * HEIGHT})`)
        expect(
            Number(optionHit(svg, 'automatic').getAttribute('y')) - 2 * HEIGHT,
        ).toBe(frameY)
        expect(viewportClip.getAttribute('y')).toBe(String(HEIGHT))
        expect(viewportClip.getAttribute('height')).toBe(String(HEIGHT))
        expect(slidingDropdown.getValue()).toBe('landscape')
        expect(onChange).not.toHaveBeenCalled()

        vi.advanceTimersByTime(311)
        expect(slidingDropdown.getValue()).toBe('landscape')
        expect(onChange).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)

        expect(transitionEasings.length).toBeGreaterThan(0)
        expect(transitionEasings.every(easing => easing === easePupOut)).toBe(true)
        expect(Math.max(...transitionDurations)).toBe(312)
        expect(svg.style.height).toBe(`${HEIGHT}px`)
        expect(svg.getAttribute('viewBox')).toBe(`0 0 ${surfaceWidth(svg)} ${HEIGHT}`)
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
        const expandedSurfaceWidth = surfaceWidth(svg)

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
        expect(svg.getAttribute('viewBox')).toBe(`0 0 ${expandedSurfaceWidth} ${OPTIONS.length * HEIGHT}`)
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
