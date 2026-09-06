import {
    type ProviderState,
} from '../graph/state.ts'

export const createProviderCancellationError = (signal?: AbortSignal): unknown => signal?.reason ?? new DOMException(
    'Generation cancelled by user',
    'AbortError',
)

export const throwIfProviderCancelled = (
    state: Pick<ProviderState, 'cancelledByUser'>,
    signal?: AbortSignal,
): void => {
    if (
        !state.cancelledByUser
        && !signal?.aborted
    )
        return

    throw createProviderCancellationError(signal)
}

export const isProviderCancellationError = (error: unknown): boolean => {
    const candidate = error as {
        name?: unknown
        message?: unknown
    }
    const name = typeof candidate?.name === 'string' ? candidate.name : ''
    const message = typeof candidate?.message === 'string' ? candidate.message : String(error ?? '')

    return name === 'AbortError'
        || name === 'APIUserAbortError'
        || /(?:^|\b)abort(?:ed)?(?:\b|$)/iu.test(message)
}
