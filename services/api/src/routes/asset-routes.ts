'use strict'

import { Router } from 'express'
import multer from 'multer'

import NATS_Service from '@lixpi/nats-service'
import {
    MAX_UPLOAD_FILE_SIZE,
    type AssetDocumentRole,
    type AssetRenditionName,
} from '@lixpi/constants'

import { jwtVerifier } from '../helpers/auth.ts'
import AssetModel from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import Workspace from '../models/workspace.ts'
import { getAssetRequesterContext } from '../services/asset-requester-context.ts'
import AssetDocumentService from '../services/asset-document-service.ts'
import { AssetFileRejectedError, ingestAssetFile } from '../services/asset-ingest.ts'
import { fetchPublicRemoteFile } from '../services/public-remote-file.ts'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_FILE_SIZE } })

const normalizeUploadedFilename = (filename: string): string => {
    const hasUtf8Mojibake = /[\u0080-\u009f]|Ã|Â|â/.test(filename)
    const decoded = hasUtf8Mojibake ? Buffer.from(filename, 'latin1').toString('utf8') : filename
    const validDecoded = decoded.includes('\uFFFD') ? filename : decoded
    return validDecoded.normalize('NFC').replace(/[\u00a0\u202f]/g, ' ')
}

const authenticateRequest = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : req.query.token
    if (!token) return res.status(401).json({ error: 'No authorization token provided' })
    const { decoded, error } = await jwtVerifier.verify(token)
    if (error || !decoded) return res.status(401).json({ error: 'Invalid or expired token' })
    req.user = { userId: decoded.sub }
    next()
}

router.post('/workspaces/:workspaceId', authenticateRequest, upload.single('file'), async (req: any, res: any) => {
    const { userId } = req.user
    const { workspaceId } = req.params
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    if ('error' in workspace) return res.status(workspace.error === 'NOT_FOUND' ? 404 : 403).json(workspace)
    if (workspace.deletingAt) return res.status(409).json({ error: 'WORKSPACE_DELETING' })
    if (!workspace.accessList.some((entry) => entry.userId === userId && (entry.accessLevel === 'owner' || entry.accessLevel === 'editor'))) {
        return res.status(403).json({ error: 'PERMISSION_DENIED' })
    }
    const organizationId = workspace.organizationId
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    try {
        return res.json(await ingestAssetFile({
            organizationId,
            workspaceId,
            ownerUserId: userId,
            buffer: req.file.buffer,
            originalName: normalizeUploadedFilename(req.file.originalname),
            ...(req.body?.expectedKind === 'image' ? { expectedKind: 'image' as const } : {}),
        }))
    } catch (error) {
        if (error instanceof AssetFileRejectedError) return res.status(422).json({ error: error.reason })
        console.error('Asset upload failed:', error)
        return res.status(500).json({ error: 'ASSET_UPLOAD_FAILED' })
    }
})

router.post('/workspaces/:workspaceId/import-url', authenticateRequest, async (req: any, res: any) => {
    const { userId } = req.user
    const { workspaceId } = req.params
    const url = req.body?.url
    if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'File URL is required' })
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    if ('error' in workspace) return res.status(workspace.error === 'NOT_FOUND' ? 404 : 403).json(workspace)
    if (workspace.deletingAt) return res.status(409).json({ error: 'WORKSPACE_DELETING' })
    if (!workspace.accessList.some((entry) => entry.userId === userId && (entry.accessLevel === 'owner' || entry.accessLevel === 'editor'))) {
        return res.status(403).json({ error: 'PERMISSION_DENIED' })
    }
    const organizationId = workspace.organizationId
    try {
        const remote = await fetchPublicRemoteFile(url)
        return res.json(await ingestAssetFile({
            organizationId,
            workspaceId,
            ownerUserId: userId,
            ...remote,
            ...(req.body?.expectedKind === 'image' ? { expectedKind: 'image' as const } : {}),
        }))
    } catch (error) {
        if (error instanceof AssetFileRejectedError) return res.status(422).json({ error: error.reason })
        const message = error instanceof Error ? error.message : String(error)
        const unsafeOrInvalid = /Invalid|Only public|credentials|Private network|too large|redirected/i.test(message)
        return res.status(unsafeOrInvalid ? 400 : 502).json({ error: message })
    }
})

router.get('/:assetId/renditions/:renditionName', authenticateRequest, async (req: any, res: any) => {
    const requester = await getAssetRequesterContext(req.user.userId)
    const result = await AssetModel.get({ assetId: req.params.assetId, requester })
    if ('error' in result) return res.status(result.error === 'NOT_FOUND' ? 404 : 403).json(result)
    const renditionName = req.params.renditionName as AssetRenditionName
    const rendition = result.media?.renditions[renditionName]
    if (rendition?.status !== 'ready' || !rendition.blobHash) return res.status(404).json({ error: 'RENDITION_NOT_FOUND' })
    const blob = await BlobModel.get({ organizationId: result.organizationId, blobHash: rendition.blobHash })
    if (!blob) return res.status(404).json({ error: 'BLOB_NOT_FOUND' })
    const natsService = NATS_Service.getInstance()
    if (!natsService) return res.status(503).json({ error: 'STORAGE_UNAVAILABLE' })
    const data = await natsService.getObject(blob.bucketName, blob.objectKey)
    if (!data) return res.status(404).json({ error: 'BLOB_OBJECT_NOT_FOUND' })
    const buffer = Buffer.from(data)
    const etag = `"${blob.blobHash}"`
    res.setHeader('Content-Type', blob.mimeType)
    res.setHeader('Cache-Control', 'private, no-cache')
    res.setHeader('ETag', etag)
    if (req.query.download === 'true') {
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.media?.originalName ?? result.title)}`)
    }
    const range = req.headers.range
    if (!range && req.headers['if-none-match'] === etag) return res.status(304).end()
    if ((result.media?.kind === 'audio' || result.media?.kind === 'video') && range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range)
        if (!match) return res.status(416).end()
        const start = Number(match[1])
        const end = match[2] ? Number(match[2]) : buffer.length - 1
        if (start < 0 || end >= buffer.length || start > end) return res.status(416).end()
        const chunk = buffer.subarray(start, end + 1)
        res.status(206)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`)
        res.setHeader('Content-Length', chunk.length)
        return res.end(chunk)
    }
    res.setHeader('Content-Length', buffer.length)
    return res.end(buffer)
})

router.get('/:assetId/documents/:role/snapshot', authenticateRequest, async (req: any, res: any) => {
    const role = req.params.role as AssetDocumentRole
    if (role !== 'content' && role !== 'conversation' && role !== 'provenance') {
        return res.status(400).json({ error: 'INVALID_DOCUMENT_ROLE' })
    }
    const requester = await getAssetRequesterContext(req.user.userId)
    const asset = await AssetModel.get({ assetId: req.params.assetId, requester })
    if ('error' in asset) return res.status(asset.error === 'NOT_FOUND' ? 404 : 403).json(asset)
    const snapshot = await AssetDocumentService.loadSnapshot(asset, role)
    if (!snapshot) return res.status(404).json({ error: 'DOCUMENT_SNAPSHOT_NOT_FOUND' })
    const etag = `"${snapshot.blobHash ?? `${asset.assetId}:${role}:${snapshot.version}`}"`
    if (req.headers['if-none-match'] === etag) return res.status(304).end()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'private, no-cache')
    res.setHeader('ETag', etag)
    return res.json(snapshot)
})

export default router
