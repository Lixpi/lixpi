import type {
    CanvasIngestReply,
    CanvasUploadRequest,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import AuthService from '$src/services/auth-service.ts'

async function readReply(response: Response, fallbackError: string): Promise<CanvasIngestReply> {
    const data = await response.json()
    if (!response.ok) return { error: data?.error || fallbackError }
    if (typeof data?.assetId !== 'string' || !['image', 'video', 'audio', 'document'].includes(data?.kind)) {
        throw new Error('INVALID_ASSET_INGEST_REPLY')
    }
    return { assetId: data.assetId, kind: data.kind }
}

export async function uploadCanvasAsset({ workspaceId, file, onStart }: CanvasUploadRequest & { file: File }): Promise<CanvasIngestReply> {
    const token = await AuthService.getTokenSilently()
    if (!token || !onStart()) return null
    const body = new FormData()
    body.append('file', file)
    const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/assets/workspaces/${workspaceId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
    })
    return await readReply(response, 'Upload failed')
}

export async function importCanvasAssetUrl({ workspaceId, url, onStart }: CanvasUploadRequest & { url: string }): Promise<CanvasIngestReply> {
    const token = await AuthService.getTokenSilently()
    if (!token || !onStart()) return null
    const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/assets/workspaces/${workspaceId}/import-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    })
    return await readReply(response, 'File URL import failed')
}
