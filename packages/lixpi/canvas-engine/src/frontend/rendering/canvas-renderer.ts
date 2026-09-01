'use strict'

import { Application } from 'pixi.js'
import type {
    CanvasEngineRect,
    CanvasEngineSize,
    CanvasViewport,
    Dispose,
} from '../../shared/index.ts'
import { FrameScheduler } from '../runtime/frame-scheduler.ts'
import { Lifetime } from '../runtime/lifetime.ts'
import { CanvasMedia } from '../media/canvas-media.ts'
import type { ImageDecoderOptions } from '../media/image-decoder.ts'
import type {
    EngineMedia,
    MediaCacheOptions,
    MediaSourceResolver,
} from '../media/types.ts'
import type {
    CanvasLayer,
    DrawingResources,
} from './resources.ts'
import { PixiDrawingResources } from './pixi-drawing-resources.ts'
import { CanvasDrawingScope } from './drawing-scope.ts'
import { ScopedDrawingResources } from './scoped-drawing-resources.ts'
import { PixiGpuRetirement } from './pixi-gpu-retirement.ts'

export type CanvasRendererOptions = {
    root: HTMLElement
    onError: (error: unknown) => void
    preference?: 'webgpu' | 'webgl'
    resolution?: number
    mediaResolver?: MediaSourceResolver
    mediaCache?: MediaCacheOptions
    decoder?: ImageDecoderOptions
    beforeRender?: () => void
}

export class CanvasRenderer {
    readonly ready: Promise<boolean>
    readonly resources: DrawingResources
    readonly media: EngineMedia
    readonly layers: Readonly<{ media: CanvasLayer; connectors: CanvasLayer; foreground: CanvasLayer }>
    private readonly app = new Application()
    private readonly lifetime = new Lifetime()
    private readonly backend: PixiDrawingResources
    private readonly mediaCache: CanvasMedia
    private readonly frames: FrameScheduler
    private resizeObserver: ResizeObserver | null = null
    private readonly retirements: Dispose[] = []
    private retirement: Promise<void> | null = null
    private applicationDisposal: Promise<void> | null = null
    private gpuRetirement: PixiGpuRetirement | null = null
    private canvas: HTMLCanvasElement | null = null
    private initialized = false
    private destroyed = false
    private size: CanvasEngineSize = { width: 1, height: 1 }

    constructor(private readonly options: CanvasRendererOptions) {
        this.frames = new FrameScheduler({ render: () => this.render(), onError: options.onError })
        this.backend = new PixiDrawingResources(this.app.stage, this.retire, () => this.schedule())
        this.resources = new ScopedDrawingResources(this.backend, this.lifetime)
        this.layers = Object.freeze({ connectors: this.backend.addLayer(), media: this.backend.addLayer(), foreground: this.backend.addLayer() })
        this.mediaCache = new CanvasMedia({
            resolver: options.mediaResolver ?? {
                resolve: async () => {
                    throw new Error('Canvas media requires a source resolver')
                },
            },
            cache: options.mediaCache,
            decoder: options.decoder,
            createTexture: bitmap => {
                const texture = this.backend.createOwnedTexture({ kind: 'image', source: bitmap, mipmaps: true }, () => bitmap.close())
                return { texture, release: () => this.backend.release(texture) }
            },
        })
        this.media = this.mediaCache.scoped(this.lifetime.signal)
        try {
            this.resizeObserver = new ResizeObserver(() => this.resize())
            this.resizeObserver.observe(options.root)
            this.ready = this.initialize()
        } catch (error) {
            this.destroy()
            throw error
        }
    }

    private async initialize(): Promise<boolean> {
        try {
            await this.app.init({
                preference: this.options.preference ?? 'webgpu',
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: true,
                resolution: this.options.resolution ?? Math.min(window.devicePixelRatio || 1, 2),
                autoStart: false,
                sharedTicker: false,
                gcActive: false,
                webgpu: { antialias: true, powerPreference: 'high-performance' },
                webgl: { antialias: true, powerPreference: 'high-performance' },
            })
            this.app.ticker.stop()
            this.initialized = true
            if ('gpu' in this.app.renderer && 'buffer' in this.app.renderer) this.gpuRetirement = new PixiGpuRetirement(this.app.renderer, this.retire)
            if (this.destroyed) {
                await this.disposeApplication()
                return false
            }
            this.canvas = this.app.canvas
            this.canvas.style.pointerEvents = 'none'
            this.options.root.appendChild(this.canvas)
            this.resize()
            return true
        } catch (error) {
            this.initialized = Boolean(this.app.renderer)
            if (!this.destroyed) {
                this.options.onError(error)
                this.destroy()
            } else if (this.initialized) {
                await this.disposeApplication()
            }
            return false
        }
    }

    resize(size?: CanvasEngineSize): void {
        if (this.destroyed) return
        const bounds = size ?? this.options.root.getBoundingClientRect()
        this.size = { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }
        if (this.initialized) this.app.renderer.resize(this.size.width, this.size.height)
        this.invalidate()
    }

    setViewport(viewport: CanvasViewport): void {
        if (this.destroyed) return
        this.backend.setViewport(viewport)
    }

    invalidate(bounds?: CanvasEngineRect): void {
        this.backend.invalidateCaptures(bounds)
        this.schedule(bounds)
    }

    private schedule(bounds?: CanvasEngineRect): void {
        if (!this.destroyed && this.initialized) this.frames.invalidate(bounds)
    }

    requestFrame(callback: (elapsedMs: number) => void): Dispose {
        return this.frames.animate(callback)
    }

    createScope(): CanvasDrawingScope {
        if (this.destroyed) throw new Error('Canvas renderer is disposed')
        return new CanvasDrawingScope({
            resources: this.backend,
            media: this.media,
            layers: this.layers,
            requestFrame: callback => this.requestFrame(callback),
            invalidate: bounds => this.invalidate(bounds),
        }, this.lifetime.child())
    }

    private render(): void {
        if (this.destroyed || !this.initialized) return
        this.options.beforeRender?.()
        if (this.destroyed) return
        this.backend.renderCaptures(this.app.renderer)
        this.backend.prepareProjection({ x: 0, y: 0, ...this.size })
        this.app.render()
    }

    renderNow(): void {
        this.render()
    }

    private retire = (dispose: Dispose): void => {
        this.retirements.push(dispose)
        this.retirement ??= this.drainRetirements()
    }

    private async drainRetirements(): Promise<void> {
        // Yield once so the retirement promise is registered before cleanup can finish.
        await Promise.resolve()
        try {
            while (this.retirements.length > 0) {
                const batch = this.retirements.splice(0)
                try {
                    if (this.initialized && 'gpu' in this.app.renderer) {
                        await this.app.renderer.gpu.device.queue.onSubmittedWorkDone()
                    }
                } catch (error) {
                    this.options.onError(error)
                }
                for (const dispose of batch) {
                    try {
                        dispose()
                    } catch (error) {
                        this.options.onError(error)
                    }
                }
            }
        } finally {
            this.retirement = null
        }
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.resizeObserver?.disconnect()
        this.frames.destroy()
        this.canvas?.remove()
        try {
            this.lifetime.destroy()
        } catch (error) {
            this.options.onError(error)
        }
        this.mediaCache.destroy()
        this.backend.destroy()
        if (this.initialized) void this.disposeApplication()
    }

    private disposeApplication(): Promise<void> {
        this.applicationDisposal ??= this.destroyApplication()
        return this.applicationDisposal
    }

    private async destroyApplication(): Promise<void> {
        try {
            await this.retirement
            if ('gpu' in this.app.renderer) {
                try {
                    await this.app.renderer.gpu.device.queue.onSubmittedWorkDone()
                } catch (error) {
                    this.options.onError(error)
                }
            }
            this.gpuRetirement?.destroy()
            this.gpuRetirement = null
            this.initialized = false
            this.app.destroy(true, { children: true, texture: false, textureSource: false })
            await this.retirement
        } catch (error) {
            this.options.onError(error)
        }
    }
}
