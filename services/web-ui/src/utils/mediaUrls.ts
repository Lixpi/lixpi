const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i

export type MediaUrlToken = string | false | null | undefined

export type ResolveMediaUrlOptions = {
    apiBaseUrl?: string
    base64MimeType?: string
    emptyFallback?: string
    token?: MediaUrlToken
}

export type ResolveAuthenticatedMediaUrlOptions = ResolveMediaUrlOptions & {
    getAuthToken?: () => Promise<MediaUrlToken>
}

const getUrlBase = (): string => typeof window === 'undefined' ? 'http://localhost' : window.location.origin

const parseUrl = (url: string): { parsed: URL; isAbsolute: boolean } | null => {
    try {
        const isAbsolute = ABSOLUTE_URL_PATTERN.test(url)
        return { parsed: isAbsolute ? new URL(url) : new URL(url, getUrlBase()), isAbsolute }
    } catch {
        return null
    }
}

const stringifyUrl = (parsed: URL, isAbsolute: boolean): string =>
    isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`

export const buildAssetRenditionPath = (assetId: string, rendition: string): string =>
    `/api/assets/${encodeURIComponent(assetId)}/renditions/${encodeURIComponent(rendition)}`

export const buildAssetUploadPath = (workspaceId: string): string =>
    `/api/assets/workspaces/${encodeURIComponent(workspaceId)}`

export const isApiEndpoint = (url: string): boolean => Boolean(parseUrl(url)?.parsed.pathname.startsWith('/api/'))

export const isAssetEndpoint = (url: string): boolean => Boolean(parseUrl(url)?.parsed.pathname.startsWith('/api/assets/'))

export function stripAuthTokenFromUrl(url: string): string {
    const result = parseUrl(url)
    if (!result) return url.replace(/([?&])token=[^&]*/g, '').replace('?&', '?').replace(/[?&]$/, '')
    result.parsed.searchParams.delete('token')
    return stringifyUrl(result.parsed, result.isAbsolute)
}

export function setAuthTokenOnUrl(url: string, token: string): string {
    if (!token) return url
    const result = parseUrl(url)
    if (!result) return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    result.parsed.searchParams.set('token', token)
    return stringifyUrl(result.parsed, result.isAbsolute)
}

export function resolveMediaUrl(url: string, options: ResolveMediaUrlOptions = {}): string {
    if (!url) return options.emptyFallback ?? ''
    if (url.startsWith('data:') || url.startsWith('blob:')) return url
    if (url.startsWith('/api/')) {
        const sourceUrl = `${(options.apiBaseUrl ?? '').replace(/\/$/, '')}${url}`
        return options.token ? setAuthTokenOnUrl(sourceUrl, String(options.token)) : sourceUrl
    }
    if (url.startsWith('http') && isApiEndpoint(url)) {
        const sourceUrl = options.token ? stripAuthTokenFromUrl(url) : url
        return options.token ? setAuthTokenOnUrl(sourceUrl, String(options.token)) : sourceUrl
    }
    if (url.startsWith('http')) return url
    return options.base64MimeType ? `data:${options.base64MimeType};base64,${url}` : url
}

export async function resolveAuthenticatedMediaUrl(
    url: string,
    options: ResolveAuthenticatedMediaUrlOptions = {},
): Promise<string> {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return resolveMediaUrl(url, options)
    const token = options.token || (isApiEndpoint(url) && options.getAuthToken ? await options.getAuthToken() : '')
    return resolveMediaUrl(url, { ...options, token })
}
