// @vitest-environment happy-dom

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { OVERLAY_TITLE_BAR } from '$src/components/windowTitleBar/title-bar-mode.ts'
import {
    START_DRAGGING_COMMAND,
    TOGGLE_MAXIMIZE_COMMAND,
    mountWindowTitleBar,
    type WindowTitleBarInstance,
} from '$src/components/windowTitleBar/windowTitleBar.ts'

const invoke = vi.fn(async () => undefined)
const root = document.documentElement

const press = (
    target: Element,
    clientY: number,
    timeStamp = 0,
): PointerEvent => {
    const event = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 200,
        clientY,
        pointerType: 'mouse',
    })
    Object.defineProperty(event, 'timeStamp', { value: timeStamp })
    target.dispatchEvent(event)

    return event
}

const release = (
    target: Element,
    clientY: number,
): void =>
    void target.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        clientX: 200,
        clientY,
        pointerType: 'mouse',
    }))

describe('WindowTitleBar', () => {
    let titleBar: WindowTitleBarInstance | null = null

    beforeEach(() => {
        invoke.mockClear()
        ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke }
    })

    afterEach(() => {
        titleBar?.destroy()
        titleBar = null
        document.body.replaceChildren()
        delete root.dataset.titleBar
        root.removeAttribute('data-window-fullscreen')
        root.style.removeProperty('--window-title-bar-height')
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    })

    const mountOverlay = (): void => {
        root.dataset.titleBar = OVERLAY_TITLE_BAR
        root.style.setProperty('--window-title-bar-height', '40px')
        titleBar = mountWindowTitleBar(document.body)
    }

    it('does nothing in a browser', () => {
        titleBar = mountWindowTitleBar(document.body)

        press(document.body, 10)

        expect(titleBar).toBeNull()
        expect(document.body.children).toHaveLength(0)
        expect(invoke).not.toHaveBeenCalled()
    })

    it('draws the backdrop behind the traffic lights', () => {
        mountOverlay()

        expect(document.body.querySelector('.window-title-bar-backdrop')?.getAttribute('aria-hidden')).toBe('true')
    })

    it('drags the window from an empty spot in the row and keeps the press from the page', () => {
        mountOverlay()
        const content = document.createElement('div')
        const pageListener = vi.fn()
        content.addEventListener('pointerdown', pageListener)
        document.body.append(content)

        const event = press(content, 10)

        expect(invoke).toHaveBeenCalledWith(START_DRAGGING_COMMAND)
        expect(event.defaultPrevented).toBe(true)
        expect(pageListener).not.toHaveBeenCalled()
    })

    it('leaves controls in the row and everything below it to the page', () => {
        mountOverlay()
        const toggle = document.createElement('button')
        const icon = document.createElement('span')
        toggle.append(icon)
        const content = document.createElement('div')
        document.body.append(toggle, content)

        press(icon, 10)
        press(content, 40)

        expect(invoke).not.toHaveBeenCalled()
    })

    it('zooms the window on a double click that stays in place', () => {
        mountOverlay()
        const content = document.createElement('div')
        document.body.append(content)

        press(content, 10, 0)
        press(content, 10, 200)
        release(content, 10)

        expect(invoke.mock.calls).toEqual([
            [START_DRAGGING_COMMAND],
            [TOGGLE_MAXIMIZE_COMMAND],
        ])
    })

    it('does not zoom when the second press moves before release', () => {
        mountOverlay()
        const content = document.createElement('div')
        document.body.append(content)

        press(content, 10, 0)
        press(content, 10, 200)
        release(content, 30)

        expect(invoke.mock.calls).toEqual([[START_DRAGGING_COMMAND]])
    })

    it('leaves the row to the page in full screen', () => {
        mountOverlay()
        root.setAttribute('data-window-fullscreen', '')

        press(document.body, 10)

        expect(invoke).not.toHaveBeenCalled()
    })

    it('stops listening and removes the backdrop on destroy', () => {
        mountOverlay()
        titleBar?.destroy()
        titleBar = null

        press(document.body, 10)

        expect(document.body.children).toHaveLength(0)
        expect(invoke).not.toHaveBeenCalled()
    })
})
