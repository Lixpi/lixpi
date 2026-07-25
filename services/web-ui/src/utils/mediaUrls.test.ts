'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    buildAssetRenditionPath,
    buildAssetUploadPath,
    isApiEndpoint,
    isAssetEndpoint,
    resolveAuthenticatedMediaUrl,
    resolveMediaUrl,
    setAuthTokenOnUrl,
    stripAuthTokenFromUrl,
} from './mediaUrls.ts'

// =============================================================================
// PATH BUILDERS
// =============================================================================

describe('mediaUrls path builders', () => {
    it('builds an encoded asset rendition path', () => {
        expect(buildAssetRenditionPath('asset 1', 'thumb nail')).toBe(
            '/api/assets/asset%201/renditions/thumb%20nail',
        )
    })

    it('builds an encoded asset upload path', () => {
        expect(buildAssetUploadPath('my workspace')).toBe('/api/assets/workspaces/my%20workspace')
    })
})

// =============================================================================
// PATH DETECTION
// =============================================================================

describe('mediaUrls detection', () => {
    it('identifies API endpoints from relative and absolute URLs', () => {
        expect(isApiEndpoint('/api/assets/asset-1')).toBe(true)
        expect(isApiEndpoint('https://cdn.local/api/assets/asset-1')).toBe(true)
        expect(isApiEndpoint('https://cdn.local/assets/asset-1')).toBe(false)
        expect(isApiEndpoint('not a url')).toBe(false)
    })

    it('identifies asset endpoints specifically, not just any /api/ path', () => {
        expect(isAssetEndpoint('/api/assets/asset-1/renditions/original')).toBe(true)
        expect(isAssetEndpoint('/api/other/asset-1')).toBe(false)
    })
})

// =============================================================================
// TOKEN MANIPULATION
// =============================================================================

describe('mediaUrls token helpers', () => {
    it('strips token params from absolute and relative URLs while preserving other query values', () => {
        expect(stripAuthTokenFromUrl('https://cdn.local/api/assets/a1?download=true&token=abc&rev=1')).toBe(
            'https://cdn.local/api/assets/a1?download=true&rev=1',
        )
        expect(stripAuthTokenFromUrl('/api/assets/a1?download=true&token=abc&rev=1')).toBe(
            '/api/assets/a1?download=true&rev=1',
        )
        expect(stripAuthTokenFromUrl('https://cdn.local/api/assets/a1?token=abc')).toBe(
            'https://cdn.local/api/assets/a1',
        )
    })

    it('adds or replaces token parameters', () => {
        expect(setAuthTokenOnUrl('https://cdn.local/api/assets/a1?download=true', 'tok')).toBe(
            'https://cdn.local/api/assets/a1?download=true&token=tok',
        )
        expect(setAuthTokenOnUrl('https://cdn.local/api/assets/a1?token=old', 'new')).toBe(
            'https://cdn.local/api/assets/a1?token=new',
        )
        expect(setAuthTokenOnUrl('/api/assets/a1?download=true', 'tok')).toBe(
            '/api/assets/a1?download=true&token=tok',
        )
    })

    it('returns the URL unchanged when the token is empty', () => {
        expect(setAuthTokenOnUrl('/api/assets/a1', '')).toBe('/api/assets/a1')
    })
})

// =============================================================================
// SYNCHRONOUS MEDIA RESOLUTION
// =============================================================================

describe('mediaUrls resolveMediaUrl', () => {
    it('returns data and blob URLs unchanged', () => {
        expect(resolveMediaUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
        expect(resolveMediaUrl('blob:http://localhost/fake')).toBe('blob:http://localhost/fake')
    })

    it('returns the empty fallback for empty URLs', () => {
        expect(resolveMediaUrl('')).toBe('')
        expect(resolveMediaUrl('', { emptyFallback: 'fallback' })).toBe('fallback')
    })

    it('prefixes relative /api/ paths with the API base URL and injects a token', () => {
        expect(resolveMediaUrl('/api/assets/a1')).toBe('/api/assets/a1')
        expect(resolveMediaUrl('/api/assets/a1', { apiBaseUrl: 'https://api.example.test/' })).toBe(
            'https://api.example.test/api/assets/a1',
        )
        expect(resolveMediaUrl('/api/assets/a1', { apiBaseUrl: 'https://api.example.test', token: 'fresh' })).toBe(
            'https://api.example.test/api/assets/a1?token=fresh',
        )
    })

    it('replaces an existing token on an absolute API URL', () => {
        expect(
            resolveMediaUrl('http://localhost:3005/api/assets/a1?token=stale&download=true', { token: 'fresh' }),
        ).toBe('http://localhost:3005/api/assets/a1?download=true&token=fresh')
    })

    it('leaves absolute non-API http(s) URLs untouched even when a token is supplied', () => {
        expect(resolveMediaUrl('https://cdn.example.com/file.png', { token: 'fresh' })).toBe(
            'https://cdn.example.com/file.png',
        )
    })

    it('wraps non-browser-addressable strings in a base64 data URI when requested', () => {
        expect(resolveMediaUrl('s3://bucket/object', { base64MimeType: 'image/png' })).toBe(
            'data:image/png;base64,s3://bucket/object',
        )
        expect(resolveMediaUrl('rawbase64payload', { base64MimeType: 'image/png' })).toBe(
            'data:image/png;base64,rawbase64payload',
        )
    })

    it('returns raw non-URL strings unchanged when no base64 MIME type is given', () => {
        expect(resolveMediaUrl('rawbase64payload')).toBe('rawbase64payload')
    })
})

// =============================================================================
// AUTHENTICATED MEDIA RESOLUTION
// =============================================================================

describe('mediaUrls resolveAuthenticatedMediaUrl', () => {
    beforeEach(() => {
        vi.useRealTimers()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns data and blob URLs unchanged without calling getAuthToken', async () => {
        const getAuthToken = vi.fn().mockResolvedValue('fresh-token')

        expect(await resolveAuthenticatedMediaUrl('data:image/png;base64,abc', { getAuthToken })).toBe(
            'data:image/png;base64,abc',
        )
        expect(await resolveAuthenticatedMediaUrl('blob:http://localhost/fake', { getAuthToken })).toBe(
            'blob:http://localhost/fake',
        )
        expect(getAuthToken).not.toHaveBeenCalled()
    })

    it('calls getAuthToken for API endpoints and injects the refreshed token', async () => {
        const getAuthToken = vi.fn().mockResolvedValue('fresh-token')

        const result = await resolveAuthenticatedMediaUrl('http://localhost:3005/api/assets/a1', { getAuthToken })

        expect(getAuthToken).toHaveBeenCalledOnce()
        expect(result).toBe('http://localhost:3005/api/assets/a1?token=fresh-token')
    })

    it('does not call getAuthToken for non-API URLs', async () => {
        const getAuthToken = vi.fn().mockResolvedValue('fresh-token')
        const result = await resolveAuthenticatedMediaUrl('https://cdn.example.com/file.png', { getAuthToken })

        expect(getAuthToken).not.toHaveBeenCalled()
        expect(result).toBe('https://cdn.example.com/file.png')
    })

    it('uses a provided token in preference to getAuthToken', async () => {
        const getAuthToken = vi.fn().mockResolvedValue('fresh-token')

        const result = await resolveAuthenticatedMediaUrl('http://localhost:3005/api/assets/a1?token=stale', {
            token: 'provided',
            getAuthToken,
        })

        expect(getAuthToken).not.toHaveBeenCalled()
        expect(result).toBe('http://localhost:3005/api/assets/a1?token=provided')
    })

    it('returns the empty fallback when the URL is empty', async () => {
        expect(await resolveAuthenticatedMediaUrl('', { emptyFallback: 'empty' })).toBe('empty')
    })

    it('propagates token retrieval failures', async () => {
        const error = new Error('token failed')
        const getAuthToken = vi.fn().mockRejectedValue(error)

        await expect(
            resolveAuthenticatedMediaUrl('http://localhost:3005/api/assets/a1', { getAuthToken }),
        ).rejects.toThrow(error)
    })
})
