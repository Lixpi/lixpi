import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { createPureDropdown } from '$src/components/dropdown/index.ts'
import { settings } from '$src/settings.ts'

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

function createModalityDropdown() {
    const onSelect = vi.fn()
    const options = [
        { title: 'Vision', value: 'vision', tags: ['image', 'vision'] },
        { title: 'Text Only', value: 'text', tags: ['text'] },
        { title: 'Multimodal', value: 'multi', tags: ['text', 'image'] },
    ]

    const dropdown = createPureDropdown({
        id: 'modality-dropdown',
        selectedValue: options[0],
        options,
        enableTagFilter: true,
        availableTags: ['image', 'text'],
        onSelect,
    })

    return { dropdown, onSelect, options }
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

describe('pureDropdown — modality filter behavior', () => {
    const previousModalityFilter = settings.modelSelectorDropdown.useModalityFilter

    beforeEach(() => {
        settings.modelSelectorDropdown.useModalityFilter = true
        document.body.innerHTML = ''
    })

    afterEach(() => {
        settings.modelSelectorDropdown.useModalityFilter = previousModalityFilter
        document.body.innerHTML = ''
    })

    it('renders modality filter controls when enabled', () => {
        const { dropdown, options } = createModalityDropdown()
        document.body.appendChild(dropdown.dom)

        expect(dropdown.dom.querySelector('.tag-filter')).not.toBeNull()
        expect(dropdown.dom.querySelectorAll('.tag-filter-item')).toHaveLength(2)

        const submenu = dropdown.dom.querySelector('.submenu')!
        expect(submenu.querySelectorAll('li')).toHaveLength(options.length)
    })

    it('filters options when tags are toggled', () => {
        const { dropdown, options } = createModalityDropdown()
        document.body.appendChild(dropdown.dom)

        const imageTag = dropdown.dom.querySelector<HTMLElement>('.tag-filter-item[data-tag="image"]')!
        imageTag.click()

        const filteredOptions = dropdown.dom.querySelectorAll('.submenu li')
        expect(filteredOptions).toHaveLength(2)
        expect(filteredOptions[0].textContent).toContain('Vision')
        expect(filteredOptions[1].textContent).toContain('Multimodal')

        const textTag = dropdown.dom.querySelector<HTMLElement>('.tag-filter-item[data-tag="text"]')!
        textTag.click()

        const textFilteredOptions = dropdown.dom.querySelectorAll('.submenu li')
        expect(textFilteredOptions).toHaveLength(1)
        expect(textFilteredOptions[0].textContent).toContain('Multimodal')
    })

    it('adds and removes click feedback class on tag controls', () => {
        vi.useFakeTimers()

        try {
            const { dropdown } = createModalityDropdown()
            document.body.appendChild(dropdown.dom)

            const imageTag = dropdown.dom.querySelector<HTMLElement>('.tag-filter-item[data-tag="image"]')!
            imageTag.click()

            expect(imageTag.classList.contains('click-feedback')).toBe(true)

            vi.advanceTimersByTime(151)
            expect(imageTag.classList.contains('click-feedback')).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('pureDropdown — wheel behavior', () => {
    let list: HTMLUListElement
    let dropdownDom: HTMLElement

    beforeEach(() => {
        const { dropdown } = createTestDropdown()
        dropdownDom = dropdown.dom
        list = dropdownDom.querySelector('.submenu') as HTMLUListElement
        document.body.appendChild(dropdownDom)
        Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 })
        Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 200 })
        Object.defineProperty(list, 'scrollTop', { configurable: true, value: 0, writable: true })
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('stops propagation only when dropdown can actually scroll in that direction', () => {
        const wheelDownEvent = new WheelEvent('wheel', { bubbles: true, deltaY: 120 })
        const stopSpy = vi.spyOn(wheelDownEvent, 'stopPropagation')

        list.dispatchEvent(wheelDownEvent)
        expect(stopSpy).not.toHaveBeenCalled()

        Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 400 })

        const wheelToScrollEvent = new WheelEvent('wheel', { bubbles: true, deltaY: 120 })
        const canScrollStopSpy = vi.spyOn(wheelToScrollEvent, 'stopPropagation')
        list.dispatchEvent(wheelToScrollEvent)
        expect(canScrollStopSpy).toHaveBeenCalled()

        list.scrollTop = 400
        const wheelAtBottomEvent = new WheelEvent('wheel', { bubbles: true, deltaY: 120 })
        const atBottomStopSpy = vi.spyOn(wheelAtBottomEvent, 'stopPropagation')
        list.dispatchEvent(wheelAtBottomEvent)
        expect(atBottomStopSpy).not.toHaveBeenCalled()
    })

    it('prevents default on ctrl-wheel zoom events', () => {
        const wheelEvent = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
        Object.defineProperty(wheelEvent, 'ctrlKey', { configurable: true, value: true })
        const preventSpy = vi.spyOn(wheelEvent, 'preventDefault')

        list.dispatchEvent(wheelEvent)

        expect(preventSpy).toHaveBeenCalled()
    })
})

describe('pureDropdown — mount behavior', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('applies configured popover box shadow via dropdown settings', () => {
        const { dropdown } = createTestDropdown()
        document.body.appendChild(dropdown.dom)

        const popover = dropdown.dom.querySelector('.dropdown-menu-popover')
        expect(popover).not.toBeNull()
        expect(popover!.style.getPropertyValue('--dropdown-popover-box-shadow')).toBe(settings.dropdown.styles.popoverBoxShadow)
    })

    it('reads the popover box shadow from settings when the dropdown is created', () => {
        const previousShadow = settings.dropdown.styles.popoverBoxShadow
        settings.dropdown.styles.popoverBoxShadow = '0 0 0 4px rgba(1, 2, 3, 0.5)'

        try {
            const { dropdown } = createTestDropdown()
            document.body.appendChild(dropdown.dom)

            const popover = dropdown.dom.querySelector('.dropdown-menu-popover') as HTMLElement
            expect(popover.style.getPropertyValue('--dropdown-popover-box-shadow')).toBe('0 0 0 4px rgba(1, 2, 3, 0.5)')
        } finally {
            settings.dropdown.styles.popoverBoxShadow = previousShadow
        }
    })

    it('mounts its popover directly in the body when mountToBody is enabled', () => {
        const onSelect = vi.fn()
        const dropdown = createPureDropdown({
            id: 'body-mount-dropdown',
            selectedValue: defaultOptions[0],
            options: defaultOptions,
            mountToBody: true,
            onSelect,
        })

        const popover = document.body.querySelector('.dropdown-menu-popover')
        expect(popover).not.toBeNull()
        expect(dropdown.dom.querySelector('.dropdown-menu-popover')).toBeNull()

        document.body.appendChild(dropdown.dom)
        dropdown.dom.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(document.body.querySelector('.dropdown-menu-popover')).toBe(popover)
    })
})
