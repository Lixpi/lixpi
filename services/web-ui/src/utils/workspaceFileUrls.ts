const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i
const WORKSPACE_FILE_ENDPOINT_PATTERN = /^\/api\/(?:files|images|videos)\/([^/]+)\/([^/]+)$/
const WORKSPACE_FILE_ENDPOINT_PREFIX_PATTERN = /^\/api\/(?:files|images|videos)\//

export type WorkspaceFileToken = string | false | null | undefined

export type ResolveMediaUrlOptions = {
    apiBaseUrl?: string
    base64MimeType?: string
    emptyFallback?: string
    token?: WorkspaceFileToken
}

export type ResolveAuthenticatedMediaUrlOptions = ResolveMediaUrlOptions & {
    getAuthToken?: () => Promise<WorkspaceFileToken>
}

function getUrlBase(): string {
    return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}

function parseUrl(url: string): { parsed: URL; isAbsolute: boolean } | null {
    try {
        const isAbsolute = ABSOLUTE_URL_PATTERN.test(url)
        return {
            parsed: isAbsolute ? new URL(url) : new URL(url, getUrlBase()),
            isAbsolute,
        }
    } catch {
        return null
    }
}

function stringifyUrl(parsed: URL, isAbsolute: boolean): string {
    if (isAbsolute) return parsed.toString()
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function normalizeApiBaseUrl(apiBaseUrl = ''): string {
    return apiBaseUrl.replace(/\/$/, '')
}

function isBrowserAddressableUrl(url: string): boolean {
    return url.startsWith('data:') ||
        url.startsWith('blob:') ||
        url.startsWith('/api/') ||
        url.startsWith('http')
}

export function buildWorkspaceFilePath(workspaceId: string, fileId: string): string {
    return `/api/files/${encodeURIComponent(workspaceId)}/${encodeURIComponent(fileId)}`
}

export function buildWorkspaceFilesPath(workspaceId: string): string {
    return `/api/files/${encodeURIComponent(workspaceId)}`
}

export function isWorkspaceFileEndpoint(url: string): boolean {
    const result = parseUrl(url)
    if (!result) return false
    return WORKSPACE_FILE_ENDPOINT_PREFIX_PATTERN.test(result.parsed.pathname)
}

export function isApiEndpoint(url: string): boolean {
    const result = parseUrl(url)
    if (!result) return false
    return result.parsed.pathname.startsWith('/api/')
}

export function normalizeWorkspaceFileEndpoint(url: string): string {
    const result = parseUrl(url)
    if (!result) return url

    const match = WORKSPACE_FILE_ENDPOINT_PATTERN.exec(result.parsed.pathname)
    if (!match) return url

    const [, workspaceId, fileId] = match
    if (!workspaceId || !fileId) return url

    result.parsed.pathname = buildWorkspaceFilePath(workspaceId, fileId)
    return stringifyUrl(result.parsed, result.isAbsolute)
}

export function stripAuthTokenFromUrl(url: string): string {
    const result = parseUrl(url)
    if (!result) {
        return url
            .replace(/([?&])token=[^&]*/g, '')
            .replace('?&', '?')
            .replace(/[?&]$/, '')
    }

    result.parsed.searchParams.delete('token')
    return stringifyUrl(result.parsed, result.isAbsolute)
}

export function setAuthTokenOnUrl(url: string, token: string): string {
    if (!token) return url

    const result = parseUrl(url)
    if (!result) {
        const separator = url.includes('?') ? '&' : '?'
        return `${url}${separator}token=${encodeURIComponent(token)}`
    }

    result.parsed.searchParams.set('token', token)
    return stringifyUrl(result.parsed, result.isAbsolute)
}

export function resolveApiMediaUrl(url: string, options: ResolveMediaUrlOptions = {}): string {
    const normalizedUrl = normalizeWorkspaceFileEndpoint(url)
    const token = options.token || ''

    if (normalizedUrl.startsWith('/api/')) {
        const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl)
        const sourceUrl = `${apiBaseUrl}${normalizedUrl}`
        return token ? setAuthTokenOnUrl(sourceUrl, token) : sourceUrl
    }

    if (normalizedUrl.startsWith('http') && isApiEndpoint(normalizedUrl)) {
        const sourceUrl = token ? stripAuthTokenFromUrl(normalizedUrl) : normalizedUrl
        return token ? setAuthTokenOnUrl(sourceUrl, token) : sourceUrl
    }

    return normalizedUrl
}

export function resolveMediaUrl(url: string, options: ResolveMediaUrlOptions = {}): string {
    if (!url) return options.emptyFallback ?? ''
    if (url.startsWith('data:') || url.startsWith('blob:')) return url

    const resolvedUrl = resolveApiMediaUrl(url, options)
    if (isBrowserAddressableUrl(resolvedUrl)) return resolvedUrl

    return options.base64MimeType
        ? `data:${options.base64MimeType};base64,${resolvedUrl}`
        : resolvedUrl
}

export async function resolveAuthenticatedMediaUrl(
    url: string,
    options: ResolveAuthenticatedMediaUrlOptions = {},
): Promise<string> {
    if (!url) return options.emptyFallback ?? ''
    if (url.startsWith('data:') || url.startsWith('blob:')) return url

    const normalizedUrl = normalizeWorkspaceFileEndpoint(url)
    const token = options.token || (isApiEndpoint(normalizedUrl) && options.getAuthToken
        ? await options.getAuthToken()
        : '')

    return resolveMediaUrl(normalizedUrl, { ...options, token })
}
