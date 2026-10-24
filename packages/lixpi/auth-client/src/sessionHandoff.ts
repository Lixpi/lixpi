const HANDOFF_PARAMETER = 'auth'
const HANDOFF_VALUE = 'continue'
const ACCOUNT_PARAMETER = 'auth_account'
const ACCOUNT_HINT = /^[a-f0-9]{32}\.[a-f0-9]{64}$/

export type SessionHandoff = {
    accountHint: string | null
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

const hashAccount = async (
    userId: string,
    nonce: string,
): Promise<string> => hex(
    new Uint8Array(await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${nonce}:${userId}`),
    )),
)

// A random salt keeps links from carrying a stable account identifier. This
// hint can only invalidate a cached session; it never authenticates anyone.
export const createSessionAccountHint = async (userId: string): Promise<string> => {
    const nonce = hex(
        crypto.getRandomValues(
            new Uint8Array(16),
        ),
    )

    return `${nonce}.${await hashAccount(userId, nonce)}`
}

export const matchesSessionAccount = async (
    handoff: SessionHandoff,
    userId: string,
): Promise<boolean> => {
    if (
        !handoff.accountHint
        || !ACCOUNT_HINT.test(handoff.accountHint)
    )
        return false

    const [nonce, expected] = handoff.accountHint.split('.')

    return (await hashAccount(userId, nonce)) === expected
}

// This is a navigation intent, never proof of authentication. The receiving
// application starts its own SDK transaction and obtains its own tokens.
export const createSessionHandoffUrl = (
    destination: string,
    accountHint?: string,
): string => {
    const url = new URL(destination)

    if (
        url.username
        || url.password
        || !['http:', 'https:'].includes(url.protocol)
    )
        throw new Error('Invalid application destination')

    url.searchParams.set(HANDOFF_PARAMETER, HANDOFF_VALUE)
    url.searchParams.delete(ACCOUNT_PARAMETER)

    if (
        accountHint
        && ACCOUNT_HINT.test(accountHint)
    )
        url.searchParams.set(ACCOUNT_PARAMETER, accountHint)

    return url.href
}

export const consumeSessionHandoff = (): SessionHandoff | null => {
    const url = new URL(window.location.href)

    if (url.searchParams.get(HANDOFF_PARAMETER) !== HANDOFF_VALUE)
        return null

    const accountHint = url.searchParams.get(ACCOUNT_PARAMETER)
    url.searchParams.delete(HANDOFF_PARAMETER)
    url.searchParams.delete(ACCOUNT_PARAMETER)
    window.history.replaceState(
        {},
        document.title,
        `${url.pathname}${url.search}${url.hash}`,
    )

    // A callback must finish (or fail) normally. Never turn a denied callback
    // into another authorization attempt, even if its URL contains a marker.
    if (
        url.searchParams.has('code')
        || url.searchParams.has('error')
        || url.searchParams.has('state')
    )
        return null

    return { accountHint }
}
