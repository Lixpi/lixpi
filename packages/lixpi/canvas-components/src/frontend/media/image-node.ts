import {
    type CanvasEngineRect,
    type CanvasViewport,
    type EngineNode,
    type NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import {
    type ComponentContext,
    type NodeRegistration,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import {
    ImageSurface,
    type ImageSurfaceOptions,
} from './image-surface.ts'

export type ImageNodeOptions<Data> = Omit<ImageSurfaceOptions, 'surface' | 'onImageLoaded'> & {
    type: string
    geometry: NodeGeometryPolicy<Data>
    getMedia: (node: EngineNode<Data>) => MediaDescriptor | null
    getStyle?: (node: EngineNode<Data>) => Pick<ImageSurfaceOptions, 'fit' | 'radius' | 'placeholder'>
    onImageLoaded?: (
        node: EngineNode<Data>,
        image: Parameters<NonNullable<ImageSurfaceOptions['onImageLoaded']>>[0] & {
            initialLoad: boolean
        },
    ) => void
}

class ImageNodeView<Data> implements NodeView<Data> {
    private node: EngineNode<Data>
    private readonly image: ImageSurface
    private loaded = false

    constructor(
        node: EngineNode<Data>,
        context: ComponentContext,
        private readonly options: ImageNodeOptions<Data>,
    ) {
        this.node = node
        this.image = new ImageSurface({
            ...options,
            surface: context,
            onImageLoaded: image => {
                const initialLoad = !this.loaded
                this.loaded = true
                options.onImageLoaded?.(
                    this.node,
                    {
                        ...image,
                        initialLoad,
                    },
                )
            },
        })

        try {
            this.update(node)
        } catch (error) {
            this.image.destroy()

            throw error
        }
    }

    update(node: EngineNode<Data>): void {
        this.node = node
        const style = this.options.getStyle?.(node)
        this.image.setFit(style?.fit ?? this.options.fit ?? 'stretch')
        this.image.setRadius(style?.radius ?? this.options.radius ?? 0)

        if (
            style
            && 'placeholder' in style
        )
            this.image.setPlaceholder(style.placeholder)

        this.image.setMedia(
            this.options.getMedia(node),
        )
    }

    setGeometry(
        bounds: CanvasEngineRect,
        viewport: CanvasViewport,
    ): void {
        this.image.setGeometry(bounds, viewport)
    }
    setVisible(visible: boolean): void {
        this.image.setVisible(visible)
    }
    setSelected(_selected: boolean): void {}
    prefetch(): Promise<void> {
        return this.image.prefetch()
    }
    destroy(): void {
        this.image.destroy()
    }
}

export const createImageNodeRegistration = <Data>(options: ImageNodeOptions<Data>): NodeRegistration<Data> => ({
    type: options.type,
    geometry: options.geometry,
    mount: (node, context) => new ImageNodeView(
        node,
        context,
        options,
    ),
})
