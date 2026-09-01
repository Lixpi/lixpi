'use strict'

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { ImageDecodeRequest } from './image-decode-protocol.ts'

async function workerScope() {
    vi.resetModules()
    const scope = {
        onmessage: null as ((event: MessageEvent<ImageDecodeRequest>) => Promise<void>) | null,
        postMessage: vi.fn(),
    }
    vi.stubGlobal('self', scope)
    await import('./image-decode-worker.ts')
    return scope
}

function message(data: ImageDecodeRequest): MessageEvent<ImageDecodeRequest> {
    return { data } as MessageEvent<ImageDecodeRequest>
}

afterEach(() => vi.unstubAllGlobals())

describe('image decode worker', () => {
    it('fetches with caller options and transfers the decoded bitmap', async () => {
        const blob = new Blob(['image'])
        const bitmap = { close: vi.fn() }
        const fetcher = vi.fn(async () => ({ ok: true, blob: async () => blob }))
        const decode = vi.fn(async () => bitmap)
        vi.stubGlobal('fetch', fetcher)
        vi.stubGlobal('createImageBitmap', decode)
        const scope = await workerScope()
        await scope.onmessage!(message({ kind: 'decode', requestId: 'one', source: { url: 'image.png', credentials: 'include', headers: { Authorization: 'example-token' } } }))
        expect(fetcher).toHaveBeenCalledWith('image.png', expect.objectContaining({ credentials: 'include', headers: { Authorization: 'example-token' }, signal: expect.any(AbortSignal) }))
        expect(decode).toHaveBeenCalledWith(blob, { imageOrientation: 'from-image' })
        expect(scope.postMessage).toHaveBeenCalledWith({ requestId: 'one', bitmap }, [bitmap])
        expect(bitmap.close).not.toHaveBeenCalled()
    })

    it('closes a bitmap completed after cancellation without posting it', async () => {
        const bitmap = { close: vi.fn() }
        let finish!: (value: typeof bitmap) => void
        const decoded = new Promise<typeof bitmap>(resolve => {
            finish = resolve
        })
        const decode = vi.fn(() => decoded)
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })))
        vi.stubGlobal('createImageBitmap', decode)
        const scope = await workerScope()
        const pending = scope.onmessage!(message({ kind: 'decode', requestId: 'one', source: { url: 'image.png' } }))
        await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
        await scope.onmessage!(message({ kind: 'cancel', requestId: 'one' }))
        finish(bitmap)
        await pending
        expect(bitmap.close).toHaveBeenCalledOnce()
        expect(scope.postMessage).not.toHaveBeenCalled()
    })

    it('reports fetch errors and omits credentials by default', async () => {
        const fetcher = vi.fn(async () => ({ ok: false, status: 404 }))
        vi.stubGlobal('fetch', fetcher)
        const scope = await workerScope()
        await scope.onmessage!(message({ kind: 'decode', requestId: 'one', source: { url: 'missing.png' } }))
        expect(fetcher).toHaveBeenCalledWith('missing.png', expect.objectContaining({ credentials: 'omit' }))
        expect(scope.postMessage).toHaveBeenCalledWith({ requestId: 'one', error: 'Image fetch failed with status 404' })
    })
})
