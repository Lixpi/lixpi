'use strict'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createAudioNodeHandler } from './audioNodeHandler.ts'
import { type AudioCanvasNode, type CanvasState } from '@lixpi/constants'
import AuthService from '$src/services/auth-service.ts'

const { FakeContainer, FakeGraphics, FakeTexture } = vi.hoisted(() => {
    class FakeTexture {
        public static empty = new FakeTexture(0, 0, 'empty')

        public constructor(
            public width = 0,
            public height = 0,
            private readonly id = 'texture'
        ) {}

        public destroy = vi.fn()
        public source = { autoGenerateMipmaps: false }

        public static get EMPTY(): FakeTexture {
            return FakeTexture.empty
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

    return { FakeContainer, FakeGraphics, FakeTexture }
})

vi.mock('pixi.js', () => ({
    Container: FakeContainer,
    Graphics: FakeGraphics,
    Texture: FakeTexture,
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

function makeAudioNode(overrides: Partial<AudioCanvasNode> = {}): AudioCanvasNode {
    return {
        nodeId: 'audio-1',
        type: 'audio',
        fileId: 'audio-file-id',
        workspaceId: 'workspace-1',
        src: '/api/files/audio.wav',
        dimensions: { width: 420, height: 110 },
        position: { x: 10, y: 20 },
        ...overrides,
    }
}

function makeCanvasState(node: AudioCanvasNode): CanvasState {
    return {
        sourceContext: {},
        nodes: [node],
        edges: [],
    } as CanvasState
}

// =============================================================================
// audioNodeHandler behavior
// =============================================================================

describe('audioNodeHandler', () => {
    let audioLayer: FakeContainer
    let onRender: ReturnType<typeof vi.fn>
    let onAudioElementReady: ReturnType<typeof vi.fn>

    beforeEach(() => {
        audioLayer = new FakeContainer()
        onRender = vi.fn()
        onAudioElementReady = vi.fn()
        document.body.innerHTML = ''
        vi.clearAllMocks()
        FakeTexture.empty = new FakeTexture(0, 0, 'empty')
    })

    afterEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
    })

    it('creates and reuses a shared hidden audio host', () => {
        const handler = createAudioNodeHandler({
            audioLayer,
            onRender,
            onAudioElementReady,
        })
        const audio = makeAudioNode()

        handler.upsert(audio, { x: 10, y: 20 }, makeCanvasState(audio))

        expect(audioLayer.children).toHaveLength(1)
        expect(handler.hasEntry(audio.nodeId)).toBe(true)
        expect(handler.getAudioElement(audio.nodeId)).not.toBeNull()
        expect(document.querySelector('.workspace-hidden-audio-host')).toBeTruthy()

        handler.upsert(audio, { x: 11, y: 21 }, makeCanvasState(audio))
        expect(audioLayer.children).toHaveLength(1)
        expect(document.querySelectorAll('.workspace-hidden-audio-host')).toHaveLength(1)
    })

    it('attaches authenticated srcs for /api audio assets', async () => {
        const handler = createAudioNodeHandler({
            audioLayer,
            onRender,
            onAudioElementReady,
        })
        const audio = makeAudioNode()

        handler.upsert(audio, { x: 10, y: 20 }, makeCanvasState(audio))

        const audioElement = handler.getAudioElement(audio.nodeId)!
        await vi.waitFor(() => expect(onAudioElementReady).toHaveBeenCalledTimes(1))

        expect(audioElement.src).toContain('/api/files/audio.wav?token=token')
        expect(onAudioElementReady).toHaveBeenCalledWith(audio.nodeId)
    })

    it('does not authenticate data: and blob: URLs', async () => {
        const handler = createAudioNodeHandler({
            audioLayer,
            onRender,
            onAudioElementReady,
        })
        const audio = makeAudioNode({
            nodeId: 'audio-data',
            src: 'data:audio/wav;base64,ZmFrZQ==',
        })

        handler.upsert(audio, { x: 10, y: 20 }, makeCanvasState(audio))
        const audioElement = handler.getAudioElement(audio.nodeId)!

        await vi.waitFor(() => expect(onAudioElementReady).toHaveBeenCalledWith(audio.nodeId))
        expect(AuthService.getTokenSilently).not.toHaveBeenCalled()
        expect(audioElement.getAttribute('src')).toContain('data:audio/wav;base64,ZmFrZQ==')
    })

    it('only updates audio element when source key changes', async () => {
        const handler = createAudioNodeHandler({
            audioLayer,
            onRender,
            onAudioElementReady,
        })
        const audio = makeAudioNode()

        handler.upsert(audio, { x: 10, y: 20 }, makeCanvasState(audio))
        const element = handler.getAudioElement(audio.nodeId)!
        const loadSpy = vi.spyOn(element, 'load').mockImplementation(() => undefined)
        await vi.waitFor(() => expect(onAudioElementReady).toHaveBeenCalledTimes(1))

        handler.upsert(audio, { x: 10, y: 20 }, makeCanvasState(audio))
        expect(loadSpy).toHaveBeenCalledTimes(1)

        const changed = makeAudioNode({
            src: '/api/files/audio-v2.wav',
            fileId: 'audio-file-v2',
        })
        handler.upsert(changed, { x: 10, y: 20 }, makeCanvasState(changed))

        await vi.waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(2))
        await vi.waitFor(() => expect(onAudioElementReady).toHaveBeenCalledTimes(2))
        expect(element.src).toContain('audio-v2.wav?token=token')
    })

    it('handles play / pause / toggle state transitions', async () => {
        const handler = createAudioNodeHandler({
            audioLayer,
            onRender,
            onAudioElementReady,
        })
        const audio = makeAudioNode()

        handler.upsert(audio, { x: 10, y: 20 }, makeCanvasState(audio))
        const audioElement = handler.getAudioElement(audio.nodeId)!
        let paused = true

        Object.defineProperty(audioElement, 'paused', {
            configurable: true,
            get: () => paused,
        })
        vi.spyOn(audioElement, 'play').mockImplementation(async () => {
            paused = false
        })
        const pauseSpy = vi.spyOn(audioElement, 'pause').mockImplementation(() => {
            paused = true
        })

        await handler.play(audio.nodeId)
        expect(handler.isPlaying(audio.nodeId)).toBe(true)

        handler.pause(audio.nodeId)
        expect(handler.isPlaying(audio.nodeId)).toBe(false)
        expect(pauseSpy).toHaveBeenCalled()

        await handler.toggle(audio.nodeId)
        expect(handler.isPlaying(audio.nodeId)).toBe(true)

        await handler.toggle(audio.nodeId)
        expect(handler.isPlaying(audio.nodeId)).toBe(false)
        expect(pauseSpy).toHaveBeenCalledTimes(2)
    })

    it('removes entry artifacts and clears host on destroy', () => {
        const handler = createAudioNodeHandler({
            audioLayer,
            onRender,
            onAudioElementReady,
        })
        const first = makeAudioNode()
        const second = makeAudioNode({ nodeId: 'audio-2', src: '/api/files/audio-2.wav' })

        handler.upsert(first, { x: 10, y: 20 }, makeCanvasState(first))
        handler.upsert(second, { x: 20, y: 30 }, makeCanvasState(second))
        expect(document.querySelector('.workspace-hidden-audio-host')).toBeTruthy()

        handler.destroy()

        expect(handler.hasEntry(first.nodeId)).toBe(false)
        expect(handler.hasEntry(second.nodeId)).toBe(false)
        expect(handler.getAudioElement(first.nodeId)).toBeNull()
        expect(handler.getAudioElement(second.nodeId)).toBeNull()
        expect(audioLayer.children).toHaveLength(0)
        expect(document.querySelector('.workspace-hidden-audio-host')).toBeNull()

        handler.upsert(first, { x: 10, y: 20 }, makeCanvasState(first))
        expect(handler.hasEntry(first.nodeId)).toBe(false)
        expect(document.querySelector('.workspace-hidden-audio-host')).toBeNull()
    })
})
