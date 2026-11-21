// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createButton } from './button.ts'

describe('Button', () => {
    it('renders a secondary xx-medium button with its label by default', () => {
        const button = createButton({ label: 'Reset' })

        expect(button.element.tagName).toBe('BUTTON')
        expect(button.element.type).toBe('button')
        expect(button.element.className).toBe('button')
        expect(button.element.dataset.variant).toBe('secondary')
        expect(button.element.dataset.size).toBe('xx-medium')
        expect(button.element.querySelector('.button-label')?.textContent).toBe('Reset')
        expect(button.element.querySelector('.button-icon')).toBeNull()
    })

    it('places a leading icon and keeps a host hook class for placement', () => {
        const button = createButton({
            label: 'Add model',
            icon: '<svg viewBox="0 0 1 1"></svg>',
            variant: 'primary',
            size: 'x-small',
            className: 'composer-add',
        })

        expect(button.element.className).toBe('button composer-add')
        expect(button.element.dataset.variant).toBe('primary')
        expect(button.element.dataset.size).toBe('x-small')
        expect(button.element.firstElementChild?.classList.contains('button-icon')).toBe(true)
        expect(button.element.querySelector('svg')).not.toBeNull()
    })

    it('reports clicks until it is destroyed', () => {
        const onClick = vi.fn()
        const button = createButton({
            label: 'Retry',
            onClick,
        })
        document.body.append(button.element)

        button.element.click()
        expect(onClick).toHaveBeenCalledOnce()
        button.destroy()
        button.element.click()
        expect(onClick).toHaveBeenCalledOnce()
        expect(button.element.isConnected).toBe(false)
    })

    it('updates its label and disabled state', () => {
        const button = createButton({
            label: 'Count 0',
            ariaLabel: 'Counter',
        })

        button.setLabel('Count 1')
        button.setDisabled(true)
        expect(button.element.querySelector('.button-label')?.textContent).toBe('Count 1')
        expect(button.element.disabled).toBe(true)
        expect(button.element.getAttribute('aria-label')).toBe('Counter')
    })

    it('submits a form when it is a submit button', () => {
        const button = createButton({
            label: 'Run',
            type: 'submit',
        })

        expect(button.element.type).toBe('submit')
    })
})
