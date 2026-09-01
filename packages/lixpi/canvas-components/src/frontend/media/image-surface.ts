import { roundedRectanglePath } from '@lixpi/ui-primitives/svg'
import {
    type CanvasEngineRect,
    type CanvasEngineSize,
    type CanvasViewport,
} from '@lixpi/canvas-engine/shared'
import {
    selectImageRendition,
    type ImageLease,
    type MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import { IdleTask } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type CanvasDrawingSurface,
    type CanvasLayer,
    type MeshData,
    type ResourceHandle,
} from '@lixpi/canvas-engine/frontend/rendering'

export type ImageSurfaceOptions = {
    surface: CanvasDrawingSurface
    layer?: CanvasLayer | ResourceHandle<'group'>
    radius?: number
    fit?: 'stretch' | 'contain' | 'cover'
    placeholder?: { color: string; alpha?: number } | null
    progressive?: boolean
    minimumLoadZoom?: number
    resolution?: number
    onImageLoaded?: (image: { media: MediaDescriptor; previousMedia?: MediaDescriptor; intrinsicSize: CanvasEngineSize }) => void
    onError: (error: unknown) => void
}

type LoadedImage = { lease: ImageLease; media: MediaDescriptor; identity: string }
type PendingImage = { controller: AbortController; identity: string; renditionId: string }

function mediaIdentity(media: MediaDescriptor): string {
    return JSON.stringify([media.key, media.version])
}

export class ImageSurface {
    private readonly group: ResourceHandle<'group'>
    private readonly imageGroup: ResourceHandle<'group'>
    private readonly mesh: ResourceHandle<'mesh'>
    private readonly mask: ResourceHandle<'path'>
    private readonly placeholder: ResourceHandle<'path'>
    private readonly geometry: MeshData = {
        positions: new Float32Array(8),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        version: 0,
    }
    private bounds: CanvasEngineRect = { x: 0, y: 0, width: 1, height: 1 }
    private viewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }
    private radius = 0
    private placeholderPaint: ImageSurfaceOptions['placeholder']
    private media: MediaDescriptor | null = null
    private current: LoadedImage | null = null
    private pending: PendingImage | null = null
    private prefetchController: AbortController | null = null
    private upgrade: IdleTask | null = null
    private readonly failed = new Set<string>()
    private visible = false
    private destroyed = false

    constructor(private readonly options: ImageSurfaceOptions) {
        const { resources, signal, layers } = options.surface
        if (signal.aborted) throw new Error('Cannot mount an image in a disposed drawing scope')
        this.radius = options.radius ?? 0
        this.placeholderPaint = options.placeholder === undefined ? { color: '#e7eaee', alpha: 0.85 } : options.placeholder
        this.group = resources.createGroup({ space: 'world', layer: options.layer ?? layers.media })
        try {
            this.placeholder = resources.createPath(this.group, [])
            this.imageGroup = resources.createGroup({ space: 'world', layer: this.group })
            this.mask = resources.createPath(this.group, [])
            resources.setMask(this.imageGroup, this.mask)
            this.mesh = resources.createMesh(this.imageGroup, this.geometry, null)
            this.syncGeometry()
            resources.setVisible(this.group, false)
        } catch (error) {
            resources.release(this.group)
            throw error
        }
        signal.addEventListener('abort', this.destroy, { once: true })
    }

    setMedia(media: MediaDescriptor | null): void {
        if (this.destroyed) return
        const changed = (media ? mediaIdentity(media) : null) !== (this.media ? mediaIdentity(this.media) : null)
        this.media = media ? structuredClone(media) : null
        if (changed) {
            this.cancelPending()
            this.prefetchController?.abort()
            this.prefetchController = null
            this.failed.clear()
        }
        if (!media) this.clearImage()
        this.ensureImage()
    }

    setGeometry(bounds: CanvasEngineRect, viewport: CanvasViewport, radius = this.options.radius ?? 0): void {
        if (this.destroyed) return
        if (![bounds.x, bounds.y, bounds.width, bounds.height, viewport.x, viewport.y, viewport.zoom, radius].every(Number.isFinite) || bounds.width < 0 || bounds.height < 0 || viewport.zoom <= 0) throw new RangeError('Image bounds, radius and viewport must be finite')
        const changed = bounds.x !== this.bounds.x || bounds.y !== this.bounds.y || bounds.width !== this.bounds.width || bounds.height !== this.bounds.height || radius !== this.radius
        this.bounds = { ...bounds }
        this.viewport = { ...viewport }
        this.radius = radius
        if (changed) this.syncGeometry()
        this.ensureImage()
    }

    setPlaceholder(paint: ImageSurfaceOptions['placeholder']): void {
        if (this.destroyed) return
        this.placeholderPaint = paint
        this.syncPaths()
        this.syncVisibility()
    }

    setVisible(visible: boolean): void {
        if (this.destroyed || this.visible === visible) return
        this.visible = visible
        if (!visible) {
            this.cancelPending()
            this.clearImage()
        }
        this.syncVisibility()
        this.ensureImage()
    }

    retry(): void {
        if (this.destroyed) return
        this.failed.clear()
        this.ensureImage()
    }

    async prefetch(): Promise<void> {
        if (this.destroyed || this.visible || this.prefetchController || !this.hasImage()) return
        const media = this.media!
        const controller = new AbortController()
        this.prefetchController = controller
        try {
            const lease = await this.options.surface.media.acquireImage({ media, visiblePixels: { width: 1, height: 1 }, signal: controller.signal })
            lease.release()
        } catch (error) {
            if (!controller.signal.aborted && !this.destroyed) this.options.onError(error)
        } finally {
            if (this.prefetchController === controller) this.prefetchController = null
        }
    }

    private hasImage(): boolean {
        return Boolean(this.media?.renditions.some(rendition => rendition.mimeType.startsWith('image/')))
    }

    private ensureImage(allowPreview = true): void {
        if (this.destroyed || !this.visible || !this.hasImage() || this.pending || this.viewport.zoom < (this.options.minimumLoadZoom ?? 0) || this.bounds.width <= 0 || this.bounds.height <= 0) return
        try {
            const resolution = this.options.resolution ?? (typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2))
            const visiblePixels = { width: this.bounds.width * this.viewport.zoom * resolution, height: this.bounds.height * this.viewport.zoom * resolution }
            const media = this.media!
            const identity = mediaIdentity(media)
            const desired = selectImageRendition(media, visiblePixels)
            if (this.current?.identity === identity && (this.current.lease.renditionId === desired.id || (this.current.lease.intrinsicSize.width >= (desired.width ?? visiblePixels.width) && this.current.lease.intrinsicSize.height >= (desired.height ?? visiblePixels.height)))) return
            const preview = allowPreview && this.options.progressive !== false && this.current?.identity !== identity
            const pixels = preview ? { width: 1, height: 1 } : visiblePixels
            const rendition = selectImageRendition(media, pixels)
            if (this.failed.has(JSON.stringify([identity, rendition.id]))) return
            const pending = { controller: new AbortController(), identity, renditionId: rendition.id }
            this.pending = pending
            void this.load(media, pixels, pending)
        } catch (error) {
            this.options.onError(error)
        }
    }

    private async load(media: MediaDescriptor, visiblePixels: CanvasEngineSize, pending: PendingImage): Promise<void> {
        let lease: ImageLease | null = null
        try {
            lease = await this.options.surface.media.acquireImage({ media, visiblePixels, signal: pending.controller.signal })
            if (this.destroyed || !this.visible || this.pending !== pending || pending.controller.signal.aborted) {
                lease.release()
                return
            }
            const previous = this.current
            this.options.surface.resources.setPaint(this.mesh, lease.texture)
            this.current = { lease, media, identity: pending.identity }
            lease = null
            this.pending = null
            try {
                this.syncMesh()
                this.syncVisibility()
            } finally {
                previous?.lease.release()
            }
            this.options.onImageLoaded?.({ media, previousMedia: previous?.media, intrinsicSize: { ...this.current.lease.intrinsicSize } })
            if (!this.destroyed && this.visible && this.media && mediaIdentity(this.media) === pending.identity && this.current?.identity === pending.identity) {
                this.upgrade?.destroy()
                this.upgrade = new IdleTask({
                    callback: () => {
                        this.upgrade = null
                        this.ensureImage(false)
                    },
                    signal: this.options.surface.signal,
                    timeoutMs: 2000,
                })
            }
        } catch (error) {
            lease?.release()
            if (this.pending === pending) {
                this.pending = null
                this.failed.add(JSON.stringify([pending.identity, pending.renditionId]))
            }
            if (!this.destroyed && !pending.controller.signal.aborted) this.options.onError(error)
        }
    }

    private syncGeometry(): void {
        this.options.surface.resources.updateGroup(this.group, { position: { x: this.bounds.x, y: this.bounds.y } })
        this.syncPaths()
        this.syncMesh()
    }

    private syncPaths(): void {
        const path = roundedRectanglePath({ ...this.bounds, x: 0, y: 0 }, this.radius)
        this.options.surface.resources.updatePath(this.mask, [{ path, fill: { color: '#ffffff' } }])
        this.options.surface.resources.updatePath(this.placeholder, this.placeholderPaint ? [{ path, fill: this.placeholderPaint }] : [])
    }

    private syncMesh(): void {
        const { width, height } = this.bounds
        let x = 0
        let y = 0
        let imageWidth = width
        let imageHeight = height
        let u0 = 0
        let v0 = 0
        let u1 = 1
        let v1 = 1
        const intrinsic = this.current?.lease.intrinsicSize
        if (intrinsic && width > 0 && height > 0 && this.options.fit && this.options.fit !== 'stretch') {
            const scale = this.options.fit === 'contain' ? Math.min(width / intrinsic.width, height / intrinsic.height) : Math.max(width / intrinsic.width, height / intrinsic.height)
            if (this.options.fit === 'contain') {
                imageWidth = intrinsic.width * scale
                imageHeight = intrinsic.height * scale
                x = (width - imageWidth) / 2
                y = (height - imageHeight) / 2
            } else {
                u0 = (1 - width / (intrinsic.width * scale)) / 2
                v0 = (1 - height / (intrinsic.height * scale)) / 2
                u1 = 1 - u0
                v1 = 1 - v0
            }
        }
        this.geometry.positions.set([x, y, x + imageWidth, y, x + imageWidth, y + imageHeight, x, y + imageHeight])
        this.geometry.uvs.set([u0, v0, u1, v0, u1, v1, u0, v1])
        this.geometry.version++
        this.options.surface.resources.updateMesh(this.mesh, this.geometry)
    }

    private syncVisibility(): void {
        const { resources } = this.options.surface
        resources.setVisible(this.group, this.visible)
        resources.setVisible(this.mesh, Boolean(this.current))
        resources.setVisible(this.placeholder, !this.current && Boolean(this.placeholderPaint))
    }

    private cancelPending(): void {
        this.pending?.controller.abort()
        this.pending = null
        this.upgrade?.destroy()
        this.upgrade = null
    }

    private clearImage(): void {
        if (!this.current) return
        this.options.surface.resources.setPaint(this.mesh, null)
        this.current.lease.release()
        this.current = null
        this.syncVisibility()
    }

    destroy = (): void => {
        if (this.destroyed) return
        this.destroyed = true
        this.options.surface.signal.removeEventListener('abort', this.destroy)
        this.cancelPending()
        this.prefetchController?.abort()
        this.options.surface.resources.release(this.group)
        this.current?.lease.release()
        this.current = null
    }
}
