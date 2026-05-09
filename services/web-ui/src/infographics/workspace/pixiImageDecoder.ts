// How many workers to run in parallel. Six matches the typical browser
// per-origin connection limit so every available TCP slot is used for
// image fetching while multiple CPU cores handle the decode step in
// parallel (createImageBitmap is CPU-bound).
const POOL_SIZE = 6

type DecodeImageResponse =
    | { requestId: string; bitmap: ImageBitmap }
    | { requestId: string; error: string }

type PendingDecode = {
    resolve: (bitmap: ImageBitmap) => void
    reject: (error: Error) => void
    // Which worker owns this request — lets crash handler only reject
    // work assigned to the dead worker, leaving other workers unaffected.
    worker: Worker
}

let pool: Worker[] = []
let robinCursor = 0
let requestCounter = 0
const pending = new Map<string, PendingDecode>()

function spawnWorker(): Worker {
    const w = new Worker(new URL('./pixiImageDecodeWorker.ts', import.meta.url), { type: 'module' })

    w.onmessage = (event: MessageEvent<DecodeImageResponse>) => {
        const { data } = event
        const entry = pending.get(data.requestId)
        if (!entry) return
        pending.delete(data.requestId)
        if ('error' in data) {
            entry.reject(new Error(data.error))
        } else {
            entry.resolve(data.bitmap)
        }
    }

    w.onerror = () => {
        // Only reject work that was dispatched to THIS worker so that the
        // remaining pool members can finish their own in-flight requests.
        for (const [id, entry] of pending) {
            if (entry.worker !== w) continue
            entry.reject(new Error('PIXI image decode worker crashed'))
            pending.delete(id)
        }
        const idx = pool.indexOf(w)
        if (idx !== -1) pool.splice(idx, 1)
        w.terminate()
    }

    return w
}

function nextWorker(): Worker {
    // Lazily grow the pool up to POOL_SIZE on demand so cold-start pays
    // no cost when only a few images are on screen.
    if (pool.length < POOL_SIZE) {
        const w = spawnWorker()
        pool.push(w)
        return w
    }
    // Round-robin across the live pool.
    const w = pool[robinCursor % pool.length]
    robinCursor = (robinCursor + 1) % pool.length
    return w
}

export function decodeImageInWorker(url: string): Promise<ImageBitmap> {
    const requestId = `pixi-img-${++requestCounter}`
    const worker = nextWorker()
    return new Promise<ImageBitmap>((resolve, reject) => {
        pending.set(requestId, { resolve, reject, worker })
        worker.postMessage({ requestId, url })
    })
}

export function destroyPixiImageDecoder(): void {
    for (const w of pool) w.terminate()
    pool = []
    robinCursor = 0
    for (const [, entry] of pending) {
        entry.reject(new Error('PIXI image decoder destroyed'))
    }
    pending.clear()
}
