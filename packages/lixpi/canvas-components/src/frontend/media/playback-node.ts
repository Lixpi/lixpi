import {
    type CanvasEngineRect,
    type CanvasEngineSize,
    type CanvasViewport,
    type EngineNode,
    type NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import {
    type MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import {
    type ComponentContext,
    type NodeRegistration,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    ImageSurface,
    type ImageSurfaceOptions,
} from './image-surface.ts'
import {
    NativePlayback,
    type NativePlaybackOptions,
} from './native-playback.ts'

export type PlaybackContent = {
    media: MediaDescriptor
    playbackRenditionId: string | null
    posterRenditionId?: string
}

export type PlaybackNodeOptions<Data> = {
    type: string
    kind: 'video' | 'audio'
    geometry: NodeGeometryPolicy<Data>
    getContent: (node: EngineNode<Data>) => PlaybackContent | null
    image?: Omit<ImageSurfaceOptions, 'surface' | 'onError' | 'onImageLoaded'>
    playback?: Pick<NativePlaybackOptions, 'muted' | 'loop' | 'preload' | 'crossOrigin'>
    pauseWhenHidden?: boolean
    isImageVisible?: (node: EngineNode<Data>) => boolean
    onElement?: (
        node: EngineNode<Data>,
        element: HTMLVideoElement | HTMLAudioElement | null,
    ) => void
    onPlayback?: (
        node: EngineNode<Data>,
        playback: NativePlayback | null,
    ) => void
    onReady?: (
        node: EngineNode<Data>,
        element: HTMLVideoElement | HTMLAudioElement,
    ) => void
    onIntrinsicSize?: (
        node: EngineNode<Data>,
        size: CanvasEngineSize,
    ) => void
    onError: (error: unknown) => void
}

class PlaybackNodeView<Data> implements NodeView<Data> {
    private node: EngineNode<Data>
    private readonly image: ImageSurface
    private readonly playback: NativePlayback
    private destroyed = false
    private visible = false

    constructor(
        node: EngineNode<Data>,
        private readonly context: ComponentContext,
        private readonly options: PlaybackNodeOptions<Data>,
    ) {
        this.node = node
        this.image = new ImageSurface({
            ...options.image,
            surface: context,
            onError: options.onError,
        })

        try {
            this.playback = new NativePlayback({
                ...options.playback,
                root: context.contentRoot,
                signal: context.signal,
                media: context.media,
                kind: options.kind,
                onReady: element => options.onReady?.(this.node, element),
                onIntrinsicSize: size => options.onIntrinsicSize?.(this.node, size),
                onError: options.onError,
            })
        } catch (error) {
            this.image.destroy()

            throw error
        }

        try {
            context.signal.addEventListener(
                'abort',
                this.destroy,
                { once: true },
            )
            options.onElement?.(node, this.playback.element)
            options.onPlayback?.(node, this.playback)
            this.update(node)
        } catch (error) {
            this.destroy()

            throw error
        }
    }

    update(node: EngineNode<Data>): void {
        if (this.destroyed)
            return

        this.node = node
        const content = this.options.getContent(node)
        const poster = content?.posterRenditionId
            ? {
                ...content.media,
                renditions: content.media.renditions.filter(rendition => rendition.id === content.posterRenditionId),
            }
            : null
        this.image.setMedia(poster)
        this.image.setVisible(this.visible && (this.options.isImageVisible?.(node) ?? true))
        void this.playback.setSource(content?.playbackRenditionId ? content.media : null, content?.playbackRenditionId ?? '')
        void this.playback.setPoster(poster, content?.posterRenditionId ?? '')
    }

    setGeometry(
        bounds: CanvasEngineRect,
        viewport: CanvasViewport,
    ): void {
        this.image.setGeometry(bounds, viewport)
    }
    setSelected(_selected: boolean): void {}

    setVisible(visible: boolean): void {
        this.visible = visible
        this.image.setVisible(visible && (this.options.isImageVisible?.(this.node) ?? true))

        if (
            !visible
            && this.options.pauseWhenHidden
        )
            this.playback.pause()
    }

    prefetch(): Promise<void> {
        return this.image.prefetch()
    }

    destroy = (): void => {
        if (this.destroyed)
            return

        this.destroyed = true
        this.context.signal.removeEventListener('abort', this.destroy)

        try {
            this.playback.destroy()
        } finally {
            try {
                this.image.destroy()
            } finally {
                try {
                    this.options.onElement?.(this.node, null)
                } finally {
                    this.options.onPlayback?.(this.node, null)
                }
            }
        }
    }
}

export const createPlaybackNodeRegistration = <Data>(options: PlaybackNodeOptions<Data>): NodeRegistration<Data> => {
    return {
        type: options.type,
        geometry: options.geometry,
        mount: (node, context) => new PlaybackNodeView(
            node,
            context,
            options,
        ),
    }
}
