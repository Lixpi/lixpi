import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import type {
    EngineMedia,
    MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import type { CanvasEngineSize } from '@lixpi/canvas-engine/shared'

type SourceLease = Awaited<ReturnType<EngineMedia['acquirePlayback']>>
type SourceRequest = { media: MediaDescriptor; renditionId: string }

class NativeSourceBinding {
    private request: SourceRequest | null = null
    private key = ''
    private pending: AbortController | null = null
    private current: { lease: SourceLease; controller: AbortController } | null = null
    private disposed = false
    ready: Promise<void> = Promise.resolve()

    constructor(
        private readonly media: EngineMedia,
        private readonly signal: AbortSignal,
        private readonly apply: (url: string | null) => void,
        private readonly onError: (error: unknown) => void,
    ) {}

    set(request: SourceRequest | null, force = false): Promise<void> {
        if (this.disposed) return Promise.resolve()
        const key = request ? JSON.stringify([request.media.key, request.media.version, request.renditionId]) : ''
        if (!force && key === this.key) return this.ready
        this.key = key
        this.request = request ? structuredClone(request) : null
        this.pending?.abort()
        this.pending = null
        if (!this.request) {
            this.apply(null)
            this.releaseCurrent()
            this.ready = Promise.resolve()
            return this.ready
        }
        const controller = new AbortController()
        this.pending = controller
        this.ready = this.resolve(this.request, controller)
        return this.ready
    }

    retry(): Promise<void> {
        return this.set(this.request, true)
    }

    private async resolve(request: SourceRequest, controller: AbortController): Promise<void> {
        let lease: SourceLease | null = null
        try {
            lease = await this.media.acquirePlayback({ ...request, signal: AbortSignal.any([controller.signal, this.signal]) })
            if (this.disposed || controller.signal.aborted || this.pending !== controller) {
                lease.release()
                return
            }
            this.apply(lease.url)
            if (this.disposed || controller.signal.aborted || this.pending !== controller) {
                lease.release()
                return
            }
            this.releaseCurrent()
            if (this.disposed || controller.signal.aborted || this.pending !== controller) {
                lease.release()
                return
            }
            this.current = { lease, controller }
            lease = null
        } catch (error) {
            lease?.release()
            if (!this.disposed && !controller.signal.aborted && !this.signal.aborted) this.onError(error)
        } finally {
            if (this.pending === controller) this.pending = null
        }
    }

    private releaseCurrent(): void {
        if (!this.current) return
        const current = this.current
        this.current = null
        current.lease.release()
        current.controller.abort()
    }

    destroy(): void {
        if (this.disposed) return
        this.disposed = true
        this.pending?.abort()
        this.pending = null
        this.releaseCurrent()
    }
}

export type NativePlaybackOptions = {
    root: HTMLElement
    media: EngineMedia
    signal: AbortSignal
    kind: 'video' | 'audio'
    muted?: boolean
    loop?: boolean
    preload?: 'none' | 'metadata' | 'auto'
    crossOrigin?: 'anonymous' | 'use-credentials'
    onReady?: (element: HTMLVideoElement | HTMLAudioElement) => void
    onIntrinsicSize?: (size: CanvasEngineSize) => void
    onPlaybackChange?: (playing: boolean) => void
    onError: (error: unknown) => void
}

export class NativePlayback {
    readonly element: HTMLVideoElement | HTMLAudioElement
    private readonly source: NativeSourceBinding
    private readonly poster: NativeSourceBinding
    private destroyed = false

    constructor(private readonly options: NativePlaybackOptions) {
        options.signal.throwIfAborted()
        const html = createDocumentHtml(options.root.ownerDocument)
        this.element = options.kind === 'video'
            ? html`<video className="canvas-native-video" playsinline></video>` as HTMLVideoElement
            : html`<audio className="canvas-native-audio"></audio>` as HTMLAudioElement
        this.element.muted = options.muted ?? false
        this.element.loop = options.loop ?? false
        this.element.preload = options.preload ?? 'metadata'
        this.element.crossOrigin = options.crossOrigin ?? 'anonymous'
        applyStyle(
            this.element,
            options.kind === 'video'
                ? { width: '100%', height: '100%', display: 'block', objectFit: 'contain' }
                : { width: '1px', height: '1px', display: 'block' },
        )
        this.source = new NativeSourceBinding(options.media, options.signal, url => {
            this.pause()
            if (url) this.element.src = url
            else this.element.removeAttribute('src')
            this.element.load()
            if (url) options.onReady?.(this.element)
        }, options.onError)
        this.poster = new NativeSourceBinding(options.media, options.signal, url => {
            if (url) (this.element as HTMLVideoElement).poster = url
            else this.element.removeAttribute('poster')
        }, options.onError)
        this.element.addEventListener('loadedmetadata', this.onMetadata)
        this.element.addEventListener('error', this.onMediaError)
        for (const event of ['play', 'pause', 'ended']) this.element.addEventListener(event, this.onPlaybackChange)
        options.root.appendChild(this.element)
        options.signal.addEventListener('abort', this.destroy, { once: true })
    }

    setSource(media: MediaDescriptor | null, renditionId: string): Promise<void> {
        return this.source.set(media ? { media, renditionId } : null)
    }

    setPoster(media: MediaDescriptor | null, renditionId: string): Promise<void> {
        if (this.options.kind !== 'video') return Promise.resolve()
        return this.poster.set(media ? { media, renditionId } : null)
    }

    async retrySources(): Promise<void> {
        await Promise.all([this.source.retry(), this.poster.retry()])
    }

    get isPlaying(): boolean {
        return !this.element.paused && !this.element.ended
    }

    async play(): Promise<void> {
        const ready = this.source.ready
        await ready
        if (this.destroyed || ready !== this.source.ready || !this.element.getAttribute('src') || this.isPlaying) return
        try {
            await this.element.play()
            if (this.destroyed) this.element.pause()
        } catch (error) {
            if (!this.destroyed) this.options.onError(error)
        }
    }

    pause(): void {
        try {
            this.element.pause()
        } catch (error) {
            if (!this.destroyed) this.options.onError(error)
        }
    }

    async toggle(): Promise<void> {
        if (this.isPlaying) this.pause()
        else await this.play()
    }

    private onMetadata = (): void => {
        if (this.destroyed || this.options.kind !== 'video') return
        const { videoWidth: width, videoHeight: height } = this.element as HTMLVideoElement
        if (width > 0 && height > 0) this.options.onIntrinsicSize?.({ width, height })
    }

    private onPlaybackChange = (): void => {
        if (!this.destroyed) this.options.onPlaybackChange?.(this.isPlaying)
    }

    private onMediaError = (): void => {
        if (!this.destroyed) this.options.onError(this.element.error ?? new Error('Native media loading failed'))
    }

    destroy = (): void => {
        if (this.destroyed) return
        this.destroyed = true
        this.options.signal.removeEventListener('abort', this.destroy)
        this.element.removeEventListener('loadedmetadata', this.onMetadata)
        this.element.removeEventListener('error', this.onMediaError)
        for (const event of ['play', 'pause', 'ended']) this.element.removeEventListener(event, this.onPlaybackChange)
        this.pause()
        this.element.removeAttribute('src')
        this.element.removeAttribute('poster')
        try {
            this.element.load()
        } catch (error) {
            this.options.onError(error)
        }
        this.source.destroy()
        this.poster.destroy()
        this.element.remove()
    }
}
