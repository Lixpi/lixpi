'use strict'

import { createHash } from 'node:crypto'

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import type {
    Asset,
    MediaGenerationRequest,
    MediaReferenceBinding,
    ProviderIdentityVerification,
} from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    getAuthorized: vi.fn(),
    transition: vi.fn(),
    addProviderVerification: vi.fn(),
    appendEvent: vi.fn(),
    updateOperationNode: vi.fn(),
}))

vi.mock('../../models/media-generation-request.ts', () => ({
    default: {
        getAuthorized: mocks.getAuthorized,
        transition: mocks.transition,
    },
}))

vi.mock('../../models/asset.ts', () => ({ default: { get: vi.fn() } }))

vi.mock('../../services/asset-subject-identity-service.ts', () => ({
    default: class {
        addProviderVerification = mocks.addProviderVerification
    },
}))

vi.mock('../../services/media-generation-request-event-log.ts', () => ({
    MediaGenerationRequestEventLog: class {
        static fromSingleton(): { append: typeof mocks.appendEvent } {
            return { append: mocks.appendEvent }
        }
    },
}))

vi.mock('../../services/media-generation-operation-projection.ts', () => ({
    updateMediaGenerationOperationNode: mocks.updateOperationNode,
}))

import {
    createProviderVerificationState,
    ProviderVerificationCoordinator,
} from './provider-verification-coordinator.ts'

const NOW = 1_800_000_000_000
const RESULT_TOKEN = 'provider-session-token'
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

const binding = (
    assetId: string,
    providerVerifications: ProviderIdentityVerification[] = [],
): MediaReferenceBinding => ({
    assetId,
    assetRevision: 3,
    mediaKind: 'image',
    alias: assetId === 'asset-1' ? 'REFERENCE_1' : 'REFERENCE_2',
    displayNameSnapshot: `Display ${assetId}`,
    forbiddenNameVariants: [`display ${assetId}`],
    semanticDescriptor: 'portrait reference',
    depictionMedium: 'photograph',
    subjectIdentity: {
        classification: 'self',
        source: 'user-attestation',
        identityGroupId: `subject-${assetId}`,
        currentAttestationId: `attestation-${assetId}`,
        providerVerifications,
    },
})

const request = (requiredVerificationAssetIds = ['asset-1']): MediaGenerationRequest => ({
    generationRequestId: 'request-1',
    workspaceId: 'workspace-1',
    organizationId: 'organization-1',
    userId: 'user-1',
    conversationAssetId: 'conversation-1',
    status: 'action-required',
    checkpointBlobHash: 'a'.repeat(64),
    checkpointSchemaVersion: 'media-generation-checkpoint-v1',
    bindings: requiredVerificationAssetIds.map(assetId => binding(assetId)),
    unresolvedBindings: [],
    resolvedReferences: [],
    runs: [{
        generationRun: 0,
        reasoningModelId: 'Anthropic:claude',
        reasoningIndex: 0,
        provider: 'BytePlus',
        modelId: 'BytePlus:seedance',
        status: 'awaiting-provider-verification',
        operationNodeId: 'operation-1',
        requiredVerificationAssetIds,
    }],
    verificationSessions: [{
        sessionId: 'session-1',
        generationRun: 0,
        provider: 'BytePlus',
        assetId: 'asset-1',
        providerAccountScope: 'account-1',
        status: 'pending',
        stateNonceHash: hash('nonce-1'),
        providerSessionTokenHash: hash(RESULT_TOKEN),
        expiresAt: NOW + 60_000,
        createdAt: NOW - 1_000,
    }],
    plannedCanvasNodeIds: ['operation-1'],
    revision: 3,
    createdAt: NOW - 10_000,
    updatedAt: NOW - 1_000,
    statusUpdatedAt: NOW - 1_000,
})

const stateToken = (): string =>
    createProviderVerificationState({
        sessionId: 'session-1',
        generationRequestId: 'request-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        provider: 'BytePlus',
        assetId: 'asset-1',
        assetRevision: 3,
        nonce: 'nonce-1',
        expiresAt: NOW + 60_000,
    })

const updatedAsset = (verification: ProviderIdentityVerification): Asset => ({
    assetId: 'asset-1',
    organizationId: 'organization-1',
    title: 'Display asset-1',
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    originWorkspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    media: {
        kind: 'image',
        originalName: 'portrait.png',
        sourceMimeType: 'image/png',
        modelSafe: true,
        renditions: {},
    },
    depictionMedium: 'photograph',
    subjectIdentity: {
        classification: 'self',
        source: 'user-attestation',
        identityGroupId: 'subject-asset-1',
        currentAttestationId: 'attestation-asset-1',
        providerVerifications: [verification],
    },
    documents: {},
    states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
    referenceCount: 1,
    revision: 4,
    createdAt: NOW - 10_000,
    updatedAt: NOW,
})

describe('ProviderVerificationCoordinator lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(Date, 'now').mockReturnValue(NOW)
        process.env.PROVIDER_VERIFICATION_STATE_SECRET = 'a-secure-test-secret-with-at-least-32-bytes'
        process.env.BYTEPLUS_IDENTITY_VERIFICATION_EXCHANGE_URL = 'https://byteplus.example/exchange'
        process.env.ARK_API_KEY = 'server-provider-credential'
        mocks.transition.mockResolvedValue(undefined)
        mocks.appendEvent.mockResolvedValue(undefined)
        mocks.updateOperationNode.mockResolvedValue(undefined)
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        subject_handle: 'provider-subject-handle',
                        expires_at: 1_900_000_000,
                    }),
                    { status: 200 },
                )
            ),
        )
        mocks.addProviderVerification.mockImplementation(async ({ verification }) => updatedAsset(verification))
    })

    afterEach(() => {
        delete process.env.PROVIDER_VERIFICATION_STATE_SECRET
        delete process.env.BYTEPLUS_IDENTITY_VERIFICATION_EXCHANGE_URL
        delete process.env.ARK_API_KEY
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('stores only the scoped provider handle and resumes the same request after the last verification', async () => {
        mocks.getAuthorized.mockResolvedValue(request())

        const completed = await new ProviderVerificationCoordinator().complete({
            stateToken: stateToken(),
            resultToken: RESULT_TOKEN,
            userId: 'user-1',
            requester: { userId: 'user-1' } as any,
        })

        expect(completed).toMatchObject({
            generationRequestId: 'request-1',
            status: 'submitted',
            revision: 4,
            runs: [{ status: 'pending' }],
            verificationSessions: [{ status: 'consumed', consumedAt: NOW }],
        })
        expect(mocks.addProviderVerification).toHaveBeenCalledWith(expect.objectContaining({
            verification: expect.objectContaining({
                subjectHandle: 'provider-subject-handle',
                providerAccountScope: 'account-1',
                expiresAt: 1_900_000_000_000,
            }),
        }))
        expect(JSON.stringify(mocks.addProviderVerification.mock.calls[0])).not.toContain(RESULT_TOKEN)
        expect(mocks.updateOperationNode).toHaveBeenCalledWith(expect.objectContaining({
            status: 'in-progress',
            clearAction: true,
        }))
    })

    it('keeps the same run action-required until every required Asset is verified', async () => {
        mocks.getAuthorized.mockResolvedValue(request(['asset-1', 'asset-2']))

        const completed = await new ProviderVerificationCoordinator().complete({
            stateToken: stateToken(),
            resultToken: RESULT_TOKEN,
            userId: 'user-1',
            requester: { userId: 'user-1' } as any,
        })

        expect(completed).toMatchObject({
            generationRequestId: 'request-1',
            status: 'action-required',
            runs: [{
                status: 'awaiting-provider-verification',
                requiredVerificationAssetIds: ['asset-2'],
            }],
        })
        expect(mocks.updateOperationNode).toHaveBeenCalledWith(expect.objectContaining({
            status: 'action-required',
            verificationAssetId: 'asset-2',
        }))
    })

    it('rejects consumed-session callback replay before exchanging the result token', async () => {
        const replayed = request()
        replayed.verificationSessions = replayed.verificationSessions?.map(session => ({
            ...session,
            status: 'consumed',
            consumedAt: NOW - 1,
        }))
        mocks.getAuthorized.mockResolvedValue(replayed)

        await expect(new ProviderVerificationCoordinator().complete({
            stateToken: stateToken(),
            resultToken: RESULT_TOKEN,
            userId: 'user-1',
            requester: { userId: 'user-1' } as any,
        })).rejects.toThrow('PROVIDER_VERIFICATION_SESSION_REPLAYED')
        expect(fetch).not.toHaveBeenCalled()
    })
})
