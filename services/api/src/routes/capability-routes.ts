import { Router } from 'express'

import { jwtVerifier } from '../helpers/auth.ts'
import CapabilityModel from '../models/capability.ts'
import { getAssetRequesterContext } from '../services/asset-requester-context.ts'

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
    '/:capabilityId/resources/:resourceId',
    authenticateRequest,
    async (req: any, res: any) => {
        try {
            const assetRequester = await getAssetRequesterContext(req.user.userId)
            const resource = await CapabilityModel.readResource({
                capabilityId: req.params.capabilityId,
                resourceId: req.params.resourceId,
                manifestBlobHash: typeof req.query.manifestBlobHash === 'string' ? req.query.manifestBlobHash : undefined,
                requester: {
                    userId: req.user.userId,
                    organizationIds: assetRequester.organizationIds,
                },
            })
            res.setHeader('Content-Type', resource.mediaType)
            res.setHeader('Cache-Control', 'private, no-cache')
            res.setHeader('ETag', `"${resource.blobHash}"`)
            res.setHeader('Content-Length', resource.bytes.byteLength)

            return res.end(
                Buffer.from(resource.bytes),
            )
        } catch (error) {
            const message = (error as Error).message
            const status = message === 'NOT_FOUND'
                || message === 'CAPABILITY_RESOURCE_NOT_FOUND'
                || message === 'BLOB_NOT_FOUND'
                ? 404
                : message === 'PERMISSION_DENIED'
                    ? 403
                    : 422

            return res.status(status).json({ error: message })
        }
    },
)

export default router
