import {
    type AudioCanvasNode,
    type CanvasNode,
    type CanvasCollaborationPresence,
    type DocumentMediaCanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    type EngineNode,
    type NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import { NodeRegistry } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import {
    createImageNodeRegistration,
    createPlaybackNodeRegistration,
    type NativePlayback,
} from '@lixpi/canvas-components/media'
import {
    type WorkspaceMediaSources,
} from './workspace-media-sources.ts'

export type WorkspaceMediaNode = ImageCanvasNode | VideoCanvasNode | AudioCanvasNode | DocumentMediaCanvasNode
export type WorkspaceMediaNodeData = {
    node: WorkspaceMediaNode
    media: MediaDescriptor | null
    framePending: boolean
}
type PlaybackView = NonNullable<CanvasCollaborationPresence['playback']>
type MediaElement = HTMLVideoElement | HTMLAudioElement
const playbackEvents = ['play', 'pause', 'ended', 'seeked', 'ratechange', 'volumechange', 'timeupdate', 'loadedmetadata'] as const

export type WorkspaceMediaNodesOptions = {
    sources: WorkspaceMediaSources
    radius: number
    backgroundColor?: string
    onImageIntrinsicSize?: (info: {
        nodeId: string
        width: number
        height: number
        preserveNodeGeometry?: boolean
    }) => void
    onVideoIntrinsicSize?: (info: {
        nodeId: string
        width: number
        height: number
    }) => void
    onPlaybackReady?: (nodeId: string) => void
    onPlaybackPresence?: (
        playback: CanvasCollaborationPresence['playback'],
        terminal: boolean,
    ) => void
    onError: (error: unknown) => void
}

export const isWorkspaceMediaNode = (node: CanvasNode): node is WorkspaceMediaNode =>
    node.type === 'image' || node.type === 'video' || node.type === 'audio' || node.type === 'mediaDocument'

const geometry: NodeGeometryPolicy<WorkspaceMediaNodeData> = {
    measure: node => {
        const bounds = {
            ...node.position,
            ...node.dimensions,
        }

        return {
            visualBounds: bounds,
            hitBounds: bounds,
            selectionBounds: bounds,
            collisionBounds: bounds,
            connectorBounds: bounds,
        }
    },
    movable: true,
    resize: {
        min: {
            width: 1,
            height: 1,
        },
        preserveAspectRatio: true,
    },
}

export class WorkspaceMediaNodes {
    readonly registry = new NodeRegistry()
    private readonly players = new Map<string, NativePlayback>()
    private readonly unwatchPlayer = new Map<string, () => void>()
    private following = false
    private followedPlayback: PlaybackView | null = null
    private savedPlayback: PlaybackView | null = null
    private requestedPlay: MediaElement | null = null
    private publishedPlayerId: string | null = null
    private fullscreenPlayerId: string | null = null
    private readonly transient = new Map<string, string>()
    private readonly assetIds = new Map<string, string>()
    private readonly promoteOriginal = new Set<string>()

    constructor(private readonly options: WorkspaceMediaNodesOptions) {
        for (const kind of ['image', 'mediaDocument'] as const) {
            this.registry.register(
                createImageNodeRegistration<WorkspaceMediaNodeData>({
                    type: kind,
                    geometry,
                    getMedia: node => kind === 'image'
                        && node.data.framePending
                        ? null
                        : node.data.media,
                    getStyle: node => ({
                        radius: options.radius,
                        placeholder: kind === 'image'
                            && node.data.framePending
                            ? null
                            : {
                                color: options.backgroundColor ?? (kind === 'image' ? '#e7eaee' : '#2b2b2b'),
                                alpha: kind === 'image' ? 0.85 : 1,
                            },
                    }),
                    fit: kind === 'image' ? 'stretch' : 'contain',
                    minimumLoadZoom: kind === 'image' ? 0.1 : undefined,
                    onImageLoaded: kind === 'image' ? (node, image) => options.onImageIntrinsicSize?.({
                        nodeId: node.nodeId,
                        ...image.intrinsicSize,
                        preserveNodeGeometry: !image.initialLoad
                            && node.data.node.type === 'image'
                            && Boolean(node.data.node.generatedBy),
                    }) : undefined,
                    onError: options.onError,
                }),
            )
        }

        for (const kind of ['video', 'audio'] as const) {
            this.registry.register(
                createPlaybackNodeRegistration<WorkspaceMediaNodeData>({
                    type: kind,
                    kind,
                    geometry,
                    getContent: node => {
                        const media = node.data.media

                        if (!media)
                            return null

                        return {
                            media,
                            playbackRenditionId: media.renditions.some(rendition => rendition.id === 'original') ? 'original' : null,
                            posterRenditionId: kind === 'video'
                                && media.renditions.some(rendition => rendition.id === 'poster')
                                ? 'poster'
                                : undefined,
                        }
                    },
                    image: {
                        radius: options.radius,
                        placeholder: { color: kind === 'video' ? '#222222' : '#1f2a30' },
                        fit: 'contain',
                    },
                    getImageStyle: () => ({
                        radius: options.radius,
                        placeholder: { color: options.backgroundColor ?? (kind === 'video' ? '#222222' : '#1f2a30') },
                    }),
                    playback: {
                        muted: kind === 'video',
                        loop: kind === 'video',
                        crossOrigin: 'anonymous',
                        preload: 'metadata',
                    },
                    isImageVisible: node => Boolean(node.data.node.assetId),
                    onPlayback: (node, playback) => {
                        this.setPlayer(node.nodeId, playback)

                        options.onPlaybackReady?.(node.nodeId)
                    },
                    onReady: node => {
                        this.reflectPlayback(node.nodeId, true)
                        options.onPlaybackReady?.(node.nodeId)
                    },
                    onIntrinsicSize: kind === 'video' ? (node, size) => options.onVideoIntrinsicSize?.({
                        nodeId: node.nodeId,
                        ...size,
                    }) : undefined,
                    onError: options.onError,
                }),
            )
        }
    }

    project(
        node: WorkspaceMediaNode,
        framePending = false,
        forceOriginal = false,
    ): EngineNode<WorkspaceMediaNodeData> {
        const previousAssetId = this.assetIds.get(node.nodeId)

        if (
            previousAssetId !== undefined
            && previousAssetId !== node.assetId
            && node.type === 'image'
            && node.generatedBy?.conversationAssetId
        )
            this.promoteOriginal.add(node.nodeId)

        this.assetIds.set(node.nodeId, node.assetId)
        const transient = this.transient.get(node.nodeId)
        const kind = node.type === 'mediaDocument' ? 'document' : node.type
        const only = node.type === 'mediaDocument'
            ? ['poster']
            : node.type === 'image'
                && (forceOriginal || this.promoteOriginal.has(node.nodeId))
                ? ['original']
                : undefined
        let media = this.options.sources.describeAsset(
            node.assetId,
            kind,
            only,
        )

        if (
            node.type === 'image'
            && transient
            && (!only || !media?.renditions.length)
        )
            media = this.options.sources.describeTransient(node.nodeId, transient)

        return {
            nodeId: node.nodeId,
            type: node.type,
            parentId: node.parentId,
            position: node.position,
            dimensions: node.dimensions,
            ports: [],
            data: {
                node,
                media,
                framePending: framePending && !forceOriginal && !transient,
            },
        }
    }

    refreshTheme(style: Pick<WorkspaceMediaNodesOptions, 'radius' | 'backgroundColor'>): void {
        this.options.radius = style.radius
        this.options.backgroundColor = style.backgroundColor
    }

    setTransient(
        nodeId: string,
        url: string | null,
    ): void {
        if (url)
            this.transient.set(nodeId, url)
        else
            this.transient.delete(nodeId)
    }

    retain(nodeIds: ReadonlySet<string>): void {
        for (const id of this.assetIds.keys()) {
            if (nodeIds.has(id))
                continue

            this.assetIds.delete(id)
            this.transient.delete(id)
            this.promoteOriginal.delete(id)
        }
    }

    private setPlayer(
        nodeId: string,
        player: NativePlayback | null,
    ): void {
        this.unwatchPlayer.get(nodeId)?.()
        this.unwatchPlayer.delete(nodeId)

        if (!player) {
            this.players.delete(nodeId)

            if (this.publishedPlayerId === nodeId) {
                this.publishedPlayerId = null
                this.options.onPlaybackPresence?.(null, true)
            }

            return
        }

        this.players.set(nodeId, player)

        if (!this.options.onPlaybackPresence)
            return

        const listener = (event: Event) => {
            if (event.type === 'loadedmetadata') {
                this.reflectPlayback(nodeId, true)

                return
            }

            if (
                this.following
                || (event.type === 'timeupdate' && this.publishedPlayerId !== nodeId)
            )
                return

            this.publishedPlayerId = nodeId
            const terminal = event.type !== 'timeupdate' && event.type !== 'volumechange'
            this.options.onPlaybackPresence?.(
                this.readPlayback(nodeId, player.element),
                terminal,
            )
        }

        const document = player.element.ownerDocument
        const fullscreen = () => {
            const active = document.fullscreenElement === player.element

            if (
                this.following
                || (!active && this.fullscreenPlayerId !== nodeId)
            )
                return

            this.fullscreenPlayerId = active ? nodeId : null
            this.publishedPlayerId = nodeId
            this.options.onPlaybackPresence?.(
                this.readPlayback(nodeId, player.element),
                true,
            )
        }

        for (const event of playbackEvents)
            player.element.addEventListener(event, listener)

        document.addEventListener('fullscreenchange', fullscreen)

        this.unwatchPlayer.set(nodeId, () => {
            for (const event of playbackEvents)
                player.element.removeEventListener(event, listener)

            document.removeEventListener('fullscreenchange', fullscreen)
        })
        this.reflectPlayback(nodeId)
    }

    private readPlayback(
        nodeId: string,
        element: MediaElement,
    ): PlaybackView {
        return {
            nodeId,
            time: element.currentTime,
            paused: element.paused || element.ended,
            rate: element.playbackRate,
            volume: element.volume,
            muted: element.muted,
            fullscreen: element.ownerDocument.fullscreenElement === element,
        }
    }

    setFollowedPlayback(
        following: boolean,
        state: CanvasCollaborationPresence['playback'],
    ): void {
        const saved = this.savedPlayback
        this.following = following
        this.followedPlayback = following ? (state ?? null) : null

        if (
            saved
            && saved.nodeId !== this.followedPlayback?.nodeId
        ) {
            this.savedPlayback = null
            this.requestedPlay = null
            const player = this.players.get(saved.nodeId)

            if (player)
                this.applyPlayback(
                    player,
                    saved,
                    true,
                )
        }

        if (this.followedPlayback)
            this.reflectPlayback(this.followedPlayback.nodeId)
    }

    private reflectPlayback(
        nodeId: string,
        retry = false,
    ): void {
        const state = this.followedPlayback
        const player = this.players.get(nodeId)

        if (
            !player
            || state?.nodeId !== nodeId
        )
            return

        this.savedPlayback ??= this.readPlayback(nodeId, player.element)
        this.applyPlayback(
            player,
            state,
            retry,
        )
    }

    private applyPlayback(
        player: NativePlayback,
        state: PlaybackView,
        retry: boolean,
    ): void {
        const element = player.element
        const tolerance = state.paused ? 0.025 : 0.3

        if (element.playbackRate !== state.rate)
            element.playbackRate = state.rate

        if (element.volume !== state.volume)
            element.volume = state.volume

        if (element.muted !== state.muted)
            element.muted = state.muted

        if (
            element.readyState
            && Math.abs(element.currentTime - state.time) > tolerance
        )
            element.currentTime = Number.isFinite(element.duration) ? Math.min(state.time, element.duration) : state.time

        if (state.paused) {
            this.requestedPlay = null

            if (player.isPlaying)
                player.pause()
        } else if (
            !player.isPlaying
            && (retry || this.requestedPlay !== element)
        ) {
            this.requestedPlay = element
            void player.play()
        }
    }

    getVideoElement(nodeId: string): HTMLVideoElement | null {
        const element = this.players.get(nodeId)?.element

        return element?.tagName === 'VIDEO' ? (element as HTMLVideoElement) : null
    }

    getAudioElement(nodeId: string): HTMLAudioElement | null {
        const element = this.players.get(nodeId)?.element

        return element?.tagName === 'AUDIO' ? (element as HTMLAudioElement) : null
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

        for (const stop of this.unwatchPlayer.values())
            stop()

        this.unwatchPlayer.clear()
        this.followedPlayback = null
        this.savedPlayback = null
        this.requestedPlay = null
        this.publishedPlayerId = null
        this.fullscreenPlayerId = null
        this.following = false
        this.players.clear()
    }
}
