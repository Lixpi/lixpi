// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewportController, type ViewportControllerOptions } from './viewport-controller.ts'

const controllers: ViewportController[] = []
const setup = (config: ViewportControllerOptions['config'] = {}, owner: Document = document) => {
    const root = owner.createElement('div')
    owner.body.append(root)
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
    const onTransformChange = vi.fn()
    const onDraggingChange = vi.fn()
    const controller = new ViewportController({
        root,
        viewport: {
            x: 0,
            y: 0,
            zoom: 1,
        },
        config,
        onTransformChange,
        onDraggingChange,
    })
    controllers.push(controller)

    return {
        root,
        controller,
        onTransformChange,
        onDraggingChange,
    }
}
const wheel = (root: HTMLElement, init: WheelEventInit = {}) => {
    // Happy DOM's WheelEvent extends UIEvent and omits MouseEvent coordinates/modifiers.
    const event = new MouseEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
        ...init,
    })
    Object.defineProperties(event, {
        deltaX: { value: init.deltaX ?? 0 },
        deltaY: { value: init.deltaY ?? 0 },
        deltaMode: { value: init.deltaMode ?? 0 },
    })
    root.dispatchEvent(event)

    return event
}
const mouse = (target: EventTarget, type: string, x: number, y: number, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        ...init,
    }))
const pointer = (target: EventTarget, type: string, x: number, y: number, init: PointerEventInit = {}) => {
    const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
        ...init,
    })
    target.dispatchEvent(event)

    return event
}
const touch = (root: HTMLElement, type: string, touches: Array<{
    identifier: number
    clientX: number
    clientY: number
}>, changed = touches) => {
    const pointerType = {
        touchstart: 'pointerdown',
        touchmove: 'pointermove',
        touchend: 'pointerup',
    }[type]!

    for (const contact of changed)
        pointer(root, pointerType, contact.clientX, contact.clientY, {
            pointerId: contact.identifier,
            pointerType: 'touch',
        })
}
const animationClock = () => {
    let time = 0
    let id = 0
    const callbacks = new Map<number, FrameRequestCallback>()
    vi.spyOn(window.performance, 'now').mockImplementation(() => time)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        callbacks.set(++id, callback)

        return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(key => void callbacks.delete(key))

    return {
        callbacks,
        advance: (duration: number) => {
            time += duration
            const ready = [...callbacks.values()]
            callbacks.clear()

            for (const callback of ready) callback(time)
        },
    }
}

afterEach(() => {
    for (const controller of controllers.splice(0)) controller.destroy()

    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('native viewport input', () => {
    it('does not report or stop propagating zoom wheel events already at a scale limit', () => {
        const {
            root,
            controller,
            onTransformChange,
        } = setup({
            panOnScroll: false,
            zoomOnScroll: true,
        })
        controller.syncViewport({
            x: 0,
            y: 0,
            zoom: 2,
        })
        const parentWheel = vi.fn()
        document.body.addEventListener('wheel', parentWheel)

        try {
            wheel(root, { deltaY: -100 })
            expect(onTransformChange).not.toHaveBeenCalled()
            expect(parentWheel).toHaveBeenCalledOnce()
        } finally {
            document.body.removeEventListener('wheel', parentWheel)
        }
    })

    it('releases a failed constructor and restores styles and listeners', () => {
        const root = document.createElement('div')
        root.style.setProperty('-webkit-tap-highlight-color', 'red')
        const originalTapColor = root.style.getPropertyValue('-webkit-tap-highlight-color')
        const remove = vi.spyOn(root, 'removeEventListener')
        const add = root.addEventListener.bind(root)
        vi.spyOn(root, 'addEventListener').mockImplementation((type, listener, options) => {
            if (type === 'pointerdown')
                throw new Error('listener failed')

            add(type, listener, options)
        })

        try {
            expect(() => new ViewportController({
                root,
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                onTransformChange: vi.fn(),
            })).toThrow('listener failed')
            expect(remove.mock.calls.some(([type]) => type === 'wheel')).toBe(true)
            expect(root.style.getPropertyValue('-webkit-tap-highlight-color')).toBe(originalTapColor)
        } finally {
            vi.restoreAllMocks()
        }
    })

    it('uses the root document window for dragging and blur', () => {
        const frame = document.createElement('iframe')
        document.body.append(frame)
        const owner = frame.contentDocument!
        const view = owner.defaultView!
        const {
            root,
            controller,
        } = setup({}, owner)
        pointer(root, 'pointerdown', 10, 10, { view })
        pointer(view, 'pointermove', 30, 50, { view })
        expect(controller.getViewport()).toEqual({
            x: 20,
            y: 40,
            zoom: 1,
        })
        view.dispatchEvent(new Event('blur'))
        pointer(view, 'pointermove', 90, 100, { view })
        expect(controller.getViewport()).toEqual({
            x: 20,
            y: 40,
            zoom: 1,
        })
    })

    it('silently syncs authoritative state and reports unconstrained programmatic transforms once', async () => {
        const {
            controller,
            onTransformChange,
        } = setup()
        controller.syncViewport({
            x: 15,
            y: -20,
            zoom: 4,
        })
        expect(onTransformChange).not.toHaveBeenCalled()
        expect(await controller.setViewport({
            x: 30,
            y: 40,
            zoom: 3,
        })).toBe(true)
        expect(onTransformChange).toHaveBeenCalledExactlyOnceWith([30, 40, 3])
        expect(controller.getViewport()).toEqual({
            x: 30,
            y: 40,
            zoom: 3,
        })
        expect(() => controller.syncViewport({
            x: Infinity,
            y: 0,
            zoom: 1,
        })).toThrow()
        await expect(controller.setViewport({
            x: 0,
            y: 0,
            zoom: 0,
        })).rejects.toThrow()
        controller.destroy()
        expect(await controller.setViewport({
            x: 0,
            y: 0,
            zoom: 1,
        })).toBe(false)
    })

    it.each([
        ['free', -4, -6], ['horizontal', -4, 0], ['vertical', 0, -6],
    ] as const)('pans wheel input in %s mode', (panOnScrollMode, x, y) => {
        const {
            root,
            controller,
        } = setup({ panOnScrollMode })
        expect(wheel(root, {
            deltaX: 4,
            deltaY: 6,
        }).defaultPrevented).toBe(true)
        expect(controller.getViewport()).toEqual({
            x,
            y,
            zoom: 1,
        })
    })

    it('normalizes line deltas and maps shift-wheel horizontally on non-Mac systems', () => {
        vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Linux')
        const {
            root,
            controller,
        } = setup({ panOnScrollSpeed: 0.5 })
        wheel(root, {
            deltaY: 2,
            deltaMode: 1,
            shiftKey: true,
        })
        expect(controller.getViewport()).toEqual({
            x: -20,
            y: 0,
            zoom: 1,
        })
    })

    it('anchors pinch zoom at the pointer and clamps user scale to its bounds', () => {
        vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
        const {
            root,
            controller,
        } = setup()
        wheel(root, {
            ctrlKey: true,
            deltaY: -10,
        })
        const viewport = controller.getViewport()
        expect(viewport.zoom).toBeCloseTo(2 ** 0.2)
        expect((120 - viewport.x) / viewport.zoom).toBeCloseTo(120)
        expect((80 - viewport.y) / viewport.zoom).toBeCloseTo(80)
        wheel(root, {
            ctrlKey: true,
            deltaY: -10000,
        })
        expect(controller.getViewport().zoom).toBe(2)
        wheel(root, {
            ctrlKey: true,
            deltaY: 10000,
        })
        expect(controller.getViewport().zoom).toBe(0.1)
    })

    it('gives activation-key zoom precedence over scroll panning', () => {
        const {
            root,
            controller,
        } = setup({ zoomActivationKeyPressed: true })
        wheel(root, { deltaY: -100 })
        expect(controller.getViewport().zoom).toBeCloseTo(2 ** 0.2)
    })

    it('respects embedded content exclusions and native scroll policy', () => {
        const {
            root,
            controller,
        } = setup({
            panOnScroll: false,
            zoomOnScroll: true,
            preventScrolling: false,
        })
        expect(wheel(root, { deltaY: -100 }).defaultPrevented).toBe(false)
        const child = document.createElement('div')
        child.className = 'nowheel nopan'
        root.append(child)
        expect(wheel(child, {
            ctrlKey: true,
            deltaY: -100,
        }).defaultPrevented).toBe(true)
        pointer(child, 'pointerdown', 10, 10)
        pointer(window, 'pointermove', 40, 50)
        pointer(window, 'pointerup', 40, 50)
        expect(controller.getViewport()).toEqual({
            x: 0,
            y: 0,
            zoom: 1,
        })
    })

    it('cancels an active drag on nested locks and keeps authoritative sync available', async () => {
        const {
            root,
            controller,
            onDraggingChange,
        } = setup()
        pointer(root, 'pointerdown', 10, 20)
        pointer(window, 'pointermove', 30, 50)
        expect(controller.getViewport()).toEqual({
            x: 20,
            y: 30,
            zoom: 1,
        })
        expect(onDraggingChange).toHaveBeenCalledWith(true)
        const releaseA = controller.lock()
        const releaseB = controller.lock({ selection: true })
        expect(onDraggingChange).toHaveBeenLastCalledWith(false)
        releaseA()
        expect(await controller.setViewport({
            x: 0,
            y: 0,
            zoom: 1,
        })).toBe(false)
        controller.syncViewport({
            x: 100,
            y: 200,
            zoom: 1.5,
        })
        pointer(window, 'pointermove', 100, 100)
        wheel(root, { deltaY: 100 })
        releaseB()
        pointer(window, 'pointermove', 150, 150)
        expect(controller.getViewport()).toEqual({
            x: 100,
            y: 200,
            zoom: 1.5,
        })
        wheel(root, { deltaY: 10 })
        expect(controller.getViewport().y).toBe(190)
    })

    it('does not remove another canvas active drag when destroyed', () => {
        const first = setup()
        const second = setup()
        const originalSelectionStyle = document.documentElement.style.getPropertyValue('user-select')
        pointer(first.root, 'pointerdown', 0, 0, { pointerId: 1 })
        pointer(second.root, 'pointerdown', 10, 10, { pointerId: 2 })
        first.controller.destroy()
        expect(document.documentElement.style.getPropertyValue('user-select')).toBe('none')
        pointer(window, 'pointermove', 50, 60, { pointerId: 2 })
        expect(second.controller.getViewport()).toEqual({
            x: 40,
            y: 50,
            zoom: 1,
        })
        pointer(window, 'pointerup', 50, 60, { pointerId: 2 })
        expect(second.onDraggingChange).toHaveBeenLastCalledWith(false)
        expect(document.documentElement.style.getPropertyValue('user-select')).toBe(originalSelectionStyle)
    })

    it('keeps two-finger pinch continuous as one touch lifts, then cancels on blur', () => {
        const {
            root,
            controller,
        } = setup()
        const a = {
            identifier: 1,
            clientX: 100,
            clientY: 100,
        }
        const b = {
            identifier: 2,
            clientX: 200,
            clientY: 100,
        }
        touch(root, 'touchstart', [a], [a])
        touch(root, 'touchstart', [a, b], [b])
        const moved = {
            ...b,
            clientX: 300,
        }
        touch(root, 'touchmove', [a, moved], [moved])
        expect(controller.getViewport()).toEqual({
            x: -100,
            y: -100,
            zoom: 2,
        })
        touch(root, 'touchend', [a], [moved])
        const next = {
            ...a,
            clientX: 110,
            clientY: 120,
        }
        touch(root, 'touchmove', [next], [next])
        expect(controller.getViewport()).toEqual({
            x: -90,
            y: -80,
            zoom: 2,
        })
        window.dispatchEvent(new Event('blur'))
        touch(root, 'touchmove', [{
            ...next,
            clientX: 180,
        }])
        expect(controller.getViewport()).toEqual({
            x: -90,
            y: -80,
            zoom: 2,
        })
    })

    it('blocks a second touch when pinch is disabled', () => {
        const {
            root,
            controller,
        } = setup({ zoomOnPinch: false })
        touch(root, 'touchstart', [{
            identifier: 1,
            clientX: 100,
            clientY: 100,
        }, {
            identifier: 2,
            clientX: 200,
            clientY: 100,
        }])
        touch(root, 'touchmove', [{
            identifier: 2,
            clientX: 300,
            clientY: 100,
        }])
        expect(controller.getViewport().zoom).toBe(1)
    })

    it('animates double-click zoom and interrupts it on lock without late notifications', async () => {
        const {
            root,
            controller,
            onTransformChange,
        } = setup()
        mouse(root, 'dblclick', 100, 100)
        await new Promise(resolve => setTimeout(resolve, 320))
        expect(controller.getViewport().zoom).toBe(2)
        mouse(root, 'dblclick', 100, 100, { shiftKey: true })
        const release = controller.lock()
        const calls = onTransformChange.mock.calls.length
        await new Promise(resolve => setTimeout(resolve, 320))
        expect(onTransformChange).toHaveBeenCalledTimes(calls)
        release()
        controller.destroy()
        mouse(root, 'dblclick', 100, 100)
        expect(onTransformChange).toHaveBeenCalledTimes(calls)
    })

    it('removes root listeners and restores styles on destroy and permits recreation', () => {
        const {
            root,
            controller,
            onTransformChange,
        } = setup()
        controller.destroy()
        wheel(root, { deltaY: 10 })
        expect(onTransformChange).not.toHaveBeenCalled()
        expect(root.style.getPropertyValue('touch-action')).toBe('')
        const next = new ViewportController({
            root,
            viewport: {
                x: 0,
                y: 0,
                zoom: 1,
            },
            onTransformChange,
        })
        controllers.push(next)
        wheel(root, { deltaY: 10 })
        expect(next.getViewport().y).toBe(-10)
    })

    it.each(['pointercancel', 'lostpointercapture'])('releases captured pointers on %s without affecting another pointer', type => {
        const {
            root,
            controller,
            onDraggingChange,
        } = setup()
        const captured = new Set<number>()
        root.setPointerCapture = vi.fn(id => void captured.add(id))
        root.hasPointerCapture = id => captured.has(id)
        root.releasePointerCapture = vi.fn(id => void captured.delete(id))
        pointer(root, 'pointerdown', 10, 20, { pointerId: 42 })
        expect(root.setPointerCapture).toHaveBeenCalledWith(42)
        pointer(window, 'pointermove', 500, 500, { pointerId: 9 })
        expect(controller.getViewport().x).toBe(0)
        pointer(root, type, 10, 20, { pointerId: 42 })
        pointer(window, 'pointermove', 500, 500, { pointerId: 42 })
        expect(controller.getViewport()).toEqual({
            x: 0,
            y: 0,
            zoom: 1,
        })
        expect(root.releasePointerCapture).toHaveBeenCalledWith(42)
        expect(onDraggingChange.mock.calls).toEqual([[true], [false]])
    })

    it('pans with a pen and cancels when its button is released outside the WebView', () => {
        const {
            root,
            controller,
        } = setup()
        pointer(root, 'pointerdown', 10, 20, { pointerType: 'pen' })
        pointer(window, 'pointermove', 30, 50, { pointerType: 'pen' })
        expect(controller.getViewport()).toEqual({
            x: 20,
            y: 30,
            zoom: 1,
        })
        pointer(window, 'pointermove', 100, 100, {
            pointerType: 'pen',
            buttons: 0,
        })
        pointer(window, 'pointermove', 200, 200, { pointerType: 'pen' })
        expect(controller.getViewport()).toEqual({
            x: 20,
            y: 30,
            zoom: 1,
        })
    })

    it('rebases drag anchors on authoritative sync and programmatic transforms', async () => {
        const {
            root,
            controller,
        } = setup()
        pointer(root, 'pointerdown', 10, 20)
        pointer(window, 'pointermove', 30, 50)
        controller.syncViewport({
            x: 100,
            y: 200,
            zoom: 2,
        })
        pointer(window, 'pointermove', 40, 60)
        expect(controller.getViewport()).toEqual({
            x: 110,
            y: 210,
            zoom: 2,
        })
        await controller.setViewport({
            x: 0,
            y: 0,
            zoom: 4,
        })
        pointer(window, 'pointermove', 50, 80)
        expect(controller.getViewport()).toEqual({
            x: 10,
            y: 20,
            zoom: 4,
        })
    })

    it('preserves the pinch midpoint during authoritative updates and contact replacement', () => {
        const {
            root,
            controller,
        } = setup()
        pointer(root, 'pointerdown', 100, 100, {
            pointerType: 'touch',
            pointerId: 1,
        })
        pointer(root, 'pointerdown', 200, 100, {
            pointerType: 'touch',
            pointerId: 2,
        })
        controller.syncViewport({
            x: 10,
            y: 20,
            zoom: 0.5,
        })
        pointer(window, 'pointermove', 300, 100, {
            pointerType: 'touch',
            pointerId: 2,
        })
        expect(controller.getViewport()).toEqual({
            x: -80,
            y: -60,
            zoom: 1,
        })
        pointer(root, 'pointerdown', 400, 100, {
            pointerType: 'touch',
            pointerId: 3,
        })
        pointer(window, 'pointerup', 300, 100, {
            pointerType: 'touch',
            pointerId: 2,
        })
        pointer(window, 'pointermove', 400, 100, {
            pointerType: 'touch',
            pointerId: 3,
        })
        expect(controller.getViewport()).toEqual({
            x: -80,
            y: -60,
            zoom: 1,
        })
    })

    it('recovers pinch scale when two contacts initially share a position', () => {
        const {
            root,
            controller,
        } = setup()
        pointer(root, 'pointerdown', 100, 100, {
            pointerType: 'touch',
            pointerId: 1,
        })
        pointer(root, 'pointerdown', 100, 100, {
            pointerType: 'touch',
            pointerId: 2,
        })
        pointer(window, 'pointermove', 200, 100, {
            pointerType: 'touch',
            pointerId: 2,
        })
        expect(controller.getViewport().zoom).toBe(1)
        pointer(window, 'pointermove', 300, 100, {
            pointerType: 'touch',
            pointerId: 2,
        })
        expect(controller.getViewport().zoom).toBe(2)
    })

    it('leaves excluded editor pointers, native mouse compatibility and selection alone', () => {
        const {
            root,
            controller,
        } = setup()
        const editor = document.createElement('div')
        editor.className = 'nopan'
        editor.style.overflow = 'auto'
        editor.contentEditable = 'true'
        root.append(editor)
        root.setPointerCapture = vi.fn()
        const selectionStyle = document.documentElement.style.userSelect
        const down = pointer(editor, 'pointerdown', 10, 20, { pointerType: 'touch' })
        expect(down.defaultPrevented).toBe(false)
        expect(root.setPointerCapture).not.toHaveBeenCalled()
        expect(document.documentElement.style.userSelect).toBe(selectionStyle)
        pointer(window, 'pointermove', 30, 50, { pointerType: 'touch' })
        expect(controller.getViewport().x).toBe(0)
        expect(pointer(root, 'pointerdown', 10, 20).defaultPrevented).toBe(false)
    })

    it('leases touch-action before input and restores host styles on lock and destroy', () => {
        const root = document.createElement('div')
        root.style.setProperty('touch-action', 'pan-y', 'important')
        const controller = new ViewportController({
            root,
            viewport: {
                x: 0,
                y: 0,
                zoom: 1,
            },
            onTransformChange: vi.fn(),
        })
        controllers.push(controller)
        expect(root.style.getPropertyValue('touch-action')).toBe('none')
        const release = controller.lock()
        expect(root.style.getPropertyValue('touch-action')).toBe('pan-y')
        release()
        expect(root.style.getPropertyValue('touch-action')).toBe('none')
        controller.destroy()
        expect(root.style.getPropertyValue('touch-action')).toBe('pan-y')
        expect(root.style.getPropertyPriority('touch-action')).toBe('important')
    })

    it.each([[5, false], [10, true]])('suppresses clicks only above a %i pixel threshold', (paneClickDistance, propagates) => {
        const { root } = setup({ paneClickDistance })
        const click = vi.fn()
        root.addEventListener('click', click)
        pointer(root, 'pointerdown', 0, 0)
        pointer(window, 'pointermove', 6, 0)
        pointer(window, 'pointerup', 6, 0)
        mouse(root, 'click', 6, 0)
        expect(click).toHaveBeenCalledTimes(propagates ? 1 : 0)
    })

    it('does not suppress a click in another canvas after a drag', () => {
        const first = setup()
        const second = setup()
        const click = vi.fn()
        second.root.addEventListener('click', click)
        pointer(first.root, 'pointerdown', 0, 0)
        pointer(window, 'pointermove', 20, 20)
        pointer(window, 'pointerup', 20, 20)
        mouse(second.root, 'click', 0, 0)
        expect(click).toHaveBeenCalledOnce()
    })

    it('keeps double-click interpolation anchored through synchronous host echoes', () => {
        const clock = animationClock()
        const {
            root,
            controller,
            onTransformChange,
        } = setup()
        onTransformChange.mockImplementation(([x, y, zoom]) => controller.syncViewport({
            x,
            y,
            zoom,
        }))
        mouse(root, 'dblclick', 100, 80)
        clock.advance(125)
        const halfway = controller.getViewport()
        expect(halfway.zoom).toBeCloseTo(Math.sqrt(2))
        expect((100 - halfway.x) / halfway.zoom).toBeCloseTo(100)
        expect((80 - halfway.y) / halfway.zoom).toBeCloseTo(80)
        clock.advance(125)
        expect(controller.getViewport()).toEqual({
            x: -100,
            y: -80,
            zoom: 2,
        })
        expect(clock.callbacks.size).toBe(0)
    })

    it('cancels animation reentrantly when a transform callback takes a lock', () => {
        const clock = animationClock()
        const {
            root,
            controller,
            onTransformChange,
        } = setup()
        onTransformChange.mockImplementationOnce(() => controller.lock())
        mouse(root, 'dblclick', 100, 80)
        clock.advance(125)
        expect(clock.callbacks.size).toBe(0)
        clock.advance(500)
        expect(onTransformChange).toHaveBeenCalledOnce()
    })

    it('interrupts an animation on wheel input, authoritative sync and Escape', () => {
        const clock = animationClock()
        const {
            root,
            controller,
        } = setup()
        mouse(root, 'dblclick', 100, 80)
        wheel(root, { deltaY: 10 })
        clock.advance(300)
        expect(controller.getViewport()).toEqual({
            x: 0,
            y: -10,
            zoom: 1,
        })
        mouse(root, 'dblclick', 100, 80)
        controller.syncViewport({
            x: 20,
            y: 30,
            zoom: 0.5,
        })
        clock.advance(300)
        expect(controller.getViewport()).toEqual({
            x: 20,
            y: 30,
            zoom: 0.5,
        })
        mouse(root, 'dblclick', 100, 80)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        clock.advance(300)
        expect(controller.getViewport()).toEqual({
            x: 20,
            y: 30,
            zoom: 0.5,
        })
    })

    it('recognizes nearby double taps and ignores the resulting compatibility double-click', () => {
        const clock = animationClock()
        const {
            root,
            controller,
        } = setup()

        for (const pointerId of [1, 2]) {
            pointer(root, 'pointerdown', 100, 100, {
                pointerId,
                pointerType: 'touch',
            })
            pointer(root, 'pointerup', 100, 100, {
                pointerId,
                pointerType: 'touch',
            })
            clock.advance(100)
        }

        mouse(root, 'dblclick', 100, 100)
        clock.advance(150)
        expect(controller.getViewport()).toEqual({
            x: -100,
            y: -100,
            zoom: 2,
        })
    })

    it('cancels active pointers on Escape and does not resurrect them after unlock', () => {
        const {
            root,
            controller,
            onDraggingChange,
        } = setup()
        pointer(root, 'pointerdown', 10, 20)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        pointer(window, 'pointermove', 30, 50)
        expect(controller.getViewport()).toEqual({
            x: 0,
            y: 0,
            zoom: 1,
        })
        expect(onDraggingChange.mock.calls).toEqual([[true], [false]])
    })
})
