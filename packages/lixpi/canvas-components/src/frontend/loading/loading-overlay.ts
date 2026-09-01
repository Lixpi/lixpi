'use strict'

import { html } from '@lixpi/ui-primitives/dom'
import {
    CanvasRenderer,
    type CanvasDrawingScope,
} from '@lixpi/canvas-engine/frontend/rendering'
import {
    TravelingOutline,
    type TravelingOutlineOptions,
} from '../effects/outline/index.ts'

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
    private readonly renderer: CanvasRenderer
    private readonly scope: CanvasDrawingScope
    private readonly outline: TravelingOutline
    private readonly resizeObserver: ResizeObserver
    private visible = false
    private destroyed = false

    constructor(private readonly options: LoadingOverlayOptions) {
        this.message = html`<div className="canvas-loading-error-message"></div>` as HTMLDivElement
        this.dom = html`
            <div className="canvas-loading-overlay" aria-hidden="true">
                <div className="canvas-loading-error" role="status">
                    <div className="canvas-loading-error-title">${options.errorTitle}</div>
                    ${this.message}
                    <button type="button" className="canvas-loading-error-retry" onclick=${this.retry}>${options.retryLabel}</button>
                </div>
            </div>
        ` as HTMLDivElement
        options.root.appendChild(this.dom)
        this.renderer = new CanvasRenderer({ root: this.dom, onError: options.onError })
        this.scope = this.renderer.createScope()
        try {
            this.outline = new TravelingOutline({ ...options.outline, surface: this.scope, space: 'screen' })
        } catch (error) {
            this.renderer.destroy()
            this.dom.remove()
            throw error
        }
        this.resizeObserver = new ResizeObserver(() => this.syncOutline())
        this.resizeObserver.observe(this.dom)
    }

    setVisible(visible: boolean): void {
        if (this.destroyed || this.visible === visible) return
        this.visible = visible
        if (visible) this.message.textContent = ''
        this.renderState()
    }

    setErrorMessage(message: string | null): void {
        if (this.destroyed) return
        this.message.textContent = message?.trim() || ''
        this.renderState()
    }

    private renderState(): void {
        const hasError = Boolean(this.message.textContent)
        this.dom.ariaHidden = hasError ? 'false' : 'true'
        this.dom.classList.toggle('is-visible', this.visible || hasError)
        this.dom.classList.toggle('is-loading', this.visible && !hasError)
        this.dom.classList.toggle('is-error', hasError)
        this.syncOutline()
    }

    private syncOutline(): void {
        if (this.destroyed) return
        if (!this.visible || this.message.textContent) {
            this.outline.sync([])
            return
        }
        const bounds = this.dom.getBoundingClientRect()
        const width = this.dom.clientWidth || this.options.root.clientWidth || bounds.width || window.innerWidth
        const height = this.dom.clientHeight || this.options.root.clientHeight || bounds.height || window.innerHeight
        const { size, durationMs, snakeLengthFraction } = this.options.outline
        this.outline.sync([{
            id: 'loading',
            x: (width - size) / 2,
            y: (height - size) / 2,
            width: size,
            height: size,
            radius: size / 2,
            visible: true,
            direction: 'clockwise',
            durationMs,
            snakeLengthFraction,
        }])
    }

    private retry = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
        if (!this.destroyed) this.options.onRetry?.()
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.resizeObserver.disconnect()
        this.outline.destroy()
        this.scope.destroy()
        this.renderer.destroy()
        this.dom.remove()
    }
}
