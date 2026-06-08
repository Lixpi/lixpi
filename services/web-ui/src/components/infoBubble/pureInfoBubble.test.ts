import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { createInfoBubble, infoBubbleStateManager } from '$src/components/infoBubble/index.ts'

type Rect = {
    left: number
    right: number
    top: number
    bottom: number
    width: number
    height: number
    x: number
    y: number
}

function createRect(values: Partial<Rect> = {}): DOMRect {
    const rect: Rect = {
        left: 0,
        right: 80,
        top: 0,
        bottom: 24,
        width: 80,
        height: 24,
        x: 0,
        y: 0,
        ...values,
    }

    return {
        ...rect,
        toJSON: () => rect,
    } as DOMRect
}

function createBubble(id = 'bubble') {
    const anchor = document.createElement('button')
    anchor.textContent = 'open'

    const body = document.createElement('div')
    body.textContent = 'help text'

    const infoBubble = createInfoBubble({
        id,
        anchor,
        bodyContent: body,
    })

    const bubbleWrapper = infoBubble.dom.querySelector('.bubble-wrapper') as HTMLElement
    const bubbleContainer = infoBubble.dom.querySelector('.bubble-container') as HTMLElement

    anchor.getBoundingClientRect = vi.fn(() => createRect())
    bubbleWrapper.getBoundingClientRect = vi.fn(() => createRect({
        width: 160,
        height: 100,
        right: 160,
        bottom: 100,
    }))
    bubbleContainer.getBoundingClientRect = vi.fn(() => createRect({
        width: 160,
        height: 100,
        right: 160,
        bottom: 100,
    }))

    return { anchor, infoBubble }
}

describe('createInfoBubble', () => {
    let getComputedStyleSpy: ReturnType<typeof vi.spyOn>
    let originalViewportStyle: string

    beforeEach(() => {
        document.body.innerHTML = ''
        infoBubbleStateManager.closeAll()
        originalViewportStyle = document.body.style.overflow

        const originalGetComputedStyle = window.getComputedStyle
        getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
            if (pseudo === '::before') {
                return {
                    ...originalGetComputedStyle(el as Element, pseudo),
                    borderWidth: '8px 8px 8px 8px',
                    right: '12px',
                    top: '12px',
                    getPropertyValue: () => '',
                } as CSSStyleDeclaration
            }

            return originalGetComputedStyle(el as Element, pseudo)
        })
    })

    afterEach(() => {
        getComputedStyleSpy.mockRestore()
        document.body.style.overflow = originalViewportStyle
        infoBubbleStateManager.closeAll()
    })

    it('renders with default structure and state', () => {
        const { infoBubble } = createBubble()

        expect(infoBubble.dom.className).toContain('info-bubble-wrapper')
        expect(infoBubble.dom.className).toContain('theme-dark')
        expect(infoBubble.dom.getAttribute('data-arrow-side')).toBe('top')
        expect(infoBubble.isOpen()).toBe(false)
    })

    it('toggles open state from anchor click', () => {
        const { anchor, infoBubble } = createBubble('toggle-bubble')
        expect(infoBubble.isOpen()).toBe(false)

        anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        expect(infoBubble.isOpen()).toBe(true)

        anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        expect(infoBubble.isOpen()).toBe(false)
    })

    it('calls open/close callbacks and visibility class', () => {
        const onOpen = vi.fn()
        const onClose = vi.fn()

        const anchor = document.createElement('button')
        anchor.textContent = 'open'
        const body = document.createElement('div')

        const infoBubble = createInfoBubble({
            id: 'callback-bubble',
            anchor,
            bodyContent: body,
            onOpen,
            onClose,
        })

        anchor.getBoundingClientRect = vi.fn(() => createRect())
        const bubbleWrapper = infoBubble.dom.querySelector('.bubble-wrapper') as HTMLElement
        const bubbleContainer = infoBubble.dom.querySelector('.bubble-container') as HTMLElement
        bubbleWrapper.getBoundingClientRect = vi.fn(() => createRect({ width: 180, height: 90, right: 180, bottom: 90 }))
        bubbleContainer.getBoundingClientRect = vi.fn(() => createRect({ width: 180, height: 90, right: 180, bottom: 90 }))

        infoBubble.open()
        expect(infoBubble.isOpen()).toBe(true)
        expect(onOpen).toHaveBeenCalledOnce()
        expect(bubbleWrapper.classList).toContain('visible')

        infoBubble.close()
        expect(infoBubble.isOpen()).toBe(false)
        expect(onClose).toHaveBeenCalledOnce()
        expect(bubbleWrapper.classList).not.toContain('visible')
    })

    it('closes when document receives outside click and ignores self/anchor clicks', () => {
        const { anchor, infoBubble } = createBubble('outside-click')
        const bubbleRoot = infoBubble.dom

        anchor.getBoundingClientRect = vi.fn(() => createRect())
        const bubbleWrapper = infoBubble.dom.querySelector('.bubble-wrapper') as HTMLElement
        const outside = document.createElement('div')

        document.body.appendChild(anchor)
        document.body.appendChild(bubbleRoot)

        infoBubble.open()
        expect(infoBubble.isOpen()).toBe(true)

        outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(infoBubble.isOpen()).toBe(true)

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(infoBubble.isOpen()).toBe(false)

        infoBubble.open()
        bubbleWrapper.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(infoBubble.isOpen()).toBe(true)
        expect(infoBubble.dom).toBe(bubbleRoot)
    })

    it('keeps at most one bubble open through manager exclusivity', () => {
        const first = createBubble('first')
        const second = createBubble('second')

        document.body.appendChild(first.anchor)
        document.body.appendChild(first.infoBubble.dom)
        document.body.appendChild(second.anchor)
        document.body.appendChild(second.infoBubble.dom)

        first.infoBubble.open()
        expect(first.infoBubble.isOpen()).toBe(true)

        second.infoBubble.open()
        expect(first.infoBubble.isOpen()).toBe(false)
        expect(second.infoBubble.isOpen()).toBe(true)
    })

    it('removes listeners and unregisters on destroy', () => {
        const { infoBubble } = createBubble('destroy-bubble')
        const removeSpy = vi.spyOn(document, 'removeEventListener')

        infoBubble.open()
        infoBubble.destroy()

        expect(infoBubble.isOpen()).toBe(false)
        expect(removeSpy).toHaveBeenCalled()
    })
})
