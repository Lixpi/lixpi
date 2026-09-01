import {
    applyNodeGeometry,
    type CanvasEngineRect,
    type CanvasIntent,
    type CanvasViewport,
    type Dispose,
    type EngineNode,
    type NodeGeometryPolicy,
    type SceneSnapshot,
} from '@lixpi/canvas-engine/shared'
import {
    CanvasController,
    Lifetime,
    NodeRegistry,
    type CanvasDrawingContext,
    type ComponentContext,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import type { MediaDescriptor } from '@lixpi/canvas-engine/frontend/media'
import {
    createImageNodeRegistration,
    createPlaybackNodeRegistration,
} from '@lixpi/canvas-components/media'
import '@lixpi/canvas-engine/styles/interaction'

export type MediaBoardOptions = {
    imageUrl: string
    videoUrl: string
    posterUrl?: string
    color: string
    viewport?: CanvasViewport
    mountEditor: (root: HTMLElement, text: string, onChange: (text: string) => void) => Dispose
    onError: (error: unknown) => void
}

type BoardData = { text?: string; media?: MediaDescriptor; playback?: string; poster?: string }
const geometry: NodeGeometryPolicy<BoardData> = {
    measure: node => {
        const bounds = { ...node.position, ...node.dimensions }
        return { visualBounds: bounds, hitBounds: bounds, selectionBounds: bounds, collisionBounds: bounds, connectorBounds: bounds }
    },
    movable: true,
    resize: { min: { width: 120, height: 80 }, preserveAspectRatio: false },
}

class NoteView implements NodeView<BoardData> {
    private readonly dispose: Dispose
    constructor(node: EngineNode<BoardData>, context: ComponentContext, options: MediaBoardOptions, onChange: (text: string) => void) {
        this.dispose = options.mountEditor(context.contentRoot, node.data.text ?? '', onChange)
    }
    // The supplied editor owns its local draft while mounted.
    update(_node: EngineNode<BoardData>): void {}
    setGeometry(_bounds: CanvasEngineRect, _viewport: CanvasViewport): void {}
    setSelected(_selected: boolean): void {}
    setVisible(_visible: boolean): void {}
    destroy(): void {
        this.dispose()
    }
}

// A custom effect uses public drawing operations and a canvas-owned frame subscription.
class BoardPulse {
    private readonly lifetime = new Lifetime()
    constructor(context: CanvasDrawingContext, color: string) {
        const group = context.resources.createGroup({ space: 'screen', layer: context.layers.foreground })
        this.lifetime.own(() => context.resources.release(group))
        try {
            const path = context.resources.createPath(group, [{ path: 'M8 8 H100 V16 H8 Z', fill: { color } }])
            let elapsed = 0
            this.lifetime.own(context.requestFrame(delta => {
                elapsed += delta
                context.resources.updatePath(path, [{ path: 'M8 8 H100 V16 H8 Z', fill: { color, alpha: 0.5 + Math.sin(elapsed / 500) * 0.3 } }])
            }))
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }
    destroy = (): void => this.lifetime.destroy()
}

export class MediaBoard {
    readonly canvas: CanvasController
    private snapshot: SceneSnapshot<BoardData>
    private revision = 0
    private closed = false
    private mounted = false

    constructor(root: HTMLElement, options: MediaBoardOptions) {
        const image: MediaDescriptor = { key: 'photo', kind: 'image', version: '1', renditions: [{ id: 'original', mimeType: 'image/jpeg' }] }
        const video: MediaDescriptor = {
            key: 'clip',
            kind: 'video',
            version: '1',
            renditions: [{ id: 'playback', mimeType: 'video/mp4' }, ...(options.posterUrl ? [{ id: 'poster', mimeType: 'image/jpeg' }] : [])],
        }
        this.snapshot = {
            sceneKey: crypto.randomUUID(),
            revision: '0',
            edges: [],
            nodes: [
                { nodeId: 'note', type: 'note', ports: [], position: { x: 30, y: 40 }, dimensions: { width: 240, height: 120 }, data: { text: 'Your editor mounts here' } },
                { nodeId: 'photo', type: 'image', ports: [], position: { x: 320, y: 40 }, dimensions: { width: 320, height: 200 }, data: { media: image } },
                { nodeId: 'clip', type: 'video', ports: [], position: { x: 320, y: 290 }, dimensions: { width: 320, height: 200 }, data: { media: video, playback: 'playback', poster: options.posterUrl ? 'poster' : undefined } },
            ],
        }
        const registry = new NodeRegistry()
            .register<BoardData>({ type: 'note', geometry, mount: (node, context) => new NoteView(node, context, options, text => this.editNote(node.nodeId, text)) })
            .register(createImageNodeRegistration<BoardData>({ type: 'image', geometry, getMedia: node => node.data.media ?? null, radius: 12, onError: options.onError }))
            .register(createPlaybackNodeRegistration<BoardData>({
                type: 'video',
                kind: 'video',
                geometry,
                getContent: node => node.data.media ? { media: node.data.media, playbackRenditionId: node.data.playback ?? null, posterRenditionId: node.data.poster } : null,
                onElement: (_node, element) => {
                    if (element) element.controls = true
                },
                playback: { preload: 'metadata' },
                pauseWhenHidden: true,
                onError: options.onError,
            }))
        this.canvas = new CanvasController({
            root,
            scene: this.snapshot,
            registry,
            viewport: options.viewport ?? { x: 0, y: 0, zoom: 1 },
            collisions: { margin: 24 },
            mediaResolver: {
                resolve: async (media, rendition, signal) => {
                    signal.throwIfAborted()
                    const url = media.key === 'photo' ? options.imageUrl : rendition === 'poster' ? options.posterUrl : options.videoUrl
                    if (!url) throw new Error('No source supplied for this rendition')
                    // Public URLs are borrowed. An object URL resolver would revoke its URL in release.
                    return { url, release: () => {} }
                },
            },
            extensions: [{ id: 'board-pulse', mount: context => new BoardPulse(context, options.color).destroy }],
            onIntent: this.accept,
            onError: options.onError,
        })
        this.mounted = true
        if (this.revision > 0) this.canvas.setScene(this.snapshot)
    }

    getSnapshot(): SceneSnapshot<BoardData> {
        return structuredClone(this.snapshot)
    }
    destroy(): void {
        this.closed = true
        this.canvas.destroy()
    }

    private editNote(nodeId: string, text: string): void {
        if (this.closed) return
        this.snapshot = { ...this.snapshot, nodes: this.snapshot.nodes.map(node => node.nodeId === nodeId ? { ...node, data: { ...node.data, text } } : node) }
        this.publish()
    }

    private accept = (intent: CanvasIntent): void => {
        if (this.closed || intent.sceneKey !== this.snapshot.sceneKey) return
        if (intent.kind === 'geometry') {
            const changes = new Map(intent.changes.map(change => [change.nodeId, change]))
            this.snapshot = {
                ...this.snapshot,
                nodes: this.snapshot.nodes.map(node => {
                    const change = changes.get(node.nodeId)
                    return change ? applyNodeGeometry(node, change).node : node
                }),
            }
        } else if (intent.kind === 'delete') {
            this.snapshot = { ...this.snapshot, nodes: this.snapshot.nodes.filter(node => !intent.nodeIds.includes(node.nodeId)) }
        } else return
        this.publish()
    }

    private publish(): void {
        this.snapshot = { ...this.snapshot, revision: String(++this.revision) }
        if (this.mounted) this.canvas.setScene(this.snapshot)
    }
}

// Supply separate positioned roots; destroy either board without stopping the other.
export function mountTwoBoards(firstRoot: HTMLElement, secondRoot: HTMLElement, options: MediaBoardOptions): readonly [MediaBoard, MediaBoard] {
    const first = new MediaBoard(firstRoot, options)
    try {
        return [first, new MediaBoard(secondRoot, { ...options, color: '#cc6600', viewport: { x: 40, y: 20, zoom: 0.75 } })]
    } catch (error) {
        first.destroy()
        throw error
    }
}
