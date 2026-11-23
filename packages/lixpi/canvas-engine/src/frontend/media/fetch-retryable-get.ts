const RETRY_DELAYS_MS = [200, 500, 1000, 2000] as const
const RETRYABLE_STATUS = new Set([
    502,
    503,
    504,
])

const wait = async (
    delayMs: number,
    signal?: AbortSignal | null,
): Promise<void> => {
    signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer)
            reject(signal?.reason)
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort)
            resolve()
        }, delayMs)
        signal?.addEventListener(
            'abort',
            abort,
            { once: true },
        )
    })
}

// Network failures may hide a proxy 502 when the failed CORS preflight lacks
// response headers. Limit retries to GETs and keep each caller's abort signal.
export const fetchRetryableGet = async (
    url: string,
    options: Omit<RequestInit, 'method'> = {},
): Promise<Response> => {
    const signal = options.signal
    const http = !/^[a-z][a-z\d+.-]*:/i.test(url) || /^https?:/i.test(url)
    const init = {
        ...options,
        method: 'GET',
    }

    for (const delay of RETRY_DELAYS_MS) {
        signal?.throwIfAborted()
        let response: Response | undefined

        try {
            response = await fetch(url, init)
        } catch (error) {
            if (
                !http
                || !(error instanceof TypeError)
                || signal?.aborted
            )
                throw error
        }

        if (response) {
            if (
                !http
                || !RETRYABLE_STATUS.has(response.status)
            )
                return response

            try {
                await response.body?.cancel()
            } catch {
                signal?.throwIfAborted()
            }
        }

        // Stagger concurrent snapshot and image retries.
        await wait(delay + Math.random() * delay * 0.25, signal)
    }

    signal?.throwIfAborted()

    return await fetch(url, init)
}
