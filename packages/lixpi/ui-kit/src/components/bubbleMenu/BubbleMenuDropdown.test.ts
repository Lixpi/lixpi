// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    heading1Icon,
    heading2Icon,
    paragraphIcon,
} from '../../svg/svgIcons.ts'
import { BubbleMenu } from './BubbleMenu.ts'
import { BubbleMenuDropdown } from './BubbleMenuDropdown.ts'

const fixtures: BubbleMenu[] = []

const createDropdown = (scale = 1) => {
    const onChange = vi.fn()
    const dropdown = new BubbleMenuDropdown({
        document,
        label: 'Change current style',
        menuLabel: 'Text style',
        value: 'text',
        options: [
            {
                value: 'text',
                label: 'Text',
                icon: paragraphIcon,
            },
            {
                value: 'heading1',
                label: 'Heading 1',
                icon: heading1Icon,
                disabled: true,
            },
            {
                value: 'heading2',
                label: 'Heading 2',
                icon: heading2Icon,
            },
        ],
        onChange,
        getBounds: () => new DOMRect(0, 0, 320, 200),
        getScale: () => scale,
    })
    const toolbar = new BubbleMenu({
        parentEl: document.body,
        inline: true,
        label: 'Block controls',
        items: [{
            context: ['actions'],
            element: dropdown.element,
            hide: () => dropdown.hide(),
            destroy: () => dropdown.destroy(),
        }],
    })
    fixtures.push(toolbar)
    vi.spyOn(dropdown.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 120, 40, 50))

    const [
        text,
        heading1,
        heading2,
    ] = dropdown.menuElement.querySelectorAll<HTMLButtonElement>('button')

    return {
        toolbar,
        dropdown,
        text,
        heading1,
        heading2,
        onChange,
    }
}

const press = (
    element: HTMLElement,
    key: string,
): void => {
    element.dispatchEvent(
        new KeyboardEvent(
            'keydown',
            {
                key,
                bubbles: true,
                cancelable: true,
            },
        ),
    )
}

afterEach(() => {
    for (const toolbar of fixtures.splice(0))
        toolbar.destroy()
})

// =============================================================================
// Bubble menu selector
// =============================================================================

describe('BubbleMenuDropdown', () => {
    it('uses an inline toolbar and a vertical instance of the same BubbleMenu', () => {
        const {
            dropdown,
            toolbar,
        } = createDropdown()

        expect(toolbar.isVisible).toBe(true)
        expect(toolbar.element.style.position).toBe('relative')
        expect(toolbar.element.firstElementChild?.contains(dropdown.element)).toBe(true)
        expect(dropdown.menuElement.classList.contains('bubble-menu-vertical')).toBe(true)
        expect(dropdown.menuElement.role).toBe('menu')
        expect(dropdown.menuElement.getAttribute("aria-label")).toBe('Text style')

        dropdown.open()

        expect(dropdown.isOpen).toBe(true)
        toolbar.hide()
        expect(dropdown.isOpen).toBe(false)
        expect(dropdown.trigger.ariaExpanded).toBe('false')
    })

    it('skips disabled options and restores focus after applying a choice', () => {
        const {
            dropdown,
            text,
            heading1,
            heading2,
            onChange,
        } = createDropdown()
        dropdown.trigger.focus()

        press(dropdown.trigger, 'ArrowDown')
        expect(document.activeElement).toBe(text)
        expect(text.ariaChecked).toBe('true')
        expect(heading1.disabled).toBe(true)

        press(text, 'ArrowDown')
        expect(document.activeElement).toBe(heading2)
        press(heading2, 'Enter')

        expect(dropdown.isOpen).toBe(false)
        expect(document.activeElement).toBe(dropdown.trigger)
        expect(heading2.ariaChecked).toBe('true')
        expect(heading2.classList.contains('is-active')).toBe(true)
        expect(onChange).toHaveBeenCalledExactlyOnceWith('heading2')

        dropdown.setValue('text')
        expect(text.ariaChecked).toBe('true')
        expect(heading2.ariaChecked).toBe('false')
        expect(onChange).toHaveBeenCalledOnce()
    })

    it('closes on Escape and outside presses', () => {
        const {
            dropdown,
            text,
            onChange,
        } = createDropdown()

        press(dropdown.trigger, 'ArrowDown')
        press(text, 'Escape')
        expect(dropdown.isOpen).toBe(false)
        expect(document.activeElement).toBe(dropdown.trigger)

        dropdown.trigger.click()
        expect(dropdown.trigger.ariaExpanded).toBe('true')
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        expect(dropdown.trigger.ariaExpanded).toBe('false')
        expect(onChange).not.toHaveBeenCalled()
    })

    it('flips above a constrained trigger and converts screen pixels to local pixels', () => {
        const { dropdown } = createDropdown(2)
        const content = dropdown.menuElement.firstElementChild!
        Object.defineProperty(content, 'scrollHeight', { value: 100 })
        Object.defineProperty(dropdown.menuElement, 'offsetHeight', { value: 56 })

        dropdown.open()

        expect(content.style.getPropertyValue('--bubble-menu-available-height')).toBe('56px')
        expect(dropdown.menuElement.style.left).toBe('0px')
        expect(dropdown.menuElement.style.top).toBe('-60px')
        expect(dropdown.menuElement.style.visibility).toBe('visible')
    })
})
