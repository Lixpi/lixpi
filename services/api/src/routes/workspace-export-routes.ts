'use strict'

import { Router } from 'express'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import multer from 'multer'

import NATS_Service from '@lixpi/nats-service'
import { type DocumentFile } from '@lixpi/constants'
import { info, err } from '@lixpi/debug-tools'

import { jwtVerifier } from '../helpers/auth.ts'
import Workspace from '../models/workspace.ts'
import Document from '../models/document.ts'
import AiChatThread from '../models/ai-chat-thread.ts'
import { collectCanvasImageFileIds, reconcileFilesWithImages, rewriteCanvasImageNodes } from './workspace-import-helpers.ts'

const router = Router()

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`

// Maximum import file size: 1GB
const MAX_IMPORT_SIZE = 1024 * 1024 * 1024

const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMPORT_SIZE },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' || file.originalname.endsWith('.zip')) {
            cb(null, true)
        } else {
            cb(new Error('Invalid file type. Only ZIP files are accepted.'))
        }
    }
})

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

            // Collect all image fileIds that need exporting.
            // The files array is the primary source, but canvas nodes may
            // reference fileIds not in the files array (data desync).
            // Export both to ensure imported workspaces have all referenced images.
            const files: DocumentFile[] = workspace.files || []
            const exportedFileIds = new Set<string>()
            const natsService = NATS_Service.getInstance()
            const bucketName = getWorkspaceBucketName(workspaceId)

            if (natsService) {
                // Export images from the files array
                for (const file of files) {
                    try {
                        const data = await natsService.getObject(bucketName, file.id)
                        if (data) {
                            const ext = getFileExtension(file.mimeType, file.name)
                            archive.append(Buffer.from(data), { name: `images/${file.id}${ext}` })
                            exportedFileIds.add(file.id)
                        }
                    } catch (e: any) {
                        err(`Export: failed to retrieve file ${file.id}:`, e)
                    }
                }

                // Also export images referenced by canvas nodes but missing from the files array
                const extraFileIds = collectCanvasImageFileIds(
                    workspace.canvasState?.nodes || [],
                    exportedFileIds
                )
                for (const fileId of extraFileIds) {
                    try {
                        const data = await natsService.getObject(bucketName, fileId)
                        if (data) {
                            archive.append(Buffer.from(data), { name: `images/${fileId}.png` })
                            exportedFileIds.add(fileId)
                        }
                    } catch (e: any) {
                        err(`Export: failed to retrieve canvas-referenced file ${fileId}:`, e)
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

// POST /api/workspaces/:workspaceId/import
// Imports a previously exported ZIP archive, replacing all workspace content
router.post(
    '/:workspaceId/import',
    authenticateRequest,
    validateWorkspaceAccess,
    importUpload.single('file'),
    async (req: any, res: any) => {
        const { workspaceId } = req.params
        const file = req.file

        if (!file) {
            return res.status(400).json({ error: 'No file provided' })
        }

        // ── Parse ZIP ──────────────────────────────────────────────
        let zip: AdmZip
        let manifest: any

        try {
            zip = new AdmZip(file.buffer)
        } catch (e: any) {
            return res.status(400).json({ error: 'Invalid ZIP file' })
        }

        const manifestEntry = zip.getEntry('manifest.json')
        if (!manifestEntry) {
            return res.status(400).json({ error: 'ZIP archive is missing manifest.json' })
        }

        try {
            manifest = JSON.parse(manifestEntry.getData().toString('utf8'))
        } catch (e: any) {
            return res.status(400).json({ error: 'manifest.json contains invalid JSON' })
        }

        // ── Validate manifest ──────────────────────────────────────
        if (manifest.exportVersion !== 1) {
            return res.status(400).json({ error: `Unsupported export version: ${manifest.exportVersion}` })
        }

        if (!manifest.workspace?.canvasState) {
            return res.status(400).json({ error: 'manifest.json is missing workspace.canvasState' })
        }

        if (!Array.isArray(manifest.documents)) {
            return res.status(400).json({ error: 'manifest.json is missing documents array' })
        }

        if (!Array.isArray(manifest.aiChatThreads)) {
            return res.status(400).json({ error: 'manifest.json is missing aiChatThreads array' })
        }

        // Collect image entries from ZIP before wiping anything
        const imageEntries: { fileId: string; ext: string; data: Buffer }[] = []

        for (const entry of zip.getEntries()) {
            if (entry.entryName.startsWith('images/') && !entry.isDirectory) {
                const filename = entry.entryName.slice('images/'.length)
                const dotIndex = filename.lastIndexOf('.')
                const fileId = dotIndex !== -1 ? filename.substring(0, dotIndex) : filename
                const ext = dotIndex !== -1 ? filename.substring(dotIndex) : ''
                imageEntries.push({ fileId, ext, data: entry.getData() })
            }
        }

        // ── Wipe existing content ──────────────────────────────────
        try {
            const natsService = NATS_Service.getInstance()
            const bucketName = getWorkspaceBucketName(workspaceId)

            await Promise.all([
                // Delete all images (wipe entire NATS object store bucket)
                (async () => {
                    if (natsService) {
                        try {
                            await natsService.deleteObjectStore(bucketName)
                        } catch (e: any) {
                            // Bucket may not exist — that's fine
                        }
                    }
                })(),
                // Delete all documents from DynamoDB
                Document.deleteWorkspaceDocuments({ workspaceId }),
                // Delete all AI chat threads from DynamoDB
                AiChatThread.deleteWorkspaceAiChatThreads({ workspaceId })
            ])

            // ── Restore images ─────────────────────────────────────
            if (imageEntries.length > 0 && natsService) {
                await natsService.ensureObjectStore(bucketName)
                for (const image of imageEntries) {
                    await natsService.putObject(bucketName, image.fileId, image.data, {
                        name: image.fileId,
                        description: `${image.fileId}${image.ext}`
                    })
                }
            }

            // ── Restore documents ──────────────────────────────────
            for (const doc of manifest.documents) {
                await Document.importDocument({
                    documentId: doc.documentId,
                    workspaceId,
                    title: doc.title,
                    content: doc.content,
                    createdAt: doc.createdAt,
                    updatedAt: doc.updatedAt
                })
            }

            // ── Restore AI chat threads ────────────────────────────
            for (const thread of manifest.aiChatThreads) {
                await AiChatThread.createAiChatThread({
                    workspaceId,
                    threadId: thread.threadId,
                    content: thread.content,
                    aiModel: thread.aiModel
                })
            }

            // ── Reconcile files array with actually-imported images ──
            const files: DocumentFile[] = manifest.workspace.files || []
            reconcileFilesWithImages(files, imageEntries)

            // ── Rewrite canvas image node src to target workspaceId ────
            const canvasState = manifest.workspace.canvasState
            if (canvasState?.nodes) {
                rewriteCanvasImageNodes(canvasState.nodes, workspaceId)
            }

            await Workspace.replaceWorkspaceContent({
                workspaceId,
                canvasState,
                files
            })

            info(`Workspace ${workspaceId} imported successfully (${manifest.documents.length} documents, ${manifest.aiChatThreads.length} threads, ${imageEntries.length} images)`)

            res.json({
                success: true,
                workspaceId,
                imported: {
                    documents: manifest.documents.length,
                    aiChatThreads: manifest.aiChatThreads.length,
                    images: imageEntries.length
                }
            })
        } catch (e: any) {
            err('Workspace import failed:', e)
            res.status(500).json({ error: 'Import failed' })
        }
    }
)

export default router
