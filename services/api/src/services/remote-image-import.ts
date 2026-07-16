'use strict'

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// SSRF guards for importing remote URLs into workspace storage. Originally part
// of the image-only import path; now the shared URL-safety layer behind the
// unified public-remote-file.ts path. Kept provider-agnostic — it validates that a
// URL resolves to a public address, nothing image-specific.

const isPrivateIPv4 = (address: string): boolean => {
    const octets = address.split('.').map(Number)
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true
    const [first, second] = octets
    return first === 0
        || first === 10
        || first === 127
        || (first === 169 && second === 254)
        || (first === 172 && second! >= 16 && second! <= 31)
        || (first === 192 && second === 168)
        || (first === 100 && second! >= 64 && second! <= 127)
        || first! >= 224
}

export const isPrivateNetworkAddress = (address: string): boolean => {
    const normalized = address.toLowerCase()
    if (isIP(normalized) === 4) return isPrivateIPv4(normalized)
    if (normalized === '::' || normalized === '::1') return true
    if (normalized.startsWith('::ffff:')) return isPrivateIPv4(normalized.substring(7))
    return normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe8')
        || normalized.startsWith('fe9')
        || normalized.startsWith('fea')
        || normalized.startsWith('feb')
}

export const assertRemoteImageUrlIsPublic = async (url: URL): Promise<void> => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only public HTTP or HTTPS URLs are supported')
    }
    if (url.username || url.password) {
        throw new Error('Remote URL credentials are not allowed')
    }
    const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '')
    if (hostname.toLowerCase() === 'localhost') {
        throw new Error('Private network URLs are not allowed')
    }

    const addresses = isIP(hostname)
        ? [{ address: hostname }]
        : await lookup(hostname, { all: true, verbatim: true })
    if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
        throw new Error('Private network URLs are not allowed')
    }
}
