'use strict'

import { Router } from 'express'
import archiver from 'archiver'

import NATS_Service from '@lixpi/nats-service'
import { type DocumentFile } from '@lixpi/constants'
import { info, err } from '@lixpi/debug-tools'

import { jwtVerifier } from '../helpers/auth.ts'
import Workspace from '../models/workspace.ts'
import Document from '../models/document.ts'
import AiChatThread from '../models/ai-chat-thread.ts'

const router = Router()

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`

const getFileExtension = (mimeType?: string, filename?: string): string => {
    if (filename) {
        const dotIndex = filename.lastIndexOf('.')
        if (dotIndex !== -1) return filename.substring(dotIndex)
    }
    const mimeMap: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'image/avif': '.avif',
    }
    return mimeMap[mimeType || ''] || ''
}

// Middleware to validate bearer token
// Supports both Authorization header and query parameter token (for browser download links)
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

// GET /api/workspaces/:workspaceId/export
// Streams a ZIP archive containing workspace data and images
router.get(
    '/:workspaceId/export',
    authenticateRequest,
    validateWorkspaceAccess,
    async (req: any, res: any) => {
        const { workspaceId } = req.params
        const workspace = req.workspace

        try {
            const [documents, threads] = await Promise.all([
                Document.getWorkspaceDocuments({ workspaceId }),
                AiChatThread.getWorkspaceAiChatThreads({ workspaceId })
            ])

            const manifest = {
                exportVersion: 1,
                exportedAt: new Date().toISOString(),
                workspace: {
                    workspaceId,
                    name: workspace.name,
                    canvasState: workspace.canvasState,
                    files: workspace.files || [],
                    createdAt: workspace.createdAt,
                    updatedAt: workspace.updatedAt,
                },
                documents,
                aiChatThreads: threads,
            }

            const safeName = (workspace.name || 'workspace').replace(/[^a-zA-Z0-9_-]/g, '_')
            res.setHeader('Content-Type', 'application/zip')
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}-export.zip"`)

            const archive = archiver('zip', { zlib: { level: 5 } })

            archive.on('error', (archiveErr: Error) => {
                err('Archive error during workspace export:', archiveErr)
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Export failed' })
                }
            })

            res.on('close', () => {
                archive.abort()
            })

            archive.pipe(res)

            archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })

            const files: DocumentFile[] = workspace.files || []
            if (files.length > 0) {
                const natsService = NATS_Service.getInstance()
                if (natsService) {
                    const bucketName = getWorkspaceBucketName(workspaceId)
                    for (const file of files) {
                        try {
                            const data = await natsService.getObject(bucketName, file.id)
                            if (data) {
                                const ext = getFileExtension(file.mimeType, file.name)
                                archive.append(Buffer.from(data), { name: `images/${file.id}${ext}` })
                            }
                        } catch (e: any) {
                            err(`Export: failed to retrieve file ${file.id}:`, e)
                        }
                    }
                }
            }

            await archive.finalize()
            info(`Workspace ${workspaceId} exported successfully`)
        } catch (e: any) {
            err('Workspace export failed:', e)
            if (!res.headersSent) {
                res.status(500).json({ error: 'Export failed' })
            }
        }
    }
)

export default router
