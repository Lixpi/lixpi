import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    buildWorkspaceFilePath,
    buildWorkspaceFilesPath,
    isWorkspaceFileEndpoint,
    isApiEndpoint,
    normalizeWorkspaceFileEndpoint,
    resolveApiMediaUrl,
    resolveMediaUrl,
    resolveAuthenticatedMediaUrl,
    setAuthTokenOnUrl,
    stripAuthTokenFromUrl,
} from './workspaceFileUrls.ts'

// =============================================================================
// BUILD / ID HELPERS
// =============================================================================

describe('workspaceFileUrls build helpers', () => {
    it('builds encoded workspace file and collection paths', () => {
        expect(buildWorkspaceFilePath('my workspace', 'my file')).toBe('/api/files/my%20workspace/my%20file')
        expect(buildWorkspaceFilesPath('my workspace')).toBe('/api/files/my%20workspace')
    })
})

// =============================================================================
// PATH DETECTION
// =============================================================================

describe('workspaceFileUrls detection', () => {
    it('identifies workspace file endpoints from absolute and relative URLs', () => {
        expect(isWorkspaceFileEndpoint('https://cdn.local/api/files/ws1/file1')).toBe(true)
        expect(isWorkspaceFileEndpoint('/api/files/ws1/file1')).toBe(true)
        expect(isWorkspaceFileEndpoint('/api/images/ws1/file1')).toBe(true)
        expect(isWorkspaceFileEndpoint('/api/videos/ws1/file1')).toBe(true)
        expect(isWorkspaceFileEndpoint('https://cdn.local/api/other/ws1/file1')).toBe(false)
        expect(isWorkspaceFileEndpoint('https://cdn.local/assets/ws1/file1')).toBe(false)
    })

    it('identifies API endpoints from absolute and relative paths', () => {
        expect(isApiEndpoint('https://cdn.local/api/files/ws1/file1')).toBe(true)
        expect(isApiEndpoint('/api/images/ws1/file1')).toBe(true)
        expect(isApiEndpoint('ws://cdn.local/api/files/ws1/file1')).toBe(true)
    })
})

// =============================================================================
// NORMALIZATION
// =============================================================================

describe('workspaceFileUrls normalization', () => {
    it('normalizes /api/images and /api/videos endpoints to /api/files', () => {
        expect(normalizeWorkspaceFileEndpoint('https://cdn.local/api/images/ws1/file1?token=abc')).toBe(
            'https://cdn.local/api/files/ws1/file1?token=abc',
        )
        expect(normalizeWorkspaceFileEndpoint('http://localhost/api/videos/ws1/file1#thumb')).toBe(
            'http://localhost/api/files/ws1/file1#thumb',
        )
    })

    it('normalizes relative endpoints to /api/files and preserves query params', () => {
        expect(normalizeWorkspaceFileEndpoint('/api/images/ws1/file1?download=true')).toBe(
            '/api/files/ws1/file1?download=true',
        )
    })

    it('leaves non-workspace endpoints untouched', () => {
        expect(normalizeWorkspaceFileEndpoint('/api/other/ws1/file1')).toBe('/api/other/ws1/file1')
        expect(normalizeWorkspaceFileEndpoint('/assets/ws1/file1')).toBe('/assets/ws1/file1')
        expect(normalizeWorkspaceFileEndpoint('/api/files/ws1')).toBe('/api/files/ws1')
    })
})

// =============================================================================
// TOKEN MANIPULATION
// =============================================================================

describe('workspaceFileUrls token helpers', () => {
    it('strips token params from URLs while preserving other query values', () => {
        expect(stripAuthTokenFromUrl('https://cdn.local/api/files/ws1/file1?download=true&token=abc&rev=1')).toBe(
            'https://cdn.local/api/files/ws1/file1?download=true&rev=1',
        )
        expect(stripAuthTokenFromUrl('/api/files/ws1/file1?download=true&token=abc&rev=1')).toBe(
            '/api/files/ws1/file1?download=true&rev=1',
        )
        expect(stripAuthTokenFromUrl('https://cdn.local/api/files/ws1/file1?token=abc')).toBe(
            'https://cdn.local/api/files/ws1/file1',
        )
    })

    it('adds or replaces token parameters', () => {
        expect(setAuthTokenOnUrl('https://cdn.local/api/files/ws1/file1?download=true', 'tok')).toBe(
            'https://cdn.local/api/files/ws1/file1?download=true&token=tok',
        )
        expect(setAuthTokenOnUrl('https://cdn.local/api/files/ws1/file1?token=old', 'new')).toBe(
            'https://cdn.local/api/files/ws1/file1?token=new',
        )
        expect(setAuthTokenOnUrl('/api/files/ws1/file1?download=true', 'tok')).toBe(
            '/api/files/ws1/file1?download=true&token=tok',
        )
        expect(setAuthTokenOnUrl('/api/files/ws1/file1', '')).toBe('/api/files/ws1/file1')
    })
})

// =============================================================================
// MEDIA URL RESOLUTION
// =============================================================================

describe('workspaceFileUrls API resolution', () => {
    it('resolves relative workspace paths against API base URL and injects token', () => {
        expect(resolveApiMediaUrl('/api/images/ws1/file1')).toBe('/api/files/ws1/file1')
        expect(resolveApiMediaUrl('/api/images/ws1/file1', { apiBaseUrl: 'https://api.example.test/' })).toBe(
            'https://api.example.test/api/files/ws1/file1',
        )
        expect(resolveApiMediaUrl('/api/images/ws1/file1', { apiBaseUrl: 'https://api.example.test', token: 'fresh' })).toBe(
            'https://api.example.test/api/files/ws1/file1?token=fresh',
        )
    })

    it('replaces existing token params on absolute API URLs', () => {
        expect(
            resolveApiMediaUrl('http://localhost:3005/api/images/ws1/file1?token=stale&download=true', { token: 'fresh' }),
        ).toBe(
            'http://localhost:3005/api/files/ws1/file1?download=true&token=fresh',
        )
    })

    it('leaves non-API URLs untouched', () => {
        expect(resolveApiMediaUrl('https://cdn.example.com/assets/file1.png')).toBe('https://cdn.example.com/assets/file1.png')
        expect(resolveApiMediaUrl('s3://bucket/object')).toBe('s3://bucket/object')
    })
})

describe('workspaceFileUrls media resolution', () => {
    it('resolves data and blob URLs without changes', () => {
        expect(resolveMediaUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
        expect(resolveMediaUrl('blob:http://localhost/fake')).toBe('blob:http://localhost/fake')
    })

    it('returns fallback for empty URLs', () => {
        expect(resolveMediaUrl('')).toBe('')
        expect(resolveMediaUrl('', { emptyFallback: 'fallback' })).toBe('fallback')
    })

    it('wraps non-browser-addressable URLs in a base64 data URI when requested', () => {
        expect(resolveMediaUrl('s3://bucket/object', { base64MimeType: 'image/png' })).toBe(
            'data:image/png;base64,s3://bucket/object',
        )
        expect(resolveMediaUrl('assets/path/file', { base64MimeType: 'image/png' })).toBe(
            'data:image/png;base64,assets/path/file',
        )
    })
})

describe('workspaceFileUrls authenticated resolution', () => {
    beforeEach(() => {
        vi.useRealTimers()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns existing values for data and blob URLs', async () => {
        const resultData = await resolveAuthenticatedMediaUrl('data:image/png;base64,abc')
        expect(resultData).toBe('data:image/png;base64,abc')

        const resultBlob = await resolveAuthenticatedMediaUrl('blob:http://localhost/fake')
        expect(resultBlob).toBe('blob:http://localhost/fake')
    })

    it('calls getAuthToken for API endpoints and injects refreshed token', async () => {
        const getAuthToken = vi.fn().mockResolvedValue('fresh-token')

        const result = await resolveAuthenticatedMediaUrl('http://localhost:3005/api/images/ws1/file1', { getAuthToken })

        expect(getAuthToken).toHaveBeenCalledOnce()
        expect(result).toBe('http://localhost:3005/api/files/ws1/file1?token=fresh-token')
    })

    it('does not call getAuthToken for non-API URLs', async () => {
        const getAuthToken = vi.fn().mockResolvedValue('fresh-token')
        const result = await resolveAuthenticatedMediaUrl('https://cdn.example.com/file.png', { getAuthToken })

        expect(getAuthToken).not.toHaveBeenCalled()
        expect(result).toBe('https://cdn.example.com/file.png')
    })

    it('uses provided token in preference to getAuthToken', async () => {
        const getAuthToken = vi.fn().mockResolvedValue('fresh-token')

        const result = await resolveAuthenticatedMediaUrl('http://localhost:3005/api/images/ws1/file1?token=stale', {
            token: 'provided',
            getAuthToken,
        })

        expect(getAuthToken).not.toHaveBeenCalled()
        expect(result).toBe('http://localhost:3005/api/files/ws1/file1?token=provided')
    })

    it('returns empty fallback when URL is empty', async () => {
        expect(await resolveAuthenticatedMediaUrl('', { emptyFallback: 'empty' })).toBe('empty')
    })

    it('propagates token retrieval failures', async () => {
        const error = new Error('token failed')
        const getAuthToken = vi.fn().mockRejectedValue(error)

        await expect(
            resolveAuthenticatedMediaUrl('http://localhost:3005/api/images/ws1/file1', { getAuthToken }),
        ).rejects.toThrow(error)
    })
})
