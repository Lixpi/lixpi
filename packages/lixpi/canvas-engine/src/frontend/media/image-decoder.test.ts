'use strict'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { ImageDecoder } from './image-decoder.ts'
import type {
    ImageDecodeRequest,
    ImageDecodeResponse,
} from './image-decode-protocol.ts'

class FakeWorker {
    onmessage: ((event: MessageEvent<ImageDecodeResponse>) => void) | null = null
    onerror: (() => void) | null = null
    postMessage = vi.fn<(request: ImageDecodeRequest) => void>()
    terminate = vi.fn()

    respond(response: ImageDecodeResponse): void {
        this.onmessage?.({ data: response } as MessageEvent<ImageDecodeResponse>)
    }

    request(index = 0): ImageDecodeRequest {
        return this.postMessage.mock.calls[index][0]
    }
}

function makeDecoder(maxWorkers = 2) {
    const workers: FakeWorker[] = []
    const decoder = new ImageDecoder({
        maxWorkers,
        workerFactory: () => {
            const worker = new FakeWorker()
            workers.push(worker)
            return worker as unknown as Worker
        },
    })
    return { workers, decoder }
}

function bitmap(): ImageBitmap {
    return { width: 10, height: 20, close: vi.fn() } as unknown as ImageBitmap
}

describe('ImageDecoder ownership and cancellation', () => {
    it('creates workers lazily and preserves request source options', async () => {
        const { decoder, workers } = makeDecoder()
        expect(workers).toHaveLength(0)
        const source = { url: 'image.png', credentials: 'include' as const, headers: { Authorization: 'example-token' } }
        const pending = decoder.decode(source)
        expect(workers[0].request()).toMatchObject({ kind: 'decode', source })
        const result = bitmap()
        workers[0].respond({ requestId: workers[0].request().requestId, bitmap: result })
        expect(await pending).toBe(result)
        expect(result.close).not.toHaveBeenCalled()
        decoder.destroy()
    })

    it('bounds the worker pool and dispatches every request', async () => {
        const { decoder, workers } = makeDecoder(2)
        const pending = Array.from({ length: 5 }, (_, index) => decoder.decode(`${index}.png`))
        expect(workers).toHaveLength(2)
        for (const worker of workers) {
            for (const [request] of worker.postMessage.mock.calls) worker.respond({ requestId: request.requestId, bitmap: bitmap() })
        }
        expect(await Promise.all(pending)).toHaveLength(5)
        decoder.destroy()
    })

    it('aborts one request without affecting others and closes late bitmaps', async () => {
        const { decoder, workers } = makeDecoder(1)
        const controller = new AbortController()
        const cancelled = decoder.decode('cancel.png', controller.signal)
        const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
        const retained = decoder.decode('retained.png')
        controller.abort()
        await rejection
        expect(workers[0].request(2)).toEqual({ kind: 'cancel', requestId: workers[0].request(0).requestId })
        const late = bitmap()
        workers[0].respond({ requestId: workers[0].request(0).requestId, bitmap: late })
        expect(late.close).toHaveBeenCalledOnce()
        const result = bitmap()
        workers[0].respond({ requestId: workers[0].request(1).requestId, bitmap: result })
        expect(await retained).toBe(result)
        decoder.destroy()
    })

    it('rejects pre-aborted work without starting a worker', async () => {
        const { decoder, workers } = makeDecoder()
        await expect(decoder.decode('image.png', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
        expect(workers).toHaveLength(0)
        decoder.destroy()
    })

    it('disposes only its own pool and rejects future work', async () => {
        const first = makeDecoder()
        const second = makeDecoder()
        const cancelled = first.decoder.decode('first.png')
        const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
        const retained = second.decoder.decode('second.png')
        first.decoder.destroy()
        first.decoder.destroy()
        await rejection
        expect(first.workers[0].terminate).toHaveBeenCalledOnce()
        expect(second.workers[0].terminate).not.toHaveBeenCalled()
        const result = bitmap()
        second.workers[0].respond({ requestId: second.workers[0].request().requestId, bitmap: result })
        expect(await retained).toBe(result)
        await expect(first.decoder.decode('late.png')).rejects.toMatchObject({ name: 'AbortError' })
        second.decoder.destroy()
    })

    it('isolates worker crashes and replaces the failed worker', async () => {
        const { decoder, workers } = makeDecoder()
        const failed = decoder.decode('failed.png')
        const rejection = expect(failed).rejects.toThrow('Image decode worker crashed')
        const retained = decoder.decode('retained.png')
        workers[0].onerror?.()
        await rejection
        const replacement = decoder.decode('replacement.png')
        expect(workers).toHaveLength(3)
        for (const worker of workers.slice(1)) worker.respond({ requestId: worker.request().requestId, bitmap: bitmap() })
        await Promise.all([retained, replacement])
        decoder.destroy()
    })
})
