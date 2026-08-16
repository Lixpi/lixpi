import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createMediaGenerationTraceButton,
    isMediaGenerationTraceActive,
} from './mediaGenerationTraceButton.ts'

afterEach(() => {
    vi.useRealTimers()
})

describe('media generation trace button', () => {
    it('uses the shared ripple marker while generation is active', () => {
        vi.useFakeTimers()
        const control = createMediaGenerationTraceButton({
            status: 'running',
            selected: false,
            onClick: vi.fn(),
        })

        expect(control.element.classList.contains('is-active')).toBe(true)
        expect(control.element.classList.contains('is-static')).toBe(false)
        expect(control.element.querySelector('.progress-ripple-icon-svg')).not.toBeNull()
        expect(vi.getTimerCount()).toBeGreaterThan(0)
        control.destroy()
    })

    it('stops the ripple and reflects sidebar selection after the run finishes', () => {
        vi.useFakeTimers()
        const onClick = vi.fn()
        const control = createMediaGenerationTraceButton({
            status: 'running',
            selected: false,
            onClick,
        })

        control.update('completed', true)
        control.element.click()

        expect(control.element.classList.contains('is-active')).toBe(false)
        expect(control.element.classList.contains('is-static')).toBe(true)
        expect(control.element.classList.contains('is-selected')).toBe(true)
        expect(control.element.getAttribute('aria-expanded')).toBe('true')
        expect(control.element.querySelector('.marker-middle')).not.toBeNull()
        expect(control.element.querySelector('.marker-outer')).not.toBeNull()
        expect(control.element.querySelector('.marker-center')).not.toBeNull()
        expect(onClick).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
        control.destroy()
    })

    it('only treats non-terminal generation states as active', () => {
        expect(isMediaGenerationTraceActive('pending')).toBe(true)
        expect(isMediaGenerationTraceActive('running')).toBe(true)
        expect(isMediaGenerationTraceActive('awaiting-provider-verification')).toBe(true)
        expect(isMediaGenerationTraceActive('completed')).toBe(false)
        expect(isMediaGenerationTraceActive('failed')).toBe(false)
        expect(isMediaGenerationTraceActive('cancelled')).toBe(false)
    })
})
