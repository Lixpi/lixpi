'use strict'

import { Router } from 'express'
import multer from 'multer'

import NATS_Service from '@lixpi/nats-service'
import { MAX_UPLOAD_FILE_SIZE, type DocumentFile, type MediaKind } from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'

import { jwtVerifier } from '../helpers/auth.ts'
import Workspace from '../models/workspace.ts'
import { ingestWorkspaceFile, FileRejectedError } from '../services/file-ingest.ts'
import { importRemoteFileToWorkspace } from '../services/remote-file-import.ts'

// Unified upload + serve for every media kind. Replaces the per-modality
// image-routes.ts / video-routes.ts: one drop target, server-side byte sniffing,
// an explicit policy table, ingest-time transcoding, and kind-aware serving
// (Range support for audio/video).

const router = Router()

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`

// Type/policy decisions are server-authoritative — the multer filter only
// enforces the size ceiling, never the type (the bytes are sniffed downstream).
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_FILE_SIZE },
})

const authenticateRequest = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization
    const queryToken = req.query.token

    let token: string | null = null
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7)
    } else if (queryToken) {
        token = queryToken
    }

    if (!token) {
        return res.status(401).json({ error: 'No authorization token provided' })
    }

    try {
        const { decoded, error } = await jwtVerifier.verify(token)
        if (error || !decoded) {
            return res.status(401).json({ error: 'Invalid or expired token' })
        }
        req.user = { userId: decoded.sub }
        next()
    } catch (e: any) {
        err('Token verification failed:', e)
        return res.status(401).json({ error: 'Authentication failed' })
    }
}

const validateWorkspaceAccess = async (req: any, res: any, next: any) => {
    const { workspaceId } = req.params
    const { userId } = req.user

    try {
        const workspace = await Workspace.getWorkspace({ workspaceId, userId })

        if ('error' in workspace) {
            if (workspace.error === 'NOT_FOUND') {
                return res.status(404).json({ error: 'Workspace not found' })
            }
            if (workspace.error === 'PERMISSION_DENIED') {
                return res.status(403).json({ error: 'Access denied' })
            }
            return res.status(400).json({ error: workspace.error })
        }

        req.workspace = workspace
        next()
    } catch (e: any) {
        err('Workspace access validation failed:', e)
        return res.status(500).json({ error: 'Failed to validate workspace access' })
    }
}

// Resolve a requested fileId to its serving mime + kind. Originals (and posters)
// are registered in workspace.files; a canonical derivative is not registered on
// its own row but is reachable via the original's `canonicalFileId` pointer.
const resolveFileInfo = (files: DocumentFile[] | undefined, fileId: string): { mimeType: string; kind: MediaKind | null } => {
    const direct = files?.find((f) => f.id === fileId)
    if (direct) return { mimeType: direct.mimeType, kind: direct.kind }

    const parent = files?.find((f) => f.canonicalFileId === fileId)
    if (parent) return { mimeType: parent.canonicalMimeType ?? 'application/octet-stream', kind: parent.kind }

    return { mimeType: 'application/octet-stream', kind: null }
}

// POST /api/files/:workspaceId — unified upload. Accepts any file; the bytes
// decide its type, policy, and transcode target.
router.post(
    '/:workspaceId',
    authenticateRequest,
    validateWorkspaceAccess,
    upload.single('file'),
    async (req: any, res: any) => {
        const { workspaceId } = req.params
        const file = req.file

        if (!file) {
            return res.status(400).json({ error: 'No file provided' })
        }

        try {
            const result = await ingestWorkspaceFile({
                workspaceId,
                buffer: file.buffer,
                originalName: file.originalname,
                useContentHash: req.body?.useContentHash === 'true',
            })
            return res.json(result)
        } catch (e: any) {
            if (e instanceof FileRejectedError) {
                return res.status(422).json({ error: e.reason })
            }
            err(`File upload failed for workspace ${workspaceId}:`, e)
            if (e?.message?.startsWith('Workspace not found')) {
                return res.status(404).json({ error: 'Workspace not found' })
            }
            if (e?.message?.includes('NATS service unavailable')) {
                return res.status(503).json({ error: 'Storage service unavailable' })
            }
            return res.status(500).json({ error: 'Failed to upload file' })
        }
    }
)

// POST /api/files/:workspaceId/import-url — import a public URL into storage.
router.post(
    '/:workspaceId/import-url',
    authenticateRequest,
    validateWorkspaceAccess,
    async (req: any, res: any) => {
        const { workspaceId } = req.params
        const url = req.body?.url
        if (typeof url !== 'string' || !url.trim()) {
            return res.status(400).json({ error: 'File URL is required' })
        }
        try {
            return res.json(await importRemoteFileToWorkspace({ workspaceId, url }))
        } catch (e: any) {
            if (e instanceof FileRejectedError) {
                return res.status(422).json({ error: e.reason })
            }
            err(`File URL import failed for workspace ${workspaceId}:`, e)
            const unsafeOrInvalid = /Invalid|Only public|credentials|Private network|too large|redirected/i.test(e?.message ?? '')
            return res.status(unsafeOrInvalid ? 400 : 502).json({ error: e.message || 'Failed to import file URL' })
        }
    }
)

// GET /api/files/:workspaceId/:fileId — serve an original, canonical, or poster
// object. Audio and video honor HTTP Range so HTML5 <audio>/<video> can seek
// without fetching the whole asset; images/documents are sent whole.
router.get(
    '/:workspaceId/:fileId',
    authenticateRequest,
    validateWorkspaceAccess,
    async (req: any, res: any) => {
        const { workspaceId, fileId } = req.params
        const bucketName = getWorkspaceBucketName(workspaceId)

        try {
            const natsService = NATS_Service.getInstance()
            if (!natsService) {
                return res.status(503).json({ error: 'Storage service unavailable' })
            }

            const { mimeType, kind } = resolveFileInfo(req.workspace.files, fileId)

            let data: Uint8Array | null = null
            try {
                data = await natsService.getObject(bucketName, fileId)
            } catch (objErr: any) {
                const msg = objErr?.message || String(objErr)
                if (msg.includes('no stream') || msg.includes('not found') || msg.includes('bucket')) {
                    err(`Object Store bucket missing for ${workspaceId}: ${msg}`)
                    return res.status(404).json({ error: 'File storage not found — data may have been lost' })
                }
                throw objErr
            }

            if (!data) {
                return res.status(404).json({ error: 'File not found' })
            }

            const buffer = Buffer.from(data)
            const total = buffer.length
            const direct = (req.workspace.files as DocumentFile[] | undefined)?.find((f) => f.id === fileId)

            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            res.setHeader('Content-Type', mimeType)

            if (req.query.download === 'true') {
                const ext = mimeType.split('/')[1] || 'bin'
                const downloadName = direct?.name || `${fileId}.${ext}`
                res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`)
            }

            // Range support for seekable media surfaces (audio/video).
            const rangeable = kind === 'audio' || kind === 'video'
            if (rangeable) {
                res.setHeader('Accept-Ranges', 'bytes')
                const rangeHeader = req.headers.range
                if (rangeHeader) {
                    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
                    if (!match) {
                        res.setHeader('Content-Range', `bytes */${total}`)
                        return res.status(416).end()
                    }
                    const start = Number(match[1])
                    const end = match[2] ? Number(match[2]) : total - 1
                    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= total || start > end) {
                        res.setHeader('Content-Range', `bytes */${total}`)
                        return res.status(416).end()
                    }
                    const chunk = buffer.subarray(start, end + 1)
                    res.status(206)
                    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
                    res.setHeader('Content-Length', chunk.length)
                    return res.end(chunk)
                }
            }

            res.setHeader('Content-Length', total)
            return res.end(buffer)
        } catch (e: any) {
            err(`File retrieval failed for ${workspaceId}/${fileId}:`, e)
            return res.status(500).json({ error: 'Failed to retrieve file' })
        }
    }
)

export default router
