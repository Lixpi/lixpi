import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type Asset,
    type ConversationHumanAction,
} from '@lixpi/constants'
import { canvasLeaseTransaction } from '../services/canvas-collaboration-transaction.ts'
import { bindCanvasFileUpload, verifyCanvasHumanAction } from './canvas-handoff-adapter.ts'

const mocks = vi.hoisted(() => ({
    asset: vi.fn(),
    generation: vi.fn(),
    attestation: vi.fn(),
}))
vi.mock('../models/asset.ts', () => ({
    default: { get: mocks.asset },
    canEditAssetMetadata: vi.fn(async () => true),
}))
vi.mock('../models/media-generation-request.ts', () => ({
    default: { getAuthorized: mocks.generation },
}))
vi.mock('../services/asset-requester-context.ts', () => ({
    getAssetRequesterContext: vi.fn(async userId => ({
        userId,
        workspaceIds: ['workspace'],
        editableWorkspaceIds: ['workspace'],
        organizationIds: ['organization'],
    })),
}))

const principal = {
    userId: 'person',
    workspaceId: 'workspace',
    organizationId: 'organization',
}
const issuedAt = 10
const asset = {
    assetId: 'asset',
    ownerUserId: 'person',
    scope: 'workspace',
    scopeOwnerId: 'workspace',
    originWorkspaceId: 'workspace',
    organizationId: 'organization',
    createdAt: 11,
    revision: 5,
    states: { lifecycle: 'active' },
    media: { renditions: { original: { status: 'ready' } } },
    subjectIdentity: {
        currentAttestationId: 'attestation',
        providerVerifications: [{
            provider: 'BytePlus',
            providerAccountScope: 'scope',
            status: 'valid',
        }],
    },
} as Asset

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('dynamoDBService', { getItem: mocks.attestation })
    mocks.asset.mockResolvedValue(asset)
})

describe('verified canvas handoff completions', () => {
    it('binds the device upload to the precise waiting interrupt and guards its write', async () => {
        const meta = {
            workspaceId: principal.workspaceId,
            run: {
                state: 'waiting-input',
                interruptId: 'interrupt',
                humanAction: {
                    kind: 'file',
                    userId: principal.userId,
                    assetId: asset.assetId,
                },
            },
        }
        mocks.attestation.mockResolvedValue(meta)
        const binding = await bindCanvasFileUpload(principal, 'conversation', 'interrupt')

        expect(binding.assetId).toBe('asset')
        const fence = await binding.withAssetWrite(async () => await canvasLeaseTransaction.getStore()?.())
        expect(fence).toEqual([expect.objectContaining({
            type: 'check',
            expressionAttributeValues: {
                ':interrupt': 'interrupt',
                ':waiting': 'waiting-input',
                ':asset': 'asset',
                ':user': principal.userId,
            },
        })])

        await expect(bindCanvasFileUpload(principal, 'conversation', 'stale-interrupt')).rejects.toThrow('CONVERSATION_FILE_UPLOAD_UNAVAILABLE')
        await expect(bindCanvasFileUpload({
            ...principal,
            userId: 'another-person',
        }, 'conversation', 'interrupt')).rejects.toThrow('CONVERSATION_FILE_UPLOAD_UNAVAILABLE')
    })

    it('accepts only a fresh Asset created for the requesting person in this workspace', async () => {
        const action: ConversationHumanAction = {
            kind: 'file',
            userId: principal.userId,
            issuedAt,
            assetId: asset.assetId,
        }
        const result = { assetId: asset.assetId }

        await expect(verifyCanvasHumanAction(action, result, principal)).resolves.toEqual({
            kind: 'file',
            assetId: asset.assetId,
        })
        mocks.asset.mockResolvedValueOnce({
            ...asset,
            createdAt: issuedAt - 1,
        })
        await expect(verifyCanvasHumanAction(action, result, principal)).resolves.toBeUndefined()
        mocks.asset.mockResolvedValueOnce({
            ...asset,
            ownerUserId: 'somebody-else',
        })
        await expect(verifyCanvasHumanAction(action, result, principal)).resolves.toBeUndefined()
        await expect(verifyCanvasHumanAction(action, result, {
            ...principal,
            userId: 'somebody-else',
        })).resolves.toBeUndefined()
    })

    it('requires the current Asset attestation of the requested kind signed by the requester', async () => {
        const action: ConversationHumanAction = {
            kind: 'attestation',
            userId: principal.userId,
            issuedAt,
            assetId: asset.assetId,
            assetRevision: 4,
            title: 'Portrait',
            classification: 'self',
        }
        const attestation = {
            assetId: 'asset',
            assetRevision: 5,
            organizationId: principal.organizationId,
            attestedByUserId: principal.userId,
            createdAt: issuedAt + 1,
            classification: 'self',
            status: 'active',
        }
        mocks.attestation.mockResolvedValueOnce(attestation).mockResolvedValueOnce({
            ...attestation,
            attestedByUserId: 'another-editor',
        })

        await expect(verifyCanvasHumanAction(action, {}, principal)).resolves.toEqual({
            kind: 'attestation',
            assetId: asset.assetId,
        })
        await expect(verifyCanvasHumanAction(action, {}, principal)).resolves.toBeUndefined()
    })

    it('requires a newly consumed provider session for the same requester, Asset and generation run', async () => {
        const action: ConversationHumanAction = {
            kind: 'provider-verification',
            userId: principal.userId,
            issuedAt,
            assetId: asset.assetId,
            generationRequestId: 'generation',
            generationRun: 1,
            requestRevision: 2,
        }
        const session = {
            requestedByUserId: principal.userId,
            assetId: asset.assetId,
            generationRun: 1,
            createdAt: issuedAt + 1,
            consumedAt: issuedAt + 2,
            status: 'consumed',
            provider: 'BytePlus',
            providerAccountScope: 'scope',
        }
        const generation = {
            userId: principal.userId,
            organizationId: principal.organizationId,
            revision: 4,
            runs: [{ generationRun: 1 }],
            verificationSessions: [session],
        }
        mocks.generation.mockResolvedValueOnce(generation).mockResolvedValueOnce({
            ...generation,
            verificationSessions: [{
                ...session,
                generationRun: 2,
            }],
        })

        await expect(verifyCanvasHumanAction(action, {}, principal)).resolves.toEqual({
            kind: 'provider-verification',
            assetId: asset.assetId,
        })
        await expect(verifyCanvasHumanAction(action, {}, principal)).resolves.toBeUndefined()
    })
})
