type DecodeImageResponse =
    | { requestId: string; bitmap: ImageBitmap }
    | { requestId: string; error: string }

type PendingDecode = {
    resolve: (bitmap: ImageBitmap) => void
    reject: (error: Error) => void
}

let worker: Worker | null = null
let requestCounter = 0
const pending = new Map<string, PendingDecode>()

function getWorker(): Worker {
    if (worker) return worker

    const nextWorker = new Worker(new URL('./pixiImageDecodeWorker.ts', import.meta.url), { type: 'module' })
    worker = nextWorker
    nextWorker.onmessage = (event: MessageEvent<DecodeImageResponse>) => {
        const data = event.data
        const entry = pending.get(data.requestId)
        if (!entry) return
        pending.delete(data.requestId)

        if ('error' in data) {
            entry.reject(new Error(data.error))
        } else {
            entry.resolve(data.bitmap)
        }
    }
    nextWorker.onerror = () => {
        for (const [, entry] of pending) {
            entry.reject(new Error('PIXI image decode worker crashed'))
        }
        pending.clear()
        nextWorker.terminate()
        if (worker === nextWorker) {
            worker = null
        }
    }

    return nextWorker
}

export function decodeImageInWorker(url: string): Promise<ImageBitmap> {
    const requestId = `pixi-img-${++requestCounter}`
    const decodeWorker = getWorker()

    return new Promise<ImageBitmap>((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        decodeWorker.postMessage({ requestId, url })
    })
}

export function destroyPixiImageDecoder(): void {
    worker?.terminate()
    worker = null
    for (const [, entry] of pending) {
        entry.reject(new Error('PIXI image decoder destroyed'))
    }
    pending.clear()
}
