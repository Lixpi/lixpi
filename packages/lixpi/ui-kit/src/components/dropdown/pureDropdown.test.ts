import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { uiKitSettings } from '../../runtime-settings.ts'
import { createPureDropdown } from './index.ts'

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

describe('pureDropdown — selection and API updates', () => {
    it('updates selected option, closes dropdown, and notifies parent callback on click', () => {
        const { dropdown, onSelect } = createTestDropdown()
        document.body.appendChild(dropdown.dom)

        const trigger = dropdown.dom.querySelector('button') as HTMLButtonElement
        const optionItems = dropdown.dom.querySelectorAll('.submenu li')

        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        optionItems[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))

        const title = dropdown.dom.querySelector('.title')
        expect(title?.textContent).toBe('Model B')
        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onSelect).toHaveBeenCalledWith(defaultOptions[1])
        expect(dropdown.dom.classList.contains('dropdown-open')).toBe(false)
    })

    it('updates selected display from public update()', () => {
        const { dropdown } = createTestDropdown()

        const title = dropdown.dom.querySelector('.title') as HTMLElement
        expect(title.textContent).toBe('Model A')

        dropdown.update(defaultOptions[1])

        expect(title.textContent).toBe('Model B')
    })

    it('replaces options and selected value via setOptions()', () => {
        const previousModalityFilter = uiKitSettings.modelSelectorDropdown.useModalityFilter
        uiKitSettings.modelSelectorDropdown.useModalityFilter = true

        try {
            const { dropdown } = createModalityDropdown()
            const replacementOptions = [
                { title: 'Text 2', value: 'text-2', tags: ['text'] },
                { title: 'Image 2', value: 'image-2', tags: ['image'] },
                { title: 'Video 2', value: 'video-2', tags: ['video'] },
            ]

            dropdown.setOptions({
                options: replacementOptions,
                availableTags: ['video'],
                selectedValue: replacementOptions[2],
            })

            const title = dropdown.dom.querySelector('.title') as HTMLElement
            const optionItems = dropdown.dom.querySelectorAll('.submenu li')

            expect(optionItems).toHaveLength(replacementOptions.length)
            expect(title.textContent).toBe('Video 2')
        } finally {
            uiKitSettings.modelSelectorDropdown.useModalityFilter = previousModalityFilter
        }
    })
})

describe('pureDropdown — modality filter flag', () => {
    const previousModalityFilter = uiKitSettings.modelSelectorDropdown.useModalityFilter

    beforeEach(() => {
        uiKitSettings.modelSelectorDropdown.useModalityFilter = false
        document.body.innerHTML = ''
    })

    afterEach(() => {
        uiKitSettings.modelSelectorDropdown.useModalityFilter = previousModalityFilter
        document.body.innerHTML = ''
    })

    it('does not render tag filter UI when global modality filter flag is off', () => {
        const { dropdown } = createModalityDropdown()
        document.body.appendChild(dropdown.dom)

        expect(dropdown.dom.querySelector('.tag-filter')).toBeNull()
        expect(dropdown.dom.querySelectorAll('.tag-filter-item')).toHaveLength(0)
    })
})

describe('pureDropdown — modality filter behavior', () => {
    const previousModalityFilter = uiKitSettings.modelSelectorDropdown.useModalityFilter

    beforeEach(() => {
        uiKitSettings.modelSelectorDropdown.useModalityFilter = true
        document.body.innerHTML = ''
    })

    afterEach(() => {
        uiKitSettings.modelSelectorDropdown.useModalityFilter = previousModalityFilter
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

describe('pureDropdown — error state', () => {
    it('shows fallback error title and color, then restores selected value when cleared', () => {
        const { dropdown } = createTestDropdown()
        const title = dropdown.dom.querySelector('.title') as HTMLElement

        dropdown.setErrorState({ enabled: true })

        expect(dropdown.dom.classList.contains('dropdown-error-state')).toBe(true)
        expect(title.textContent).toBe(uiKitSettings.dropdown.errorState.fallbackTitle)
        expect(title.style.color).toBe(uiKitSettings.dropdown.errorState.textColor)

        dropdown.setErrorState(undefined)

        expect(dropdown.dom.classList.contains('dropdown-error-state')).toBe(false)
        expect(title.textContent).toBe('Model A')
    })

    it('uses custom title and text color when provided', () => {
        const { dropdown } = createTestDropdown()
        const title = dropdown.dom.querySelector('.title') as HTMLElement

        dropdown.setErrorState({ enabled: true, title: 'Custom error', textColor: 'rgb(1, 2, 3)' })

        expect(title.textContent).toBe('Custom error')
        expect(title.style.color).toBe('rgb(1, 2, 3)')
    })

    it('treats enabled: false as inactive and keeps showing the selected value', () => {
        const { dropdown } = createTestDropdown()
        const title = dropdown.dom.querySelector('.title') as HTMLElement

        dropdown.setErrorState({ enabled: false, title: 'Should not show' })

        expect(dropdown.dom.classList.contains('dropdown-error-state')).toBe(false)
        expect(title.textContent).toBe('Model A')
    })
})

describe('pureDropdown — icon rendering', () => {
    const iconOptions = [
        { title: 'Red', value: 'red', icon: '<svg></svg>', color: 'red' },
        { title: 'Blue', value: 'blue', icon: '<svg></svg>', color: 'blue' },
    ]

    it('injects the option color into selected and list icons by default', () => {
        const onSelect = vi.fn()
        const dropdown = createPureDropdown({
            id: 'icon-dropdown',
            selectedValue: iconOptions[0],
            options: iconOptions,
            onSelect,
        })

        const selectedIcon = dropdown.dom.querySelector('.selected-option-icon')!
        expect(selectedIcon.innerHTML).toContain('style="fill: red"')

        const optionIconSpan = dropdown.dom.querySelector('.submenu li span')!
        expect(optionIconSpan.innerHTML).toContain('style="fill: red"')
    })

    it('skips color injection when ignoreColorValues flags are set', () => {
        const onSelect = vi.fn()
        const dropdown = createPureDropdown({
            id: 'icon-dropdown-no-color',
            selectedValue: iconOptions[0],
            options: iconOptions,
            ignoreColorValuesForSelectedValue: true,
            ignoreColorValuesForOptions: true,
            onSelect,
        })

        const selectedIcon = dropdown.dom.querySelector('.selected-option-icon')!
        expect(selectedIcon.innerHTML).not.toContain('style=')

        const optionIconSpan = dropdown.dom.querySelector('.submenu li span')!
        expect(optionIconSpan.innerHTML).not.toContain('style=')
    })

    it('omits selected-value icon and title rendering when disabled', () => {
        const onSelect = vi.fn()
        const dropdown = createPureDropdown({
            id: 'icon-dropdown-disabled',
            selectedValue: iconOptions[0],
            options: iconOptions,
            renderIconForSelectedValue: false,
            renderTitleForSelectedValue: false,
            onSelect,
        })

        const selectedIcon = dropdown.dom.querySelector('.selected-option-icon')!
        const title = dropdown.dom.querySelector('.title')!
        expect(selectedIcon.innerHTML).toBe('')
        expect(title.textContent).toBe('')
    })

    it('omits option icons in the list when renderIconForOptions is disabled', () => {
        const onSelect = vi.fn()
        const dropdown = createPureDropdown({
            id: 'icon-dropdown-no-option-icons',
            selectedValue: iconOptions[0],
            options: iconOptions,
            renderIconForOptions: false,
            onSelect,
        })

        expect(dropdown.dom.querySelector('.submenu li span')).toBeNull()
    })
})

describe('pureDropdown — rerender', () => {
    it('re-renders options list and selected display on demand', () => {
        const { dropdown } = createTestDropdown()

        dropdown.setOptions({ options: [{ title: 'Only', value: 'only' }] })
        expect(dropdown.dom.querySelectorAll('.submenu li')).toHaveLength(1)

        dropdown.rerender()

        expect(dropdown.dom.querySelectorAll('.submenu li')).toHaveLength(1)
        expect(dropdown.dom.querySelector('.title')!.textContent).toBe('Model A')
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
        expect(popover!.style.getPropertyValue('--dropdown-popover-box-shadow')).toBe(uiKitSettings.dropdown.styles.popoverBoxShadow)
    })

    it('reads the popover box shadow from settings when the dropdown is created', () => {
        const previousShadow = uiKitSettings.dropdown.styles.popoverBoxShadow
        uiKitSettings.dropdown.styles.popoverBoxShadow = '0 0 0 4px rgba(1, 2, 3, 0.5)'

        try {
            const { dropdown } = createTestDropdown()
            document.body.appendChild(dropdown.dom)

            const popover = dropdown.dom.querySelector('.dropdown-menu-popover') as HTMLElement
            expect(popover.style.getPropertyValue('--dropdown-popover-box-shadow')).toBe('0 0 0 4px rgba(1, 2, 3, 0.5)')
        } finally {
            uiKitSettings.dropdown.styles.popoverBoxShadow = previousShadow
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
