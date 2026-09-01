// @vitest-environment happy-dom

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const outlineRendererInstances = vi.hoisted(() =>
    [] as Array<{
        sync: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
    }>
)

vi.mock('@lixpi/canvas-engine/frontend/rendering', () => ({
    CanvasRenderer: class {
        ready = Promise.resolve(true)
        controller = new AbortController()
        createScope() {
            return { signal: this.controller.signal, destroy: () => this.controller.abort() }
        }
        destroy() {
            this.controller.abort()
        }
    },
}))

vi.mock('../effects/outline/index.ts', () => ({
    TravelingOutline: class {
        sync = vi.fn()
        destroy = vi.fn()
        constructor() {
            outlineRendererInstances.push(this)
        }
    },
}))

import {
    LoadingOverlay,
    type LoadingOverlayOptions,
} from './loading-overlay.ts'

function createOverlay(root: HTMLElement, onRetry?: () => void) {
    const outline: LoadingOverlayOptions['outline'] = {
        size: 128,
        style: {
            radius: 12,
            gap: 3,
            snakeHeadWidth: 4,
            snakeTailWidthFraction: 0.2,
            snakeTailThinLengthFraction: 0.1,
            snakeWidthTaperPower: 0.86,
            snakeLengthFraction: 0.8,
            snakeHeadRoundLengthFraction: 0.5,
            edgeFeatherFraction: 0.5,
            durationMs: 1000,
        },
        texture: { kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array([255, 255, 255, 255]) },
    }
    return new LoadingOverlay({ root, outline, errorTitle: 'Could not load', retryLabel: 'Try again', onRetry, onError: vi.fn() })
}

class FakeResizeObserver {
    public observe = vi.fn()
    public disconnect = vi.fn()
}

describe('LoadingOverlay', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        outlineRendererInstances.length = 0
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('shows the loading outline while loading and clears it when an error is shown', async () => {
        const paneEl = document.createElement('div')
        document.body.appendChild(paneEl)
        const outline = createOverlay(paneEl)

        outline.setVisible(true)
        await vi.waitFor(() => expect(outlineRendererInstances).toHaveLength(1))

        const hostEl = paneEl.querySelector<HTMLDivElement>('.canvas-loading-overlay')
        expect(hostEl?.classList.contains('is-visible')).toBe(true)
        expect(hostEl?.classList.contains('is-loading')).toBe(true)
        expect(outlineRendererInstances[0].sync.mock.calls.at(-1)?.[0]).toHaveLength(1)
        const datum = outlineRendererInstances[0].sync.mock.calls.at(-1)?.[0][0]
        expect(datum.width).toBe(128)
        expect(datum.height).toBe(128)

        outline.setErrorMessage('The connection timed out while loading this workspace.')

        expect(hostEl?.classList.contains('is-error')).toBe(true)
        expect(hostEl?.classList.contains('is-loading')).toBe(false)
        expect(hostEl?.ariaHidden).toBe('false')
        expect(hostEl?.querySelector('.canvas-loading-error-message')?.textContent).toBe('The connection timed out while loading this workspace.')
        expect(outlineRendererInstances[0].sync.mock.calls.at(-1)?.[0]).toEqual([])

        outline.destroy()
    })

    it('fires the retry callback from the error panel', async () => {
        const paneEl = document.createElement('div')
        const onRetry = vi.fn()
        document.body.appendChild(paneEl)
        const outline = createOverlay(paneEl, onRetry)

        outline.setErrorMessage('The workspace could not be loaded.')
        paneEl.querySelector<HTMLButtonElement>('.canvas-loading-error-retry')?.click()

        expect(onRetry).toHaveBeenCalledTimes(1)
        expect(paneEl.querySelector('.canvas-loading-error-title')?.textContent).toBe('Could not load')
        expect(paneEl.querySelector('button')?.textContent).toBe('Try again')

        outline.destroy()
    })
})
