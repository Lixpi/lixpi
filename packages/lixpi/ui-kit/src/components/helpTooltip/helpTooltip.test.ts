import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { uiKitSettings } from '../../runtime-settings.ts'
import { createHelpTooltip, createHelpTooltipProvider } from './index.ts'

function createTooltip(
    override: Parameters<typeof createHelpTooltip>[0] = {},
) {
    const tooltip = createHelpTooltip({
        label: 'Model settings',
        text: 'Choose the model and output size',
        ...override,
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

    it('uses proportional default icon sizing and supports trigger-size overrides', () => {
        const { tooltip: defaultTooltip } = createTooltip()
        const { tooltip: customTooltip } = createTooltip({ triggerSize: 18, iconSize: 14 })

        expect(defaultTooltip.dom.style.getPropertyValue('--help-tooltip-trigger-size')).toBe('14px')
        expect(defaultTooltip.dom.style.getPropertyValue('--help-tooltip-icon-size')).toBe('12px')
        expect(customTooltip.dom.style.getPropertyValue('--help-tooltip-trigger-size')).toBe('18px')
        expect(customTooltip.dom.style.getPropertyValue('--help-tooltip-icon-size')).toBe('14px')
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

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))

        const content = document.body.querySelector('.help-tooltip-content')
        expect(content).not.toBeNull()
        expect(content?.classList.contains('is-visible')).toBe(true)

        trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
    })

    it('opens on focus and closes on blur', () => {
        const { tooltip, trigger } = createTooltip()
        document.body.appendChild(tooltip.dom)

        trigger.focus()
        trigger.dispatchEvent(new FocusEvent('focusin'))
        expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()

        trigger.dispatchEvent(new FocusEvent('focusout'))
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
    })

    it('hides immediately on pointer leave for non-interactive tooltips', () => {
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
            bottom: 64,
            width: 180,
            height: 40,
            x: 0,
            y: 24,
            toJSON: () => ({}),
        }) as DOMRect

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()

        trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
    })

    it('suppresses a tooltip after its trigger is clicked until the pointer leaves', () => {
        const trigger = document.createElement('button')
        trigger.setAttribute('aria-label', 'Open model settings')
        document.body.appendChild(trigger)
        const tooltip = createHelpTooltip({
            label: 'Open model settings',
            text: 'Choose the model and output size',
            triggerElement: trigger,
            describeTrigger: true,
        })

        trigger.dispatchEvent(new PointerEvent('pointerenter'))
        expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()
        expect(trigger.getAttribute('aria-describedby')).toContain('help-tooltip-')

        trigger.click()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
        expect(trigger.getAttribute('aria-describedby')).toBeNull()

        trigger.dispatchEvent(new PointerEvent('pointerenter'))
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()

        trigger.dispatchEvent(new PointerEvent('pointerleave'))
        trigger.dispatchEvent(new PointerEvent('pointerenter'))
        expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()

        tooltip.destroy()
    })

    it('destroys tooltip DOM and detached listeners cleanly', () => {
        const { tooltip, trigger } = createTooltip({
            interactive: true,
            content: 'Cleanup test',
        })
        document.body.appendChild(tooltip.dom)
        trigger.dispatchEvent(new PointerEvent('pointerenter'))

        expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()

        tooltip.destroy()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
        expect(document.body.contains(tooltip.dom)).toBe(false)
        expect(() => tooltip.destroy()).not.toThrow()
    })

    it('supports custom trigger content and optional placement', () => {
        const triggerMarkup = document.createElement('span')
        triggerMarkup.textContent = 'custom'
        triggerMarkup.className = 'custom-trigger-icon'

        const { tooltip } = createTooltip({
            triggerContent: triggerMarkup,
            preferredPlacement: 'top',
            triggerClassName: 'custom-trigger',
            className: 'custom-tooltip',
            contentClassName: 'custom-content',
            interactive: true,
            content: 'Detailed model explanation',
        })

        const root = tooltip.dom
        const trigger = tooltip.dom.querySelector('.help-tooltip-trigger-custom') as HTMLElement
        const triggerIcon = trigger.querySelector('.custom-trigger-icon') as HTMLElement

        expect(root.className).toContain('custom-tooltip')
        expect(trigger.className).toContain('custom-trigger')
        expect(triggerIcon).toBe(triggerMarkup)
        expect(root.querySelector('.help-tooltip-content')!.className).toContain('custom-content')
        expect(root.querySelector('.help-tooltip-content')!.className).toContain('help-tooltip-content-interactive')
    })

    it('keeps preferred placement as the authoritative placement choice', () => {
        const { tooltip, trigger } = createTooltip({ preferredPlacement: 'top' })
        document.body.appendChild(tooltip.dom)

        trigger.getBoundingClientRect = () => ({
            left: 0,
            right: 24,
            top: 100,
            bottom: 124,
            width: 24,
            height: 24,
            x: 0,
            y: 100,
            toJSON: () => ({}),
        }) as DOMRect
        getTooltipContent(tooltip).getBoundingClientRect = () => ({
            left: 0,
            right: 180,
            top: 60,
            bottom: 40,
            width: 180,
            height: 20,
            x: 0,
            y: 60,
            toJSON: () => ({}),
        }) as DOMRect

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        const content = document.body.querySelector('.help-tooltip-content') as HTMLElement

        expect(content.dataset.placement).toBe('top')
    })

    it('syncs a max-height CSS var only when using top placement', () => {
        const { tooltip, trigger } = createTooltip({ preferredPlacement: 'top' })
        document.body.appendChild(tooltip.dom)

        trigger.getBoundingClientRect = () => ({
            left: 0,
            right: 24,
            top: 100,
            bottom: 124,
            width: 24,
            height: 24,
            x: 0,
            y: 100,
            toJSON: () => ({}),
        }) as DOMRect
        getTooltipContent(tooltip).getBoundingClientRect = () => ({
            left: 0,
            right: 180,
            top: 60,
            bottom: 40,
            width: 180,
            height: 20,
            x: 0,
            y: 60,
            toJSON: () => ({}),
        }) as DOMRect

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        const content = document.body.querySelector('.help-tooltip-content') as HTMLElement

        expect(content.style.getPropertyValue('--help-tooltip-available-max-height')).toBe('78px')
        expect(content.dataset.placement).toBe('top')
    })

    it('removes top-placement max-height CSS var when not using top placement', () => {
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
            bottom: 64,
            width: 180,
            height: 40,
            x: 0,
            y: 24,
            toJSON: () => ({}),
        }) as DOMRect

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        const content = document.body.querySelector('.help-tooltip-content') as HTMLElement

        expect(content.style.getPropertyValue('--help-tooltip-available-max-height')).toBe('')
    })

    it('tracks content size with ResizeObserver while tooltip is open', () => {
        const observe = vi.fn()
        const disconnect = vi.fn()
        const unobserve = vi.fn()
        const originalResizeObserver = global.ResizeObserver

        class MockResizeObserver {
            observe = observe
            disconnect = disconnect
            unobserve = unobserve
        }
        global.ResizeObserver = MockResizeObserver as any

        try {
            const { tooltip, trigger } = createTooltip()
            document.body.appendChild(tooltip.dom)

            trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
            const content = document.body.querySelector('.help-tooltip-content') as HTMLElement

            expect(observe).toHaveBeenCalledWith(content)

            tooltip.destroy()
            expect(disconnect).toHaveBeenCalledTimes(1)
        } finally {
            global.ResizeObserver = originalResizeObserver
        }
    })

    it('repositions when ResizeObserver reports tooltip content size changes', () => {
        let resizeCallback: ResizeObserverCallback | null = null
        const originalResizeObserver = global.ResizeObserver

        class MockResizeObserver {
            observe = vi.fn()
            disconnect = vi.fn()
            unobserve = vi.fn()

            constructor(callback: ResizeObserverCallback) {
                resizeCallback = callback
            }
        }
        global.ResizeObserver = MockResizeObserver as any

        try {
            const { tooltip, trigger } = createTooltip()
            const content = getTooltipContent(tooltip)
            document.body.appendChild(tooltip.dom)

            trigger.getBoundingClientRect = () => ({
                left: 0,
                right: 24,
                top: 50,
                bottom: 74,
                width: 24,
                height: 24,
                x: 0,
                y: 50,
                toJSON: () => ({}),
            }) as DOMRect

            let contentHeight = 20
            content.getBoundingClientRect = () => ({
                left: 0,
                right: 180,
                top: 0,
                bottom: contentHeight,
                width: 180,
                height: contentHeight,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect

            trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
            const visibleContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
            expect(visibleContent.style.top).toBe('52px')

            contentHeight = 80
            resizeCallback?.([] as any, {} as ResizeObserver)

            expect(visibleContent.style.top).toBe('22px')
        } finally {
            global.ResizeObserver = originalResizeObserver
        }
    })


    it('supports array and element content for the tooltip body', () => {
        const first = document.createElement('span')
        const second = document.createElement('span')
        const icon = document.createElement('span')
        first.textContent = 'first'
        second.textContent = 'second'
        icon.textContent = '✕'
        icon.className = 'custom-trigger-content'

        const { tooltip } = createTooltip({
            triggerContent: icon,
            content: [first, second],
            contentCssVariableNames: ['--help-tooltip-content-z-index'],
        })

        const content = getTooltipContent(tooltip)
        expect(content.childNodes).toHaveLength(2)
        expect(content.contains(first)).toBe(true)
        expect(content.contains(second)).toBe(true)
    })

    it('writes placeholder-like content attributes when using a string fallback', () => {
        const { tooltip } = createTooltip({ text: 'fallback text' })
        const content = getTooltipContent(tooltip)
        expect(content.innerHTML).toContain('fallback text')
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

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        const content = document.body.querySelector('.help-tooltip-content') as HTMLElement

        expect(content.style.getPropertyValue('--help-tooltip-background')).toBe('#123456')
        expect(content.style.getPropertyValue('--help-tooltip-width')).toBe('210px')
        expect(content.style.getPropertyValue('--help-tooltip-content-z-index')).toBe('10120')

        getComputedStyleSpy.mockRestore()
    })

    it('supports extra tooltip content css variable names', () => {
        const originalGetComputedStyle = window.getComputedStyle
        const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
            if (node.classList?.contains('help-tooltip')) {
                return {
                    ...originalGetComputedStyle(node),
                    getPropertyValue: (name: string) => {
                        return name === '--help-tooltip-custom-extra' ? '24px' : ''
                    },
                } as CSSStyleDeclaration
            }

            return originalGetComputedStyle(node)
        })

        const { tooltip, trigger } = createTooltip({
            text: 'Extra variable test',
            contentCssVariableNames: ['--help-tooltip-custom-extra'],
        })
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

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        const content = document.body.querySelector('.help-tooltip-content') as HTMLElement

        expect(content.style.getPropertyValue('--help-tooltip-custom-extra')).toBe('24px')

        getComputedStyleSpy.mockRestore()
    })

    it('delays tooltip hide for interactive tooltips while users interact with tooltip content', () => {
        vi.useFakeTimers()

        try {
            const { tooltip, trigger } = createTooltip({
                text: 'Interactive content',
                interactive: true,
            })
            const content = getTooltipContent(tooltip)

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
            content.getBoundingClientRect = () => ({
                left: 0,
                right: 200,
                top: 24,
                bottom: 64,
                width: 200,
                height: 40,
                x: 0,
                y: 24,
                toJSON: () => ({}),
            }) as DOMRect

            trigger.dispatchEvent(new PointerEvent('pointerenter'))
            expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()

            trigger.dispatchEvent(new PointerEvent('pointerleave'))
            content.dispatchEvent(new PointerEvent('pointerenter'))
            vi.advanceTimersByTime(200)
            expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()

            content.dispatchEvent(new PointerEvent('pointerleave'))
            vi.advanceTimersByTime(uiKitSettings.helpTooltip.interactiveHideDelayMs - 1)
            expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()
            vi.advanceTimersByTime(2)
            expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })

    it('tracks viewport listeners only while visible', () => {
        const windowAddSpy = vi.spyOn(window, 'addEventListener')
        const windowRemoveSpy = vi.spyOn(window, 'removeEventListener')
        const documentAddSpy = vi.spyOn(document, 'addEventListener')
        const documentRemoveSpy = vi.spyOn(document, 'removeEventListener')

        try {
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
                bottom: 64,
                width: 180,
                height: 40,
                x: 0,
                y: 24,
                toJSON: () => ({}),
            }) as DOMRect

            trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
            expect(windowAddSpy).toHaveBeenCalledWith('resize', expect.any(Function))
            expect(documentAddSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true)

            trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
            expect(windowRemoveSpy).toHaveBeenCalledWith('resize', expect.any(Function))
            expect(documentRemoveSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true)
        } finally {
            windowAddSpy.mockRestore()
            windowRemoveSpy.mockRestore()
            documentAddSpy.mockRestore()
            documentRemoveSpy.mockRestore()
        }
    })

    it('delays delegated ARIA tooltip activation by the configured provider delay', () => {
        vi.useFakeTimers()

        try {
            const root = document.createElement('div')
            const trigger = document.createElement('button')
            trigger.setAttribute('aria-label', 'Open media library')
            trigger.dataset.helpTooltip = 'aria-label'
            root.appendChild(trigger)
            document.body.appendChild(root)
            const provider = createHelpTooltipProvider({ root })

            trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
            expect(document.body.querySelector('.help-tooltip-content')).toBeNull()

            vi.advanceTimersByTime(uiKitSettings.helpTooltip.providerShowDelayMs - 1)
            expect(document.body.querySelector('.help-tooltip-content')).toBeNull()

            vi.advanceTimersByTime(1)
            const content = document.body.querySelector('.help-tooltip-content') as HTMLElement
            expect(content.textContent).toBe('Open media library')
            expect(content.classList.contains('help-tooltip-content-simple')).toBe(true)

            provider.destroy()
        } finally {
            vi.useRealTimers()
        }
    })

    it('keeps delegated tooltips hidden after a click until the pointer re-enters', () => {
        vi.useFakeTimers()

        try {
            const root = document.createElement('div')
            const trigger = document.createElement('button')
            trigger.setAttribute('aria-label', 'Generation settings')
            trigger.dataset.helpTooltip = 'aria-label'
            root.appendChild(trigger)
            document.body.appendChild(root)
            const provider = createHelpTooltipProvider({ root })

            trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
            vi.advanceTimersByTime(uiKitSettings.helpTooltip.providerShowDelayMs)
            expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()

            trigger.click()
            expect(document.body.querySelector('.help-tooltip-content')).toBeNull()

            trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
            vi.advanceTimersByTime(uiKitSettings.helpTooltip.providerShowDelayMs)
            expect(document.body.querySelector('.help-tooltip-content')).toBeNull()

            trigger.dispatchEvent(new PointerEvent('pointerleave'))
            trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
            vi.advanceTimersByTime(uiKitSettings.helpTooltip.providerShowDelayMs)
            expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()

            provider.destroy()
        } finally {
            vi.useRealTimers()
        }
    })

    it('respects provider visibility guards before and after an expanded control opens', async () => {
        const originalShowDelay = uiKitSettings.helpTooltip.providerShowDelayMs
        uiKitSettings.helpTooltip.providerShowDelayMs = 0

        try {
            const root = document.createElement('div')
            const trigger = document.createElement('button')
            trigger.setAttribute('aria-label', 'Generation settings')
            trigger.setAttribute('aria-expanded', 'false')
            trigger.dataset.helpTooltip = 'aria-label'
            root.appendChild(trigger)
            document.body.appendChild(root)
            const provider = createHelpTooltipProvider({
                root,
                shouldShow: element => element.getAttribute('aria-expanded') !== 'true',
            })

            trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
            expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()

            trigger.setAttribute('aria-expanded', 'true')
            await Promise.resolve()
            expect(document.body.querySelector('.help-tooltip-content')).toBeNull()

            trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
            expect(document.body.querySelector('.help-tooltip-content')).toBeNull()

            provider.destroy()
        } finally {
            uiKitSettings.helpTooltip.providerShowDelayMs = originalShowDelay
        }
    })
})
