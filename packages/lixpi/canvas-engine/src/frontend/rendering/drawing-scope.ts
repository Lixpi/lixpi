'use strict'

import type {
    CanvasEngineRect,
    Dispose,
} from '../../shared/index.ts'
import { Lifetime } from '../runtime/lifetime.ts'
import type { EngineMedia } from '../media/types.ts'
import type {
    CanvasLayer,
    DrawingResources,
} from './resources.ts'
import { ScopedDrawingResources } from './scoped-drawing-resources.ts'

export type CanvasDrawingSurface = {
    resources: DrawingResources
    media: EngineMedia
    layers: Readonly<{ media: CanvasLayer; connectors: CanvasLayer; foreground: CanvasLayer }>
    requestFrame: (callback: (elapsedMs: number) => void) => Dispose
    invalidate: (bounds?: CanvasEngineRect) => void
    signal: AbortSignal
}

export class CanvasDrawingScope implements CanvasDrawingSurface {
    readonly resources: DrawingResources
    readonly media: EngineMedia
    readonly layers: CanvasDrawingSurface['layers']

    constructor(private readonly surface: Omit<CanvasDrawingSurface, 'signal'>, private readonly lifetime: Lifetime) {
        this.resources = new ScopedDrawingResources(surface.resources, lifetime)
        this.media = {
            acquireImage: request => surface.media.acquireImage({ ...request, signal: AbortSignal.any([request.signal, this.signal]) }),
            acquirePlayback: request => surface.media.acquirePlayback({ ...request, signal: AbortSignal.any([request.signal, this.signal]) }),
        }
        this.layers = surface.layers
    }

    get signal(): AbortSignal {
        return this.lifetime.signal
    }

    requestFrame = (callback: (elapsedMs: number) => void): Dispose => {
        if (this.signal.aborted) return () => {}
        return this.lifetime.own(this.surface.requestFrame(callback))
    }

    invalidate = (bounds?: CanvasEngineRect): void => {
        if (!this.signal.aborted) this.surface.invalidate(bounds)
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
