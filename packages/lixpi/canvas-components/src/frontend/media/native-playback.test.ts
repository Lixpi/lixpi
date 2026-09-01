// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type EngineMedia,
    type MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import {
    type EngineNode,
    type NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import {
    NodeRegistry,
    type ComponentContext,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type ResourceHandle,
    type ResourceKind,
} from '@lixpi/canvas-engine/frontend/rendering'
import {
    NativePlayback,
    type NativePlaybackOptions,
} from './native-playback.ts'
import {
    createPlaybackNodeRegistration,
    type PlaybackContent,
} from './playback-node.ts'

type Lease = Awaited<ReturnType<EngineMedia['acquirePlayback']>>

function descriptor(key: string): MediaDescriptor {
    return { key, kind: 'video', version: '1', renditions: [{ id: 'original', mimeType: 'video/mp4' }, { id: 'poster', mimeType: 'image/webp' }] }
}

function fixture(options: Partial<NativePlaybackOptions> = {}) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const controller = new AbortController()
    const requests: Array<{ signal: AbortSignal; resolve: (lease: Lease) => void }> = []
    const media: EngineMedia = {
        acquireImage: vi.fn(),
        acquirePlayback: vi.fn((request: Parameters<EngineMedia['acquirePlayback']>[0]) => new Promise<Lease>(resolve => requests.push({ signal: request.signal, resolve }))),
    }
    const onError = vi.fn()
    const playback = new NativePlayback({ root, signal: controller.signal, media, kind: 'video', onError, ...options })
    const lease = (url: string): Lease => ({ url, release: vi.fn() })
    return { playback, requests, controller, root, lease, onError, media }
}

beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
})

describe('NativePlayback', () => {
    it('does not request missing audio sources and toggles the resolved native player', async () => {
        const { playback, requests, lease, media } = fixture({ kind: 'audio' })
        await playback.setSource(null, 'original')
        expect(media.acquirePlayback).not.toHaveBeenCalled()
        const pending = playback.setSource({ key: 'audio', version: '1', kind: 'audio', renditions: [{ id: 'original', mimeType: 'audio/mpeg' }] }, 'original')
        requests[0].resolve(lease('https://example.test/audio.mp3'))
        await pending
        Object.defineProperty(playback.element, 'paused', { configurable: true, value: true })
        await playback.toggle()
        expect(playback.element.play).toHaveBeenCalledOnce()
        Object.defineProperty(playback.element, 'paused', { configurable: true, value: false })
        const pauses = vi.mocked(playback.element.pause).mock.calls.length
        await playback.toggle()
        expect(playback.element.pause).toHaveBeenCalledTimes(pauses + 1)
        playback.destroy()
    })

    it('registers native playback and a poster as one scoped node without reading product data', async () => {
        const { playback, requests, controller, root, lease, onError, media } = fixture()
        playback.destroy()
        const owner = Symbol()
        let nextId = 0
        const handle = <Kind extends ResourceKind>(kind: Kind): ResourceHandle<Kind> => ({ kind, id: String(++nextId), owner })
        const imageLease = { texture: handle('texture'), renditionId: 'poster', intrinsicSize: { width: 640, height: 360 }, release: vi.fn() }
        media.acquireImage = vi.fn(async () => imageLease)
        const resources = {
            createGroup: vi.fn(() => handle('group')),
            createPath: vi.fn(() => handle('path')),
            createMesh: vi.fn(() => handle('mesh')),
            setMask: vi.fn(),
            setVisible: vi.fn(),
            updateGroup: vi.fn(),
            updatePath: vi.fn(),
            updateMesh: vi.fn(),
            setPaint: vi.fn(),
            release: vi.fn(),
        }
        const context = {
            resources,
            media,
            signal: controller.signal,
            contentRoot: root,
            layers: { media: handle('layer'), connectors: handle('layer'), foreground: handle('layer') },
            requestFrame: vi.fn(),
            invalidate: vi.fn(),
            subscribeScene: vi.fn(),
            subscribeView: vi.fn(),
            mountOverlay: vi.fn(),
        } as unknown as ComponentContext
        const geometry: NodeGeometryPolicy<PlaybackContent> = {
            measure: node => {
                const bounds = { ...node.position, ...node.dimensions }
                return { visualBounds: bounds, hitBounds: bounds, selectionBounds: bounds, collisionBounds: bounds, connectorBounds: bounds }
            },
            movable: true,
            resize: { min: { width: 10, height: 10 }, preserveAspectRatio: true },
        }
        const onElement = vi.fn()
        const registry = new NodeRegistry().register(createPlaybackNodeRegistration<PlaybackContent>({ type: 'clip', kind: 'video', geometry, getContent: node => node.data, onElement, onError }))
        const node: EngineNode<PlaybackContent> = {
            nodeId: 'one',
            type: 'clip',
            ports: [],
            position: { x: 10, y: 20 },
            dimensions: { width: 640, height: 360 },
            data: { media: descriptor('clip'), playbackRenditionId: 'original', posterRenditionId: 'poster' },
        }
        const view = registry.get('clip')!.mount(node, context)
        expect(onElement).toHaveBeenCalledWith(node, root.querySelector('video'))
        view.setGeometry({ ...node.position, ...node.dimensions }, { x: 0, y: 0, zoom: 1 })
        view.setVisible(true)
        const source = lease('https://example.test/clip.mp4')
        const poster = lease('https://example.test/poster.webp')
        requests[0].resolve(source)
        requests[1].resolve(poster)
        await Promise.resolve()
        expect(media.acquireImage).toHaveBeenCalledWith(expect.objectContaining({ media: expect.objectContaining({ renditions: [{ id: 'poster', mimeType: 'image/webp' }] }) }))
        controller.abort()
        view.destroy()
        expect(onElement).toHaveBeenLastCalledWith(node, null)
        expect(root.children).toHaveLength(0)
        expect(imageLease.release).toHaveBeenCalledOnce()
        expect(source.release).toHaveBeenCalledOnce()
        expect(poster.release).toHaveBeenCalledOnce()
        expect(onError).not.toHaveBeenCalled()
    })

    it('ignores replaced sources and releases their late results', async () => {
        const { playback, requests, lease } = fixture()
        const first = playback.setSource(descriptor('first'), 'original')
        const next = playback.setSource(descriptor('next'), 'original')
        expect(requests[0].signal.aborted).toBe(true)
        const stale = lease('https://example.test/stale.mp4')
        requests[0].resolve(stale)
        await first
        expect(stale.release).toHaveBeenCalledOnce()
        expect(playback.element.hasAttribute('src')).toBe(false)
        const current = lease('https://example.test/current.mp4')
        requests[1].resolve(current)
        await next
        expect(playback.element.src).toBe(current.url)
        await playback.setSource(descriptor('next'), 'original')
        expect(requests).toHaveLength(2)
        playback.destroy()
        expect(current.release).toHaveBeenCalledOnce()
    })

    it('owns independent native source and poster leases without affecting another player', async () => {
        const first = fixture()
        const second = fixture({ kind: 'audio' })
        const source = first.playback.setSource(descriptor('video'), 'original')
        const poster = first.playback.setPoster(descriptor('video'), 'poster')
        const videoLease = first.lease('https://example.test/video.mp4')
        const posterLease = first.lease('https://example.test/poster.webp')
        first.requests[0].resolve(videoLease)
        first.requests[1].resolve(posterLease)
        await Promise.all([source, poster])
        expect((first.playback.element as HTMLVideoElement).poster).toBe(posterLease.url)
        first.controller.abort()
        first.playback.destroy()
        expect(first.playback.element.isConnected).toBe(false)
        expect(videoLease.release).toHaveBeenCalledOnce()
        expect(posterLease.release).toHaveBeenCalledOnce()
        expect(second.playback.element.isConnected).toBe(true)
        expect(second.requests).toHaveLength(0)
        second.playback.destroy()
    })

    it('does not retain a source when onReady destroys the player synchronously', async () => {
        let playback: NativePlayback
        const context = fixture({ onReady: () => playback.destroy() })
        playback = context.playback
        const pending = playback.setSource(descriptor('video'), 'original')
        const source = context.lease('https://example.test/video.mp4')
        context.requests[0].resolve(source)
        await pending
        expect(source.release).toHaveBeenCalledOnce()
        expect(playback.element.isConnected).toBe(false)
        expect(context.onError).not.toHaveBeenCalled()
    })

    it('cancels a queued play when its source changes and ignores source completion after disposal', async () => {
        const { playback, requests, lease, controller } = fixture()
        const first = playback.setSource(descriptor('first'), 'original')
        const play = playback.play()
        const second = playback.setSource(descriptor('second'), 'original')
        requests[0].resolve(lease('https://example.test/first.mp4'))
        await Promise.all([first, play])
        expect(playback.element.play).not.toHaveBeenCalled()
        controller.abort()
        const late = lease('https://example.test/second.mp4')
        requests[1].resolve(late)
        await second
        expect(late.release).toHaveBeenCalledOnce()
        expect(playback.element.hasAttribute('src')).toBe(false)
    })

    it('reports intrinsic video dimensions and removes event callbacks on destruction', () => {
        const onIntrinsicSize = vi.fn()
        const { playback, onError } = fixture({ onIntrinsicSize })
        Object.defineProperties(playback.element, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } })
        playback.element.dispatchEvent(new Event('loadedmetadata'))
        expect(onIntrinsicSize).toHaveBeenCalledExactlyOnceWith({ width: 1920, height: 1080 })
        playback.destroy()
        playback.element.dispatchEvent(new Event('loadedmetadata'))
        playback.element.dispatchEvent(new Event('error'))
        expect(onIntrinsicSize).toHaveBeenCalledOnce()
        expect(onError).not.toHaveBeenCalled()
    })
})
