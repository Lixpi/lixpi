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

type LoadingPlacement = {
    root: HTMLElement
    contained: boolean
}

// One renderer serves all pending work in an application. Releasing startup
// cannot hide an outstanding workspace or document request.
export class LoadingLayer {
    readonly dom: HTMLDivElement
    private readonly requests = new Map<object, LoadingRequest & { error: string | null }>()
    private overlay?: LoadingOverlay
    private placement: LoadingPlacement
    private destroyed = false
    private detachGeneration = 0

    constructor(private readonly options: LoadingOverlayOptions) {
        this.placement = {
            root: options.root,
            contained: false,
        }
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
    // A layer already on screen keeps its place until it has faded out, so
    // the startup spinner stays centered in the window while the workspace
    // mounts and the navigation appears beside it.
    contain(root: HTMLElement): () => void {
        const previous = this.placement

        this.placement = {
            root,
            contained: true,
        }

        return () => {
            if (this.placement.root === root)
                this.placement = previous
        }
    }

    private attach(): void {
        this.dom.classList.toggle('is-contained', this.placement.contained)
        this.placement.root.append(this.dom)
    }

    setAppearance(appearance: Pick<LoadingOverlayOptions, 'outline'>): void {
        if (this.destroyed)
            return

        this.options.outline = appearance.outline
        this.overlay?.setAppearance(appearance)
    }

    // Restarts the spinner when loading starts over while it is on screen.
    restartSpin(): void {
        if (!this.destroyed)
            this.overlay?.restartSpin()
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
                this.attach()

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
    // unless new work arrived in the meantime. Only the overlay's own
    // transitions count, because its spinner animation never finishes.
    private detachWhenSettled(): void {
        const fades = this.overlay?.dom.getAnimations?.() ?? []

        if (!fades.length) {
            this.dom.remove()

            return
        }

        this.dom.classList.add('is-idle')
        void this.detachAfterFade(fades, ++this.detachGeneration)
    }

    private async detachAfterFade(
        fades: Animation[],
        generation: number,
    ): Promise<void> {
        await Promise.allSettled(
            fades.map(fade => fade.finished),
        )

        if (
            generation === this.detachGeneration
            && !this.destroyed
        )
            this.dom.remove()
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
