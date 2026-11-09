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
        spinCycle: {
            fastTurns: 2,
            slowTurnDurationFactor: 2,
            firstSlowdownMs: 100,
            slowdownGrowthFactor: 2,
            maxSlowTurnDurationMs: 4000,
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

type SpinAnimation = {
    target: Element
    keyframes: Keyframe[]
    timing: KeyframeAnimationOptions
    cancel: ReturnType<typeof vi.fn>
}

const paint = vi.fn()
const spins: SpinAnimation[] = []
const activeSpins = () => spins.filter(spin => !spin.cancel.mock.calls.length)

// Stands in for the overlay's fade-out transition. The returned function ends
// the fade and lets its callbacks run.
const stubFade = (overlayEl: HTMLElement): () => Promise<void> => {
    let finish!: () => void
    const finished = new Promise<void>(resolve => void (finish = resolve))
    overlayEl.getAnimations = () => [{ finished } as unknown as Animation]

    return async () => {
        overlayEl.getAnimations = () => []
        finish()
        await new Promise(resolve => setTimeout(resolve))
    }
}

describe('LoadingOverlay', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        paint.mockClear()
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: paint,
        } as unknown as CanvasRenderingContext2D)
        spins.length = 0
        HTMLElement.prototype.animate = function (
            this: HTMLElement,
            keyframes: Keyframe[],
            timing: KeyframeAnimationOptions,
        ) {
            const spin = {
                target: this,
                keyframes,
                timing,
                cancel: vi.fn(),
            }
            spins.push(spin)

            return spin as unknown as Animation
        } as HTMLElement['animate']
    })

    afterEach(() => {
        vi.restoreAllMocks()
        Reflect.deleteProperty(HTMLElement.prototype, 'animate')
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
        expect(hostEl?.querySelector('canvas')?.width).toBeGreaterThan(128)
        expect(activeSpins()).toHaveLength(2)

        outline.setErrorMessage('The connection timed out while loading this workspace.')

        expect(hostEl?.classList.contains('is-error')).toBe(true)
        expect(hostEl?.ariaHidden).toBe('false')
        expect(hostEl?.querySelector('.canvas-loading-error-message')?.textContent).toBe('The connection timed out while loading this workspace.')
        expect(activeSpins()).toHaveLength(0)

        outline.destroy()
    })

    it('runs the slowing cycles first and the repeating cycle after them without the main thread', () => {
        const overlay = createOverlay(document.body)
        overlay.setVisible(true)
        const [slowing, repeating] = spins

        expect(slowing.target.classList.contains('canvas-loading-spinner')).toBe(true)
        expect(repeating.target).toBe(document.querySelector('canvas'))
        // Cycles with fast turns of 1000, 1100 and 1300ms slow down first; then the
        // cycle of two 1700ms turns and one 3400ms turn repeats.
        expect(repeating.timing).toEqual({
            duration: 6800,
            delay: 4 * 1000 + 4 * 1100 + 4 * 1300,
            iterations: Infinity,
        })
        expect(slowing.timing.duration).toBe(13600)
        expect(repeating.keyframes.at(-1)?.transform).toBe('rotate(3turn)')
        expect(slowing.keyframes.at(-1)?.transform).toMatch(/^rotate\(\d+turn\)$/)
        overlay.destroy()
    })

    it('keeps spinning while it fades out and stops once the fade ends', async () => {
        const overlay = createOverlay(document.body)
        overlay.setVisible(true)
        const finishFade = stubFade(overlay.dom)

        overlay.setVisible(false)

        expect(overlay.dom.classList.contains('is-visible')).toBe(false)
        expect(document.querySelector('canvas')?.isConnected).toBe(true)
        expect(activeSpins()).toHaveLength(2)

        await finishFade()

        expect(activeSpins()).toHaveLength(0)
        overlay.destroy()
    })

    it('continues the same turns when loading resumes before the fade ends', async () => {
        const overlay = createOverlay(document.body)
        overlay.setVisible(true)
        const finishFade = stubFade(overlay.dom)

        overlay.setVisible(false)
        overlay.setVisible(true)
        await finishFade()

        expect(spins).toHaveLength(2)
        expect(activeSpins()).toHaveLength(2)

        overlay.destroy()

        expect(activeSpins()).toHaveLength(0)
        expect(document.querySelector('canvas')).toBeNull()
    })

    it('starts over from the fastest turn after it has fully hidden', () => {
        const overlay = createOverlay(document.body)
        overlay.setVisible(true)
        overlay.setVisible(false)
        overlay.setVisible(true)

        expect(spins).toHaveLength(4)
        expect(activeSpins()).toHaveLength(2)
        overlay.destroy()
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
