'use strict'

import type {
    CanvasEngineSize,
    Dispose,
} from '../../shared/index.ts'
import type { ResourceHandle } from '../rendering/resources.ts'

export type MediaRendition = { id: string; width?: number; height?: number; mimeType: string }
export type MediaDescriptor = {
    key: string
    kind: 'image' | 'video' | 'audio' | 'document'
    version: string
    dimensions?: CanvasEngineSize
    renditions: readonly MediaRendition[]
}

export type MediaSourceResolver = {
    resolve: (media: MediaDescriptor, renditionId: string, signal: AbortSignal) => Promise<{
        url: string
        request?: { headers?: Readonly<Record<string, string>>; credentials?: RequestCredentials }
        release: Dispose
    }>
}

export type ImageLease = {
    texture: ResourceHandle<'texture'>
    intrinsicSize: CanvasEngineSize
    renditionId: string
    release: Dispose
}

export type EngineMedia = {
    acquireImage: (request: { media: MediaDescriptor; visiblePixels: CanvasEngineSize; signal: AbortSignal }) => Promise<ImageLease>
    acquirePlayback: (request: { media: MediaDescriptor; renditionId: string; signal: AbortSignal }) => Promise<{ url: string; release: Dispose }>
}

export type MediaCacheOptions = { maxTextures?: number; maxBytes?: number }
