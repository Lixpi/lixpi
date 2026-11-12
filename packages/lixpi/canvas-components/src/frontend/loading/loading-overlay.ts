import {
    applyStyle,
    html,
} from '@lixpi/ui-primitives/dom'
import { Easing } from '@lixpi/ui-primitives/animation'
import {
    type TravelingOutlineOptions,
} from '../effects/outline/index.ts'
import { bakeLoadingOutline } from './loading-outline-bitmap.ts'
import {
    createLoadingSpinKeyframes,
    planLoadingSpin,
    type LoadingSpinCycle,
} from './loading-spin.ts'

export type LoadingOverlayOptions = {
    root: HTMLElement
    outline: Omit<TravelingOutlineOptions, 'surface' | 'layer' | 'space'> & {
        size: number
        // Duration of one fast turn in the first spin cycle.
        durationMs?: number
        spinCycle: LoadingSpinCycle
        snakeLengthFraction?: number
    }
    errorTitle: string
    retryLabel: string
    onRetry?: () => void
    onError: (error: unknown) => void
}

export class LoadingOverlay {
    readonly dom: HTMLDivElement
    private readonly message: HTMLDivElement
    private readonly canvas: HTMLCanvasElement
    private readonly spinner: HTMLDivElement
    // The wrapper runs the slowing cycles and the canvas runs the repeating cycle
    // after them, so each element carries one transform animation the
    // compositor can run on its own.
    private spin: Animation[] = []
    private fadeGeneration = 0
    private visible = false
    private destroyed = false

    constructor(private readonly options: LoadingOverlayOptions) {
        this.message = html`<div className="canvas-loading-error-message"></div>` as HTMLDivElement
        this.canvas = html`<canvas className="canvas-loading-outline"></canvas>` as HTMLCanvasElement
        this.spinner = html`<div className="canvas-loading-spinner">${this.canvas}</div>` as HTMLDivElement
        this.dom = html`
            <div
                className="canvas-loading-overlay"
                aria-hidden="true"
            >
                ${this.spinner}
                <div
                    className="canvas-loading-error"
                    role="status"
                >
                    <div className="canvas-loading-error-title">${options.errorTitle}</div>
                    ${this.message}
                    <button
                        type="button"
                        className="canvas-loading-error-retry"
                        onclick=${this.retry}
                    >${options.retryLabel}</button>
                </div>
            </div>
        ` as HTMLDivElement
        options.root.appendChild(this.dom)

        try {
            this.paintOutline()
        } catch (error) {
            this.dom.remove()

            throw error
        }
    }

    private paintOutline(): void {
        const context = this.canvas.getContext('2d')

        if (!context)
            throw new Error('Loading outline requires a canvas context')

        let texture = this.options.outline.texture

        if (texture.kind === 'image') {
            this.canvas.width = texture.source.width
            this.canvas.height = texture.source.height
            context.drawImage(
                texture.source,
                0,
                0,
            )
            texture = {
                kind: 'pixels',
                size: {
                    width: this.canvas.width,
                    height: this.canvas.height,
                },
                rgba: context.getImageData(
                    0,
                    0,
                    this.canvas.width,
                    this.canvas.height,
                ).data,
            }
        }

        const bitmap = bakeLoadingOutline(
            this.options.outline,
            texture,
            Math.max(
                2,
                Math.min(window.devicePixelRatio || 1, 3),
            ),
        )
        this.canvas.width = bitmap.size
        this.canvas.height = bitmap.size
        applyStyle(
            this.canvas,
            {
                width: `${bitmap.displaySize}px`,
                height: `${bitmap.displaySize}px`,
            },
        )
        const image = context.createImageData(bitmap.size, bitmap.size)
        image.data.set(bitmap.rgba)
        context.putImageData(
            image,
            0,
            0,
        )
    }

    setAppearance(appearance: Pick<LoadingOverlayOptions, 'outline'>): void {
        if (this.destroyed)
            return

        this.options.outline = appearance.outline
        this.paintOutline()
    }

    setVisible(visible: boolean): void {
        if (
            this.destroyed
            || this.visible === visible
        )
            return

        this.visible = visible

        if (visible)
            this.message.textContent = ''

        this.renderState()
    }

    // Starts the visible spinner over from its first fast cycle, for loading
    // that begins again from the start.
    restartSpin(): void {
        if (
            this.destroyed
            || !this.visible
            || this.message.textContent
        )
            return

        this.stopSpin()
        this.startSpin()
    }

    setErrorMessage(message: string | null): void {
        if (this.destroyed)
            return

        this.message.textContent = message?.trim() || ''
        this.renderState()
    }

    private renderState(): void {
        const hasError = Boolean(this.message.textContent)
        this.dom.ariaHidden = hasError ? 'false' : 'true'
        this.dom.classList.toggle('is-visible', this.visible || hasError)
        this.dom.classList.toggle('is-error', hasError)
        this.syncSpin(hasError)
    }

    // Hiding keeps the spinner turning while the overlay lingers and fades
    // out, and stops it once the fade has finished. Showing it again before
    // then continues the same turns instead of starting over.
    private syncSpin(hasError: boolean): void {
        const generation = ++this.fadeGeneration

        if (hasError) {
            this.stopSpin()

            return
        }

        if (this.visible) {
            if (!this.spin.length)
                this.startSpin()

            return
        }

        const fades = this.dom.getAnimations?.() ?? []

        if (!fades.length) {
            this.stopSpin()

            return
        }

        void this.stopSpinAfterFade(fades, generation)
    }

    private async stopSpinAfterFade(
        fades: Animation[],
        generation: number,
    ): Promise<void> {
        await Promise.allSettled(
            fades.map(fade => fade.finished),
        )

        if (
            generation === this.fadeGeneration
            && !this.visible
        )
            this.stopSpin()
    }

    private startSpin(): void {
        const outline = this.options.outline
        const firstFastTurnDurationMs = outline.durationMs ?? outline.style.durationMs

        if (firstFastTurnDurationMs <= 0)
            return

        const ease = outline.ease ?? Easing.travelingOutlineTransition
        const plan = planLoadingSpin(firstFastTurnDurationMs, outline.spinCycle)
        const sum = (durations: number[]): number => durations.reduce((total, duration) => total + duration, 0)
        const slowingDurationMs = sum(plan.slowingTurnDurationsMs)
        const slowingTiming = { duration: slowingDurationMs }
        const repeatingTiming = {
            duration: sum(plan.repeatingTurnDurationsMs),
            delay: slowingDurationMs,
            iterations: Infinity,
        }

        if (slowingDurationMs > 0)
            this.spin.push(
                this.spinner.animate(
                    createLoadingSpinKeyframes(plan.slowingTurnDurationsMs, ease),
                    slowingTiming,
                ),
            )

        this.spin.push(
            this.canvas.animate(
                createLoadingSpinKeyframes(plan.repeatingTurnDurationsMs, ease),
                repeatingTiming,
            ),
        )
    }

    private stopSpin(): void {
        for (const animation of this.spin.splice(0))
            animation.cancel()
    }

    private retry = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()

        if (!this.destroyed)
            this.options.onRetry?.()
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.fadeGeneration++
        this.stopSpin()
        this.dom.remove()
    }
}
