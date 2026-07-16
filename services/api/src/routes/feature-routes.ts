'use strict'

import { Router } from 'express'
import { err } from '@lixpi/debug-tools'
import { jwtVerifier } from '../helpers/auth.ts'
import Feature from '../models/feature.ts'
import Organization from '../models/organization.ts'
import Workspace from '../models/workspace.ts'
import { findFeatureSampleRef, readFeatureSampleObject } from '../services/feature-sample-storage.ts'

const router = Router()

const authenticateRequest = async (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : req.query.token
    if (!token) return res.status(401).json({ error: 'No authorization token provided' })
    try {
        const { decoded, error } = await jwtVerifier.verify(token)
        if (error || !decoded) return res.status(401).json({ error: 'Invalid or expired token' })
        req.user = { userId: decoded.sub }
        next()
    } catch (e: any) { err('Token verification failed:', e); return res.status(401).json({ error: 'Authentication failed' }) }
}

// GET /api/features/:featureId/samples/:sampleIndex
router.get('/:featureId/samples/:sampleIndex', authenticateRequest, async (req: any, res: any) => {
    const { featureId, sampleIndex } = req.params
    const { userId } = req.user
    const workspaceId = req.query.workspaceId as string | undefined
    const organizationId = req.query.organizationId as string | undefined
    const idx = parseInt(sampleIndex, 10)
    if (!Number.isSafeInteger(idx) || idx < 0) return res.status(400).json({ error: 'Invalid sample index' })

    try {
        const workspace = workspaceId ? await Workspace.getWorkspace({ userId, workspaceId }) : undefined
        const organization = organizationId ? await Organization.getOrganization({ userId, organizationId }) : undefined
        const resolvedOrganizationId = workspace && !('error' in workspace)
            ? workspace.organizationId
            : organization && !('error' in organization)
                ? organizationId
                : undefined
        const featureOrError = await Feature.getFeature({
            featureId,
            requesterContext: {
                userId,
                workspaceId: workspace && !('error' in workspace) ? workspaceId : undefined,
                organizationId: resolvedOrganizationId,
            },
        })
        if ('error' in featureOrError) return res.status(featureOrError.error === 'NOT_FOUND' ? 404 : 403).json({ error: featureOrError.error })

        const feature = featureOrError
        const sampleRef = findFeatureSampleRef(feature, idx)
        if (!sampleRef) return res.status(404).json({ error: 'Sample not found' })

        const data = await readFeatureSampleObject({ feature, sample: sampleRef })
        if (!data) return res.status(404).json({ error: 'Sample not found' })
        res.setHeader('Content-Type', sampleRef.ext === 'png' ? 'image/png' : 'image/jpeg')
        res.setHeader('Content-Length', data.length)
        res.setHeader('Cache-Control', 'private, max-age=3600')
        res.send(Buffer.from(data))
    } catch (e: any) {
        err(`Feature sample retrieval failed ${featureId}[${idx}]:`, e)
        return res.status(500).json({ error: 'Failed to retrieve sample image' })
    }
})

export default router
