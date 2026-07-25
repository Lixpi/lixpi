import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadImage } from './downloadImage.ts'

// =============================================================================
// SETUP
// =============================================================================

type MockAnchor = {
    href: string
    download: string
    style: { [key: string]: string }
    click: ReturnType<typeof vi.fn>
}

type MockIFrame = {
    style: { [key: string]: string }
    src: string
}

let appendChildSpy: ReturnType<typeof vi.spyOn>
let removeChildSpy: ReturnType<typeof vi.spyOn>
let createObjectUrlSpy: ReturnType<typeof vi.spyOn>
let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node)
    createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/fake-blob')
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

const createMockAnchor = (): MockAnchor => ({
    href: '',
    download: '',
    style: {},
    click: vi.fn(),
})

const createMockIFrame = (): MockIFrame => ({
    style: {},
    src: '',
})

// =============================================================================
// DATA / BLOB URLs — fetched as blob + anchor download
// =============================================================================

describe('downloadImage — data: and blob: URLs (fetch path)', () => {
    it('fetches a data URL, creates a blob anchor, and clicks it', async () => {
        const blob = new Blob(['png-data'], { type: 'image/png' })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }))

        const anchor = createMockAnchor()
        vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement)
        vi.useFakeTimers()

        await downloadImage('data:image/png;base64,iVBORw0KGgo=')

        expect(globalThis.fetch).toHaveBeenCalledWith('data:image/png;base64,iVBORw0KGgo=')
        expect(createObjectUrlSpy).toHaveBeenCalledWith(blob)
        expect(anchor.click).toHaveBeenCalledOnce()
        expect(anchor.href).toBe('blob:http://localhost/fake-blob')
        expect(anchor.download).toBe('image.png')
        expect(anchor.style.display).toBe('none')
        expect(appendChildSpy).toHaveBeenCalledWith(anchor)

        await vi.advanceTimersByTimeAsync(200)
        expect(removeChildSpy).toHaveBeenCalledWith(anchor)
        expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:http://localhost/fake-blob')
    })

    it('uses provided filename for data URL downloads', async () => {
        const blob = new Blob(['data'], { type: 'image/jpeg' })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }))

        const anchor = createMockAnchor()
        vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement)

        await downloadImage('data:image/jpeg;base64,/9j/4AAQ', { filename: 'my-photo.jpg' })

        expect(anchor.download).toBe('my-photo.jpg')
    })

    it('derives a generic filename from blob MIME type when URL path has no extension', async () => {
        const blob = new Blob(['data'], { type: 'image/webp' })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }))

        const anchor = createMockAnchor()
        vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement)

        await downloadImage('data:image/webp;base64,UklGR')

        expect(anchor.download).toBe('image.webp')
    })

    it('falls back to window.open when fetch returns a non-OK response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('error', { status: 500 }))
        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

        await downloadImage('data:image/png;base64,notfound')

        expect(windowOpenSpy).toHaveBeenCalledWith('data:image/png;base64,notfound', '_blank')
    })

    it('falls back to window.open when fetch of data URL fails', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed'))
        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
        const anchor = createMockAnchor()
        vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement)

        await downloadImage('data:image/png;base64,broken')

        expect(windowOpenSpy).toHaveBeenCalledWith('data:image/png;base64,broken', '_blank')
    })

    it('handles blob: URLs the same as data: URLs', async () => {
        const blob = new Blob(['data'], { type: 'image/png' })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }))

        const anchor = createMockAnchor()
        vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement)

        await downloadImage('blob:http://localhost/some-blob-id')

        expect(anchor.click).toHaveBeenCalledOnce()
        expect(anchor.href).toBe('blob:http://localhost/fake-blob')
    })
})

// =============================================================================
// HTTP(S) URLs — iframe navigation with appended download param
// =============================================================================

describe('downloadImage — HTTP(S) URLs (navigation path)', () => {
    it('appends ?download=true and sets iframe styles for an already-tokened API URL', async () => {
        const iframe = createMockIFrame()
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as unknown as HTMLIFrameElement)

        await downloadImage('http://localhost:3005/api/images/ws1/file1?token=abc')

        expect(document.createElement).toHaveBeenCalledWith('iframe')
        expect(iframe.style.display).toBe('none')
        expect(iframe.src).toBe('http://localhost:3005/api/images/ws1/file1?token=abc&download=true')
        expect(appendChildSpy).toHaveBeenCalledWith(iframe)
    })

    it('appends ?download=true when URL has no query params', async () => {
        const iframe = createMockIFrame()
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as unknown as HTMLIFrameElement)

        await downloadImage('http://localhost:3005/api/images/ws1/file1')

        expect(iframe.src).toBe('http://localhost:3005/api/images/ws1/file1?download=true')
    })

    it('does not call fetch for HTTP URLs', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
        const iframe = createMockIFrame()
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as unknown as HTMLIFrameElement)

        await downloadImage('http://localhost:3005/api/images/ws1/file1?token=abc')

        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('removes the iframe after the cleanup timeout', async () => {
        const iframe = createMockIFrame()
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as unknown as HTMLIFrameElement)
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

describe('downloadImage — getAuthToken', () => {
    it('replaces stale token= param with fresh token from getAuthToken', async () => {
        const iframe = createMockIFrame()
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as unknown as HTMLIFrameElement)

        const getAuthToken = vi.fn().mockResolvedValue('fresh-jwt-token')

        await downloadImage(
            'http://localhost:3005/api/images/ws1/file1?token=stale-expired-jwt',
            { getAuthToken },
        )

        expect(getAuthToken).toHaveBeenCalledOnce()
        expect(iframe.src).toBe(
            'http://localhost:3005/api/images/ws1/file1?token=fresh-jwt-token&download=true',
        )
    })

    it('calls getAuthToken for API URLs even when token is missing', async () => {
        const iframe = createMockIFrame()
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as unknown as HTMLIFrameElement)

        const getAuthToken = vi.fn().mockResolvedValue('fresh-jwt-token')

        await downloadImage('http://localhost:3005/api/images/ws1/file1', { getAuthToken })

        expect(getAuthToken).toHaveBeenCalledOnce()
        expect(iframe.src).toBe('http://localhost:3005/api/images/ws1/file1?token=fresh-jwt-token&download=true')
    })

    it('passes absolute non-API URLs through without refreshing token', async () => {
        const iframe = createMockIFrame()
        vi.spyOn(document, 'createElement').mockReturnValue(iframe as unknown as HTMLIFrameElement)
        const getAuthToken = vi.fn().mockResolvedValue('fresh-jwt-token')

        await downloadImage('https://cdn.example.com/images/file1.png', { getAuthToken })

        expect(getAuthToken).not.toHaveBeenCalled()
        expect(iframe.src).toBe('https://cdn.example.com/images/file1.png?download=true')
    })
})
