import {
    type CanvasEngineSize,
    type Dispose,
} from '../../shared/index.ts'
import {
    type ResourceHandle,
} from '../rendering/resources.ts'
import {
    ImageDecoder,
    type ImageDecoderOptions,
} from './image-decoder.ts'
import {
    mipmappedImageBytes,
    renditionSize,
    selectImageRendition,
} from './media-renditions.ts'
import {
    type EngineMedia,
    type ImageLease,
    type MediaCacheOptions,
    type MediaDescriptor,
    type MediaRendition,
    type MediaSourceResolver,
} from './types.ts'

type ImageResource = { texture: ResourceHandle<'texture'>; release: Dispose }
type CachedImage = ImageResource & { intrinsicSize: CanvasEngineSize }
type CacheEntry = {
    key: string
    media: MediaDescriptor
    rendition: MediaRendition
    controller: AbortController
    pending: Promise<CachedImage>
    value?: CachedImage
    interests: number
    bytes: number
    touched: number
}

export type CanvasMediaOptions = {
    resolver: MediaSourceResolver
    createTexture: (bitmap: ImageBitmap) => ImageResource
    cache?: MediaCacheOptions
    decoder?: ImageDecoderOptions
}

// Canvas-owned decoding and caching. Each interest is independently abortable;
// cancelling one consumer never cancels another consumer's shared decode.
export class CanvasMedia implements EngineMedia {
    private readonly decoder: ImageDecoder
    private readonly controller = new AbortController()
    private readonly entries = new Map<string, CacheEntry>()
    private readonly maxTextures: number
    private readonly maxBytes: number
    private bytes = 0
    private clock = 0

    constructor(private readonly options: CanvasMediaOptions) {
        this.maxTextures = options.cache?.maxTextures ?? 2000
        this.maxBytes = options.cache?.maxBytes ?? 768 * 1024 * 1024
        if (!Number.isInteger(this.maxTextures) || this.maxTextures < 0 || !Number.isFinite(this.maxBytes) || this.maxBytes < 0) throw new RangeError('Media cache limits must be non-negative')
        this.decoder = new ImageDecoder(options.decoder)
    }

    scoped(signal: AbortSignal): EngineMedia {
        return {
            acquireImage: request => this.acquireImage({ ...request, signal: AbortSignal.any([request.signal, signal]) }),
            acquirePlayback: request => this.acquirePlayback({ ...request, signal: AbortSignal.any([request.signal, signal]) }),
        }
    }

    async acquireImage(request: Parameters<EngineMedia['acquireImage']>[0]): Promise<ImageLease> {
        const signal = AbortSignal.any([request.signal, this.controller.signal])
        signal.throwIfAborted()
        const rendition = selectImageRendition(request.media, request.visiblePixels)
        const key = JSON.stringify([request.media.key, request.media.version, rendition.id])
        const entry = this.entries.get(key) ?? this.reusableImage(request.media, rendition) ?? this.createEntry(key, request.media, rendition)
        entry.interests++
        entry.touched = ++this.clock
        let released = false
        let rejectAbort!: (reason: unknown) => void
        const aborted = new Promise<never>((_, reject) => {
            rejectAbort = reject
        })
        const release = () => {
            if (released) return
            released = true
            signal.removeEventListener('abort', abort)
            entry.interests--
            entry.touched = ++this.clock
            if (entry.interests === 0 && !entry.value) this.discard(entry)
            this.evict()
        }
        const abort = () => {
            release()
            rejectAbort(signal.reason)
        }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        try {
            const value = await Promise.race([entry.pending, aborted])
            signal.throwIfAborted()
            return { texture: value.texture, intrinsicSize: { ...value.intrinsicSize }, renditionId: entry.rendition.id, release }
        } catch (error) {
            release()
            throw error
        }
    }

    private reusableImage(media: MediaDescriptor, desired: MediaRendition): CacheEntry | undefined {
        const size = renditionSize(desired)
        return Array.from(this.entries.values())
            .filter(entry => entry.value && entry.media.key === media.key && entry.media.version === media.version && entry.value.intrinsicSize.width >= size.width && entry.value.intrinsicSize.height >= size.height)
            .sort((a, b) => a.bytes - b.bytes)[0]
    }

    private createEntry(key: string, media: MediaDescriptor, rendition: MediaRendition): CacheEntry {
        const entry = { key, media: structuredClone(media), rendition: { ...rendition }, controller: new AbortController(), interests: 0, bytes: 0, touched: ++this.clock } as CacheEntry
        this.entries.set(key, entry)
        entry.pending = this.load(entry)
        return entry
    }

    private async load(entry: CacheEntry): Promise<CachedImage> {
        let bitmap: ImageBitmap | null = null
        let resource: ImageResource | undefined
        try {
            const signal = entry.controller.signal
            const source = await this.options.resolver.resolve(entry.media, entry.rendition.id, signal)
            try {
                signal.throwIfAborted()
                bitmap = await this.decoder.decode({ url: source.url, ...source.request }, signal)
                signal.throwIfAborted()
            } finally {
                source.release()
            }
            signal.throwIfAborted()
            const intrinsicSize = { width: bitmap.width, height: bitmap.height }
            resource = this.options.createTexture(bitmap)
            bitmap = null // Texture ownership includes closing the bitmap after GPU disposal.
            const value = { ...resource, intrinsicSize }
            entry.value = value
            entry.bytes = mipmappedImageBytes(intrinsicSize)
            this.bytes += entry.bytes
            this.evict()
            return value
        } catch (error) {
            bitmap?.close()
            resource?.release()
            if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
            throw error
        }
    }

    private evict(): void {
        if (this.entries.size <= this.maxTextures && this.bytes <= this.maxBytes) return
        const idle = Array.from(this.entries.values()).filter(entry => entry.value && entry.interests === 0).sort((a, b) => a.touched - b.touched)
        for (const entry of idle) {
            if (this.entries.size <= this.maxTextures && this.bytes <= this.maxBytes) break
            this.discard(entry)
        }
    }

    private discard(entry: CacheEntry): void {
        if (this.entries.get(entry.key) !== entry) return
        this.entries.delete(entry.key)
        entry.controller.abort()
        this.bytes -= entry.bytes
        entry.value?.release()
    }

    async acquirePlayback(request: Parameters<EngineMedia['acquirePlayback']>[0]): Promise<{ url: string; release: Dispose }> {
        const signal = AbortSignal.any([request.signal, this.controller.signal])
        signal.throwIfAborted()
        if (!request.media.renditions.some(rendition => rendition.id === request.renditionId)) throw new Error('Unknown playback rendition')
        const source = await this.options.resolver.resolve(request.media, request.renditionId, signal)
        let released = false
        const release = () => {
            if (released) return
            released = true
            signal.removeEventListener('abort', release)
            source.release()
        }
        try {
            signal.throwIfAborted()
            if (Object.keys(source.request?.headers ?? {}).length > 0) throw new Error('Playback sources must be directly usable by a native media element')
            signal.addEventListener('abort', release, { once: true })
            return { url: source.url, release }
        } catch (error) {
            release()
            throw error
        }
    }

    destroy(): void {
        if (this.controller.signal.aborted) return
        this.controller.abort()
        for (const entry of Array.from(this.entries.values())) this.discard(entry)
        this.decoder.destroy()
    }
}
