import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { CanvasMedia } from './canvas-media.ts'
import {
    type MediaDescriptor,
    type MediaSourceResolver,
} from './types.ts'

const decoder = vi.hoisted(() => ({ decode: vi.fn(), destroy: vi.fn() }))
vi.mock('./image-decoder.ts', () => ({
    ImageDecoder: class {
        decode = decoder.decode
        destroy = decoder.destroy
    },
}))

const descriptor: MediaDescriptor = {
    key: 'photo',
    kind: 'image',
    version: '1',
    renditions: [{ id: 'small', width: 256, height: 256, mimeType: 'image/png' }, { id: 'full', width: 1024, height: 1024, mimeType: 'image/png' }],
}

function deferred<Value>() {
    let resolve!: (value: Value) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<Value>((yes, no) => {
        resolve = yes
        reject = no
    })
    return { promise, resolve, reject }
}

function bitmap(width = 256) {
    return { width, height: width, close: vi.fn() } as unknown as ImageBitmap
}

function fixture(maxTextures = 2) {
    const releaseSource = vi.fn()
    const resolve = vi.fn(async () => ({ url: 'https://media.example.test/photo', request: { headers: { Authorization: 'test' } }, release: releaseSource }))
    const releases: Array<ReturnType<typeof vi.fn>> = []
    const createTexture = vi.fn((image: ImageBitmap) => {
        const release = vi.fn(() => image.close())
        releases.push(release)
        return { texture: { kind: 'texture' as const, id: `image-${releases.length}`, owner: Symbol() }, release }
    })
    const media = new CanvasMedia({ resolver: { resolve }, createTexture, cache: { maxTextures } })
    const acquire = (signal = new AbortController().signal, source = descriptor, pixels = 100) => media.acquireImage({ media: source, visiblePixels: { width: pixels, height: pixels }, signal })
    return { media, acquire, resolve, releaseSource, createTexture, releases }
}

beforeEach(() => {
    vi.resetAllMocks()
    decoder.decode.mockImplementation(async () => bitmap())
})

describe('canvas media ownership', () => {
    it('shares a decode while allowing one waiting consumer to cancel independently', async () => {
        const pending = deferred<ImageBitmap>()
        decoder.decode.mockReturnValue(pending.promise)
        const { media, acquire, resolve, releaseSource, createTexture } = fixture()
        const first = new AbortController()
        const firstResult = acquire(first.signal)
        const secondResult = acquire()
        const cancelled = expect(firstResult).rejects.toMatchObject({ name: 'AbortError' })
        first.abort()
        await cancelled
        expect(resolve).toHaveBeenCalledOnce()
        const decodeSignal = decoder.decode.mock.calls[0][1] as AbortSignal
        expect(decodeSignal.aborted).toBe(false)
        pending.resolve(bitmap())
        const second = await secondResult
        expect(createTexture).toHaveBeenCalledOnce()
        expect(releaseSource).toHaveBeenCalledOnce()
        second.release()
        media.destroy()
    })

    it('closes a late bitmap when the last pending interest is cancelled', async () => {
        const pending = deferred<ImageBitmap>()
        decoder.decode.mockReturnValue(pending.promise)
        const { media, acquire, createTexture, releaseSource } = fixture()
        const controller = new AbortController()
        const result = acquire(controller.signal)
        await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledOnce())
        const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' })
        controller.abort()
        await cancelled
        const image = bitmap()
        pending.resolve(image)
        await vi.waitFor(() => expect(image.close).toHaveBeenCalledOnce())
        expect(createTexture).not.toHaveBeenCalled()
        expect(releaseSource).toHaveBeenCalledOnce()
        media.destroy()
    })

    it('reuses a decoded larger rendition when zooming out and separates content versions', async () => {
        decoder.decode.mockImplementation(async () => bitmap(1024))
        const { media, acquire, resolve } = fixture()
        const full = await acquire(undefined, descriptor, 900)
        full.release()
        const zoomedOut = await acquire()
        expect(zoomedOut.texture).toBe(full.texture)
        expect(zoomedOut.renditionId).toBe('full')
        expect(resolve).toHaveBeenCalledOnce()
        const replacement = await acquire(undefined, { ...descriptor, version: '2' })
        expect(replacement.texture).not.toBe(full.texture)
        expect(resolve).toHaveBeenCalledTimes(2)
        zoomedOut.release()
        replacement.release()
        media.destroy()
    })

    it('evicts idle textures under budget pressure without releasing a live lease', async () => {
        const { media, acquire, releases } = fixture(1)
        const first = await acquire()
        const second = await acquire(undefined, { ...descriptor, key: 'second' })
        expect(releases[0]).not.toHaveBeenCalled()
        expect(releases[1]).not.toHaveBeenCalled()
        first.release()
        first.release()
        expect(releases[0]).toHaveBeenCalledOnce()
        expect(releases[1]).not.toHaveBeenCalled()
        second.release()
        media.destroy()
        expect(releases[1]).toHaveBeenCalledOnce()
    })

    it('releases a failed source and allows an explicit retry', async () => {
        decoder.decode.mockRejectedValueOnce(new Error('decode failed'))
        const { media, acquire, releaseSource } = fixture()
        await expect(acquire()).rejects.toThrow('decode failed')
        const lease = await acquire()
        expect(releaseSource).toHaveBeenCalledTimes(2)
        lease.release()
        media.destroy()
    })

    it('aborts only the disposed scope and releases remaining leases on canvas disposal', async () => {
        const { media, releases } = fixture(0)
        const firstScope = new AbortController()
        const secondScope = new AbortController()
        const request = { media: descriptor, visiblePixels: { width: 100, height: 100 }, signal: new AbortController().signal }
        const first = await media.scoped(firstScope.signal).acquireImage(request)
        const second = await media.scoped(secondScope.signal).acquireImage(request)
        expect(first.texture).toBe(second.texture)
        firstScope.abort()
        expect(releases[0]).not.toHaveBeenCalled()
        media.destroy()
        expect(releases[0]).toHaveBeenCalledOnce()
        await expect(media.acquireImage(request)).rejects.toMatchObject({ name: 'AbortError' })
        expect(decoder.destroy).toHaveBeenCalledOnce()
    })

    it('releases a playback source that resolves after disposal', async () => {
        const pending = deferred<Awaited<ReturnType<MediaSourceResolver['resolve']>>>()
        const release = vi.fn()
        const media = new CanvasMedia({
            resolver: { resolve: () => pending.promise },
            createTexture: () => {
                throw new Error('No texture expected')
            },
        })
        const playback = media.acquirePlayback({ media: { ...descriptor, kind: 'video' }, renditionId: 'full', signal: new AbortController().signal })
        media.destroy()
        pending.resolve({ url: 'blob:movie', release })
        await expect(playback).rejects.toMatchObject({ name: 'AbortError' })
        expect(release).toHaveBeenCalledOnce()
    })
})
