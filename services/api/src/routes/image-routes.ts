'use strict'

import { Router } from 'express'
import multer from 'multer'

import NATS_Service from '@lixpi/nats-service'
import {
    ALLOWED_IMAGE_MIME_TYPES,
    MAX_IMAGE_FILE_SIZE,
    type DocumentFile,
} from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'

import { jwtVerifier } from '../helpers/auth.ts'
import Workspace from '../models/workspace.ts'
import {
    storeWorkspaceImage,
} from '../services/image-storage.ts'
import { importRemoteImageToWorkspace } from '../services/remote-image-import.ts'

const router = Router()

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_IMAGE_FILE_SIZE
    },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true)
        } else {
            cb(new Error(`Invalid content type. Allowed: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`))
        }
    }
})

// Middleware to validate bearer token
// Supports both Authorization header and query parameter token (for <img> tags)
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

// Middleware to validate workspace access
const validateWorkspaceAccess = async (req: any, res: any, next: any) => {
    const { workspaceId } = req.params
    const { userId } = req.user

    try {
        const workspace = await Workspace.getWorkspace({
            workspaceId,
            userId
        })

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

// POST /api/images/:workspaceId - Upload an image
// Supports hash-based deduplication for AI-generated images
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
            const result = await storeWorkspaceImage({
                workspaceId,
                buffer: file.buffer,
                originalName: file.originalname,
                mimeType: file.mimetype,
                useContentHash: req.body?.useContentHash === 'true',
            })
            return res.json(result)
        } catch (e: any) {
            err(`Image upload failed for workspace ${workspaceId}:`, e)
            if (e?.message?.startsWith('Workspace not found')) {
                return res.status(404).json({ error: 'Workspace not found' })
            }
            if (e?.message?.includes('NATS service unavailable')) {
                return res.status(503).json({ error: 'Storage service unavailable' })
            }
            return res.status(500).json({ error: 'Failed to upload image' })
        }
    }
)

// POST /api/images/:workspaceId/import-url - Import a public image URL into storage.
router.post(
    '/:workspaceId/import-url',
    authenticateRequest,
    validateWorkspaceAccess,
    async (req: any, res: any) => {
        const { workspaceId } = req.params
        const imageUrl = req.body?.url
        if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
            return res.status(400).json({ error: 'Image URL is required' })
        }
        try {
            return res.json(await importRemoteImageToWorkspace({ workspaceId, imageUrl }))
        } catch (e: any) {
            err(`Image URL import failed for workspace ${workspaceId}:`, e)
            const unsafeOrInvalid = /Invalid|Only public|credentials|Private network|supported image|valid image|too large|redirected/i.test(e?.message ?? '')
            return res.status(unsafeOrInvalid ? 400 : 502).json({ error: e.message || 'Failed to import image URL' })
        }
    }
)

// GET /api/images/:workspaceId/:fileId - Serve an image
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

            // Get file info from workspace's files array to get mime type
            const workspace = req.workspace
            const fileInfo = workspace.files?.find((f: DocumentFile) => f.id === fileId)

            // Get file from Object Store
            let data: Uint8Array | null = null
            try {
                data = await natsService.getObject(bucketName, fileId)
            } catch (objErr: any) {
                const msg = objErr?.message || String(objErr)
                if (msg.includes('no stream') || msg.includes('not found') || msg.includes('bucket')) {
                    err(`Object Store bucket missing for ${workspaceId}: ${msg}`)
                    return res.status(404).json({ error: 'Image storage not found — data may have been lost' })
                }
                throw objErr
            }

            if (!data) {
                return res.status(404).json({ error: 'Image not found' })
            }

            // Set appropriate headers
            const mimeType = fileInfo?.mimeType || 'application/octet-stream'
            res.setHeader('Content-Type', mimeType)
            res.setHeader('Content-Length', data.length)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')

            // When ?download=true is present, force the browser to save the file
            if (req.query.download === 'true') {
                const ext = mimeType.split('/')[1] || 'bin'
                const downloadName = fileInfo?.name || `${fileId}.${ext}`
                res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`)
            }

            // Send the data
            res.send(Buffer.from(data))
        } catch (e: any) {
            err(`Image retrieval failed for ${workspaceId}/${fileId}:`, e)
            return res.status(500).json({ error: 'Failed to retrieve image' })
        }
    }
)

export default router
