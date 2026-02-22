import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadImage } from './downloadImage.ts'

// =============================================================================
// SETUP
// =============================================================================

let appendChildSpy: ReturnType<typeof vi.spyOn>
let removeChildSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/fake-blob')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

// =============================================================================
// DATA / BLOB URLs — fetched as blob + anchor download
// =============================================================================

describe('downloadImage — data: and blob: URLs (fetch path)', () => {
    it('fetches a data: URL, creates a blob anchor, and clicks it', async () => {
        const blob = new Blob(['png-data'], { type: 'image/png' })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }))

        const clickSpy = vi.fn()
        vi.spyOn(document, 'createElement').mockReturnValue({ href: '', download: '', style: {}, click: clickSpy } as any)
        vi.useFakeTimers()

        await downloadImage('data:image/png;base64,iVBORw0KGgo=')

        expect(globalThis.fetch).toHaveBeenCalledWith('data:image/png;base64,iVBORw0KGgo=')
        expect(URL.createObjectURL).toHaveBeenCalled()
        expect(clickSpy).toHaveBeenCalledOnce()
        expect(appendChildSpy).toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(200)
        expect(removeChildSpy).toHaveBeenCalled()
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/fake-blob')
    })

    it('uses provided filename for data: URL', async () => {
        const blob = new Blob(['data'], { type: 'image/jpeg' })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }))

        const anchor = { href: '', download: '', style: {}, click: vi.fn() }
        vi.spyOn(document, 'createElement').mockReturnValue(anchor as any)

        await downloadImage('data:image/jpeg;base64,/9j/4AAQ', { filename: 'my-photo.jpg' })

        expect(anchor.download).toBe('my-photo.jpg')
    })

    it('derives generic filename from blob type for data: URL', async () => {
        const blob = new Blob(['data'], { type: 'image/webp' })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }))

        const anchor = { href: '', download: '', style: {}, click: vi.fn() }
        vi.spyOn(document, 'createElement').mockReturnValue(anchor as any)

        await downloadImage('data:image/webp;base64,UklGR')

        expect(anchor.download).toBe('image.webp')
    })

    it('falls back to window.open when fetch of data: URL fails', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed'))
        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

        await downloadImage('data:image/png;base64,broken')

        expect(windowOpenSpy).toHaveBeenCalledWith('data:image/png;base64,broken', '_blank')
    })

    it('handles blob: URLs the same as data: URLs', async () => {
        const blob = new Blob(['data'], { type: 'image/png' })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }))

        const clickSpy = vi.fn()
        vi.spyOn(document, 'createElement').mockReturnValue({ href: '', download: '', style: {}, click: clickSpy } as any)

        await downloadImage('blob:http://localhost/some-blob-id')

        expect(globalThis.fetch).toHaveBeenCalledWith('blob:http://localhost/some-blob-id')
        expect(clickSpy).toHaveBeenCalledOnce()
    })
})

// =============================================================================
// HTTP URLs — iframe navigation with ?download=true
// =============================================================================

describe('downloadImage — HTTP URLs (navigation path)', () => {
    it('creates a hidden iframe with ?download=true appended', async () => {
        const iframe = { style: { display: '' }, src: '' }
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as any)

        await downloadImage('http://localhost:3005/api/images/ws1/file1?token=abc')

        expect(document.createElement).toHaveBeenCalledWith('iframe')
        expect(iframe.style.display).toBe('none')
        expect(iframe.src).toBe('http://localhost:3005/api/images/ws1/file1?token=abc&download=true')
        expect(appendChildSpy).toHaveBeenCalled()
    })

    it('appends ?download=true when URL has no query params', async () => {
        const iframe = { style: { display: '' }, src: '' }
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as any)

        await downloadImage('http://localhost:3005/api/images/ws1/file1')

        expect(iframe.src).toBe('http://localhost:3005/api/images/ws1/file1?download=true')
    })

    it('does not call fetch for HTTP URLs', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
        vi.spyOn(document, 'createElement').mockReturnValue({ style: {}, src: '' } as any)

        await downloadImage('http://localhost:3005/api/images/ws1/file1?token=abc')

        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('cleans up iframe after timeout', async () => {
        const iframe = { style: { display: '' }, src: '' }
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as any)
        vi.useFakeTimers()

        await downloadImage('http://localhost:3005/api/images/ws1/file1')

        expect(removeChildSpy).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(30_000)
        expect(removeChildSpy).toHaveBeenCalledWith(iframe)
    })
})

// =============================================================================
// AUTH TOKEN REFRESH
// =============================================================================

describe('downloadImage — getAuthToken refreshes stale tokens', () => {
    it('replaces stale token= param with fresh token from getAuthToken', async () => {
        const iframe = { style: { display: '' }, src: '' }
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as any)

        const getAuthToken = vi.fn().mockResolvedValue('fresh-jwt-token')

        await downloadImage(
            'http://localhost:3005/api/images/ws1/file1?token=stale-expired-jwt',
            { getAuthToken },
        )

        expect(getAuthToken).toHaveBeenCalledOnce()
        expect(iframe.src).toBe(
            'http://localhost:3005/api/images/ws1/file1?token=fresh-jwt-token&download=true'
        )
    })

    it('does not call getAuthToken when URL has no token= param', async () => {
        const iframe = { style: { display: '' }, src: '' }
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as any)

        const getAuthToken = vi.fn().mockResolvedValue('fresh-jwt-token')

        await downloadImage(
            'http://localhost:3005/api/images/ws1/file1',
            { getAuthToken },
        )

        expect(getAuthToken).not.toHaveBeenCalled()
        expect(iframe.src).toBe('http://localhost:3005/api/images/ws1/file1?download=true')
    })

    it('does not call getAuthToken for data: URLs', async () => {
        const blob = new Blob(['data'], { type: 'image/png' })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }))
        vi.spyOn(document, 'createElement').mockReturnValue({ href: '', download: '', style: {}, click: vi.fn() } as any)

        const getAuthToken = vi.fn().mockResolvedValue('fresh-jwt-token')

        await downloadImage('data:image/png;base64,iVBORw0KGgo=', { getAuthToken })

        expect(getAuthToken).not.toHaveBeenCalled()
    })
})
