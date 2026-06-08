import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { createHelpTooltip } from '$src/components/helpTooltip/index.ts'

function createTooltip() {
    const tooltip = createHelpTooltip({
        label: 'Model settings',
        text: 'Choose the model and output size',
    })

    const trigger = tooltip.dom.querySelector('.help-tooltip-trigger') as HTMLButtonElement

    return { tooltip, trigger }
}

function getTooltipContent(tooltip: { dom: HTMLElement }): HTMLElement {
    const content = tooltip.dom.querySelector('.help-tooltip-content')
    return content as HTMLElement
}

describe('helpTooltip', () => {
    let bodyHtml: string

    beforeEach(() => {
        bodyHtml = document.body.innerHTML
        document.body.innerHTML = ''
    })

    afterEach(() => {
        document.body.innerHTML = bodyHtml
    })

    it('renders trigger, content id, and aria attributes', () => {
        const { trigger } = createTooltip()

        expect(trigger.getAttribute('aria-label')).toBe('Model settings')
        expect(trigger.getAttribute('aria-describedby')).toContain('help-tooltip-')

        const root = trigger.closest('.help-tooltip')
        expect(root).not.toBeNull()
        expect(root!.className).toContain('help-tooltip')
    })

    it('adds tooltip content on pointer enter and removes it on pointer leave', () => {
        const { tooltip, trigger } = createTooltip()
        document.body.appendChild(tooltip.dom)

        trigger.getBoundingClientRect = () => ({
            left: 0,
            right: 24,
            top: 0,
            bottom: 24,
            width: 24,
            height: 24,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }) as DOMRect

        getTooltipContent(tooltip).getBoundingClientRect = () => ({
            left: 0,
            right: 180,
            top: 24,
            bottom: 44,
            width: 180,
            height: 20,
            x: 0,
            y: 24,
            toJSON: () => ({}),
        }) as DOMRect

        tooltip.dom.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))

        const content = document.body.querySelector('.help-tooltip-content')
        expect(content).not.toBeNull()
        expect(content?.classList.contains('is-visible')).toBe(true)

        tooltip.dom.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
    })

    it('forwards pointer/keyboard suppression events from trigger', () => {
        const { tooltip, trigger } = createTooltip()

        const pointerEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        trigger.dispatchEvent(pointerEvent)

        expect(pointerEvent.defaultPrevented).toBe(true)

        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
        trigger.dispatchEvent(clickEvent)

        expect(clickEvent.defaultPrevented).toBe(true)
    })

    it('syncs CSS variables from the tooltip root to floating content', () => {
        const originalGetComputedStyle = window.getComputedStyle
        const variables = {
            '--help-tooltip-background': '#123456',
            '--help-tooltip-width': '210px',
            '--help-tooltip-content-z-index': '10120',
        }
        const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
            if (node.classList?.contains('help-tooltip')) {
                return {
                    ...originalGetComputedStyle(node),
                    getPropertyValue: (name: string) => {
                        return variables[name as keyof typeof variables] || ''
                    },
                } as CSSStyleDeclaration
            }

            return originalGetComputedStyle(node)
        })

        const { tooltip, trigger } = createTooltip()
        document.body.appendChild(tooltip.dom)

        trigger.getBoundingClientRect = () => ({
            left: 0,
            right: 24,
            top: 0,
            bottom: 24,
            width: 24,
            height: 24,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }) as DOMRect

        getTooltipContent(tooltip).getBoundingClientRect = () => ({
            left: 0,
            right: 240,
            top: 24,
            bottom: 64,
            width: 240,
            height: 40,
            x: 0,
            y: 24,
            toJSON: () => ({}),
        }) as DOMRect

        tooltip.dom.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        const content = document.body.querySelector('.help-tooltip-content') as HTMLElement

        expect(content.style.getPropertyValue('--help-tooltip-background')).toBe('#123456')
        expect(content.style.getPropertyValue('--help-tooltip-width')).toBe('210px')
        expect(content.style.getPropertyValue('--help-tooltip-content-z-index')).toBe('10120')

        getComputedStyleSpy.mockRestore()
    })
})
