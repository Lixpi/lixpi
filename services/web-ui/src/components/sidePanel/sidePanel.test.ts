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

function dispatchPointer(target: EventTarget, type: string, clientX = 0, options: {
    button?: number
    pointerId?: number
    pointerType?: string
} = {}): void {
    const event = new MouseEvent(type, {
        clientX,
        button: options.button ?? 0,
        bubbles: true,
        cancelable: true,
    })
    Object.defineProperties(event, {
        pointerId: { value: options.pointerId ?? 1 },
        pointerType: { value: options.pointerType ?? 'touch' },
    })
    target.dispatchEvent(event)
}

function pointerdown(target: EventTarget, clientX: number, options: {
    button?: number
    pointerId?: number
    pointerType?: string
} = {}): void {
    dispatchPointer(target, 'pointerdown', clientX, options)
}

function move(clientX: number, pointerId = 1): void {
    dispatchPointer(document, 'pointermove', clientX, { pointerId })
}

function pointerup(pointerId = 1): void {
    dispatchPointer(document, 'pointerup', 0, { pointerId })
}

function emitTransitionEnd(element: HTMLElement, propertyName = 'transform'): void {
    const event = new Event('transitionend', { bubbles: true })
    Object.defineProperty(event, 'propertyName', { value: propertyName })
    element.dispatchEvent(event)
}

function stubRect(element: HTMLElement, rect: { left: number; top: number; right: number; bottom: number }): void {
    Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            ...rect,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        }),
    })
}

function overlayPointerDown(clientX: number, clientY: number, options: {
    button?: number
    isPrimary?: boolean
    target?: HTMLElement
} = {}): void {
    const event = new PointerEvent('pointerdown', {
        clientX,
        clientY,
        button: options.button ?? 0,
        bubbles: true,
        cancelable: true,
    })
    // happy-dom defaults `isPrimary` to false; real browsers default it to true
    // for the first active contact, so force it unless the test opts out.
    Object.defineProperty(event, 'isPrimary', { value: options.isPrimary ?? true })
    ;(options.target ?? document).dispatchEvent(event)
}

function overlayClick(clientX: number, clientY: number, options: { button?: number; target?: HTMLElement } = {}): void {
    const event = new MouseEvent('click', {
        clientX,
        clientY,
        button: options.button ?? 0,
        bubbles: true,
        cancelable: true,
    })
    ;(options.target ?? document).dispatchEvent(event)
}

const RIGHT_CLOSED_TOGGLE_TRANSFORM = 'translate3d(var(--side-panel-toggle-closed-travel, var(--side-panel-backdrop-width, 0px)), 0, 0)'

function stubAnimationFrames(): () => void {
    const originalRequestAnimationFrame = window.requestAnimationFrame
    window.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
        callback(0)
        return 1
    }) as typeof window.requestAnimationFrame
    return () => {
        window.requestAnimationFrame = originalRequestAnimationFrame
    }
}

async function flushSlideFrames(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.body.innerHTML = ''
})

describe('SidePanel', () => {
    it('renders a positioned resize handle with the side and extra class', () => {
        const sidePanel = createSidePanel(buildConfig({ side: 'right', className: 'extra-handle' }))

        expect(sidePanel.element.classList.contains('side-panel-resize-handle')).toBe(true)
        expect(sidePanel.element.classList.contains('side-panel-resize-handle-right')).toBe(true)
        expect(sidePanel.element.classList.contains('extra-handle')).toBe(true)
        expect(sidePanel.element.style.left).toBe('-14px')
        expect(sidePanel.element.style.right).toBe('')

        sidePanel.destroy()
    })

    it('hugs the right edge for a left-side panel', () => {
        const sidePanel = createSidePanel(buildConfig({ side: 'left' }))

        expect(sidePanel.element.style.right).toBe('-14px')
        expect(sidePanel.element.style.left).toBe('')

        sidePanel.destroy()
    })

    it('grows a right-side panel as the pointer drags left', () => {
        const onResize = vi.fn()
        const onResizeStart = vi.fn()
        const onResizeEnd = vi.fn()
        const sidePanel = createSidePanel(buildConfig({ onResize, onResizeStart, onResizeEnd }))

        pointerdown(sidePanel.element, 500)
        expect(onResizeStart).toHaveBeenCalledTimes(1)
        expect(document.body.style.cursor).toBe('ew-resize')

        move(460)
        // startWidth 380 + (500 - 460) = 420
        expect(onResize).toHaveBeenLastCalledWith(420)

        pointerup()
        expect(onResizeEnd).toHaveBeenCalledWith(420)
        expect(document.body.style.cursor).toBe('')

        sidePanel.destroy()
    })

    it('grows a left-side panel as the pointer drags right', () => {
        const onResize = vi.fn()
        const sidePanel = createSidePanel(buildConfig({ side: 'left', onResize }))

        pointerdown(sidePanel.element, 500)
        move(560)
        // startWidth 380 + (560 - 500) = 440
        expect(onResize).toHaveBeenLastCalledWith(440)

        pointerup()
        sidePanel.destroy()
    })

    it('tracks the active touch pointer and ignores unrelated contacts', () => {
        const onResize = vi.fn()
        const sidePanel = createSidePanel(buildConfig({ onResize }))

        pointerdown(sidePanel.element, 500, { pointerId: 7, pointerType: 'touch' })
        move(430, 8)
        expect(onResize).not.toHaveBeenCalled()

        move(430, 7)
        expect(onResize).toHaveBeenLastCalledWith(450)

        pointerup(7)
        sidePanel.destroy()
    })

    it('ignores non-primary buttons', () => {
        const onResizeStart = vi.fn()
        const sidePanel = createSidePanel(buildConfig({ onResizeStart }))

        pointerdown(sidePanel.element, 500, { button: 2 })
        expect(onResizeStart).not.toHaveBeenCalled()

        sidePanel.destroy()
    })

    it('renders a single full-height line with no boundary circle', () => {
        const sidePanel = createSidePanel(buildConfig())
        const line = sidePanel.element.querySelector('.side-panel-resize-handle-line')

        expect(line).not.toBeNull()
        expect(sidePanel.element.querySelector('.side-panel-resize-handle-boundary-circle')).toBeNull()
        expect(sidePanel.element.style.getPropertyValue('--side-panel-resize-handle-thread-height')).toBe('')

        sidePanel.destroy()
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
        const sidePanel = createSidePanel(buildConfig())
        document.body.appendChild(sidePanel.backdropElement)
        expect(sidePanel.backdropElement.isConnected).toBe(true)

        sidePanel.destroy()
        expect(sidePanel.backdropElement.isConnected).toBe(false)
    })

    it('toggles state classes', () => {
        const sidePanel = createSidePanel(buildConfig())

        sidePanel.setSelected(true)
        expect(sidePanel.element.classList.contains('is-selected')).toBe(true)
        sidePanel.setResizing(true)
        expect(sidePanel.element.classList.contains('is-resizing')).toBe(true)

        sidePanel.destroy()
    })

    it('owns the width state, clamped to min/max', () => {
        const sidePanel = createSidePanel(buildConfig({ minWidth: 320, getMaxWidth: () => 600 }))

        // Never resized → resolved default, raw stays null.
        expect(sidePanel.getWidth()).toBe(380)
        expect(sidePanel.getRawWidth()).toBeNull()

        expect(sidePanel.setWidth(1000)).toBe(600)
        expect(sidePanel.getWidth()).toBe(600)
        expect(sidePanel.getRawWidth()).toBe(600)
        expect(sidePanel.getState()).toEqual({ width: 600 })

        expect(sidePanel.setWidth(100)).toBe(320)
        expect(sidePanel.getWidth()).toBe(320)

        sidePanel.destroy()
    })

    it('loads its initial width from the persistence adapter', () => {
        const sidePanel = createSidePanel(buildConfig({ loadState: () => ({ width: 500 }) }))

        expect(sidePanel.getRawWidth()).toBe(500)
        expect(sidePanel.getWidth()).toBe(500)

        sidePanel.destroy()
    })

    it('persists on drag end and on explicit request, not on plain setWidth', () => {
        const persistState = vi.fn()
        const sidePanel = createSidePanel(buildConfig({ persistState }))

        sidePanel.setWidth(420)
        expect(persistState).not.toHaveBeenCalled()

        sidePanel.setWidth(440, { persist: true })
        expect(persistState).toHaveBeenLastCalledWith({ width: 440 })

        pointerdown(sidePanel.element, 500)
        move(470)
        pointerup()
        // drag starts from the stored 440 + (500 - 470) = 470
        expect(persistState).toHaveBeenLastCalledWith({ width: 470 })

        sidePanel.destroy()
    })

    it('notifies subscribers and onResize, and supports silent updates', () => {
        const onResize = vi.fn()
        const subscriber = vi.fn()
        const sidePanel = createSidePanel(buildConfig({ onResize }))
        const unsubscribe = sidePanel.subscribe(subscriber)

        sidePanel.setWidth(420)
        expect(onResize).toHaveBeenLastCalledWith(420)
        expect(subscriber).toHaveBeenLastCalledWith(420)

        sidePanel.setWidth(440, { silent: true })
        expect(onResize).toHaveBeenCalledTimes(1)
        expect(subscriber).toHaveBeenCalledTimes(1)

        unsubscribe()
        sidePanel.setWidth(460)
        expect(subscriber).toHaveBeenCalledTimes(1)

        sidePanel.destroy()
    })

    it('re-clamps the stored width through applyConstraints when max shrinks', () => {
        let max = 900
        const onResize = vi.fn()
        const sidePanel = createSidePanel(buildConfig({ onResize, getMaxWidth: () => max }))

        sidePanel.setWidth(800)
        onResize.mockClear()

        max = 500
        sidePanel.applyConstraints()
        expect(sidePanel.getWidth()).toBe(500)
        expect(onResize).toHaveBeenLastCalledWith(500)

        sidePanel.destroy()
    })

    it('does not emit from applyConstraints when never resized', () => {
        const onResize = vi.fn()
        const sidePanel = createSidePanel(buildConfig({ onResize }))

        sidePanel.applyConstraints()
        expect(onResize).not.toHaveBeenCalled()

        sidePanel.destroy()
    })

    it('mounts an already-open panel at rest without replaying the slide', () => {
        const sidePanel = createSidePanel(buildConfig({
            toggle: {
                iconSvg: '<svg></svg>',
                openAriaLabel: 'Collapse panel',
                closedAriaLabel: 'Open panel',
                closedTravel: '64px',
                onToggle: vi.fn(),
            },
        }))
        const panel = document.createElement('div')

        sidePanel.mountOpen(panel)

        expect(panel.classList.contains('side-panel-slide')).toBe(true)
        expect(sidePanel.backdropElement.classList.contains('side-panel-slide')).toBe(true)
        expect(sidePanel.toggleElement?.classList.contains('side-panel-slide')).toBe(true)
        expect(panel.style.transition).toBe('none')
        expect(sidePanel.backdropElement.style.transition).toBe('none')
        expect(sidePanel.toggleElement?.style.transition).toBe('none')
        expect(panel.style.transform).toBe('translate3d(0, 0, 0)')
        expect(sidePanel.backdropElement.style.transform).toBe('translate3d(0, 0, 0)')
        expect(sidePanel.toggleElement?.style.transform).toBe('translate3d(0, 0, 0)')
        expect(sidePanel.toggleElement?.ariaLabel).toBe('Collapse panel')

        sidePanel.destroy()
    })

    it('prepares panel, backdrop, and toggle in the off-edge start position', () => {
        const sidePanel = createSidePanel(buildConfig({
            toggle: {
                iconSvg: '<svg></svg>',
                openAriaLabel: 'Collapse panel',
                closedAriaLabel: 'Open panel',
                closedTravel: '64px',
                onToggle: vi.fn(),
            },
        }))
        const panel = document.createElement('div')

        sidePanel.prepareOpen(panel)

        expect(panel.style.transform).toBe('translate3d(100%, 0, 0)')
        expect(sidePanel.backdropElement.style.transform).toBe('translate3d(100%, 0, 0)')
        expect(sidePanel.toggleElement?.style.getPropertyValue('--side-panel-toggle-closed-travel')).toBe('64px')
        expect(sidePanel.toggleElement?.style.transform).toBe(RIGHT_CLOSED_TOGGLE_TRANSFORM)
        expect(sidePanel.toggleElement?.ariaLabel).toBe('Collapse panel')

        sidePanel.destroy()
    })

    it('applies caller-provided animation timing to every moving surface', () => {
        const sidePanel = createSidePanel(buildConfig({
            animation: {
                durationMs: 345,
                easing: 'linear(0, 1)',
            },
            toggle: {
                iconSvg: '<svg></svg>',
                openAriaLabel: 'Collapse panel',
                closedAriaLabel: 'Open panel',
                onToggle: vi.fn(),
            },
        }))
        const panel = document.createElement('div')

        sidePanel.mountOpen(panel)

        const movingSurfaces = [panel, sidePanel.backdropElement, sidePanel.toggleElement]
            .filter((surface): surface is HTMLElement => surface !== null)
        for (const surface of movingSurfaces) {
            expect(surface.style.getPropertyValue('--side-panel-slide-duration')).toBe('345ms')
            expect(surface.style.getPropertyValue('--side-panel-slide-easing')).toBe('linear(0, 1)')
        }

        sidePanel.destroy()
    })

    it('uses distinct default open/close easing and a 500ms default duration when unconfigured', () => {
        const sidePanel = createSidePanel(buildConfig())
        const panel = document.createElement('div')

        sidePanel.mountOpen(panel)
        expect(panel.style.getPropertyValue('--side-panel-slide-duration')).toBe('500ms')
        expect(panel.style.getPropertyValue('--side-panel-slide-easing')).toBe('cubic-bezier(0.22, 1, 0.36, 1)')

        sidePanel.playClose()
        expect(panel.style.getPropertyValue('--side-panel-slide-easing')).toBe('cubic-bezier(0.64, 0, 0.78, 0)')

        sidePanel.destroy()
    })

    it('lets a generic animation.easing override both open and close directions', () => {
        const sidePanel = createSidePanel(buildConfig({
            animation: { durationMs: 200, easing: 'ease-in-out' },
        }))
        const panel = document.createElement('div')

        sidePanel.mountOpen(panel)
        expect(panel.style.getPropertyValue('--side-panel-slide-easing')).toBe('ease-in-out')

        sidePanel.playClose()
        expect(panel.style.getPropertyValue('--side-panel-slide-easing')).toBe('ease-in-out')

        sidePanel.destroy()
    })

    it('lets per-direction openEasing/closeEasing take priority over the generic easing fallback', () => {
        const sidePanel = createSidePanel(buildConfig({
            animation: {
                durationMs: 200,
                easing: 'ease-in-out',
                openEasing: 'ease-out',
                closeEasing: 'ease-in',
            },
        }))
        const panel = document.createElement('div')

        sidePanel.mountOpen(panel)
        expect(panel.style.getPropertyValue('--side-panel-slide-easing')).toBe('ease-out')

        sidePanel.playClose()
        expect(panel.style.getPropertyValue('--side-panel-slide-easing')).toBe('ease-in')

        sidePanel.destroy()
    })

    it('keeps a fixed-motion toggle stationary and out of the slide target list', async () => {
        const restoreAnimationFrames = stubAnimationFrames()
        try {
            const sidePanel = createSidePanel(buildConfig({
                toggle: {
                    iconSvg: '<svg></svg>',
                    openAriaLabel: 'Collapse panel',
                    closedAriaLabel: 'Open panel',
                    motion: 'fixed',
                    onToggle: vi.fn(),
                },
            }))
            const toggle = sidePanel.toggleElement as HTMLButtonElement

            // Fixed toggles start without the 'none' transition guard the sliding
            // default applies, and their closed transform is the identity.
            expect(toggle.style.transition).toBe('')
            expect(toggle.style.transform).toBe('translate3d(0, 0, 0)')

            const panel = document.createElement('div')
            document.body.appendChild(toggle)
            sidePanel.mountOpen(panel)
            expect(toggle.classList.contains('side-panel-slide')).toBe(false)
            expect(toggle.style.transform).toBe('translate3d(0, 0, 0)')

            const closed = sidePanel.playClose()
            await flushSlideFrames()
            // A fixed toggle never receives an animated transform, in either direction.
            expect(toggle.style.transform).toBe('translate3d(0, 0, 0)')
            expect(toggle.classList.contains('side-panel-slide')).toBe(false)

            emitTransitionEnd(panel, 'transform')
            emitTransitionEnd(sidePanel.backdropElement, 'transform')
            await closed

            sidePanel.destroy()
        } finally {
            restoreAnimationFrames()
        }
    })

    it('slides the toggle with the panel and waits for every moving surface to finish', async () => {
        const restoreAnimationFrames = stubAnimationFrames()
        try {
            const sidePanel = createSidePanel(buildConfig({
                toggle: {
                    iconSvg: '<svg></svg>',
                    openAriaLabel: 'Collapse panel',
                    closedAriaLabel: 'Open panel',
                    closedTravel: '80px',
                    onToggle: vi.fn(),
                },
            }))
            const panel = document.createElement('div')

            sidePanel.mountOpen(panel)
            const closed = sidePanel.playClose()
            await flushSlideFrames()

            let resolved = false
            void closed.then(() => { resolved = true })
            expect(panel.style.transform).toBe('translate3d(100%, 0, 0)')
            expect(sidePanel.backdropElement.style.transform).toBe('translate3d(100%, 0, 0)')
            expect(sidePanel.toggleElement?.style.getPropertyValue('--side-panel-toggle-closed-travel')).toBe('80px')
            expect(sidePanel.toggleElement?.style.transform).toBe(RIGHT_CLOSED_TOGGLE_TRANSFORM)
            expect(panel.style.transition).toBe('var(--side-panel-slide-transition)')
            expect(sidePanel.toggleElement?.style.transition).toBe('var(--side-panel-slide-transition)')

            emitTransitionEnd(panel, 'transform')
            emitTransitionEnd(sidePanel.backdropElement, 'transform')
            await Promise.resolve()
            expect(resolved).toBe(false)

            emitTransitionEnd(sidePanel.toggleElement as HTMLElement, 'transform')
            await closed
            await Promise.resolve()
            expect(resolved).toBe(true)

            sidePanel.destroy()
        } finally {
            restoreAnimationFrames()
        }
    })

    it('uses the configured animation duration for the transitionend fallback', async () => {
        async function closeWithCapturedFallback(durationMs: number): Promise<{
            resolvedBeforeFallback: boolean
            resolvedAfterFallback: boolean
            scheduledDelay: number
        }> {
            let fallbackCallback: (() => void) | null = null
            let scheduledDelay = 0
            const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((
                handler: TimerHandler,
                timeout?: number,
                ...args: unknown[]
            ): number => {
                scheduledDelay = Number(timeout)
                fallbackCallback = typeof handler === 'function'
                    ? () => { handler(...args) }
                    : () => undefined
                return 1
            }) as typeof window.setTimeout)
            const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined)
            const sidePanel = createSidePanel(buildConfig({
                animation: {
                    durationMs,
                    easing: 'ease-out',
                },
            }))
            const panel = document.createElement('div')

            try {
                sidePanel.mountOpen(panel)

                const closed = sidePanel.playClose()
                await flushSlideFrames()

                let resolved = false
                void closed.then(() => { resolved = true })
                await Promise.resolve()
                const resolvedBeforeFallback = resolved

                expect(fallbackCallback).not.toBeNull()
                fallbackCallback?.()
                await closed
                await Promise.resolve()

                return {
                    resolvedBeforeFallback,
                    resolvedAfterFallback: resolved,
                    scheduledDelay,
                }
            } finally {
                sidePanel.destroy()
                setTimeoutSpy.mockRestore()
                clearTimeoutSpy.mockRestore()
            }
        }

        const restoreAnimationFrames = stubAnimationFrames()

        try {
            const shortDuration = 25
            const longDuration = 70
            const shortClose = await closeWithCapturedFallback(shortDuration)
            const longClose = await closeWithCapturedFallback(longDuration)

            expect(shortClose.resolvedBeforeFallback).toBe(false)
            expect(shortClose.resolvedAfterFallback).toBe(true)
            expect(longClose.resolvedAfterFallback).toBe(true)
            expect(longClose.scheduledDelay - shortClose.scheduledDelay).toBe(longDuration - shortDuration)
        } finally {
            restoreAnimationFrames()
        }
    })

    it('resolves an in-flight close if the component is destroyed first', async () => {
        const sidePanel = createSidePanel(buildConfig())

        const closed = sidePanel.playClose()
        sidePanel.destroy()

        await expect(closed).resolves.toBeUndefined()
    })

    it('removes the element and detaches drag listeners on destroy', () => {
        const onResize = vi.fn()
        const sidePanel = createSidePanel(buildConfig({ onResize }))
        document.body.appendChild(sidePanel.element)

        pointerdown(sidePanel.element, 500)
        sidePanel.destroy()

        expect(sidePanel.element.isConnected).toBe(false)
        move(400)
        expect(onResize).not.toHaveBeenCalled()
    })

    it('requests close from a plain click inside the overlay only while open and dismissible', () => {
        const onOpenChange = vi.fn()
        const sidePanel = createSidePanel(buildConfig({
            overlay: {
                enabled: true,
                closeOnPointerDown: true,
            },
            onOpenChange,
        }))
        stubRect(sidePanel.overlayElement as HTMLElement, { left: 0, top: 0, right: 400, bottom: 800 })

        // Closed: a stray click inside the overlay bounds must not fire onOpenChange.
        overlayPointerDown(200, 200)
        overlayClick(200, 200)
        expect(onOpenChange).not.toHaveBeenCalled()

        sidePanel.setOpen(true)
        overlayPointerDown(200, 200)
        overlayClick(200, 200)
        expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)

        sidePanel.destroy()

        const disabledOverlayPanel = createSidePanel(buildConfig({
            overlay: {
                enabled: true,
                closeOnPointerDown: false,
            },
            onOpenChange,
        }))
        stubRect(disabledOverlayPanel.overlayElement as HTMLElement, { left: 0, top: 0, right: 400, bottom: 800 })

        onOpenChange.mockClear()
        disabledOverlayPanel.setOpen(true)
        overlayPointerDown(200, 200)
        overlayClick(200, 200)
        expect(onOpenChange).not.toHaveBeenCalled()

        disabledOverlayPanel.destroy()
    })

    it('ignores an overlay click outside the overlay bounds', () => {
        const onOpenChange = vi.fn()
        const sidePanel = createSidePanel(buildConfig({
            overlay: { enabled: true },
            onOpenChange,
        }))
        stubRect(sidePanel.overlayElement as HTMLElement, { left: 0, top: 0, right: 400, bottom: 800 })
        sidePanel.setOpen(true)

        overlayPointerDown(900, 900)
        overlayClick(900, 900)
        expect(onOpenChange).not.toHaveBeenCalled()

        sidePanel.destroy()
    })

    it('ignores overlay clicks that started or land on the panel, toggle, or resize handle', () => {
        const onOpenChange = vi.fn()
        const sidePanel = createSidePanel(buildConfig({
            overlay: { enabled: true },
            toggle: {
                iconSvg: '<svg></svg>',
                openAriaLabel: 'Collapse panel',
                closedAriaLabel: 'Open panel',
                onToggle: vi.fn(),
            },
            onOpenChange,
        }))
        stubRect(sidePanel.overlayElement as HTMLElement, { left: 0, top: 0, right: 400, bottom: 800 })
        const panel = document.createElement('div')
        document.body.appendChild(panel)
        sidePanel.mountOpen(panel)
        sidePanel.setOpen(true)

        overlayPointerDown(200, 200, { target: panel })
        overlayClick(200, 200, { target: panel })
        expect(onOpenChange).not.toHaveBeenCalled()

        overlayPointerDown(200, 200, { target: sidePanel.toggleElement as HTMLElement })
        overlayClick(200, 200, { target: sidePanel.toggleElement as HTMLElement })
        expect(onOpenChange).not.toHaveBeenCalled()

        overlayPointerDown(200, 200, { target: sidePanel.element })
        overlayClick(200, 200, { target: sidePanel.element })
        expect(onOpenChange).not.toHaveBeenCalled()

        sidePanel.destroy()
    })

    it('ignores non-primary-button clicks for overlay dismissal', () => {
        const onOpenChange = vi.fn()
        const sidePanel = createSidePanel(buildConfig({
            overlay: { enabled: true },
            onOpenChange,
        }))
        stubRect(sidePanel.overlayElement as HTMLElement, { left: 0, top: 0, right: 400, bottom: 800 })
        sidePanel.setOpen(true)

        overlayPointerDown(200, 200)
        overlayClick(200, 200, { button: 1 })
        expect(onOpenChange).not.toHaveBeenCalled()

        sidePanel.destroy()
    })

    it('treats an overlay pointerdown-then-drag-then-release as a drag, not a dismiss click', () => {
        const onOpenChange = vi.fn()
        const sidePanel = createSidePanel(buildConfig({
            overlay: { enabled: true },
            onOpenChange,
        }))
        stubRect(sidePanel.overlayElement as HTMLElement, { left: 0, top: 0, right: 400, bottom: 800 })
        sidePanel.setOpen(true)

        // Pointer starts inside the overlay but the click lands far enough away
        // (e.g. a text-selection drag) that it must not count as a dismiss click.
        overlayPointerDown(200, 200)
        overlayClick(210, 210)
        expect(onOpenChange).not.toHaveBeenCalled()

        // A click with no prior recorded overlay pointerdown (e.g. the browser
        // only ever fired 'click', as happens with keyboard/synthetic activation)
        // still dismisses, since there is no drag distance to disqualify it.
        overlayClick(200, 200)
        expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)

        sidePanel.destroy()
    })

    it('swipe-closes from panel body drag while fading the overlay from the dragged distance', () => {
        const onOpenChange = vi.fn()
        const sidePanel = createSidePanel(buildConfig({
            overlay: {
                enabled: true,
                opacity: 0.6,
            },
            drag: {
                enabled: true,
                closeThreshold: 0.25,
                velocityThreshold: 999,
                pointerSwipeStartThreshold: 2,
                touchSwipeStartThreshold: 2,
            },
            onOpenChange,
        }))
        const panel = document.createElement('div')
        Object.defineProperty(panel, 'getBoundingClientRect', {
            value: () => ({ width: 400, height: 800, left: 0, top: 0, right: 400, bottom: 800 }),
        })

        sidePanel.mountOpen(panel)
        pointerdown(panel, 500, { pointerType: 'touch' })
        dispatchPointer(panel, 'pointermove', 620, { pointerType: 'touch' })

        expect(panel.classList.contains('side-panel-touch-dragging')).toBe(true)
        expect(panel.style.transform).toBe('translate3d(120px, 0, 0)')
        expect(sidePanel.backdropElement.style.transform).toBe('translate3d(120px, 0, 0)')
        expect(sidePanel.overlayElement?.style.opacity).toBe('0.42')

        dispatchPointer(panel, 'pointerup', 620, { pointerType: 'touch' })

        expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
        expect(panel.classList.contains('side-panel-touch-dragging')).toBe(false)

        sidePanel.destroy()
    })

    it('resets panel drag instead of closing when the close threshold is not reached', () => {
        const onOpenChange = vi.fn()
        const sidePanel = createSidePanel(buildConfig({
            overlay: {
                enabled: true,
                opacity: 0.5,
            },
            drag: {
                enabled: true,
                closeThreshold: 0.5,
                velocityThreshold: 999,
                pointerSwipeStartThreshold: 2,
            },
            onOpenChange,
        }))
        const panel = document.createElement('div')
        Object.defineProperty(panel, 'getBoundingClientRect', {
            value: () => ({ width: 400, height: 800, left: 0, top: 0, right: 400, bottom: 800 }),
        })

        sidePanel.mountOpen(panel)
        pointerdown(panel, 500, { pointerType: 'mouse' })
        dispatchPointer(panel, 'pointermove', 560, { pointerType: 'mouse' })
        dispatchPointer(panel, 'pointerup', 560, { pointerType: 'mouse' })

        expect(onOpenChange).not.toHaveBeenCalled()
        expect(panel.style.transform).toBe('translate3d(0, 0, 0)')
        expect(panel.style.transition).toBe('var(--side-panel-slide-transition)')
        expect(sidePanel.overlayElement?.style.opacity).toBe('0.5')
        expect(sidePanel.overlayElement?.style.transition).toBe('var(--side-panel-overlay-transition)')

        sidePanel.destroy()
    })

    it('does not start swipe-close gestures from interactive or opted-out panel children', () => {
        const onOpenChange = vi.fn()
        const sidePanel = createSidePanel(buildConfig({
            drag: {
                enabled: true,
                closeThreshold: 0.25,
                velocityThreshold: 999,
            },
            onOpenChange,
        }))
        const panel = document.createElement('div')
        const button = document.createElement('button')
        const optedOut = document.createElement('div')
        optedOut.dataset.sidePanelNoDrag = 'true'
        panel.append(button, optedOut)
        Object.defineProperty(panel, 'getBoundingClientRect', {
            value: () => ({ width: 400, height: 800, left: 0, top: 0, right: 400, bottom: 800 }),
        })

        sidePanel.mountOpen(panel)

        pointerdown(button, 500)
        dispatchPointer(panel, 'pointermove', 680)
        dispatchPointer(panel, 'pointerup', 680)
        pointerdown(optedOut, 500)
        dispatchPointer(panel, 'pointermove', 680)
        dispatchPointer(panel, 'pointerup', 680)

        expect(onOpenChange).not.toHaveBeenCalled()
        expect(panel.style.transform).toBe('translate3d(0, 0, 0)')

        sidePanel.destroy()
    })
})
