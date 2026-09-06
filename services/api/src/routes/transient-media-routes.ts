import { Router } from 'express'

import NATS_Service from '@lixpi/nats-service'

import { jwtVerifier } from '../helpers/auth.ts'
import Workspace from '../models/workspace.ts'
import {
    getTransientMediaBucketName,
    getTransientMediaMimeType,
    isTransientMediaObjectKey,
} from '../services/transient-media-store.ts'

const router = Router()

const authenticateRequest = async (
    req: any,
    res: any,
    next: any,
) => {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : req.query.token

    if (!token)
        return res.status(401).json({ error: 'No authorization token provided' })

    const {
        decoded,
        error,
    } = await jwtVerifier.verify(token)

    if (
        error
        || !decoded
    )
        return res.status(401).json({ error: 'Invalid or expired token' })

    req.user = { userId: decoded.sub }
    next()
}

router.get(
    '/workspaces/:workspaceId/objects/:objectKey',
    authenticateRequest,
    async (req: any, res: any) => {
        const {
            workspaceId,
            objectKey,
        } = req.params

        if (!isTransientMediaObjectKey(objectKey))
            return res.status(400).json({ error: 'INVALID_TRANSIENT_MEDIA_KEY' })

        const mimeType = getTransientMediaMimeType(objectKey)

        if (!mimeType)
            return res.status(415).json({ error: 'UNSUPPORTED_TRANSIENT_MEDIA_TYPE' })

        const workspace = await Workspace.getWorkspace({
            userId: req.user.userId,
            workspaceId,
        })

        if ('error' in workspace)
            return res.status(workspace.error === 'NOT_FOUND' ? 404 : 403).json(workspace)

        const natsService = NATS_Service.getInstance()

        if (!natsService)
            return res.status(503).json({ error: 'STORAGE_UNAVAILABLE' })

        const bytes = await natsService.getObject(
            getTransientMediaBucketName(workspace.organizationId),
            objectKey,
        )

        if (!bytes)
            return res.status(404).json({ error: 'TRANSIENT_MEDIA_NOT_FOUND' })

        const buffer = Buffer.from(bytes)
        res.setHeader('Content-Type', mimeType)
        res.setHeader('Cache-Control', 'private, no-store')
        const range = req.headers.range

        if (
            (mimeType.startsWith('audio/') || mimeType.startsWith('video/'))
            && range
        ) {
            const match = /bytes=(\d+)-(\d*)/.exec(range)

            if (!match)
                return res.status(416).end()

            const start = Number(match[1])
            const end = match[2] ? Number(match[2]) : buffer.length - 1

            if (
                start < 0
                || end >= buffer.length
                || start > end
            )
                return res.status(416).end()

            const chunk = buffer.subarray(start, end + 1)
            res.status(206)
            res.setHeader('Accept-Ranges', 'bytes')
            res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`)
            res.setHeader('Content-Length', chunk.length)

            return res.end(chunk)
        }

        res.setHeader('Content-Length', buffer.length)

        return res.end(buffer)
    },
)

export default router
