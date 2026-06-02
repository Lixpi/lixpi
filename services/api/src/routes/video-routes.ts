'use strict'

import { Router } from 'express'
import multer from 'multer'

import NATS_Service from '@lixpi/nats-service'
import { type DocumentFile } from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'

import { jwtVerifier } from '../helpers/auth.ts'
import Workspace from '../models/workspace.ts'
import { storeWorkspaceImage } from '../services/image-storage.ts'
import { extractPosterFrame, storeWorkspaceVideo } from '../services/video-storage.ts'

// Mirrors routes/image-routes.ts for workspace videos. Videos live in the same
// Object Store bucket as images, but are served with HTTP Range support so HTML5
// <video> can seek without fetching the whole MP4 up front.
//
// Authentication mirrors the image route exactly so a tokenized URL passed to
// a <video src=...> or PIXI VideoSource works the same way it does for <img>.

const router = Router()

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`
const MAX_VIDEO_FILE_SIZE = 1024 * 1024 * 1024
const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4']

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_VIDEO_FILE_SIZE,
    },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_VIDEO_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true)
        } else {
            cb(new Error(`Invalid content type. Allowed: ${ALLOWED_VIDEO_MIME_TYPES.join(', ')}`))
        }
    },
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

// POST /api/videos/:workspaceId - Upload a replacement/user-supplied video.
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
            const video = await storeWorkspaceVideo({
                workspaceId,
                buffer: file.buffer,
                originalName: file.originalname,
                mimeType: file.mimetype,
            })

            let poster: { fileId: string; url: string } | null = null
            const posterBuffer = await extractPosterFrame(file.buffer)
            if (posterBuffer) {
                poster = await storeWorkspaceImage({
                    workspaceId,
                    buffer: posterBuffer,
                    originalName: `${file.originalname}-poster.png`,
                    mimeType: 'image/png',
                })
            }

            return res.json({
                ...video,
                posterFileId: poster?.fileId ?? '',
                posterUrl: poster?.url ?? '',
            })
        } catch (e: any) {
            err(`Video upload failed for workspace ${workspaceId}:`, e)
            if (e?.message?.startsWith('Workspace not found')) {
                return res.status(404).json({ error: 'Workspace not found' })
            }
            if (e?.message?.includes('NATS service unavailable')) {
                return res.status(503).json({ error: 'Storage service unavailable' })
            }
            return res.status(500).json({ error: 'Failed to upload video' })
        }
    }
)

// GET /api/videos/:workspaceId/:fileId
//
// Streams a generated MP4 with HTTP Range support. The whole object is loaded
// from the Object Store and sliced in memory — VEO clips are short (max 8s),
// so this is simpler than range-aware streaming from NATS and bounded enough
// for v1. Returns 206 Partial Content with Content-Range when Range is present,
// or 200 OK with Accept-Ranges: bytes otherwise.
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

            const workspace = req.workspace
            const fileInfo = workspace.files?.find((f: DocumentFile) => f.id === fileId)

            let data: Uint8Array | null = null
            try {
                data = await natsService.getObject(bucketName, fileId)
            } catch (objErr: any) {
                const msg = objErr?.message || String(objErr)
                if (msg.includes('no stream') || msg.includes('not found') || msg.includes('bucket')) {
                    err(`Object Store bucket missing for ${workspaceId}: ${msg}`)
                    return res.status(404).json({ error: 'Video storage not found — data may have been lost' })
                }
                throw objErr
            }

            if (!data) {
                return res.status(404).json({ error: 'Video not found' })
            }

            const buffer = Buffer.from(data)
            const total = buffer.length
            const mimeType = fileInfo?.mimeType || 'video/mp4'

            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            res.setHeader('Content-Type', mimeType)
            res.setHeader('Accept-Ranges', 'bytes')

            if (req.query.download === 'true') {
                const ext = mimeType.split('/')[1] || 'mp4'
                const downloadName = fileInfo?.name || `${fileId}.${ext}`
                res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`)
            }

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

            res.setHeader('Content-Length', total)
            return res.end(buffer)
        } catch (e: any) {
            err(`Video retrieval failed for ${workspaceId}/${fileId}:`, e)
            return res.status(500).json({ error: 'Failed to retrieve video' })
        }
    }
)

export default router
