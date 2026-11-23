import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type ImageDecodeRequest,
} from './image-decode-protocol.ts'

const workerScope = async () => {
    vi.resetModules()
    const scope = {
        onmessage: null as ((event: MessageEvent<ImageDecodeRequest>) => Promise<void>) | null,
        postMessage: vi.fn(),
    }
    vi.stubGlobal('self', scope)
    await import('./image-decode-worker.ts')

    return scope
}

const message = (data: ImageDecodeRequest): MessageEvent<ImageDecodeRequest> => ({ data } as MessageEvent<ImageDecodeRequest>)

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('image decode worker', () => {
    it('fetches with caller options and transfers the decoded bitmap', async () => {
        const blob = new Blob(['image'])
        const bitmap = { close: vi.fn() }
        const fetcher = vi.fn(async () => ({
            ok: true,
            blob: async () => blob,
        }))
        const decode = vi.fn(async () => bitmap)
        vi.stubGlobal('fetch', fetcher)
        vi.stubGlobal('createImageBitmap', decode)
        const scope = await workerScope()
        await scope.onmessage!(message({
            kind: 'decode',
            requestId: 'one',
            source: {
                url: 'image.png',
                credentials: 'include',
                headers: { Authorization: 'example-token' },
            },
        }))
        expect(fetcher).toHaveBeenCalledWith('image.png', expect.objectContaining({
            credentials: 'include',
            headers: { Authorization: 'example-token' },
            signal: expect.any(AbortSignal),
        }))
        expect(decode).toHaveBeenCalledWith(blob, { imageOrientation: 'from-image' })
        expect(scope.postMessage).toHaveBeenCalledWith({
            requestId: 'one',
            bitmap,
        }, [bitmap])
        expect(bitmap.close).not.toHaveBeenCalled()
    })

    it('closes a bitmap completed after cancellation without posting it', async () => {
        const bitmap = { close: vi.fn() }
        let finish!: (value: typeof bitmap) => void
        const decoded = new Promise<typeof bitmap>(resolve => void (finish = resolve))
        const decode = vi.fn(() => decoded)
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            blob: async () => new Blob(),
        })))
        vi.stubGlobal('createImageBitmap', decode)
        const scope = await workerScope()
        const pending = scope.onmessage!(message({
            kind: 'decode',
            requestId: 'one',
            source: { url: 'image.png' },
        }))
        await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
        await scope.onmessage!(message({
            kind: 'cancel',
            requestId: 'one',
        }))
        finish(bitmap)
        await pending
        expect(bitmap.close).toHaveBeenCalledOnce()
        expect(scope.postMessage).not.toHaveBeenCalled()
    })

    it('recovers a rendition after a gateway failure and a rejected preflight', async () => {
        vi.useFakeTimers()
        const bitmap = { close: vi.fn() }
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response(null, { status: 502 }))
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(new Response(new Blob(['image'])))
        vi.stubGlobal('fetch', fetcher)
        vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
        const scope = await workerScope()
        const pending = scope.onmessage!(message({
            kind: 'decode',
            requestId: 'one',
            source: { url: 'https://api.example/rendition' },
        }))
        await vi.advanceTimersByTimeAsync(1000)
        await pending

        expect(fetcher).toHaveBeenCalledTimes(3)
        expect(scope.postMessage).toHaveBeenCalledWith({
            requestId: 'one',
            bitmap,
        }, [bitmap])
    })

    it('cancels a scheduled rendition retry when all interested views are gone', async () => {
        vi.useFakeTimers()
        const fetcher = vi.fn(async () => new Response(null, { status: 503 }))
        vi.stubGlobal('fetch', fetcher)
        const scope = await workerScope()
        const pending = scope.onmessage!(message({
            kind: 'decode',
            requestId: 'one',
            source: { url: 'https://api.example/rendition' },
        }))
        await vi.advanceTimersByTimeAsync(0)
        await scope.onmessage!(message({
            kind: 'cancel',
            requestId: 'one',
        }))
        await pending
        await vi.advanceTimersByTimeAsync(5000)
        expect(fetcher).toHaveBeenCalledOnce()
        expect(scope.postMessage).not.toHaveBeenCalled()
    })

    it.each([401, 403, 404])('does not retry HTTP %i and omits credentials by default', async status => {
        const fetcher = vi.fn(async () => ({
            ok: false,
            status,
        }))
        vi.stubGlobal('fetch', fetcher)
        const scope = await workerScope()
        await scope.onmessage!(message({
            kind: 'decode',
            requestId: 'one',
            source: { url: 'missing.png' },
        }))
        expect(fetcher).toHaveBeenCalledOnce()
        expect(fetcher).toHaveBeenCalledWith('missing.png', expect.objectContaining({ credentials: 'omit' }))
        expect(scope.postMessage).toHaveBeenCalledWith({
            requestId: 'one',
            error: `Image fetch failed with status ${status}`,
        })
    })
})
