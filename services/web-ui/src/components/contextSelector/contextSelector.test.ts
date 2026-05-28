import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createContextSelector } from '$src/components/contextSelector/contextSelector.ts'

type Mode = 'followSelection' | 'pinnedContext'

const options = [
    { label: 'Follow', value: 'followSelection' as Mode },
    { label: 'Pinned', value: 'pinnedContext' as Mode },
]

function make(selectedValue: Mode = 'followSelection', onChange = vi.fn()) {
    const selector = createContextSelector<Mode>({ id: 'ctx', options, selectedValue, onChange })
    return { selector, onChange }
}

const optionButtons = (dom: HTMLElement) =>
    Array.from(dom.querySelectorAll<HTMLButtonElement>('.context-selector-option'))

// =============================================================================
// INITIAL STATE
// =============================================================================

describe('createContextSelector — initial state', () => {
    it('renders a radiogroup with one radio per option and reflects the selected value', () => {
        const { selector } = make('pinnedContext')

        expect(selector.dom.getAttribute('role')).toBe('radiogroup')
        const buttons = optionButtons(selector.dom)
        expect(buttons).toHaveLength(2)
        expect(buttons[1]!.getAttribute('aria-checked')).toBe('true')
        expect(buttons[0]!.getAttribute('aria-checked')).toBe('false')
        expect(selector.getValue()).toBe('pinnedContext')
    })

    it('falls back to the first option when the selected value is not in the options', () => {
        const selector = createContextSelector<Mode>({
            id: 'ctx',
            options,
            selectedValue: 'nope' as Mode,
        })
        expect(selector.getValue()).toBe('followSelection')
    })

    it('throws when constructed with no options', () => {
        expect(() => createContextSelector({ id: 'ctx', options: [] })).toThrow()
    })

    it('positions the indicator at the selected index via a CSS translateX transform', () => {
        const { selector } = make('pinnedContext')
        const indicator = selector.dom.querySelector<HTMLElement>('.context-selector-indicator')!
        expect(indicator.style.transform).toBe('translateX(100%)')
    })
})

// =============================================================================
// SELECTION + onChange
// =============================================================================

describe('createContextSelector — interaction', () => {
    let selector: ReturnType<typeof createContextSelector<Mode>>
    let onChange: ReturnType<typeof vi.fn>

    beforeEach(() => {
        ;({ selector, onChange } = make('followSelection'))
    })

    it('clicking an option selects it, fires onChange, and moves the indicator', () => {
        optionButtons(selector.dom)[1]!.click()

        expect(selector.getValue()).toBe('pinnedContext')
        expect(onChange).toHaveBeenCalledExactlyOnceWith('pinnedContext')
        const indicator = selector.dom.querySelector<HTMLElement>('.context-selector-indicator')!
        expect(indicator.style.transform).toBe('translateX(100%)')
        expect(optionButtons(selector.dom)[1]!.getAttribute('aria-checked')).toBe('true')
    })

    it('does not fire onChange when the already-selected option is clicked again', () => {
        optionButtons(selector.dom)[0]!.click()
        expect(onChange).not.toHaveBeenCalled()
        expect(selector.getValue()).toBe('followSelection')
    })

    it('cycles with ArrowRight / ArrowLeft and reports each change', () => {
        const buttons = optionButtons(selector.dom)
        buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(selector.getValue()).toBe('pinnedContext')

        buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
        expect(selector.getValue()).toBe('followSelection')
        expect(onChange).toHaveBeenCalledTimes(2)
    })

    it('setValue updates state and ARIA without firing onChange', () => {
        selector.setValue('pinnedContext')

        expect(selector.getValue()).toBe('pinnedContext')
        expect(onChange).not.toHaveBeenCalled()
        expect(optionButtons(selector.dom)[1]!.getAttribute('aria-checked')).toBe('true')
    })

    it('ignores setValue for a value outside the options', () => {
        selector.setValue('bogus' as Mode)
        expect(selector.getValue()).toBe('followSelection')
    })
})
