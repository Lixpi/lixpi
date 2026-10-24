// @vitest-environment happy-dom

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    LoadingOverlay,
    type LoadingOverlayOptions,
} from './loading-overlay.ts'

const createOverlay = (root: HTMLElement, onRetry?: () => void) => {
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
        texture: {
            kind: 'pixels',
            size: {
                width: 1,
                height: 1,
            },
            rgba: new Uint8Array([255, 255, 255, 255]),
        },
    }

    return new LoadingOverlay({
        root,
        outline,
        errorTitle: 'Could not load',
        retryLabel: 'Try again',
        onRetry,
        onError: vi.fn(),
    })
}

let nextFrame: FrameRequestCallback
const paint = vi.fn()

describe('LoadingOverlay', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        paint.mockClear()
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: paint,
        } as unknown as CanvasRenderingContext2D)
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            nextFrame = callback

            return 1
        }))
        vi.stubGlobal('cancelAnimationFrame', vi.fn())
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('paints the outline synchronously and hides it when an error is shown', () => {
        const paneEl = document.createElement('div')
        document.body.appendChild(paneEl)
        const outline = createOverlay(paneEl)

        outline.setVisible(true)
        expect(paint).toHaveBeenCalledOnce()
        expect(paint.mock.calls[0][0].data.some((value: number) => value > 0)).toBe(true)

        const hostEl = paneEl.querySelector<HTMLDivElement>('.canvas-loading-overlay')
        expect(hostEl?.classList.contains('is-visible')).toBe(true)
        expect(hostEl?.classList.contains('is-loading')).toBe(true)
        expect(hostEl?.querySelector('canvas')?.width).toBeGreaterThan(128)

        outline.setErrorMessage('The connection timed out while loading this workspace.')

        expect(hostEl?.classList.contains('is-error')).toBe(true)
        expect(hostEl?.classList.contains('is-loading')).toBe(false)
        expect(hostEl?.ariaHidden).toBe('false')
        expect(hostEl?.querySelector('.canvas-loading-error-message')?.textContent).toBe('The connection timed out while loading this workspace.')
        expect(cancelAnimationFrame).toHaveBeenCalledOnce()

        outline.destroy()
    })

    it('resumes the same lap after a loading handoff and stops animating on disposal', () => {
        const overlay = createOverlay(document.body)
        overlay.setVisible(true)
        nextFrame(100)
        nextFrame(350)
        const canvas = document.querySelector('canvas')!
        const quarterLap = canvas.style.transform
        expect(quarterLap).not.toContain('rotate(0deg)')
        overlay.setVisible(false)
        overlay.setVisible(true)
        nextFrame(4000)
        expect(canvas.style.transform).toBe(quarterLap)
        nextFrame(4750)
        expect(canvas.style.transform).toContain('rotate(0deg)')
        overlay.destroy()
        expect(cancelAnimationFrame).toHaveBeenCalledTimes(2)
        expect(canvas.isConnected).toBe(false)
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
