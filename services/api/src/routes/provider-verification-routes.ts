'use strict'

import { Router } from 'express'

import { jwtVerifier } from '../helpers/auth.ts'
import {
    ProviderVerificationCoordinator,
    verifyProviderVerificationState,
} from '../llm/media-identity/provider-verification-coordinator.ts'
import { resumeAiInteractionMediaGenerationRequest } from '../NATS/subscriptions/ai-interaction-subjects.ts'
import { getAssetRequesterContext } from '../services/asset-requester-context.ts'

const router = Router()

const authenticateRequest = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined
    if (!token) return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' })
    const { decoded, error } = await jwtVerifier.verify(token)
    if (error || !decoded) return res.status(401).json({ error: 'INVALID_ACCESS_TOKEN' })
    req.user = { userId: decoded.sub }
    next()
}

router.post('/byteplus/callback', authenticateRequest, async (req: any, res: any) => {
    if (typeof req.body?.state !== 'string' || typeof req.body?.resultToken !== 'string') {
        return res.status(400).json({ error: 'PROVIDER_VERIFICATION_CALLBACK_INVALID' })
    }
    try {
        const userId = req.user.userId as string
        const request = await new ProviderVerificationCoordinator().complete({
            stateToken: req.body.state,
            resultToken: req.body.resultToken,
            userId,
            requester: await getAssetRequesterContext(userId),
        })
        if (request.status === 'submitted') {
            await resumeAiInteractionMediaGenerationRequest({ request, user: { userId } })
        }
        return res.json({
            generationRequestId: request.generationRequestId,
            workspaceId: request.workspaceId,
            status: request.status,
            requestRevision: request.revision,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const conflict = /REPLAYED|EXPIRED|REVISION_CONFLICT/u.test(message)
        return res.status(conflict ? 409 : 400).json({ error: message })
    }
})

router.get('/byteplus/callback', async (req: any, res: any) => {
    if (typeof req.query?.state !== 'string'
        || typeof req.query?.bytedToken !== 'string'
        || req.query.bytedToken.length > 4096
        || req.query.resultCode !== '10000') {
        return res.status(400).send('Provider verification did not complete successfully.')
    }
    try {
        const state = verifyProviderVerificationState(req.query.state)
        const request = await new ProviderVerificationCoordinator().complete({
            stateToken: req.query.state,
            resultToken: req.query.bytedToken,
            userId: state.userId,
            requester: await getAssetRequesterContext(state.userId),
        })
        if (request.status === 'submitted') {
            await resumeAiInteractionMediaGenerationRequest({ request, user: { userId: state.userId } })
        }
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        return res.send('<!doctype html><meta charset="utf-8"><title>Verification complete</title><p>Verification complete. You can close this window.</p>')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const conflict = /REPLAYED|EXPIRED|MISMATCH|REVISION_CONFLICT/u.test(message)
        return res.status(conflict ? 409 : 400).send('Provider verification could not be completed.')
    }
})

export default router
