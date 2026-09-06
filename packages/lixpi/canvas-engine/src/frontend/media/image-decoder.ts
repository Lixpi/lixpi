import {
    type ImageDecodeRequest,
    type ImageDecodeResponse,
    type ImageSourceRequest,
} from './image-decode-protocol.ts'

export type ImageDecoderOptions = {
    maxWorkers?: number
    workerFactory?: () => Worker
}

type PendingDecode = {
    worker: Worker
    resolve: (bitmap: ImageBitmap) => void
    reject: (error: unknown) => void
    cleanup: () => void
}

export class ImageDecoder {
    private readonly workers: Worker[] = []
    private readonly pending = new Map<string, PendingDecode>()
    private readonly maxWorkers: number
    private readonly workerFactory: () => Worker
    private cursor = 0
    private counter = 0
    private destroyed = false

    constructor(options: ImageDecoderOptions = {}) {
        this.maxWorkers = options.maxWorkers ?? 6

        if (
            !Number.isInteger(this.maxWorkers)
            || this.maxWorkers < 1
        )
            throw new RangeError('maxWorkers must be a positive integer')

        this.workerFactory = options.workerFactory ?? (() => new Worker(
            new URL('./image-decode-worker.ts', import.meta.url),
            { type: 'module' },
        ))
    }

    async decode(
        source: string | ImageSourceRequest,
        signal?: AbortSignal,
    ): Promise<ImageBitmap> {
        if (this.destroyed)
            throw new DOMException('Image decoder destroyed', 'AbortError')

        signal?.throwIfAborted()
        const worker = this.nextWorker()
        const requestId = `image-${++this.counter}`

        return new Promise<ImageBitmap>((resolve, reject) => {
            const abort = () => {
                const entry = this.take(requestId)

                if (!entry)
                    return

                entry.reject(signal?.reason ?? new DOMException('Image decode cancelled', 'AbortError'))

                try {
                    worker.postMessage({
                        kind: 'cancel',
                        requestId,
                    } satisfies ImageDecodeRequest)
                } catch {
                    // A crashed worker cannot receive cancellation; its late output is discarded.
                }
            }
            this.pending.set(
                requestId,
                {
                    worker,
                    resolve,
                    reject,
                    cleanup: () => signal?.removeEventListener('abort', abort),
                },
            )
            signal?.addEventListener(
                'abort',
                abort,
                { once: true },
            )

            try {
                worker.postMessage(
                    {
                        kind: 'decode',
                        requestId,
                        source: typeof source === 'string' ? { url: source } : source,
                    } satisfies ImageDecodeRequest,
                )
            } catch (error) {
                this.take(requestId)?.reject(error)
            }
        })
    }

    private take(requestId: string): PendingDecode | undefined {
        const entry = this.pending.get(requestId)

        if (!entry)
            return

        this.pending.delete(requestId)
        entry.cleanup()

        return entry
    }

    private nextWorker(): Worker {
        if (this.workers.length < this.maxWorkers) {
            const worker = this.workerFactory()
            worker.onmessage = (event: MessageEvent<ImageDecodeResponse>) => {
                const data = event.data
                const pending = this.pending.get(data.requestId)

                if (
                    !pending
                    || pending.worker !== worker
                ) {
                    if ('bitmap' in data)
                        data.bitmap.close()

                    return
                }

                const entry = this.take(data.requestId)!

                if ('error' in data)
                    entry.reject(
                        new Error(data.error),
                    )
                else
                    entry.resolve(data.bitmap)
            }
            worker.onerror = () => {
                for (const [id, entry] of this.pending) {
                    if (entry.worker === worker)
                        this.take(id)?.reject(
                            new Error('Image decode worker crashed'),
                        )
                }

                const index = this.workers.indexOf(worker)

                if (index !== -1)
                    this.workers.splice(index, 1)

                worker.terminate()
            }
            this.workers.push(worker)

            return worker
        }

        const worker = this.workers[this.cursor % this.workers.length]
        this.cursor = (this.cursor + 1) % this.workers.length

        return worker
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true

        for (const id of this.pending.keys())
            this.take(id)?.reject(
                new DOMException('Image decoder destroyed', 'AbortError'),
            )

        for (const worker of this.workers)
            worker.terminate()

        this.workers.length = 0
    }
}
