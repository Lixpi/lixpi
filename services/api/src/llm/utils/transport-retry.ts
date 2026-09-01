'use strict'

import { warn } from '@lixpi/debug-tools'

// Bounded reconnect for provider transport faults — a request that never
// reached the provider, or a response that dropped before it produced a usable
// result. The backoff mirrors the NATS client loop in
// packages/lixpi/nats-service/ts/nats-service.ts (500ms, 1s, 2s, 4s, 8s, capped
// at 16s), but this loop is additionally deadline-bounded so a single provider
// operation can never stall a generation for longer than a minute.
//
// This module owns only what every provider genuinely shares: the Node socket
// layer they all reach through fetch, and user-initiated cancellation. Anything
// SDK-specific is contributed by the provider as a list of error class names,
// so this file never has to know which vendors exist. It is unrelated to the
// capability-level "automaticRetries: 0" contract, which is about never
// re-rendering a shot the provider actually returned.
const RETRY_BUDGET_MS = 60_000
const RETRY_BASE_DELAY_MS = 500
const RETRY_MAX_DELAY_MS = 16_000

export const TRANSPORT_RETRY_BUDGET_MS = RETRY_BUDGET_MS

// Node/undici socket-layer failure codes. Providers surface these either
// directly, or wrapped by their SDK in an error whose `cause` carries them —
// `fetch` in particular always reports `TypeError: fetch failed` and hides the
// real code one level down.
const SOCKET_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'EPIPE',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENETDOWN',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ERR_STREAM_PREMATURE_CLOSE',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
])

// User-initiated cancellation must never be retried, whatever layer reports it.
// Note that AWS/Smithy classifies AbortError as transient and retries it; that
// is wrong for us, because here an abort is always the user stopping the run.
const ABORT_ERROR_NAMES = new Set(['AbortError', 'APIUserAbortError'])

// Connection-failure class names shared by every Stainless-generated SDK, which
// is what both the OpenAI and the Anthropic clients are — the classes and their
// "Connection error." message are identical across the two.
export const STAINLESS_TRANSPORT_FAULT_NAMES: readonly string[] = [
    'APIConnectionError',
    'APIConnectionTimeoutError',
]

// Transient names from @smithy/service-error-classification, which the AWS SDK
// v3 clients (Bedrock) raise. AbortError is deliberately excluded — see above.
export const SMITHY_TRANSPORT_FAULT_NAMES: readonly string[] = [
    'TimeoutError',
    'RequestTimeout',
    'RequestTimeoutException',
]

// Handed to every attempt. A streaming attempt calls markPublished() as soon as
// it emits something downstream, which makes any later failure terminal — a
// restart would replay output the user has already seen.
export type TransportRetryAttempt = {
    markPublished: () => void
}

const walkCauses = (error: unknown, predicate: (candidate: Error) => boolean): boolean => {
    let current: unknown = error
    for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
        if (predicate(current)) return true
        current = current.cause
    }
    return false
}

export const isTransportFault = (error: unknown, faultNames: readonly string[] = []): boolean => {
    if (walkCauses(error, candidate => ABORT_ERROR_NAMES.has(candidate.name))) return false
    const providerNames = new Set(faultNames)
    return walkCauses(error, candidate => {
        if (providerNames.has(candidate.name)) return true
        const code = (candidate as { code?: unknown }).code
        return typeof code === 'string' && SOCKET_ERROR_CODES.has(code)
    })
}

const sleep = async (delayMs: number, signal?: AbortSignal): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, delayMs)
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

// Runs `attempt` and retries it while it keeps failing with a transport fault,
// until the retry budget would be exceeded. Any other failure — moderation,
// validation, quota, an aborted request — propagates on the first throw.
//
// Only wrap work that is safe to run again from the start; an attempt that
// publishes as it goes must call markPublished() at its first emission.
export const withTransportRetry = async <T>(args: {
    label: string
    faultNames?: readonly string[]
    signal?: AbortSignal
    shouldStop?: () => boolean
    attempt: (context: TransportRetryAttempt) => Promise<T>
}): Promise<T> => {
    const deadline = Date.now() + RETRY_BUDGET_MS
    let attemptsMade = 0
    for (;;) {
        let published = false
        try {
            return await args.attempt({
                markPublished: () => {
                    published = true
                },
            })
        } catch (error) {
            attemptsMade += 1
            if (
                published
                || args.signal?.aborted
                || args.shouldStop?.()
                || !isTransportFault(error, args.faultNames)
            ) throw error
            const delayMs = Math.min(RETRY_BASE_DELAY_MS * (2 ** (attemptsMade - 1)), RETRY_MAX_DELAY_MS)
            if (Date.now() + delayMs >= deadline) throw error
            warn(`[${args.label}] provider transport fault on attempt ${attemptsMade}; reconnecting in ${delayMs}ms: ${(error as Error)?.message ?? error}`)
            await sleep(delayMs, args.signal)
        }
    }
}
