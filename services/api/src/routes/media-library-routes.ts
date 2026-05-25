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

// GET /api/media-library/items/:itemId/content - Serve a saved Media Library image.
router.get('/items/:itemId/content', authenticateRequest, async (req: any, res: any) => {
    const { itemId } = req.params
    const { userId } = req.user

    try {
        const [workspaces, organizations] = await Promise.all([
            Workspace.getUserWorkspaces({ userId }),
            Organization.getUserOrganizations({ userId }),
        ])
        const item = await MediaLibraryItem.getImageItem({
            itemId,
            requesterContext: {
                userId,
                workspaceIds: workspaces.map((workspace) => workspace.workspaceId),
                organizationIds: organizations.map((organization) => organization.organizationId),
            },
        })
        if ('error' in item) {
            return res.status(item.error === 'NOT_FOUND' ? 404 : 403).json({ error: item.error })
        }

        const natsService = NATS_Service.getInstance()
        if (!natsService) return res.status(503).json({ error: 'Storage service unavailable' })
        const data = await natsService.getObject(item.asset.bucketName, item.asset.objectKey)
        if (!data) return res.status(404).json({ error: 'Image not found' })

        res.setHeader('Content-Type', item.asset.mimeType)
        res.setHeader('Content-Length', data.length)
        res.setHeader('Cache-Control', 'private, max-age=3600')
        return res.send(Buffer.from(data))
    } catch (e: any) {
        err(`Media Library image retrieval failed ${itemId}:`, e)
        return res.status(500).json({ error: 'Failed to retrieve image' })
    }
})

export default router
