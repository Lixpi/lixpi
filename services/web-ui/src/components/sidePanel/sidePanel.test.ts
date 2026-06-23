import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSidePanel, type SidePanelConfig } from '$src/components/sidePanel/sidePanel.ts'

function buildConfig(overrides: Partial<SidePanelConfig> = {}): SidePanelConfig {
    return {
        side: 'right',
        offset: 4,
        grabWidth: 20,
        minWidth: 320,
        defaultWidth: 380,
        getMaxWidth: () => 900,
        onResize: vi.fn(),
        ...overrides,
    }
}

// The rail listens to Pointer Events so it works for mouse and touch alike.
// jsdom does not implement PointerEvent, so MouseEvent carries the pointer-event
// type names and the clientX/button fields the handler reads.
function mousedown(target: EventTarget, clientX: number, button = 0): void {
    target.dispatchEvent(new MouseEvent('pointerdown', { clientX, button, bubbles: true, cancelable: true }))
}

function move(clientX: number): void {
    document.dispatchEvent(new MouseEvent('pointermove', { clientX, bubbles: true }))
}

function mouseup(): void {
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
}

afterEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
})

describe('SidePanel', () => {
    it('renders a positioned rail element with the side and extra class', () => {
        const rail = createSidePanel(buildConfig({ side: 'right', className: 'extra-rail' }))

        expect(rail.element.classList.contains('side-panel-rail')).toBe(true)
        expect(rail.element.classList.contains('side-panel-rail-right')).toBe(true)
        expect(rail.element.classList.contains('extra-rail')).toBe(true)
        // Right-side panel rail hugs the panel's left edge.
        expect(rail.element.style.left).toBe('-14px')
        expect(rail.element.style.right).toBe('')

        rail.destroy()
    })

    it('hugs the right edge for a left-side panel', () => {
        const rail = createSidePanel(buildConfig({ side: 'left' }))

        expect(rail.element.style.right).toBe('-14px')
        expect(rail.element.style.left).toBe('')

        rail.destroy()
    })

    it('grows a right-side panel as the pointer drags left', () => {
        const onResize = vi.fn()
        const onResizeStart = vi.fn()
        const onResizeEnd = vi.fn()
        const rail = createSidePanel(buildConfig({ onResize, onResizeStart, onResizeEnd }))

        mousedown(rail.element, 500)
        expect(onResizeStart).toHaveBeenCalledTimes(1)
        expect(document.body.style.cursor).toBe('ew-resize')

        move(460)
        // startWidth 380 + (500 - 460) = 420
        expect(onResize).toHaveBeenLastCalledWith(420)

        mouseup()
        expect(onResizeEnd).toHaveBeenCalledWith(420)
        expect(document.body.style.cursor).toBe('')

        rail.destroy()
    })

    it('grows a left-side panel as the pointer drags right', () => {
        const onResize = vi.fn()
        const rail = createSidePanel(buildConfig({ side: 'left', onResize }))

        mousedown(rail.element, 500)
        move(560)
        // startWidth 380 + (560 - 500) = 440
        expect(onResize).toHaveBeenLastCalledWith(440)

        mouseup()
        rail.destroy()
    })

    it('ignores non-primary mouse buttons', () => {
        const onResizeStart = vi.fn()
        const rail = createSidePanel(buildConfig({ onResizeStart }))

        mousedown(rail.element, 500, 2)
        expect(onResizeStart).not.toHaveBeenCalled()

        rail.destroy()
    })

    it('renders a single full-height line with no boundary circle', () => {
        const rail = createSidePanel(buildConfig())
        const line = rail.element.querySelector('.side-panel-rail-line')

        expect(line).not.toBeNull()
        expect(rail.element.querySelector('.side-panel-rail-boundary-circle')).toBeNull()
        // The line has no inline height override — it spans the full panel height via CSS.
        expect(rail.element.style.getPropertyValue('--side-panel-rail-thread-height')).toBe('')

        rail.destroy()
    })

    it('owns a glass backdrop element anchored to the correct side', () => {
        const right = createSidePanel(buildConfig({ side: 'right' }))
        expect(right.backdropElement.classList.contains('side-panel-backdrop')).toBe(true)
        expect(right.backdropElement.classList.contains('side-panel-backdrop-right')).toBe(true)
        right.destroy()

        const left = createSidePanel(buildConfig({ side: 'left' }))
        expect(left.backdropElement.classList.contains('side-panel-backdrop-left')).toBe(true)
        left.destroy()
    })

    it('removes the backdrop element on destroy', () => {
        const rail = createSidePanel(buildConfig())
        document.body.appendChild(rail.backdropElement)
        expect(rail.backdropElement.isConnected).toBe(true)

        rail.destroy()
        expect(rail.backdropElement.isConnected).toBe(false)
    })

    it('toggles state classes', () => {
        const rail = createSidePanel(buildConfig())

        rail.setSelected(true)
        expect(rail.element.classList.contains('is-selected')).toBe(true)
        rail.setResizing(true)
        expect(rail.element.classList.contains('is-resizing')).toBe(true)

        rail.destroy()
    })

    it('owns the width state, clamped to min/max', () => {
        const rail = createSidePanel(buildConfig({ minWidth: 320, getMaxWidth: () => 600 }))

        // Never resized → resolved default, raw stays null.
        expect(rail.getWidth()).toBe(380)
        expect(rail.getRawWidth()).toBeNull()

        expect(rail.setWidth(1000)).toBe(600)
        expect(rail.getWidth()).toBe(600)
        expect(rail.getRawWidth()).toBe(600)
        expect(rail.getState()).toEqual({ width: 600 })

        expect(rail.setWidth(100)).toBe(320)
        expect(rail.getWidth()).toBe(320)

        rail.destroy()
    })

    it('loads its initial width from the persistence adapter', () => {
        const rail = createSidePanel(buildConfig({ loadState: () => ({ width: 500 }) }))

        expect(rail.getRawWidth()).toBe(500)
        expect(rail.getWidth()).toBe(500)

        rail.destroy()
    })

    it('persists on drag end and on explicit request, not on plain setWidth', () => {
        const persistState = vi.fn()
        const rail = createSidePanel(buildConfig({ persistState }))

        rail.setWidth(420)
        expect(persistState).not.toHaveBeenCalled()

        rail.setWidth(440, { persist: true })
        expect(persistState).toHaveBeenLastCalledWith({ width: 440 })

        mousedown(rail.element, 500)
        move(470)
        mouseup()
        // drag starts from the stored 440 + (500 - 470) = 470
        expect(persistState).toHaveBeenLastCalledWith({ width: 470 })

        rail.destroy()
    })

    it('notifies subscribers and onResize, and supports silent updates', () => {
        const onResize = vi.fn()
        const subscriber = vi.fn()
        const rail = createSidePanel(buildConfig({ onResize }))
        const unsubscribe = rail.subscribe(subscriber)

        rail.setWidth(420)
        expect(onResize).toHaveBeenLastCalledWith(420)
        expect(subscriber).toHaveBeenLastCalledWith(420)

        rail.setWidth(440, { silent: true })
        expect(onResize).toHaveBeenCalledTimes(1)
        expect(subscriber).toHaveBeenCalledTimes(1)

        unsubscribe()
        rail.setWidth(460)
        expect(subscriber).toHaveBeenCalledTimes(1)

        rail.destroy()
    })

    it('re-clamps the stored width through applyConstraints when max shrinks', () => {
        let max = 900
        const onResize = vi.fn()
        const rail = createSidePanel(buildConfig({ onResize, getMaxWidth: () => max }))

        rail.setWidth(800)
        onResize.mockClear()

        max = 500
        rail.applyConstraints()
        expect(rail.getWidth()).toBe(500)
        expect(onResize).toHaveBeenLastCalledWith(500)

        rail.destroy()
    })

    it('does not emit from applyConstraints when never resized', () => {
        const onResize = vi.fn()
        const rail = createSidePanel(buildConfig({ onResize }))

        rail.applyConstraints()
        expect(onResize).not.toHaveBeenCalled()

        rail.destroy()
    })

    function emitTransitionEnd(element: HTMLElement, propertyName = 'transform'): void {
        const event = new Event('transitionend', { bubbles: true })
        Object.defineProperty(event, 'propertyName', { value: propertyName })
        element.dispatchEvent(event)
    }

    it('adds side-panel-slide classes on open', () => {
        const rail = createSidePanel(buildConfig({ side: 'right' }))
        const panel = document.createElement('div')

        rail.playOpen(panel)

        expect(panel.classList.contains('side-panel-slide')).toBe(true)
        expect(rail.backdropElement.classList.contains('side-panel-slide')).toBe(true)
        expect(panel.classList.contains('side-panel-slide-offset-right')).toBe(false)
        expect(rail.backdropElement.classList.contains('side-panel-slide-offset-right')).toBe(false)

        rail.destroy()
    })

    it('adds left-side offset classes on open for a left panel', () => {
        const rail = createSidePanel(buildConfig({ side: 'left' }))
        const panel = document.createElement('div')

        rail.playOpen(panel)

        expect(panel.classList.contains('side-panel-slide')).toBe(true)
        expect(rail.backdropElement.classList.contains('side-panel-slide')).toBe(true)
        expect(panel.classList.contains('side-panel-slide-offset-left')).toBe(false)
        expect(rail.backdropElement.classList.contains('side-panel-slide-offset-left')).toBe(false)

        rail.destroy()
    })

    it('resolves playClose only when panel and backdrop transitionend events finish', async () => {
        const rail = createSidePanel(buildConfig({ side: 'left' }))
        const panel = document.createElement('div')

        rail.playOpen(panel)
        const closed = rail.playClose()

        let resolved = false
        void closed.then(() => { resolved = true })
        await Promise.resolve()
        expect(resolved).toBe(false)

        emitTransitionEnd(panel, 'width')
        emitTransitionEnd(rail.backdropElement, 'transform')
        await Promise.resolve()
        expect(resolved).toBe(false)

        emitTransitionEnd(panel, 'transform')
        emitTransitionEnd(rail.backdropElement, 'transform')
        await closed
        expect(resolved).toBe(true)

        rail.destroy()
    })

    it('resolves playClose immediately when prefers-reduced-motion is enabled', async () => {
        const originalMatchMedia = window.matchMedia
        window.matchMedia = vi.fn().mockReturnValue({ matches: true })

        try {
            const rail = createSidePanel(buildConfig())
            await expect(rail.playClose()).resolves.toBeUndefined()
            rail.destroy()
        } finally {
            window.matchMedia = originalMatchMedia
        }
    })

    it('resolves an in-flight close if the component is destroyed first', async () => {
        const rail = createSidePanel(buildConfig())

        const closed = rail.playClose()
        rail.destroy()

        await expect(closed).resolves.toBeUndefined()
    })

    it('removes the element and detaches drag listeners on destroy', () => {
        const onResize = vi.fn()
        const rail = createSidePanel(buildConfig({ onResize }))
        document.body.appendChild(rail.element)

        mousedown(rail.element, 500)
        rail.destroy()

        expect(rail.element.isConnected).toBe(false)
        move(400)
        expect(onResize).not.toHaveBeenCalled()
    })
})
