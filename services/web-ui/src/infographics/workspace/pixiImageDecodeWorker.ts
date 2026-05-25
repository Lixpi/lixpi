type DecodeImageRequest = {
    requestId: string
    url: string
}

type DecodeImageResponse =
    | { requestId: string; bitmap: ImageBitmap }
    | { requestId: string; error: string }

self.onmessage = async (event: MessageEvent<DecodeImageRequest>) => {
    const { requestId, url } = event.data

    try {
        const response = await fetch(url, { credentials: 'omit' })
        if (!response.ok) throw new Error(`Image fetch failed with status ${response.status}`)
        const blob = await response.blob()
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
        const message: DecodeImageResponse = { requestId, bitmap }
        ;(self as any).postMessage(message, [bitmap])
    } catch (error) {
        const message: DecodeImageResponse = {
            requestId,
            error: error instanceof Error ? error.message : String(error),
        }
        ;(self as any).postMessage(message)
    }
}
