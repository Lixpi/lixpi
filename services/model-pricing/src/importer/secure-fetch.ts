'use strict'

import { lookup } from 'node:dns/promises'
import { Buffer } from 'node:buffer'

const MAX_REDIRECTS = 3

export class ProviderSourceError extends Error {
    constructor(readonly reason: 'provider-source-too-large' | 'provider-source-invalid', message: string) {
        super(message)
    }
}

const isPrivateAddress = (address: string): boolean => {
    const normalized = address.toLowerCase()
    const octets = normalized.split('.').map(Number)
    const isIpv4 = octets.length === 4 && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    if (isIpv4) {
        const [first, second] = octets
        return first === 0
            || first === 10
            || first === 127
            || first! >= 224
            || (first === 100 && second! >= 64 && second! <= 127)
            || (first === 169 && second === 254)
            || (first === 172 && second! >= 16 && second! <= 31)
            || (first === 192 && (second === 0 || second === 168))
            || (first === 198 && (second === 18 || second === 19 || second === 51))
            || (first === 203 && second === 0)
    }
    return normalized === '::1'
        || normalized === '::'
        || normalized.startsWith('::ffff:')
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80:')
        || normalized.startsWith('2001:db8:')
}

const assertAllowedUrl = async (url: URL, allowedOrigins: ReadonlySet<string>): Promise<void> => {
    if (url.protocol !== 'https:' || !allowedOrigins.has(url.origin) || url.username || url.password) {
        throw new ProviderSourceError('provider-source-invalid', `Disallowed provider source URL: ${url.origin}`)
    }

    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new ProviderSourceError('provider-source-invalid', `Provider source resolves to a prohibited address: ${url.hostname}`)
    }
}

export const fetchAllowlistedText = async ({
    url,
    allowedOrigins,
    maxBytes,
}: {
    url: string
    allowedOrigins: ReadonlySet<string>
    maxBytes: number
}): Promise<{ text: string; resolvedUrl: string }> => {
    let current = new URL(url)

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
        await assertAllowedUrl(current, allowedOrigins)
        const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location')
            if (!location) throw new ProviderSourceError('provider-source-invalid', 'Provider response redirected without a location')
            current = new URL(location, current)
            continue
        }

        if (!response.ok || !response.body) {
            throw new ProviderSourceError('provider-source-invalid', `Provider source returned HTTP ${response.status}`)
        }

        const declaredLength = Number(response.headers.get('content-length') ?? '0')
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
            throw new ProviderSourceError('provider-source-too-large', `Provider source exceeds ${maxBytes} byte limit`)
        }

        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let receivedBytes = 0
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            receivedBytes += value.byteLength
            if (receivedBytes > maxBytes) {
                await reader.cancel()
                throw new ProviderSourceError('provider-source-too-large', `Provider source exceeds ${maxBytes} byte limit`)
            }
            chunks.push(value)
        }

        return { text: new TextDecoder().decode(Buffer.concat(chunks)), resolvedUrl: current.toString() }
    }

    throw new ProviderSourceError('provider-source-invalid', 'Provider source exceeded redirect limit')
}
