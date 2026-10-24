import {
    applyStyle,
    html,
} from '@lixpi/ui-primitives/dom'
import { Easing } from '@lixpi/ui-primitives/animation'
import {
    type TravelingOutlineOptions,
} from '../effects/outline/index.ts'
import { bakeLoadingOutline } from './loading-outline-bitmap.ts'

export type LoadingOverlayOptions = {
    root: HTMLElement
    outline: Omit<TravelingOutlineOptions, 'surface' | 'layer' | 'space'> & {
        size: number
        durationMs?: number
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
    private frame?: number
    private previousFrame?: number
    private elapsed = 0
    private visible = false
    private destroyed = false

    constructor(private readonly options: LoadingOverlayOptions) {
        this.message = html`<div className="canvas-loading-error-message"></div>` as HTMLDivElement
        this.canvas = html`<canvas className="canvas-loading-outline"></canvas>` as HTMLCanvasElement
        this.dom = html`
            <div
                className="canvas-loading-overlay"
                aria-hidden="true"
            >
                ${this.canvas}
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
        this.dom.classList.toggle('is-loading', this.visible && !hasError)
        this.dom.classList.toggle('is-error', hasError)
        this.syncAnimation()
    }

    private syncAnimation(): void {
        if (
            this.visible
            && !this.message.textContent
        )
            this.frame ??= requestAnimationFrame(this.tick)
        else {
            if (this.frame !== undefined)
                cancelAnimationFrame(this.frame)

            this.frame = undefined
            this.previousFrame = undefined
        }
    }

    private tick = (timestamp: number): void => {
        if (this.destroyed)
            return

        if (this.previousFrame !== undefined)
            this.elapsed += timestamp - this.previousFrame

        this.previousFrame = timestamp
        const duration = this.options.outline.durationMs ?? this.options.outline.style.durationMs
        const progress = duration > 0 ? (this.elapsed % duration) / duration : 0
        const rotation = (this.options.outline.ease ?? Easing.travelingOutlineTransition)(progress) * 360
        this.canvas.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`
        this.frame = requestAnimationFrame(this.tick)
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

        if (this.frame !== undefined)
            cancelAnimationFrame(this.frame)

        this.dom.remove()
    }
}
