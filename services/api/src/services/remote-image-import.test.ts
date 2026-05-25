'use strict'

import { describe, expect, it } from 'vitest'

import {
    assertRemoteImageUrlIsPublic,
    isPrivateNetworkAddress,
} from './remote-image-import.ts'

describe('remote image import network safety', () => {
    it.each([
        '127.0.0.1',
        '10.2.3.4',
        '169.254.169.254',
        '172.16.0.1',
        '192.168.0.1',
        '::1',
        'fd00::1',
        'fe80::1',
        '::ffff:127.0.0.1',
    ])('rejects private or local address %s', (address) => {
        expect(isPrivateNetworkAddress(address)).toBe(true)
    })

    it.each([
        '93.184.216.34',
        '2001:4860:4860::8888',
    ])('allows a public address %s', (address) => {
        expect(isPrivateNetworkAddress(address)).toBe(false)
    })

    it('rejects loopback IPv4 and bracketed IPv6 URLs without fetching', async () => {
        await expect(assertRemoteImageUrlIsPublic(new URL('https://127.0.0.1/image.png')))
            .rejects.toThrow('Private network')
        await expect(assertRemoteImageUrlIsPublic(new URL('https://[::1]/image.png')))
            .rejects.toThrow('Private network')
    })

    it('rejects non-HTTP URLs and URLs with credentials', async () => {
        await expect(assertRemoteImageUrlIsPublic(new URL('file:///tmp/image.png')))
            .rejects.toThrow('HTTP or HTTPS')
        await expect(assertRemoteImageUrlIsPublic(new URL('https://user:password@example.com/image.png')))
            .rejects.toThrow('credentials')
    })
})
