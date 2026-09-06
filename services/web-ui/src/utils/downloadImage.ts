// =============================================================================
// DOWNLOAD IMAGE UTILITY
//
// Downloads an image from a URL. Two strategies depending on the URL type:
//
// data: / blob: URLs  → fetch as blob, trigger download via hidden <a> anchor.
//                        These are same-origin by definition so fetch always works.
//
// HTTP(S) URLs         → Append ?download=true to the URL and navigate to it.
//                        The API responds with Content-Disposition: attachment,
//                        which triggers the browser's native save dialog.
//                        This avoids cross-origin fetch issues entirely.
//
// When a getAuthToken callback is provided, API media URLs get a freshly
// obtained token. This prevents 401 errors from expired JWTs that were baked
// into stored canvas media URLs.
// =============================================================================

import { html } from '@lixpi/ui-primitives/dom'
import {
    isApiEndpoint,
    resolveMediaUrl,
} from '$src/utils/mediaUrls.ts'

type DownloadImageOptions = {
    filename?: string
    getAuthToken?: () => Promise<string>
}

const MIME_TO_EXTENSION: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
}

const getExtensionFromMime = (mimeType: string): string => MIME_TO_EXTENSION[mimeType] ?? '.png'

const deriveFilename = (
    url: string,
    blob: Blob,
): string => {
    try {
        const pathname = new URL(url, window.location.origin).pathname
        const lastSegment = pathname.split('/').pop()

        if (
            lastSegment
            && lastSegment.includes('.')
        )
            return lastSegment
    } catch {
        // URL parsing failed — fall through to default
    }

    const ext = getExtensionFromMime(blob.type)

    return `image${ext}`
}

const appendDownloadParam = (url: string): string => {
    const separator = url.includes('?') ? '&' : '?'

    return `${url}${separator}download=true`
}

const downloadViaFetch = async (
    imageUrl: string,
    filename?: string,
): Promise<void> => {
    const response = await fetch(imageUrl)

    if (!response.ok)
        throw new Error(`Fetch failed: ${response.status}`)

    const blob = await response.blob()
    const resolvedFilename = filename ?? deriveFilename(imageUrl, blob)

    const objectUrl = URL.createObjectURL(blob)
    const anchor = html`<a
            href=${objectUrl}
            download=${resolvedFilename}
            style=${{ display: 'none' }}
        ></a>` as HTMLAnchorElement

    document.body.appendChild(anchor)
    anchor.click()

    setTimeout(() => {
        document.body.removeChild(anchor)
        URL.revokeObjectURL(objectUrl)
    }, 100)
}

const downloadViaNavigation = async (
    imageUrl: string,
    getAuthToken?: () => Promise<string>,
): Promise<void> => {
    let url = imageUrl

    // Refresh stale auth token if a token refresher is provided.
    if (
        getAuthToken
        && isApiEndpoint(url)
    ) {
        const freshToken = await getAuthToken()
        url = resolveMediaUrl(
            url,
            {
                apiBaseUrl: import.meta.env.VITE_API_URL || '',
                token: freshToken,
            },
        )
    }

    const downloadUrl = appendDownloadParam(url)

    // Use a hidden iframe so the current page isn't disrupted.
    // The server responds with Content-Disposition: attachment which
    // triggers the browser's native save dialog.
    const iframe = html`<iframe
            src=${downloadUrl}
            style=${{ display: 'none' }}
        ></iframe>` as HTMLIFrameElement
    document.body.appendChild(iframe)

    setTimeout(() => void document.body.removeChild(iframe), 30000)
}

export const downloadImage = async (
    imageUrl: string,
    options?: DownloadImageOptions,
): Promise<void> => {
    const {
        filename,
        getAuthToken,
    } = options ?? {}

    // data: and blob: URLs can be fetched without CORS issues
    if (
        imageUrl.startsWith('data:')
        || imageUrl.startsWith('blob:')
    ) {
        try {
            await downloadViaFetch(imageUrl, filename)
        } catch {
            window.open(imageUrl, '_blank')
        }

        return
    }

    // HTTP(S) URLs — navigate directly so CORS is irrelevant.
    // The API adds Content-Disposition: attachment when ?download=true is present.
    await downloadViaNavigation(imageUrl, getAuthToken)
}
