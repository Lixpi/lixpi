import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { createPureDropdown } from '$src/components/dropdown/index.ts'

const defaultOptions = [
    { title: 'Model A', value: 'a' },
    { title: 'Model B', value: 'b' },
]

function createTestDropdown() {
    const onSelect = vi.fn()
    const dropdown = createPureDropdown({
        id: 'test-dropdown',
        selectedValue: defaultOptions[0],
        options: defaultOptions,
        onSelect,
    })

    const button = dropdown.dom.querySelector('button')!
    const firstOption = dropdown.dom.querySelector('.submenu li') as HTMLElement

    return {
        dropdown,
        onSelect,
        button,
        firstOption,
    }
}

describe('pureDropdown — outside click behavior', () => {
    let addEventListenerSpy: ReturnType<typeof vi.spyOn>
    let removeEventListenerSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        document.body.innerHTML = ''
        addEventListenerSpy = vi.spyOn(document, 'addEventListener')
        removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
    })

    afterEach(() => {
        addEventListenerSpy.mockRestore()
        removeEventListenerSpy.mockRestore()
        document.body.innerHTML = ''
    })

    it('closes on document mousedown outside the dropdown', () => {
        const { dropdown, button } = createTestDropdown()
        document.body.appendChild(dropdown.dom)

        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(dropdown.dom.classList.contains('dropdown-open')).toBe(true)

        const outside = document.createElement('div')
        document.body.appendChild(outside)
        outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

        expect(dropdown.dom.classList.contains('dropdown-open')).toBe(false)
    })

    it('does not close when mousedown target is inside the dropdown', () => {
        const { dropdown, button, firstOption } = createTestDropdown()
        document.body.appendChild(dropdown.dom)

        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(dropdown.dom.classList.contains('dropdown-open')).toBe(true)

        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        firstOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

        expect(dropdown.dom.classList.contains('dropdown-open')).toBe(true)
    })

    it('keeps the dropdown open/closed lifecycle in sync with infoBubble state', () => {
        const { dropdown } = createTestDropdown()

        dropdown.dom.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(dropdown.dom.classList.contains('dropdown-open')).toBe(true)

        dropdown.dom.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(dropdown.dom.classList.contains('dropdown-open')).toBe(false)
    })

    it('registers a mousedown listener on create and removes it on destroy', () => {
        const { dropdown } = createTestDropdown()

        expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function), true)

        dropdown.destroy()

        expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function), true)
    })
})
