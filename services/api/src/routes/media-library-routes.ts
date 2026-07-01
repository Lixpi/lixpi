'use strict'

import { Router } from 'express'

import { err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'

import { jwtVerifier } from '../helpers/auth.ts'
import MediaLibraryItem from '../models/media-library-item.ts'
import Organization from '../models/organization.ts'
import Workspace from '../models/workspace.ts'

const router = Router()

const authenticateRequest = async (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.substring(7)
        : req.query.token
    if (!token) return res.status(401).json({ error: 'No authorization token provided' })
    try {
        const { decoded, error } = await jwtVerifier.verify(token)
        if (error || !decoded) return res.status(401).json({ error: 'Invalid or expired token' })
        req.user = { userId: decoded.sub }
        next()
    } catch (e: any) {
        err('Token verification failed:', e)
        return res.status(401).json({ error: 'Authentication failed' })
    }
}

const resolveRequesterContext = async (userId: string) => {
    const [workspaces, organizations] = await Promise.all([
        Workspace.getUserWorkspaces({ userId }),
        Organization.getUserOrganizations({ userId }),
    ])
    return {
        userId,
        workspaceIds: workspaces.map((workspace) => workspace.workspaceId),
        organizationIds: organizations.map((organization) => organization.organizationId),
    }
}

const parseRangeHeader = (rangeHeader: string | undefined, totalSize: number): { start: number; end: number } | null => {
    if (!rangeHeader) return null
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
    if (!match) return null
    const start = Number.parseInt(match[1]!, 10)
    const end = match[2] && match[2].length > 0
        ? Math.min(Number.parseInt(match[2]!, 10), totalSize - 1)
        : totalSize - 1
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || end >= totalSize) return null
    return { start, end }
}

// GET /api/media-library/items/:itemId/content - Serve a saved Media Library
// item. Image items return the asset as a single response with cache headers;
// video items honor HTTP Range so <video> elements can seek without pulling
// the entire MP4 into memory client-side.
router.get('/items/:itemId/content', authenticateRequest, async (req: any, res: any) => {
    const { itemId } = req.params
    const { userId } = req.user

    try {
        const item = await MediaLibraryItem.getAnyItem({
            itemId,
            requesterContext: await resolveRequesterContext(userId),
        })
        if ('error' in item) {
            return res.status(item.error === 'NOT_FOUND' ? 404 : 403).json({ error: item.error })
        }

        const natsService = NATS_Service.getInstance()
        if (!natsService) return res.status(503).json({ error: 'Storage service unavailable' })
        const data = await natsService.getObject(item.asset.bucketName, item.asset.objectKey)
        if (!data) return res.status(404).json({ error: 'Asset not found' })

        // Audio and video honor HTTP Range so <audio>/<video> can seek without
        // pulling the whole asset into memory.
        if (item.kind === 'video' || item.kind === 'audio') {
            const buffer = Buffer.from(data)
            const totalSize = buffer.length
            const range = parseRangeHeader(req.headers.range as string | undefined, totalSize)
            res.setHeader('Accept-Ranges', 'bytes')
            res.setHeader('Content-Type', item.asset.mimeType)
            res.setHeader('Cache-Control', 'private, max-age=3600')
            if (range) {
                const chunk = buffer.slice(range.start, range.end + 1)
                res.status(206)
                res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`)
                res.setHeader('Content-Length', chunk.length)
                return res.end(chunk)
            }
            res.setHeader('Content-Length', totalSize)
            return res.end(buffer)
        }

        res.setHeader('Content-Type', item.asset.mimeType)
        res.setHeader('Content-Length', data.length)
        res.setHeader('Cache-Control', 'private, max-age=3600')
        return res.send(Buffer.from(data))
    } catch (e: any) {
        err(`Media Library content retrieval failed ${itemId}:`, e)
        return res.status(500).json({ error: 'Failed to retrieve asset' })
    }
})

// GET /api/media-library/items/:itemId/poster - Serve the still-frame poster
// for a video item or the first-page poster for a document item. Returns 404
// for kinds that don't carry a poster, or when poster extraction failed at save.
router.get('/items/:itemId/poster', authenticateRequest, async (req: any, res: any) => {
    const { itemId } = req.params
    const { userId } = req.user

    try {
        const item = await MediaLibraryItem.getAnyItem({
            itemId,
            requesterContext: await resolveRequesterContext(userId),
        })
        if ('error' in item) {
            return res.status(item.error === 'NOT_FOUND' ? 404 : 403).json({ error: item.error })
        }
        if ((item.kind !== 'video' && item.kind !== 'document') || !item.poster) {
            return res.status(404).json({ error: 'Poster not available' })
        }

        const natsService = NATS_Service.getInstance()
        if (!natsService) return res.status(503).json({ error: 'Storage service unavailable' })
        const data = await natsService.getObject(item.poster.bucketName, item.poster.objectKey)
        if (!data) return res.status(404).json({ error: 'Poster not found' })

        res.setHeader('Content-Type', item.poster.mimeType)
        res.setHeader('Content-Length', data.length)
        res.setHeader('Cache-Control', 'private, max-age=3600')
        return res.send(Buffer.from(data))
    } catch (e: any) {
        err(`Media Library poster retrieval failed ${itemId}:`, e)
        return res.status(500).json({ error: 'Failed to retrieve poster' })
    }
})

export default router
