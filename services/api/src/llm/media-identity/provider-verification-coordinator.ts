'use strict'

import * as process from 'node:process'
import {
    createHash,
    createHmac,
    timingSafeEqual,
} from 'node:crypto'
import { v4 as uuid } from 'uuid'

import type {
    AssetRequesterContext,
    MediaGenerationRequest,
    ProviderIdentityVerification,
    ProviderName,
    ProviderVerificationSession,
} from '@lixpi/constants'

import AssetModel from '../../models/asset.ts'
import MediaGenerationRequestModel from '../../models/media-generation-request.ts'
import AssetSubjectIdentityService from '../../services/asset-subject-identity-service.ts'
import { MediaGenerationRequestEventLog } from '../../services/media-generation-request-event-log.ts'
import { updateMediaGenerationOperationNode } from '../../services/media-generation-operation-projection.ts'

const SESSION_DURATION_MS = 15 * 60 * 1000

type VerificationState = {
    sessionId: string
    generationRequestId: string
    workspaceId: string
    userId: string
    provider: ProviderName
    assetId: string
    assetRevision: number
    nonce: string
    expiresAt: number
}

const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')
const decode = (value: string): string => Buffer.from(value, 'base64url').toString('utf8')
const stateSecret = (): string => {
    const secret = process.env.PROVIDER_VERIFICATION_STATE_SECRET
    if (!secret || secret.length < 32) throw new Error('PROVIDER_VERIFICATION_STATE_SECRET_REQUIRED')
    return secret
}
const sign = (payload: string): string => createHmac('sha256', stateSecret()).update(payload).digest('base64url')
const hashNonce = (nonce: string): string => createHash('sha256').update(nonce).digest('hex')

export const normalizeProviderExpiresAt = (expiresAt: number): number => (
    expiresAt < 1_000_000_000_000 ? expiresAt * 1_000 : expiresAt
)

export const createProviderVerificationState = (state: VerificationState): string => {
    const payload = encode(JSON.stringify(state))
    return `${payload}.${sign(payload)}`
}

export const verifyProviderVerificationState = (token: string): VerificationState => {
    const [payload, signature] = token.split('.')
    if (!payload || !signature) throw new Error('PROVIDER_VERIFICATION_STATE_INVALID')
    const expected = Buffer.from(sign(payload))
    const actual = Buffer.from(signature)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        throw new Error('PROVIDER_VERIFICATION_STATE_INVALID')
    }
    const state = JSON.parse(decode(payload)) as VerificationState
    if (!state.sessionId || !state.nonce || state.expiresAt <= Date.now()) throw new Error('PROVIDER_VERIFICATION_STATE_EXPIRED')
    return state
}

const createBytePlusSession = async (callbackUrl: string): Promise<{
    verificationUrl: string
    providerSessionToken: string
    expiresAt?: number
}> => {
    const endpoint = process.env.BYTEPLUS_IDENTITY_VERIFICATION_SESSION_URL
        ?? process.env.BYTEPLUS_IDENTITY_VERIFICATION_URL
    const apiKey = process.env.ARK_API_KEY
    if (!endpoint || !apiKey) throw new Error('BYTEPLUS_IDENTITY_VERIFICATION_NOT_CONFIGURED')
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ callback_url: callbackUrl, project_name: process.env.BYTEPLUS_PROJECT_NAME ?? 'default' }),
    })
    const body = await response.json() as {
        h5_link?: string
        byted_token?: string
        expires_at?: number
        error?: { code?: string }
    }
    if (!response.ok || !body.h5_link || !body.byted_token) {
        throw new Error(`BYTEPLUS_IDENTITY_VERIFICATION_SESSION_FAILED:${body.error?.code ?? `HTTP_${response.status}`}`)
    }
    return {
        verificationUrl: body.h5_link,
        providerSessionToken: body.byted_token,
        ...(body.expires_at ? { expiresAt: body.expires_at } : {}),
    }
}

const exchangeBytePlusResult = async (resultToken: string): Promise<{ subjectHandle: string; expiresAt?: number }> => {
    const endpoint = process.env.BYTEPLUS_IDENTITY_VERIFICATION_EXCHANGE_URL
    const apiKey = process.env.ARK_API_KEY
    if (!endpoint || !apiKey) throw new Error('BYTEPLUS_IDENTITY_VERIFICATION_EXCHANGE_NOT_CONFIGURED')
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ byted_token: resultToken, project_name: process.env.BYTEPLUS_PROJECT_NAME ?? 'default' }),
    })
    const body = await response.json() as { subject_handle?: string; expires_at?: number; error?: { code?: string; message?: string } }
    if (!response.ok || !body.subject_handle) {
        const detail = body.error?.code ?? `HTTP_${response.status}`
        throw new Error(`BYTEPLUS_IDENTITY_VERIFICATION_EXCHANGE_FAILED:${detail}`)
    }
    return {
        subjectHandle: body.subject_handle,
        ...(body.expires_at ? { expiresAt: body.expires_at } : {}),
    }
}

export class ProviderVerificationCoordinator {
    async start({
        generationRequestId,
        workspaceId,
        userId,
        requestRevision,
        generationRun,
        assetId,
        requester,
    }: {
        generationRequestId: string
        workspaceId: string
        userId: string
        requestRevision: number
        generationRun: number
        assetId: string
        requester: AssetRequesterContext
    }): Promise<{ verificationUrl: string; expiresAt: number; requestRevision: number }> {
        const authorized = await MediaGenerationRequestModel.getAuthorized({ generationRequestId, workspaceId, userId })
        if ('error' in authorized) throw new Error(authorized.error)
        if (authorized.revision !== requestRevision) throw new Error('STALE_MEDIA_REQUEST_REVISION')
        const run = authorized.runs.find(candidate => candidate.generationRun === generationRun)
        if (!run || run.provider !== 'BytePlus') throw new Error('PROVIDER_VERIFICATION_RUN_UNSUPPORTED')
        if (!run.requiredVerificationAssetIds?.includes(assetId)) {
            throw new Error('PROVIDER_VERIFICATION_ASSET_NOT_REQUIRED')
        }
        const asset = await AssetModel.get({ assetId, requester })
        if ('error' in asset || !authorized.bindings.some(binding => binding.assetId === assetId)) {
            throw new Error('PROVIDER_VERIFICATION_ASSET_NOT_AUTHORIZED')
        }
        if (
            asset.subjectIdentity.classification !== 'self'
            && asset.subjectIdentity.classification !== 'authorized-real-person'
        ) {
            throw new Error('PROVIDER_VERIFICATION_IDENTITY_CLASSIFICATION_REQUIRED')
        }
        const providerAccountScope = process.env.BYTEPLUS_ACCOUNT_SCOPE
        if (!providerAccountScope || !process.env.API_PUBLIC_URL) throw new Error('BYTEPLUS_IDENTITY_VERIFICATION_NOT_CONFIGURED')
        const now = Date.now()
        const expiresAt = now + SESSION_DURATION_MS
        const nonce = uuid()
        const sessionId = uuid()
        const state: VerificationState = {
            sessionId,
            generationRequestId,
            workspaceId,
            userId,
            provider: 'BytePlus',
            assetId,
            assetRevision: asset.revision,
            nonce,
            expiresAt,
        }
        const token = createProviderVerificationState(state)
        const callbackUrl = new URL('/api/provider-verification/byteplus/callback', process.env.API_PUBLIC_URL)
        callbackUrl.searchParams.set('state', token)
        const providerSession = await createBytePlusSession(callbackUrl.toString())
        const providerExpiresAt = providerSession.expiresAt === undefined
            ? expiresAt
            : normalizeProviderExpiresAt(providerSession.expiresAt)
        const session: ProviderVerificationSession = {
            sessionId,
            generationRun,
            provider: 'BytePlus',
            assetId,
            providerAccountScope,
            status: 'pending',
            stateNonceHash: hashNonce(nonce),
            providerSessionTokenHash: hashNonce(providerSession.providerSessionToken),
            expiresAt: Math.min(expiresAt, providerExpiresAt),
            createdAt: now,
        }
        const next: MediaGenerationRequest = {
            ...authorized,
            status: 'action-required',
            runs: authorized.runs.map(candidate =>
                candidate.generationRun === generationRun
                    ? {
                        ...candidate,
                        status: 'awaiting-provider-verification',
                        requiredVerificationAssetIds: [assetId],
                    }
                    : candidate
            ),
            verificationSessions: [...(authorized.verificationSessions ?? []), session],
            revision: authorized.revision + 1,
            updatedAt: now,
            statusUpdatedAt: now,
        }
        await MediaGenerationRequestModel.transition({ request: next, expectedRevision: authorized.revision })
        await updateMediaGenerationOperationNode({
            workspaceId,
            operationNodeId: run.operationNodeId,
            status: 'action-required',
            message: 'BytePlus requires identity verification for this reference.',
            requestRevision: next.revision,
            verificationAssetId: assetId,
        })
        await MediaGenerationRequestEventLog.fromSingleton().append({
            userId,
            workspaceId,
            event: {
                eventId: uuid(),
                generationRequestId,
                sequence: next.revision,
                status: 'MEDIA_GENERATION_ACTION_REQUIRED',
                requestRevision: next.revision,
                payload: {
                    status: next.status,
                    generationRun,
                    verificationProvider: run.provider,
                    sessionExpiresAt: session.expiresAt,
                },
                createdAt: now,
            },
        })
        return {
            verificationUrl: providerSession.verificationUrl,
            expiresAt: session.expiresAt,
            requestRevision: next.revision,
        }
    }

    async complete({ stateToken, resultToken, userId, requester }: {
        stateToken: string
        resultToken: string
        userId: string
        requester: AssetRequesterContext
    }): Promise<MediaGenerationRequest> {
        if (!resultToken || resultToken.length > 4096) throw new Error('PROVIDER_VERIFICATION_RESULT_TOKEN_INVALID')
        const state = verifyProviderVerificationState(stateToken)
        if (state.userId !== userId) throw new Error('PROVIDER_VERIFICATION_USER_MISMATCH')
        const authorized = await MediaGenerationRequestModel.getAuthorized({
            generationRequestId: state.generationRequestId,
            workspaceId: state.workspaceId,
            userId,
        })
        if ('error' in authorized) throw new Error(authorized.error)
        const session = authorized.verificationSessions?.find(candidate => candidate.sessionId === state.sessionId)
        if (!session || session.status !== 'pending') throw new Error('PROVIDER_VERIFICATION_SESSION_REPLAYED')
        if (session.expiresAt <= Date.now() || session.stateNonceHash !== hashNonce(state.nonce)) {
            throw new Error('PROVIDER_VERIFICATION_SESSION_EXPIRED')
        }
        if (
            !session.providerSessionTokenHash
            || session.providerSessionTokenHash !== hashNonce(resultToken)
        ) {
            throw new Error('PROVIDER_VERIFICATION_RESULT_TOKEN_MISMATCH')
        }
        const exchange = await exchangeBytePlusResult(resultToken)
        const providerHandleExpiresAt = exchange.expiresAt === undefined
            ? undefined
            : normalizeProviderExpiresAt(exchange.expiresAt)
        if (providerHandleExpiresAt !== undefined && providerHandleExpiresAt <= Date.now()) {
            throw new Error('PROVIDER_VERIFICATION_HANDLE_EXPIRED')
        }
        const verification: ProviderIdentityVerification = {
            provider: 'BytePlus',
            providerAccountScope: session.providerAccountScope,
            strategy: 'provider-hosted-session',
            subjectHandle: exchange.subjectHandle,
            status: 'valid',
            verifiedAt: Date.now(),
            ...(providerHandleExpiresAt ? { expiresAt: providerHandleExpiresAt } : {}),
            derivativeReuse: 'documented-lineage',
            policyProfileVersion: 'byteplus-media-policy-v1',
        }
        const updatedAsset = await new AssetSubjectIdentityService().addProviderVerification({
            assetId: state.assetId,
            assetRevision: state.assetRevision,
            verification,
            requester,
        })
        if ('error' in updatedAsset) throw new Error(updatedAsset.error)
        const now = Date.now()
        const updatedBindings = authorized.bindings.map(binding =>
            binding.assetId === updatedAsset.assetId
                ? {
                    ...binding,
                    assetRevision: updatedAsset.revision,
                    depictionMedium: updatedAsset.depictionMedium,
                    subjectIdentity: updatedAsset.subjectIdentity,
                }
                : binding
        )
        const verificationRun = authorized.runs.find(run => run.generationRun === session.generationRun)
        if (!verificationRun) throw new Error('PROVIDER_VERIFICATION_RUN_NOT_FOUND')
        const remainingVerificationAssetIds = (verificationRun.requiredVerificationAssetIds ?? [])
            .filter(assetId =>
                !updatedBindings.some(binding => (
                    binding.assetId === assetId
                    && binding.subjectIdentity.providerVerifications.some(candidate => (
                        candidate.provider === session.provider
                        && candidate.providerAccountScope === session.providerAccountScope
                        && candidate.status === 'valid'
                        && (candidate.expiresAt === undefined || candidate.expiresAt > now)
                    ))
                ))
            )
        const resumedRuns = authorized.runs.map(run => {
            if (run.generationRun !== session.generationRun) return run
            if (remainingVerificationAssetIds.length > 0) {
                return {
                    ...run,
                    status: 'awaiting-provider-verification' as const,
                    requiredVerificationAssetIds: remainingVerificationAssetIds,
                }
            }
            const { requiredVerificationAssetIds: _required, problem: _problem, ...rest } = run
            return { ...rest, status: 'pending' as const }
        })
        const hasOtherActionRequired = resumedRuns.some(run => run.status === 'awaiting-provider-verification')
        const next: MediaGenerationRequest = {
            ...authorized,
            status: hasOtherActionRequired ? 'action-required' : 'submitted',
            bindings: updatedBindings,
            runs: resumedRuns,
            verificationSessions: (authorized.verificationSessions ?? []).map(candidate =>
                candidate.sessionId === session.sessionId
                    ? {
                        ...candidate,
                        status: 'consumed',
                        consumedAt: now,
                    }
                    : candidate
            ),
            revision: authorized.revision + 1,
            updatedAt: now,
            statusUpdatedAt: now,
        }
        await MediaGenerationRequestModel.transition({ request: next, expectedRevision: authorized.revision })
        const resumedRun = next.runs.find(run => run.generationRun === session.generationRun)!
        await updateMediaGenerationOperationNode({
            workspaceId: state.workspaceId,
            operationNodeId: resumedRun.operationNodeId,
            status: remainingVerificationAssetIds.length > 0 ? 'action-required' : 'in-progress',
            message: remainingVerificationAssetIds.length > 0
                ? 'BytePlus requires identity verification for another reference.'
                : 'Verification completed. Resuming the media request.',
            requestRevision: next.revision,
            ...(remainingVerificationAssetIds[0]
                ? {
                    verificationAssetId: remainingVerificationAssetIds[0],
                }
                : { clearAction: true }),
        })
        await MediaGenerationRequestEventLog.fromSingleton().append({
            userId,
            workspaceId: state.workspaceId,
            event: {
                eventId: uuid(),
                generationRequestId: state.generationRequestId,
                sequence: next.revision,
                status: remainingVerificationAssetIds.length > 0
                    ? 'MEDIA_GENERATION_ACTION_REQUIRED'
                    : 'MEDIA_GENERATION_REQUEST_STATUS',
                requestRevision: next.revision,
                payload: {
                    status: next.status,
                    verificationProvider: state.provider,
                    ...(remainingVerificationAssetIds[0]
                        ? {
                            verificationAssetId: remainingVerificationAssetIds[0],
                        }
                        : {}),
                },
                createdAt: now,
            },
        })
        return next
    }
}
