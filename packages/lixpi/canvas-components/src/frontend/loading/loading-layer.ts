import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    LoadingOverlay,
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
    private destroyed = false
    private detachGeneration = 0

    constructor(private readonly options: LoadingOverlayOptions) {
        const html = createDocumentHtml(options.root.ownerDocument)
        this.dom = html`
            <div
                className="canvas-loading-layer"
                role="status"
            ></div>
        ` as HTMLDivElement
    }

    // Confines the layer to `root` instead of covering the whole window, so a
    // later load covers only the area it belongs to and leaves navigation
    // around it in place. Returns the function that puts the layer back.
    contain(root: HTMLElement): () => void {
        const previousRoot = this.options.root
        const wasContained = this.dom.classList.contains('is-contained')

        this.moveTo(root, true)

        return () => {
            if (this.options.root === root)
                this.moveTo(previousRoot, wasContained)
        }
    }

    private moveTo(
        root: HTMLElement,
        contained: boolean,
    ): void {
        this.options.root = root
        this.dom.classList.toggle('is-contained', contained)

        if (this.dom.isConnected)
            root.append(this.dom)
    }

    setAppearance(appearance: Pick<LoadingOverlayOptions, 'outline'>): void {
        if (this.destroyed)
            return

        this.options.outline = appearance.outline
        this.overlay?.setAppearance(appearance)
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
            this.detachGeneration++
            this.dom.classList.remove('is-idle')
            this.dom.setAttribute('aria-label', active.label ?? 'Loading')

            if (!this.dom.isConnected)
                this.options.root.append(this.dom)

            if (!this.overlay)
                this.initialize()
        }

        this.overlay?.setVisible(
            Boolean(active && !error),
        )
        this.overlay?.setErrorMessage(error?.error ?? null)

        if (!active)
            this.detachWhenSettled()
    }

    // Removing the layer while its overlay fades out would pop the frosted
    // backdrop off the screen in one frame. The layer lets pointer input
    // through while it fades and leaves the document once the fade ends,
    // unless new work arrived in the meantime.
    private detachWhenSettled(): void {
        const fades = this.dom.getAnimations?.({ subtree: true }) ?? []

        if (!fades.length) {
            this.dom.remove()

            return
        }

        const generation = ++this.detachGeneration
        this.dom.classList.add('is-idle')
        const settled = Promise.allSettled(
            fades.map(fade => fade.finished),
        )
        void settled.then(() => {
            if (
                generation === this.detachGeneration
                && !this.destroyed
            )
                this.dom.remove()
        })
    }

    private initialize(): void {
        try {
            this.overlay = new LoadingOverlay({
                ...this.options,
                root: this.dom,
                onRetry: () => Array.from(
                    this.requests.values(),
                ).find(request => request.error)?.onRetry?.(),
            })
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
