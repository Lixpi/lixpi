import type {
    AudioCanvasNode,
    CanvasNode,
    DocumentMediaCanvasNode,
    ImageCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'
import type {
    CanvasEngineRect,
    CanvasViewport,
    EngineNode,
    NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import {
    NodeRegistry,
    type ComponentContext,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import type { MediaDescriptor } from '@lixpi/canvas-engine/frontend/media'
import {
    ImageSurface,
    createImageNodeRegistration,
    createPlaybackNodeRegistration,
    type NativePlayback,
} from '@lixpi/canvas-components/media'
import { WorkspaceMediaSources } from './workspace-media-sources.ts'

export type WorkspaceMediaNode = ImageCanvasNode | VideoCanvasNode | AudioCanvasNode | DocumentMediaCanvasNode
export type WorkspaceMediaNodeData = { node: WorkspaceMediaNode; media: MediaDescriptor | null; framePending: boolean }
export type WorkspaceMediaNodesOptions = {
    sources: WorkspaceMediaSources
    radius: number
    onImageIntrinsicSize?: (info: { nodeId: string; width: number; height: number; preserveNodeGeometry?: boolean }) => void
    onVideoIntrinsicSize?: (info: { nodeId: string; width: number; height: number }) => void
    onPlaybackReady?: (nodeId: string) => void
    onError: (error: unknown) => void
}

export function isWorkspaceMediaNode(node: CanvasNode): node is WorkspaceMediaNode {
    return node.type === 'image' || node.type === 'video' || node.type === 'audio' || node.type === 'mediaDocument'
}

const geometry: NodeGeometryPolicy<WorkspaceMediaNodeData> = {
    measure: node => {
        const bounds = { ...node.position, ...node.dimensions }
        return { visualBounds: bounds, hitBounds: bounds, selectionBounds: bounds, collisionBounds: bounds, connectorBounds: bounds }
    },
    movable: true,
    resize: { min: { width: 1, height: 1 }, preserveAspectRatio: true },
}

export class WorkspaceMediaNodes {
    readonly registry = new NodeRegistry()
    private readonly players = new Map<string, NativePlayback>()
    private readonly transient = new Map<string, string>()
    private readonly assetIds = new Map<string, string>()
    private readonly promoteOriginal = new Set<string>()

    constructor(private readonly options: WorkspaceMediaNodesOptions) {
        this.registry.register<WorkspaceMediaNodeData>({ type: 'image', geometry, mount: (node, context) => new WorkspaceImageView(node, context, options) })
        this.registry.register(createImageNodeRegistration<WorkspaceMediaNodeData>({
            type: 'mediaDocument',
            geometry,
            getMedia: node => node.data.media,
            radius: options.radius,
            placeholder: { color: '#2b2b2b' },
            fit: 'contain',
            onError: options.onError,
        }))
        for (const kind of ['video', 'audio'] as const) {
            this.registry.register(createPlaybackNodeRegistration<WorkspaceMediaNodeData>({
                type: kind,
                kind,
                geometry,
                getContent: node => {
                    const media = node.data.media
                    if (!media) return null
                    return { media, playbackRenditionId: media.renditions.some(rendition => rendition.id === 'original') ? 'original' : null, posterRenditionId: kind === 'video' && media.renditions.some(rendition => rendition.id === 'poster') ? 'poster' : undefined }
                },
                image: { radius: options.radius, placeholder: { color: kind === 'video' ? '#222222' : '#1f2a30' }, fit: 'contain' },
                playback: { muted: kind === 'video', loop: kind === 'video', crossOrigin: 'anonymous', preload: 'metadata' },
                isImageVisible: node => Boolean(node.data.node.assetId),
                onPlayback: (node, playback) => {
                    if (playback) this.players.set(node.nodeId, playback)
                    else this.players.delete(node.nodeId)
                    options.onPlaybackReady?.(node.nodeId)
                },
                onReady: node => options.onPlaybackReady?.(node.nodeId),
                onIntrinsicSize: kind === 'video' ? (node, size) => options.onVideoIntrinsicSize?.({ nodeId: node.nodeId, ...size }) : undefined,
                onError: options.onError,
            }))
        }
    }

    project(node: WorkspaceMediaNode, framePending = false, forceOriginal = false): EngineNode<WorkspaceMediaNodeData> {
        const previousAssetId = this.assetIds.get(node.nodeId)
        if (previousAssetId !== undefined && previousAssetId !== node.assetId && node.type === 'image' && node.generatedBy?.conversationAssetId) this.promoteOriginal.add(node.nodeId)
        this.assetIds.set(node.nodeId, node.assetId)
        const transient = this.transient.get(node.nodeId)
        const kind = node.type === 'mediaDocument' ? 'document' : node.type
        const only = node.type === 'mediaDocument' ? ['poster'] : node.type === 'image' && (forceOriginal || this.promoteOriginal.has(node.nodeId)) ? ['original'] : undefined
        let media = this.options.sources.describeAsset(node.assetId, kind, only)
        if (node.type === 'image' && transient && (!only || !media?.renditions.length)) media = this.options.sources.describeTransient(node.nodeId, transient)
        return { nodeId: node.nodeId, type: node.type, parentId: node.parentId, position: node.position, dimensions: node.dimensions, ports: [], data: { node, media, framePending: framePending && !forceOriginal && !transient } }
    }

    setTransient(nodeId: string, url: string | null): void {
        if (url) this.transient.set(nodeId, url)
        else this.transient.delete(nodeId)
    }

    retain(nodeIds: ReadonlySet<string>): void {
        for (const id of this.assetIds.keys()) {
            if (nodeIds.has(id)) continue
            this.assetIds.delete(id)
            this.transient.delete(id)
            this.promoteOriginal.delete(id)
        }
    }

    getVideoElement(nodeId: string): HTMLVideoElement | null {
        const element = this.players.get(nodeId)?.element
        return element?.tagName === 'VIDEO' ? element as HTMLVideoElement : null
    }

    getAudioElement(nodeId: string): HTMLAudioElement | null {
        const element = this.players.get(nodeId)?.element
        return element?.tagName === 'AUDIO' ? element as HTMLAudioElement : null
    }

    hasEntry(nodeId: string): boolean {
        return this.players.has(nodeId)
    }
    async toggle(nodeId: string): Promise<void> {
        await this.players.get(nodeId)?.toggle()
    }
    async play(nodeId: string): Promise<void> {
        await this.players.get(nodeId)?.play()
    }
    pause(nodeId: string): void {
        this.players.get(nodeId)?.pause()
    }
    isPlaying(nodeId: string): boolean {
        return this.players.get(nodeId)?.isPlaying ?? false
    }

    clear(): void {
        this.transient.clear()
        this.assetIds.clear()
        this.promoteOriginal.clear()
        this.players.clear()
    }
}

class WorkspaceImageView implements NodeView<WorkspaceMediaNodeData> {
    private readonly image: ImageSurface
    private decoded = false
    private framePending: boolean | null = null
    private node: EngineNode<WorkspaceMediaNodeData>

    constructor(node: EngineNode<WorkspaceMediaNodeData>, context: ComponentContext, options: WorkspaceMediaNodesOptions) {
        this.node = node
        this.image = new ImageSurface({
            surface: context,
            radius: options.radius,
            minimumLoadZoom: 0.1,
            onError: options.onError,
            onImageLoaded: image => {
                const preserveNodeGeometry = this.decoded && this.node.data.node.type === 'image' && Boolean(this.node.data.node.generatedBy)
                this.decoded = true
                options.onImageIntrinsicSize?.({ nodeId: this.node.nodeId, ...image.intrinsicSize, preserveNodeGeometry })
            },
        })
        try {
            this.update(node)
        } catch (error) {
            this.image.destroy()
            throw error
        }
    }

    update(node: EngineNode<WorkspaceMediaNodeData>): void {
        this.node = node
        if (this.framePending !== node.data.framePending) {
            this.framePending = node.data.framePending
            this.image.setPlaceholder(this.framePending ? null : { color: '#e7eaee', alpha: 0.85 })
        }
        this.image.setMedia(this.framePending ? null : node.data.media)
    }

    setGeometry(bounds: CanvasEngineRect, viewport: CanvasViewport): void {
        this.image.setGeometry(bounds, viewport)
    }
    setSelected(): void {}
    setVisible(visible: boolean): void {
        this.image.setVisible(visible)
    }
    prefetch(): Promise<void> {
        return this.image.prefetch()
    }
    destroy(): void {
        this.image.destroy()
    }
}
