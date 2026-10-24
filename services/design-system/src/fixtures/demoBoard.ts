// An engine-level canvas built from the real Canvas Components media
// registrations. The board owns its scene snapshot and accepts the engine's
// geometry, connection and deletion intents back into it, the way an
// application host does. Connector and selection appearance come from the
// Lixpi canvas presets.

import {
    applyNodeGeometry,
    type CanvasIntent,
    type CanvasViewport,
    type EngineEdge,
    type EngineNode,
    type NodeGeometryPolicy,
    type SceneSnapshot,
} from '@lixpi/canvas-engine/shared'
import {
    CanvasController,
    NodeRegistry,
    type CanvasExtension,
    type CanvasOptions,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import {
    createImageNodeRegistration,
    createPlaybackNodeRegistration,
} from '@lixpi/canvas-components/media'
import { createLixpiCanvasSettings } from '@lixpi/canvas-components-lixpi-specific/frontend/settings'
import { arrowRightIcon } from '@lixpi/ui-kit/svg'
import { extractSvgPathIcon } from '@lixpi/ui-primitives/svg'

import {
    type DemoAssets,
} from '$src/fixtures/demoAssets.ts'
import { settleRecordedVideoDuration } from '$src/fixtures/demoMedia.ts'

export type DemoBoardFit = 'contain' | 'cover' | 'stretch'

export type DemoBoardNode = {
    assetId: string
    fit?: DemoBoardFit
    height: number
    kind: 'audio' | 'image' | 'video'
    nodeId: string
    width: number
    x: number
    y: number
}

export type DemoBoardEdge = {
    path?: EngineEdge['path']
    source: string
    target: string
}

export type DemoBoardConfig = {
    assets: DemoAssets
    collisions?: boolean
    edges?: readonly DemoBoardEdge[]
    extensions?: readonly CanvasExtension[]
    interaction?: boolean
    nodes: readonly DemoBoardNode[]
    radius?: number
    renderer?: CanvasOptions['renderer']
    root: HTMLElement
    viewport?: CanvasViewport
    onError: (error: unknown) => void
    onSelectionChange?: (nodeIds: ReadonlySet<string>) => void
}

type BoardData = {
    media: MediaDescriptor
}

const FITS: readonly DemoBoardFit[] = ['cover', 'contain', 'stretch']

const geometry: NodeGeometryPolicy<BoardData> = {
    measure: node => {
        const bounds = {
            ...node.position,
            ...node.dimensions,
        }

        return {
            collisionBounds: bounds,
            connectorBounds: bounds,
            hitBounds: bounds,
            selectionBounds: bounds,
            visualBounds: bounds,
        }
    },
    movable: true,
    resize: {
        min: {
            height: 60,
            width: 80,
        },
        preserveAspectRatio: false,
    },
}

const ports = (
    width: number,
    height: number,
): EngineNode['ports'] => [
    {
        anchor: {
            x: 0,
            y: height / 2,
        },
        direction: 'left',
        id: 'in',
        role: 'input',
    },
    {
        anchor: {
            x: width,
            y: height / 2,
        },
        direction: 'right',
        id: 'out',
        role: 'output',
    },
]

export class DemoBoard {
    readonly canvas: CanvasController

    private snapshot: SceneSnapshot<BoardData>
    private revision = 0
    private closed = false

    constructor(private readonly config: DemoBoardConfig) {
        const settings = createLixpiCanvasSettings()
        const marker = extractSvgPathIcon(arrowRightIcon)
        this.snapshot = {
            edges: (config.edges ?? []).map(
                (edge, index) => ({
                    data: null,
                    edgeId: `edge-${index}`,
                    path: edge.path ?? 'bezier',
                    source: {
                        nodeId: edge.source,
                        portId: 'out',
                    },
                    target: {
                        nodeId: edge.target,
                        portId: 'in',
                    },
                }),
            ),
            nodes: config.nodes.map(node => this.toEngineNode(node)),
            revision: '0',
            sceneKey: crypto.randomUUID(),
        }
        let registry = new NodeRegistry()

        for (const fit of FITS)
            registry = registry.register(
                createImageNodeRegistration<BoardData>({
                    fit,
                    geometry,
                    getMedia: node => node.data.media,
                    placeholder: { color: settings.connector.styles.lineDefaultColor },
                    progressive: true,
                    radius: config.radius ?? settings.mediaNode.styles.borderRadius,
                    type: `image-${fit}`,
                    onError: config.onError,
                }),
            )

        registry = registry
            .register(
                createPlaybackNodeRegistration<BoardData>({
                    geometry,
                    getContent: node => ({
                        media: node.data.media,
                        playbackRenditionId: 'original',
                        posterRenditionId: node.data.media.kind === 'video' ? 'poster' : undefined,
                    }),
                    image: { radius: config.radius ?? settings.mediaNode.styles.borderRadius },
                    kind: 'video',
                    pauseWhenHidden: true,
                    playback: {
                        loop: true,
                        muted: true,
                        preload: 'auto',
                    },
                    type: 'video',
                    onElement: (_node, element) => {
                        if (element instanceof HTMLVideoElement) {
                            element.controls = true
                            settleRecordedVideoDuration(element)
                        }
                    },
                    onError: config.onError,
                }),
            )
            .register(
                createPlaybackNodeRegistration<BoardData>({
                    geometry,
                    getContent: node => ({
                        media: node.data.media,
                        playbackRenditionId: 'original',
                    }),
                    kind: 'audio',
                    type: 'audio',
                    onElement: (_node, element) => {
                        if (element)
                            element.controls = true
                    },
                    onError: config.onError,
                }),
            )
        this.canvas = new CanvasController({
            collisions: config.collisions === false ? undefined : { margin: 24 },
            connectors: {
                renderer: {
                    marker: {
                        paths: marker.pathData,
                        reference: {
                            x: 48,
                            y: 128,
                        },
                        width: marker.width,
                    },
                },
                settings: settings.connector,
            },
            extensions: config.extensions,
            interaction: config.interaction === false
                ? false
                : {
                    marquee: {
                        backgroundColor: settings.selection.styles.marqueeBackgroundColor,
                        borderColor: settings.selection.styles.marqueeBorderColor,
                        radius: 8,
                    },
                    onSelectionChange: nodeIds => config.onSelectionChange?.(nodeIds),
                },
            mediaResolver: {
                resolve: async (
                    media,
                    renditionId,
                    signal,
                ) => {
                    signal.throwIfAborted()
                    await config.assets.ready

                    return {
                        release: () => {},
                        url: config.assets.url(media.key, renditionId),
                    }
                },
            },
            registry,
            renderer: config.renderer,
            root: config.root,
            scene: this.snapshot,
            viewport: config.viewport ?? {
                x: 0,
                y: 0,
                zoom: 1,
            },
            onError: config.onError,
            onIntent: this.accept,
        })
    }

    destroy(): void {
        this.closed = true
        this.canvas.destroy()
    }

    private toEngineNode(node: DemoBoardNode): EngineNode<BoardData> {
        const asset = this.config.assets.get(node.assetId)
        const renditions = Object.values(asset?.media?.renditions ?? {}).map(
            rendition => ({
                height: rendition.height,
                id: rendition.name,
                mimeType: rendition.mimeType ?? '',
                width: rendition.width,
            }),
        )

        return {
            data: {
                media: {
                    dimensions: asset?.media?.width
                        && asset.media.height
                        ? {
                            height: asset.media.height,
                            width: asset.media.width,
                        }
                        : undefined,
                    key: node.assetId,
                    kind: node.kind,
                    renditions,
                    version: '1',
                },
            },
            dimensions: {
                height: node.height,
                width: node.width,
            },
            nodeId: node.nodeId,
            ports: ports(node.width, node.height),
            position: {
                x: node.x,
                y: node.y,
            },
            type: node.kind === 'image' ? `image-${node.fit ?? 'cover'}` : node.kind,
        }
    }

    private accept = (intent: CanvasIntent): void => {
        if (
            this.closed
            || intent.sceneKey !== this.snapshot.sceneKey
            || intent.kind === 'viewport'
        )
            return

        if (intent.kind === 'geometry') {
            const changes = new Map(
                intent.changes.map(change => [change.nodeId, change]),
            )
            this.snapshot = {
                ...this.snapshot,
                nodes: this.snapshot.nodes.map(node => {
                    const change = changes.get(node.nodeId)

                    if (!change)
                        return node

                    const updated = applyNodeGeometry(node, change).node

                    return {
                        ...updated,
                        ports: ports(updated.dimensions.width, updated.dimensions.height),
                    }
                }),
            }
        } else if (intent.kind === 'delete') {
            const removed = new Set(intent.nodeIds)
            this.snapshot = {
                ...this.snapshot,
                edges: this.snapshot.edges.filter(
                    edge => !intent.edgeIds.includes(edge.edgeId)
                        && !removed.has(edge.source.nodeId)
                        && !removed.has(edge.target.nodeId),
                ),
                nodes: this.snapshot.nodes.filter(node => !removed.has(node.nodeId)),
            }
        } else if (intent.kind === 'connect')
            this.snapshot = {
                ...this.snapshot,
                edges: [...this.snapshot.edges, {
                    data: null,
                    edgeId: crypto.randomUUID(),
                    path: 'bezier',
                    source: intent.source,
                    target: intent.target,
                }],
            }
        else
            this.snapshot = {
                ...this.snapshot,
                edges: this.snapshot.edges.map(
                    edge => edge.edgeId === intent.edgeId
                        ? {
                            ...edge,
                            source: intent.source,
                            target: intent.target,
                        }
                        : edge,
                ),
            }

        this.snapshot = {
            ...this.snapshot,
            revision: String(++this.revision),
        }
        this.canvas.setScene(this.snapshot)
    }
}
