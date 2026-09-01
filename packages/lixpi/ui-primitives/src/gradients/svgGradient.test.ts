'use strict'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { Easing } from '../animation/index.ts'
import { SvgGradientRenderer } from './svgGradient.ts'

type StopRecord = {
    attrs: Record<string, unknown>
    styles: Record<string, unknown>
}

type TransitionRecord = {
    duration?: number
    ease?: (progress: number) => number
    attrs: Record<string, unknown>
    onEnd?: () => void
}

function createStopRecorder(): { gradient: any; stops: StopRecord[] } {
    const stops: StopRecord[] = []

    return {
        stops,
        gradient: {
            append: vi.fn((tagName: string) => {
                expect(tagName).toBe('stop')
                const stop: StopRecord = { attrs: {}, styles: {} }
                stops.push(stop)

                const selection = {
                    attr: vi.fn((name: string, value: unknown) => {
                        stop.attrs[name] = value
                        return selection
                    }),
                    style: vi.fn((name: string, value: unknown) => {
                        stop.styles[name] = value
                        return selection
                    }),
                }

                return selection
            }),
        },
    }
}

function createTransitionRecorder(): { gradient: any; transitions: TransitionRecord[] } {
    const transitions: TransitionRecord[] = []

    return {
        transitions,
        gradient: {
            interrupt: vi.fn(),
            transition: vi.fn(() => {
                const transition: TransitionRecord = { attrs: {} }
                transitions.push(transition)

                const selection = {
                    duration: vi.fn((duration: number) => {
                        transition.duration = duration
                        return selection
                    }),
                    ease: vi.fn((ease: (progress: number) => number) => {
                        transition.ease = ease
                        return selection
                    }),
                    attr: vi.fn((name: string, value: unknown) => {
                        transition.attrs[name] = value
                        return selection
                    }),
                    on: vi.fn((eventName: string, callback: () => void) => {
                        expect(eventName).toBe('end')
                        transition.onEnd = callback
                        return selection
                    }),
                }

                return selection
            }),
        },
    }
}

describe('SvgGradientRenderer', () => {
    it('appends evenly-spaced linear gradient stops with optional ids', () => {
        const { gradient, stops } = createStopRecorder()

        SvgGradientRenderer.appendLinearGradientStops(gradient, ['#111111', '#222222', '#333333'], {
            idPrefix: 'test-stop',
        })

        expect(stops).toEqual([
            { attrs: { offset: '0%', id: 'test-stop-0' }, styles: { 'stop-color': '#111111' } },
            { attrs: { offset: '50%', id: 'test-stop-1' }, styles: { 'stop-color': '#222222' } },
            { attrs: { offset: '100%', id: 'test-stop-2' }, styles: { 'stop-color': '#333333' } },
        ])
    })

    it('keeps a single linear gradient stop at the start of the gradient', () => {
        const { gradient, stops } = createStopRecorder()

        SvgGradientRenderer.appendLinearGradientStops(gradient, ['#111111'])

        expect(stops).toEqual([
            { attrs: { offset: '0%' }, styles: { 'stop-color': '#111111' } },
        ])
    })

    it('appends repeated stops for looping gradient borders', () => {
        const { gradient, stops } = createStopRecorder()

        SvgGradientRenderer.appendRepeatingLinearGradientStops(gradient, ['#111111', '#222222'], 2)

        expect(stops).toHaveLength(7)
        expect(stops[0]).toEqual({ attrs: { offset: '0%' }, styles: { 'stop-color': '#111111' } })
        expect(Number.parseFloat(stops[1].attrs.offset as string)).toBeCloseTo(100 / 6)
        expect(stops[1].styles).toEqual({ 'stop-color': '#222222' })
        expect(stops[6]).toEqual({ attrs: { offset: '100%' }, styles: { 'stop-color': '#111111' } })
    })

    it('does not append repeating stops for an empty color set', () => {
        const { gradient, stops } = createStopRecorder()

        SvgGradientRenderer.appendRepeatingLinearGradientStops(gradient, [])

        expect(gradient.append).not.toHaveBeenCalled()
        expect(stops).toEqual([])
    })

    it('starts and stops a rotating linear gradient transition', () => {
        const { gradient, transitions } = createTransitionRecorder()
        const customEase = vi.fn((progress: number) => progress)

        const animation = SvgGradientRenderer.startRotatingLinearGradient(gradient, {
            center: { x: 0.5, y: 0.5 },
            radius: 0.5,
            duration: 50,
            angleStep: -0.25,
            ease: customEase,
        })

        expect(transitions).toHaveLength(1)
        expect(transitions[0].duration).toBe(50)
        expect(transitions[0].ease).toBe(customEase)
        expect(transitions[0].attrs.x1).toBeCloseTo(1)
        expect(transitions[0].attrs.y1).toBeCloseTo(0.5)
        expect(transitions[0].attrs.x2).toBeCloseTo(0)
        expect(transitions[0].attrs.y2).toBeCloseTo(0.5)

        transitions[0].onEnd?.()

        expect(transitions).toHaveLength(2)
        expect(transitions[1].attrs.x1).not.toBe(transitions[0].attrs.x1)

        animation.stop()
        expect(gradient.interrupt).toHaveBeenCalledTimes(1)

        transitions[1].onEnd?.()
        expect(transitions).toHaveLength(2)
    })

    it('uses the shared hover transition by default', () => {
        const { gradient, transitions } = createTransitionRecorder()

        SvgGradientRenderer.startRotatingLinearGradient(gradient, {
            center: { x: 0, y: 0 },
            radius: 1,
            duration: 100,
        })

        expect(transitions[0].ease).toBe(Easing.hoverTransition)
    })
})
