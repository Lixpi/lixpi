import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    type LoadingOverlay,
    type LoadingOverlayOptions,
} from './loading-overlay.ts'

type LoadingRequest = {
    label?: string
    visible?: boolean
    onRetry?: () => void
}

export type LoadingLease = Pick<LoadingOverlay, 'setVisible' | 'setErrorMessage' | 'destroy'>

// One renderer serves all pending work in an application. Releasing startup
// cannot hide an outstanding workspace or document request.
export class LoadingLayer {
    readonly dom: HTMLDivElement
    private readonly requests = new Map<object, LoadingRequest & { error: string | null }>()
    private overlay?: LoadingOverlay
    private initializing?: Promise<void>
    private destroyed = false

    constructor(private readonly options: LoadingOverlayOptions) {
        const html = createDocumentHtml(options.root.ownerDocument)
        this.dom = html`
            <div
                className="canvas-loading-layer"
                role="status"
            ></div>
        ` as HTMLDivElement
    }

    acquire(options: LoadingRequest = {}): LoadingLease {
        if (this.destroyed)
            throw new Error('Loading layer is disposed')

        const request = {
            ...options,
            error: null as string | null,
        }
        this.requests.set(request, request)
        this.sync()

        return {
            setVisible: visible => {
                if (!this.requests.has(request))
                    return

                request.visible = visible

                if (visible)
                    request.error = null

                this.sync()
            },
            setErrorMessage: message => {
                if (!this.requests.has(request))
                    return

                request.error = message?.trim() || null
                this.sync()
            },
            destroy: () => {
                this.requests.delete(request)
                this.sync()
            },
        }
    }

    private sync(): void {
        if (this.destroyed)
            return

        const requests = Array.from(
            this.requests.values(),
        )
        const error = requests.find(request => request.error)
        const active = error ?? requests.find(request => request.visible)

        if (active) {
            this.dom.setAttribute('aria-label', active.label ?? 'Loading')

            if (!this.dom.isConnected)
                this.options.root.append(this.dom)

            this.initializing ??= this.initialize()
        } else
            this.dom.remove()

        this.overlay?.setVisible(
            Boolean(active && !error),
        )
        this.overlay?.setErrorMessage(error?.error ?? null)
    }

    private async initialize(): Promise<void> {
        try {
            // Keep the GPU backend out of the public application's initial
            // bundle; the overlay element is already mounted while it loads.
            const { LoadingOverlay } = await import('./loading-overlay.ts')

            if (this.destroyed)
                return

            if (!Array.from(
                this.requests.values(),
            ).some(request => request.visible || request.error)) {
                this.initializing = undefined

                return
            }

            this.overlay = new LoadingOverlay({
                ...this.options,
                root: this.dom,
                onRetry: () => Array.from(
                    this.requests.values(),
                ).find(request => request.error)?.onRetry?.(),
            })
            this.sync()
        } catch (error) {
            this.options.onError(error)
        }
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.requests.clear()
        this.overlay?.destroy()
        this.dom.remove()
    }
}
