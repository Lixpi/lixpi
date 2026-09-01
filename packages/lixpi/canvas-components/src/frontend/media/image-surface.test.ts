import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    EngineMedia,
    ImageLease,
    MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import type {
    EngineNode,
    NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import {
    NodeRegistry,
    type ComponentContext,
} from '@lixpi/canvas-engine/frontend/runtime'
import type {
    CanvasDrawingSurface,
    DrawingResources,
    ResourceHandle,
    ResourceKind,
} from '@lixpi/canvas-engine/frontend/rendering'
import {
    ImageSurface,
    type ImageSurfaceOptions,
} from './image-surface.ts'
import { createImageNodeRegistration } from './image-node.ts'

function descriptor(key: string): MediaDescriptor {
    return {
        key,
        kind: 'image',
        version: '1',
        renditions: [
            { id: 'small', mimeType: 'image/webp', width: 64, height: 64 },
            { id: 'large', mimeType: 'image/webp', width: 1024, height: 1024 },
        ],
    }
}

function fixture(options: Partial<Omit<ImageSurfaceOptions, 'surface' | 'onError'>> = {}) {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const controller = new AbortController()
    const owner = Symbol()
    let nextId = 0
    const handle = <Kind extends ResourceKind>(kind: Kind): ResourceHandle<Kind> => ({ kind, id: String(++nextId), owner })
    type Request = Parameters<EngineMedia['acquireImage']>[0]
    const requests: Array<{ request: Request; resolve: (lease: ImageLease) => void; reject: (error: unknown) => void }> = []
    const resources = {
        createGroup: vi.fn(() => handle('group')),
        createPath: vi.fn(() => handle('path')),
        createMesh: vi.fn<DrawingResources['createMesh']>(() => handle('mesh')),
        setMask: vi.fn(),
        updateGroup: vi.fn(),
        updatePath: vi.fn(),
        updateMesh: vi.fn<DrawingResources['updateMesh']>(),
        setPaint: vi.fn<DrawingResources['setPaint']>(),
        setVisible: vi.fn(),
        release: vi.fn(),
    }
    const surface: CanvasDrawingSurface = {
        resources: resources as unknown as DrawingResources,
        layers: { media: handle('layer'), foreground: handle('layer'), connectors: handle('layer') },
        media: {
            acquireImage: vi.fn(request => new Promise<ImageLease>((resolve, reject) => requests.push({ request, resolve, reject }))),
            acquirePlayback: vi.fn(),
        },
        signal: controller.signal,
        invalidate: vi.fn(),
        requestFrame: vi.fn(),
    }
    const onError = vi.fn()
    const onImageLoaded = options.onImageLoaded ?? vi.fn()
    const image = new ImageSurface({ surface, resolution: 1, ...options, onImageLoaded, onError })
    image.setGeometry({ x: 10, y: 20, width: 400, height: 200 }, { x: 0, y: 0, zoom: 1 })
    const lease = (renditionId = 'large', width = 1024, height = 1024): ImageLease => ({ texture: handle('texture'), renditionId, intrinsicSize: { width, height }, release: vi.fn() })
    return { image, resources, requests, lease, controller, surface, onError, onImageLoaded }
}

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('ImageSurface', () => {
    it('mounts rounded masks and placeholder geometry before the first image finishes', () => {
        const { image, resources } = fixture({ radius: 12 })
        expect(resources.setMask).toHaveBeenCalledOnce()
        const paths = resources.updatePath.mock.calls.map(call => call[1][0])
        expect(paths.some(shape => shape.path.startsWith('M12 0 H388 A12 12'))).toBe(true)
        expect(paths.some(shape => shape.fill?.color === '#e7eaee')).toBe(true)
        expect(resources.updateGroup).toHaveBeenLastCalledWith(expect.anything(), { position: { x: 10, y: 20 } })
        image.destroy()
    })

    it('mounts through the same registry as a caller-defined node with opaque data', async () => {
        const { image, requests, lease, surface, onError } = fixture()
        image.destroy()
        type Data = { photo: MediaDescriptor; caption: string }
        const geometry: NodeGeometryPolicy<Data> = {
            measure: node => {
                const bounds = { ...node.position, ...node.dimensions }
                return { visualBounds: bounds, hitBounds: bounds, selectionBounds: bounds, collisionBounds: bounds, connectorBounds: bounds }
            },
            movable: true,
            resize: { min: { width: 10, height: 10 }, preserveAspectRatio: true },
        }
        const onImageLoaded = vi.fn()
        const registration = createImageNodeRegistration<Data>({ type: 'photograph', geometry, getMedia: node => node.data.photo, progressive: false, onImageLoaded, onError })
        const registry = new NodeRegistry().register(registration)
        expect(registry.get('image')).toBeUndefined()
        expect(() => registry.register(registration)).toThrow('already registered')
        const node: EngineNode<Data> = { nodeId: 'one', type: 'photograph', position: { x: 10, y: 20 }, dimensions: { width: 400, height: 200 }, ports: [], data: { photo: descriptor('image'), caption: 'First caption' } }
        const context = { ...surface, contentRoot: {}, subscribeScene: vi.fn(), subscribeView: vi.fn(), mountOverlay: vi.fn() } as unknown as ComponentContext
        const view = registry.get(node.type)!.mount(node, context)
        view.setGeometry({ ...node.position, ...node.dimensions }, { x: 0, y: 0, zoom: 1 })
        view.setVisible(true)
        view.update({ ...node, data: { ...node.data, caption: 'Updated caption' } })
        expect(requests).toHaveLength(1)
        const loaded = lease()
        requests[0].resolve(loaded)
        await Promise.resolve()
        expect(onImageLoaded).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ caption: 'Updated caption' }) }), expect.anything())
        view.destroy()
        expect(loaded.release).toHaveBeenCalledOnce()
    })

    it('retains the displayed image during replacement and rejects a late superseded load', async () => {
        const { image, requests, lease, resources, onImageLoaded } = fixture({ progressive: false })
        image.setVisible(true)
        image.setMedia(descriptor('first'))
        const first = lease()
        requests[0].resolve(first)
        await Promise.resolve()
        image.setMedia(descriptor('second'))
        image.setMedia(descriptor('third'))
        expect(first.release).not.toHaveBeenCalled()
        expect(requests[1].request.signal.aborted).toBe(true)
        const stale = lease()
        requests[1].resolve(stale)
        await Promise.resolve()
        expect(stale.release).toHaveBeenCalledOnce()
        expect(resources.setPaint.mock.calls.at(-1)?.[1]).toBe(first.texture)
        const third = lease()
        requests[2].resolve(third)
        await Promise.resolve()
        expect(first.release).toHaveBeenCalledOnce()
        expect(onImageLoaded).toHaveBeenLastCalledWith(expect.objectContaining({ media: expect.objectContaining({ key: 'third' }), previousMedia: expect.objectContaining({ key: 'first' }) }))
        image.destroy()
        expect(third.release).toHaveBeenCalledOnce()
    })

    it('loads a preview then upgrades to the visible footprint without downgrading on zoom out', async () => {
        const { image, requests, lease } = fixture()
        image.setMedia(descriptor('image'))
        image.setVisible(true)
        expect(requests[0].request.visiblePixels).toEqual({ width: 1, height: 1 })
        const small = lease('small', 64, 64)
        requests[0].resolve(small)
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(250)
        expect(requests[1].request.visiblePixels).toEqual({ width: 400, height: 200 })
        const large = lease()
        requests[1].resolve(large)
        await Promise.resolve()
        expect(small.release).toHaveBeenCalledOnce()
        image.setGeometry({ x: 10, y: 20, width: 400, height: 200 }, { x: 0, y: 0, zoom: 0.1 })
        await vi.runAllTimersAsync()
        expect(requests).toHaveLength(2)
        image.destroy()
    })

    it('releases offscreen image leases and reuses mesh allocation when shown again', async () => {
        const { image, requests, lease, resources, controller } = fixture({ progressive: false })
        image.setMedia(descriptor('image'))
        image.setVisible(true)
        const loaded = lease()
        requests[0].resolve(loaded)
        await Promise.resolve()
        image.setVisible(false)
        expect(resources.setPaint.mock.calls.at(-1)?.[1]).toBeNull()
        expect(loaded.release).toHaveBeenCalledOnce()
        image.setVisible(true)
        expect(resources.createMesh).toHaveBeenCalledOnce()
        controller.abort()
        expect(requests[1].request.signal.aborted).toBe(true)
        const late = lease()
        requests[1].resolve(late)
        await Promise.resolve()
        image.destroy()
        expect(late.release).toHaveBeenCalledOnce()
        expect(resources.release).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('waits for an explicit retry after failure and never requests an absent image rendition', async () => {
        const { image, requests, onError } = fixture({ progressive: false })
        image.setVisible(true)
        image.setMedia({ ...descriptor('empty'), renditions: [] })
        expect(requests).toHaveLength(0)
        image.setMedia(descriptor('image'))
        const error = new Error('Unavailable')
        requests[0].reject(error)
        await Promise.resolve()
        expect(onError).toHaveBeenCalledExactlyOnceWith(error)
        image.setMedia(descriptor('image'))
        expect(requests).toHaveLength(1)
        image.retry()
        expect(requests).toHaveLength(2)
        image.destroy()
    })

    it('crops cover UVs without changing the node geometry', async () => {
        const { image, requests, lease, resources } = fixture({ progressive: false, fit: 'cover' })
        image.setMedia(descriptor('image'))
        image.setVisible(true)
        requests[0].resolve(lease('large', 100, 100))
        await Promise.resolve()
        const geometry = resources.updateMesh.mock.calls.at(-1)![1]
        expect(Array.from(geometry.positions)).toEqual([0, 0, 400, 0, 400, 200, 0, 200])
        expect(Array.from(geometry.uvs)).toEqual([0, 0.25, 1, 0.25, 1, 0.75, 0, 0.75])
        image.destroy()
    })
})
