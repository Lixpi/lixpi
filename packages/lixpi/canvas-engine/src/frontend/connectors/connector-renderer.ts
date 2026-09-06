import {
    getAdaptiveBoundedZoomScalingOptions,
    scaleCanvasChromeToScreenForZoom,
    type BoundedZoomScalingOptions,
    type CanvasViewport,
} from '../../shared/index.ts'
import {
    type CanvasDrawingSurface,
} from '../rendering/drawing-scope.ts'
import {
    type ResourceHandle,
} from '../rendering/resources.ts'

export type ConnectorMarker = {
    paths: readonly string[]
    width: number
    reference: {
        x: number
        y: number
    }
}
export type ConnectorArrow = {
    x: number
    y: number
    angle: number
    baseScreenSize: number
}
export type ConnectorRenderDatum = {
    id: string
    svgPath: string
    strokeColor: string
    baseScreenStrokeWidth: number
    isDashed: boolean
    arrowEnd: ConnectorArrow | null
    arrowStart: ConnectorArrow | null
}

export type ConnectorRendererOptions = {
    surface: CanvasDrawingSurface
    zoomScaling?: BoundedZoomScalingOptions
    marker?: ConnectorMarker
    dash?: readonly number[]
    resolution?: number
}

type ArrowEntry = {
    group: ResourceHandle<'group'>
    path: ResourceHandle<'path'>
}
type Entry = {
    group: ResourceHandle<'group'>
    path: ResourceHandle<'path'>
    arrows: ArrowEntry[]
    key: string
}

export class ConnectorRenderer {
    private readonly root: ResourceHandle<'group'>
    private readonly entries = new Map<string, Entry>()
    private destroyed = false

    constructor(private readonly options: ConnectorRendererOptions) {
        options.surface.signal.throwIfAborted()

        if (
            options.marker
            && (!Number.isFinite(options.marker.width) || options.marker.width <= 0)
        )
            throw new RangeError('Connector marker width must be positive')

        this.root = options.surface.resources.createGroup({
            layer: options.surface.layers.connectors,
            space: 'screen',
        })
        options.surface.signal.addEventListener(
            'abort',
            this.destroy,
            { once: true },
        )
    }

    render(
        edges: readonly ConnectorRenderDatum[],
        viewport: CanvasViewport,
    ): void {
        if (this.destroyed)
            return

        const resources = this.options.surface.resources
        const incoming = new Set(
            edges.map(edge => edge.id),
        )

        for (const [id, entry] of this.entries) if (!incoming.has(id))
            resources.setVisible(entry.group, false)

        for (const edge of edges) {
            let entry = this.entries.get(edge.id)

            if (!entry) {
                const group = resources.createGroup({
                    layer: this.root,
                    space: 'screen',
                })

                try {
                    entry = {
                        group,
                        path: resources.createPath(group, []),
                        arrows: [],
                        key: '',
                    }
                    this.entries.set(edge.id, entry)
                } catch (error) {
                    resources.release(group)

                    throw error
                }
            }

            resources.setVisible(entry.group, true)
            const key = JSON.stringify([edge, viewport])

            if (entry.key === key)
                continue

            const scale = (value: number) => scaleCanvasChromeToScreenForZoom(
                value,
                viewport.zoom,
                getAdaptiveBoundedZoomScalingOptions(this.options.zoomScaling ?? { minZoom: 0 }),
            )
            resources.updatePath(
                entry.path,
                [{
                    path: edge.svgPath,
                    projection: {
                        ...viewport,
                        snapResolution: this.options.resolution ?? Math.min(globalThis.devicePixelRatio || 1, 2),
                    },
                    stroke: {
                        color: edge.strokeColor,
                        width: scale(edge.baseScreenStrokeWidth),
                        cap: 'round',
                        join: 'round',
                        dash: edge.isDashed ? this.options.dash ?? [6, 4] : undefined,
                    },
                }],
            )
            const marker = this.options.marker
            const arrows = marker ? [edge.arrowStart, edge.arrowEnd].filter((arrow): arrow is ConnectorArrow => arrow !== null) : []

            for (const [index, arrowEntry] of entry.arrows.entries()) resources.setVisible(arrowEntry.group, index < arrows.length)

            for (const [index, arrow] of arrows.entries()) {
                let arrowEntry = entry.arrows[index]

                if (!arrowEntry) {
                    const group = resources.createGroup({
                        layer: entry.group,
                        space: 'screen',
                    })
                    const local = resources.createGroup({
                        layer: group,
                        space: 'screen',
                    })
                    resources.updateGroup(
                        local,
                        { position: {
                            x: -marker!.reference.x,
                            y: -marker!.reference.y,
                        } },
                    )
                    arrowEntry = {
                        group,
                        path: resources.createPath(local, []),
                    }
                    entry.arrows.push(arrowEntry)
                }

                resources.setVisible(arrowEntry.group, true)
                resources.updatePath(
                    arrowEntry.path,
                    marker!.paths.map(
                        path => ({
                            path,
                            fill: { color: edge.strokeColor },
                        }),
                    ),
                )
                const size = scale(arrow.baseScreenSize) / marker!.width
                resources.updateGroup(
                    arrowEntry.group,
                    {
                        position: {
                            x: arrow.x * viewport.zoom + viewport.x,
                            y: arrow.y * viewport.zoom + viewport.y,
                        },
                        scale: {
                            x: size,
                            y: size,
                        },
                        rotation: arrow.angle,
                    },
                )
            }

            entry.key = key
        }
    }

    destroy = (): void => {
        if (this.destroyed)
            return

        this.destroyed = true
        this.options.surface.signal.removeEventListener('abort', this.destroy)
        this.options.surface.resources.release(this.root)
        this.entries.clear()
    }
}
