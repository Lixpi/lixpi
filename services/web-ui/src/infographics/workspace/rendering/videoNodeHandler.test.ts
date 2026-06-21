'use strict'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createVideoNodeHandler } from './videoNodeHandler.ts'
import { type VideoCanvasNode, type CanvasState } from '@lixpi/constants'
import { decodeImageInWorker } from '$src/infographics/workspace/pixiImageDecoder.ts'

const { FakeContainer, FakeGraphics, FakeSprite, FakeTexture } = vi.hoisted(() => {
    class FakeTexture {
        public static empty = new FakeTexture({ width: 0, height: 0 }, 'empty')
        public source = { autoGenerateMipmaps: false }

        public constructor(
            public width = 0,
            public height = 0,
            private readonly id = ''
        ) {}

        public destroy = vi.fn()

        public static get EMPTY(): FakeTexture {
            return FakeTexture.empty
        }

        public static from(bitmap: { width: number; height: number } | undefined): FakeTexture {
            return new FakeTexture(bitmap?.width ?? 0, bitmap?.height ?? 0, `bmp-${Math.random()}`)
        }
    }

    class FakeContainer {
        public children: Array<unknown> = []

        public addChild(child: unknown): unknown {
            this.children.push(child)
            return child
        }

        public removeChild(child: unknown): void {
            this.children = this.children.filter((candidate) => candidate !== child)
        }
    }

    class FakeGraphics {
        public positionX = 0
        public positionY = 0
        public position = {
            set: (x: number, y: number) => {
                this.positionX = x
                this.positionY = y
            },
        }
        public clear = vi.fn()
        public roundRect = vi.fn()
        public fill = vi.fn()
        public destroy = vi.fn()
    }

    class FakeSprite {
        public texture: FakeTexture = FakeTexture.EMPTY
        public visible = false
        public width = 0
        public height = 0
        public mask: unknown = null
        public eventMode = ''
        public positionX = 0
        public positionY = 0

        public position = {
            set: (x: number, y: number) => {
                this.positionX = x
                this.positionY = y
            },
        }

        public destroy = vi.fn()
    }

    return { FakeContainer, FakeGraphics, FakeSprite, FakeTexture }
})

vi.mock('pixi.js', () => ({
    Container: FakeContainer,
    Graphics: FakeGraphics,
    Sprite: FakeSprite,
    Texture: FakeTexture,
}))

vi.mock('$src/infographics/workspace/pixiImageDecoder.ts', () => ({
    decodeImageInWorker: vi.fn(async (source: string) => ({ width: 10, height: 20, source })),
    destroyPixiImageDecoder: vi.fn(),
}))

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: vi.fn(async () => 'token'),
    },
}))

vi.mock('$src/settings.ts', () => ({
    settings: {
        mediaNode: {
            styles: {
                borderRadius: 8,
            },
        },
    },
}))

function makeVideoNode(overrides: Partial<VideoCanvasNode> = {}): VideoCanvasNode {
    return {
        nodeId: 'video-1',
        type: 'video',
        fileId: 'video-file-id',
        posterFileId: 'poster-file-id',
        workspaceId: 'workspace-1',
        src: 'https://cdn.example/video.mp4',
        posterSrc: 'data:image/png;base64,vGVzdA==',
        aspectRatio: 16 / 9,
        durationSeconds: 6,
        hasAudio: true,
        dimensions: { width: 640, height: 360 },
        position: { x: 10, y: 20 },
        ...overrides,
    }
}

function makeCanvasState(node: VideoCanvasNode): CanvasState {
    return {
        sourceContext: {},
        nodes: [node],
        edges: [],
    } as CanvasState
}

// =============================================================================
// videoNodeHandler behavior
// =============================================================================

describe('videoNodeHandler', () => {
    let videoLayer: FakeContainer
    let onIntrinsicSize: ReturnType<typeof vi.fn>
    let onRender: ReturnType<typeof vi.fn>
    let onVideoElementReady: ReturnType<typeof vi.fn>

    beforeEach(() => {
        videoLayer = new FakeContainer()
        onIntrinsicSize = vi.fn()
        onRender = vi.fn()
        onVideoElementReady = vi.fn()
        document.body.innerHTML = ''
        vi.clearAllMocks()
        FakeTexture.empty = new FakeTexture(0, 0, 'empty')
    })

    afterEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
    })

    it('exposes an HTMLVideoElement for only owned nodes', () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const video = makeVideoNode()
        const image = { type: 'image' } as unknown as VideoCanvasNode

        expect(handler.canHandle(video)).toBe(true)
        expect(handler.canHandle(image)).toBe(false)
        expect(handler.getVideoElement(video.nodeId)).toBeNull()
        expect(handler.isPlaying(video.nodeId)).toBe(false)
        expect(handler.hasEntry(video.nodeId)).toBe(false)
    })

    it('creates and registers PIXI primitives on first upsert', () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const video = makeVideoNode()

        handler.upsert(video, { x: 10, y: 20 }, makeCanvasState(video))

        expect(videoLayer.children).toHaveLength(3)
        expect(handler.hasEntry(video.nodeId)).toBe(true)
        expect(handler.getVideoElement(video.nodeId)).not.toBeNull()
        expect(document.querySelector('.workspace-hidden-video-host')).toBeTruthy()

        const videoElement = handler.getVideoElement(video.nodeId)!
        expect(videoElement.tagName).toBe('VIDEO')
        expect(videoElement.crossOrigin).toBe('anonymous')
        expect(videoElement.getAttribute('preload')).toBe('metadata')
        expect(videoElement.preload).toBe('metadata')
        expect(onRender).toHaveBeenCalledTimes(1)
    })

    it('decodes poster assets through the shared worker path and replaces sprite texture while paused', async () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const video = makeVideoNode()

        handler.upsert(video, { x: 10, y: 20 }, makeCanvasState(video))
        const sprite = videoLayer.children[2] as FakeSprite
        await vi.waitFor(() => expect(decodeImageInWorker).toHaveBeenCalled())

        expect(decodeImageInWorker).toHaveBeenCalledWith(video.posterSrc)
        expect(sprite.texture).toBeInstanceOf(FakeTexture)
        expect((sprite.texture as FakeTexture).width).toBe(10)
        expect(videoLayer.children[0]).toBeInstanceOf(FakeGraphics)
        expect(handler.getVideoElement(video.nodeId)?.poster).toBe(video.posterSrc)
        expect(onVideoElementReady).toHaveBeenCalledWith(video.nodeId)
        expect(sprite.texture).not.toBe(FakeTexture.EMPTY)
    })

    it('does not re-fetch poster or src when source metadata is unchanged', async () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const video = makeVideoNode()

        handler.upsert(video, { x: 10, y: 20 }, makeCanvasState(video))
        await vi.waitFor(() => expect(decodeImageInWorker).toHaveBeenCalledTimes(1))
        expect(onVideoElementReady).toHaveBeenCalledTimes(1)

        handler.upsert(video, { x: 10, y: 20 }, makeCanvasState(video))
        expect(decodeImageInWorker).toHaveBeenCalledTimes(1)
        expect(onVideoElementReady).toHaveBeenCalledTimes(1)
    })

    it('updates video src and emits readiness when source changes', async () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const video = makeVideoNode({ src: 'https://cdn.example/video-v1.mp4' })

        handler.upsert(video, { x: 10, y: 20 }, makeCanvasState(video))
        await vi.waitFor(() => expect(onVideoElementReady).toHaveBeenCalledTimes(1))

        const videoElement = handler.getVideoElement(video.nodeId)!
        const loadSpy = vi.spyOn(videoElement, 'load').mockImplementation(() => undefined)

        const updated = makeVideoNode({ src: 'https://cdn.example/video-v2.mp4', posterSrc: video.posterSrc })
        handler.upsert(updated, { x: 10, y: 20 }, makeCanvasState(updated))
        await vi.waitFor(() => expect(onVideoElementReady).toHaveBeenCalledTimes(2))

        expect(videoElement.src).toContain('video-v2.mp4')
        expect(loadSpy).toHaveBeenCalled()
    })

    it('replaces poster textures and destroys prior textures when poster source changes', async () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const first = makeVideoNode({ posterSrc: 'data:image/png;base64,Zmlyc3Q=' })
        const second = makeVideoNode({ posterSrc: 'data:image/png;base64,c2Vjb25k' })

        handler.upsert(first, { x: 10, y: 20 }, makeCanvasState(first))
        await vi.waitFor(() => expect(decodeImageInWorker).toHaveBeenCalledTimes(1))
        const sprite = videoLayer.children[2] as FakeSprite
        const firstTexture = sprite.texture

        handler.upsert(second, { x: 10, y: 20 }, makeCanvasState(second))
        await vi.waitFor(() => expect(decodeImageInWorker).toHaveBeenCalledTimes(2))

        expect(sprite.texture).not.toBe(firstTexture)
        expect((firstTexture as FakeTexture).destroy).toHaveBeenCalled()
    })

    it('repositions entries and redraws geometry when live transforms change', async () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const video = makeVideoNode({ dimensions: { width: 300, height: 150 } })

        handler.upsert(video, { x: 10, y: 20 }, makeCanvasState(video))
        const sprite = videoLayer.children[2] as FakeSprite
        const mask = videoLayer.children[1] as FakeGraphics
        const colorRect = videoLayer.children[0] as FakeGraphics
        const initialClearCalls = mask.clear.mock.calls.length + colorRect.clear.mock.calls.length

        handler.setLiveTransform(video.nodeId, { x: 200, y: 400 }, { width: 300, height: 150 })
        expect(sprite.positionX).toBe(200)
        expect(sprite.positionY).toBe(400)
        expect(mask.clear).toHaveBeenCalledTimes(initialClearCalls)

        handler.setLiveTransform(video.nodeId, { x: 220, y: 420 }, { width: 360, height: 180 })
        expect(sprite.positionX).toBe(220)
        expect(sprite.positionY).toBe(420)
        expect(mask.clear).toHaveBeenCalledTimes(initialClearCalls + 1)
    })

    it('tracks playback intent through play/pause/toggle and reflects isPlaying state', async () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const video = makeVideoNode()

        handler.upsert(video, { x: 10, y: 20 }, makeCanvasState(video))

        const videoElement = handler.getVideoElement(video.nodeId)!
        let paused = true
        Object.defineProperty(videoElement, 'paused', {
            configurable: true,
            get: () => paused,
        })
        vi.spyOn(videoElement, 'play').mockImplementation(async () => {
            paused = false
        })
        const pauseSpy = vi.spyOn(videoElement, 'pause').mockImplementation(() => {
            paused = true
        })

        await handler.play(video.nodeId)
        expect(handler.isPlaying(video.nodeId)).toBe(true)

        handler.pause(video.nodeId)
        expect(handler.isPlaying(video.nodeId)).toBe(false)
        expect(pauseSpy).toHaveBeenCalled()

        await handler.toggle(video.nodeId)
        expect(handler.isPlaying(video.nodeId)).toBe(true)

        await handler.toggle(video.nodeId)
        expect(handler.isPlaying(video.nodeId)).toBe(false)
        expect(pauseSpy).toHaveBeenCalledTimes(2)
    })

    it('removes entry artifacts on remove without dropping host until destroy', () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const video = makeVideoNode()

        handler.upsert(video, { x: 10, y: 20 }, makeCanvasState(video))
        const videoElement = handler.getVideoElement(video.nodeId)!
        const pauseSpy = vi.spyOn(videoElement, 'pause').mockImplementation(() => undefined)
        const removeAttrSpy = vi.spyOn(videoElement, 'removeAttribute').mockImplementation(() => undefined)
        const loadSpy = vi.spyOn(videoElement, 'load').mockImplementation(() => undefined)

        handler.remove(video.nodeId)

        expect(handler.hasEntry(video.nodeId)).toBe(false)
        expect(handler.getVideoElement(video.nodeId)).toBeNull()
        expect(videoLayer.children).toHaveLength(0)
        expect(pauseSpy).toHaveBeenCalled()
        expect(removeAttrSpy).toHaveBeenCalledWith('src')
        expect(loadSpy).toHaveBeenCalled()
        expect(onRender).toHaveBeenCalled()
        expect(document.querySelector('.workspace-hidden-video-host')).toBeTruthy()
    })

    it('destroys all entries and removes hidden host during teardown', () => {
        const handler = createVideoNodeHandler({
            videoLayer,
            onIntrinsicSize,
            onRender,
            onVideoElementReady,
        })
        const first = makeVideoNode({ nodeId: 'video-1' })
        const second = makeVideoNode({ nodeId: 'video-2' })

        handler.upsert(first, { x: 10, y: 20 }, makeCanvasState(first))
        handler.upsert(second, { x: 30, y: 40 }, makeCanvasState(second))
        expect(handler.hasEntry(first.nodeId)).toBe(true)
        expect(handler.hasEntry(second.nodeId)).toBe(true)
        expect(document.querySelector('.workspace-hidden-video-host')).toBeTruthy()

        handler.destroy()

        expect(handler.hasEntry(first.nodeId)).toBe(false)
        expect(handler.hasEntry(second.nodeId)).toBe(false)
        expect(handler.getVideoElement(first.nodeId)).toBeNull()
        expect(handler.getVideoElement(second.nodeId)).toBeNull()
        expect(videoLayer.children).toHaveLength(0)
        expect(document.querySelector('.workspace-hidden-video-host')).toBeNull()

        handler.upsert(first, { x: 10, y: 20 }, makeCanvasState(first))
        expect(handler.hasEntry(first.nodeId)).toBe(false)
        expect(document.querySelector('.workspace-hidden-video-host')).toBeNull()
    })
})
