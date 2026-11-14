// WindowTitleBar - the title bar row the desktop app leaves to the page.
//
// Renderer: TypeScript `html` DOM. On macOS the desktop app hides its native
// title bar and floats the traffic lights over the page. Before any page script
// runs it marks `<html>` with `data-title-bar="overlay"` and sets
// `--window-title-bar-height` and `--window-controls-inset`, and while the
// window is full screen it adds `data-window-fullscreen`.
//
// The row holds the page's own controls, such as the panel toggles, so it has
// no element of its own covering them. Instead a press anywhere in the row
// that doesn't land on a control drags the window, and a double click zooms it,
// as a native title bar does. A backdrop behind the traffic lights keeps them
// readable over the content and fades into it. In a browser, or in full
// screen, the row does nothing and nothing is drawn.

import { html } from '@lixpi/ui-primitives/dom'
import { hasOverlayTitleBar } from '$src/components/windowTitleBar/title-bar-mode.ts'
import '$src/components/windowTitleBar/window-title-bar.scss'

export type WindowTitleBarInstance = {
    destroy: () => void
}

type TauriInternals = {
    invoke: (command: string) => Promise<unknown>
}

type PendingDoubleClick = {
    x: number
    y: number
}

type PreviousPress = PendingDoubleClick & {
    time: number
}

export const START_DRAGGING_COMMAND = 'plugin:window|start_dragging'
export const TOGGLE_MAXIMIZE_COMMAND = 'plugin:window|internal_toggle_maximize'

// A press on any of these, or inside one, belongs to the control rather than
// to the window.
const CONTROL_SELECTOR = [
    'a',
    'button',
    'input',
    'label',
    'select',
    'summary',
    'textarea',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="tab"]',
    '[tabindex]:not([tabindex="-1"])',
    '.side-panel-resize-handle',
].join(', ')

// macOS reads the double click interval from the user's settings, which the
// page can't see. Half a second is the system default.
const DOUBLE_CLICK_MS = 500
// A double click zooms only when the pointer stayed where it was pressed,
// the way macOS cancels a title bar double click that moves.
const DOUBLE_CLICK_SLOP_PX = 4

class WindowTitleBar implements WindowTitleBarInstance {
    private readonly backdropEl: HTMLDivElement
    private previousPress: PreviousPress | null = null
    private pendingDoubleClick: PendingDoubleClick | null = null

    constructor(
        target: HTMLElement,
        private readonly root: HTMLElement,
    ) {
        this.backdropEl = html`
            <div
                className="window-title-bar-backdrop"
                aria-hidden="true"
            ></div>
        ` as HTMLDivElement

        target.append(this.backdropEl)
        // Capture runs before the canvas and every other page listener, so a
        // press that drags the window never also starts a pan or a selection.
        window.addEventListener(
            'pointerdown',
            this.handlePointerDown,
            true,
        )
        window.addEventListener(
            'pointerup',
            this.handlePointerUp,
            true,
        )
    }

    private handlePointerDown = (event: PointerEvent): void => {
        if (!this.isWindowPress(event)) {
            this.previousPress = null

            return
        }

        event.preventDefault()
        event.stopImmediatePropagation()

        const previous = this.previousPress
        this.previousPress = {
            x: event.clientX,
            y: event.clientY,
            time: event.timeStamp,
        }

        if (
            previous
            && event.timeStamp - previous.time <= DOUBLE_CLICK_MS
            && this.isNear(event, previous)
        ) {
            this.previousPress = null
            this.pendingDoubleClick = {
                x: event.clientX,
                y: event.clientY,
            }

            return
        }

        void this.invoke(START_DRAGGING_COMMAND)
    }

    private handlePointerUp = (event: PointerEvent): void => {
        const pending = this.pendingDoubleClick

        if (!pending)
            return

        this.pendingDoubleClick = null
        event.stopImmediatePropagation()

        if (this.isNear(event, pending))
            void this.invoke(TOGGLE_MAXIMIZE_COMMAND)
    }

    private isWindowPress(event: PointerEvent): boolean {
        if (
            event.button !== 0
            || event.pointerType === 'touch'
            || this.root.hasAttribute('data-window-fullscreen')
        )
            return false

        const height = Number.parseFloat(
            this.root.style.getPropertyValue('--window-title-bar-height'),
        )

        if (
            !(height > 0)
            || event.clientY >= height
        )
            return false

        const target = event.target instanceof Element ? event.target : null

        return !target?.closest(CONTROL_SELECTOR)
    }

    private isNear = (
        event: PointerEvent,
        point: PendingDoubleClick,
    ): boolean => Math.abs(event.clientX - point.x) <= DOUBLE_CLICK_SLOP_PX && Math.abs(event.clientY - point.y) <= DOUBLE_CLICK_SLOP_PX

    private async invoke(command: string): Promise<void> {
        const tauri = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__

        try {
            await tauri?.invoke(command)
        } catch (error) {
            console.error('The window did not accept the title bar command.', error)
        }
    }

    destroy(): void {
        window.removeEventListener(
            'pointerdown',
            this.handlePointerDown,
            true,
        )
        window.removeEventListener(
            'pointerup',
            this.handlePointerUp,
            true,
        )
        this.backdropEl.remove()
    }
}

// Takes over the title bar row when the desktop app asked for one, and
// returns null in a browser.
export const mountWindowTitleBar = (
    target: HTMLElement,
    root: HTMLElement = document.documentElement,
): WindowTitleBarInstance | null => (hasOverlayTitleBar(root) ? new WindowTitleBar(target, root) : null)
