// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { InteractivePreviewPopover } from './interactivePreviewPopover.ts'

describe('InteractivePreviewPopover', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        document.body.innerHTML = ''
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('opens for pointer and focus, stays open in interactive content, and closes outside', () => {
        const trigger = document.createElement('button')
        const popover = document.createElement('div')
        const action = document.createElement('button')
        popover.append(action)
        const root = document.createElement('div')
        root.append(trigger, popover)
        document.body.append(root)
        new InteractivePreviewPopover({ root, trigger, popover })

        root.dispatchEvent(new PointerEvent('pointerenter'))
        expect(root.classList.contains('is-open')).toBe(true)
        popover.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: trigger }))
        root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: action }))
        vi.advanceTimersByTime(100)
        expect(root.classList.contains('is-open')).toBe(true)
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        expect(root.classList.contains('is-open')).toBe(false)
    })

    it('closes on Escape and returns focus to the trigger', () => {
        const trigger = document.createElement('button')
        const popover = document.createElement('div')
        const action = document.createElement('button')
        popover.append(action)
        const root = document.createElement('div')
        root.append(trigger, popover)
        document.body.append(root)
        new InteractivePreviewPopover({ root, trigger, popover })

        action.focus()
        expect(root.classList.contains('is-open')).toBe(true)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        expect(root.classList.contains('is-open')).toBe(false)
        expect(document.activeElement).toBe(trigger)
    })
})
