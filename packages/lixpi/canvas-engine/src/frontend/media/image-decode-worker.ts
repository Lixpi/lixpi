import {
    type ImageDecodeRequest,
    type ImageDecodeResponse,
} from './image-decode-protocol.ts'

type ImageDecodeWorkerScope = {
    onmessage: ((event: MessageEvent<ImageDecodeRequest>) => void) | null
    postMessage: (
        message: ImageDecodeResponse,
        transfer?: Transferable[],
    ) => void
}
const worker = self as unknown as ImageDecodeWorkerScope
const active = new Map<string, AbortController>()

worker.onmessage = async (event: MessageEvent<ImageDecodeRequest>) => {
    const request = event.data

    if (request.kind === 'cancel') {
        active.get(request.requestId)?.abort()
        active.delete(request.requestId)

        return
    }

    const {
        requestId,
        source,
    } = request
    const controller = new AbortController()
    active.set(requestId, controller)
    let bitmap: ImageBitmap | null = null

    try {
        const response = await fetch(
            source.url,
            {
                credentials: source.credentials ?? 'omit',
                headers: source.headers,
                signal: controller.signal,
            },
        )

        if (!response.ok)
            throw new Error(`Image fetch failed with status ${response.status}`)

        const blob = await response.blob()
        controller.signal.throwIfAborted()
        bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
        controller.signal.throwIfAborted()
        worker.postMessage({
            requestId,
            bitmap,
        } satisfies ImageDecodeResponse, [bitmap])
        bitmap = null
    } catch (error) {
        if (!controller.signal.aborted)
            worker.postMessage({
                requestId,
                error: error instanceof Error ? error.message : String(error),
            } satisfies ImageDecodeResponse)
    } finally {
        bitmap?.close()

        if (active.get(requestId) === controller)
            active.delete(requestId)
    }
}
