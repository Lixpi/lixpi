import type { Asset } from '@lixpi/constants'
import type { WorkspaceCanvasHost } from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    buildAssetRenditionPath,
    buildAssetUploadPath,
    resolveAuthenticatedMediaUrl,
    resolveMediaUrl,
    type MediaUrlToken,
} from '$src/utils/mediaUrls.ts'

type MediaPorts = WorkspaceCanvasHost['media']
export type WorkspaceMediaAdapterPorts = {
    apiBaseUrl: string
    getToken: () => Promise<MediaUrlToken>
    getAsset: (assetId: string) => Asset | undefined
    fetch: typeof fetch
}

export class WorkspaceMediaAdapter implements MediaPorts {
    readonly sources: MediaPorts['sources']

    constructor(private readonly ports: WorkspaceMediaAdapterPorts) {
        this.sources = {
            getAsset: ports.getAsset,
            resolveAssetRendition: ({ assetId, renditionId, signal }) => this.resolveSource(buildAssetRenditionPath(assetId, renditionId), signal),
            resolveTransientSource: this.resolveSource,
        }
    }

    renditionPath = buildAssetRenditionPath

    private resolveSource = async (source: string, signal: AbortSignal) => {
        signal.throwIfAborted()
        const url = await resolveAuthenticatedMediaUrl(source, { apiBaseUrl: this.ports.apiBaseUrl, getAuthToken: this.ports.getToken })
        signal.throwIfAborted()
        return { url, release: () => {} }
    }

    prepareRenditionUrls: MediaPorts['prepareRenditionUrls'] = async () => {
        const token = await this.ports.getToken()
        return (assetId, rendition) => resolveMediaUrl(buildAssetRenditionPath(assetId, rendition), { apiBaseUrl: this.ports.apiBaseUrl, token })
    }

    download: MediaPorts['download'] = async ({ assetId, rendition, attachment, document, signal }) => {
        if (signal.aborted) return
        const token = await this.ports.getToken()
        if (signal.aborted || (attachment && !token)) return
        const source = resolveMediaUrl(buildAssetRenditionPath(assetId, rendition), { apiBaseUrl: this.ports.apiBaseUrl, token: token || false })
        const href = `${source}${source.includes('?') ? '&' : '?'}download=true`
        const html = createDocumentHtml(document)
        const anchor = html`<a href=${href} rel="noopener" style=${{ display: 'none' }}></a>` as HTMLAnchorElement
        try {
            document.body.append(anchor)
            anchor.click()
        } finally {
            anchor.remove()
        }
    }

    uploadReplacement: MediaPorts['uploadReplacement'] = async ({ workspaceId, file, signal, isCurrent }) => {
        if (signal.aborted || !isCurrent()) return null
        const token = await this.ports.getToken()
        if (!token || signal.aborted || !isCurrent()) return null
        const form = new FormData()
        form.append('file', file)
        const response = await this.ports.fetch(`${this.ports.apiBaseUrl.replace(/\/$/, '')}${buildAssetUploadPath(workspaceId)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
            signal,
        })
        if (!response.ok || signal.aborted || !isCurrent()) return null
        const result = await response.json()
        return signal.aborted || !isCurrent() ? null : result
    }
}
