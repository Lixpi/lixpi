'use strict'

import {
    ACCESS_LEVEL,
    type MediaGenerationRequest,
} from '@lixpi/constants'
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const { workspaceGetMock } = vi.hoisted(() => ({
    workspaceGetMock: vi.fn(),
}))

vi.mock('./workspace.ts', () => ({
    default: { getWorkspace: workspaceGetMock },
}))

import MediaGenerationRequestModel from './media-generation-request.ts'

const dynamo = {
    getItem: vi.fn(),
    queryItems: vi.fn(),
    transactWrite: vi.fn(),
}

const request: MediaGenerationRequest = {
    generationRequestId: 'media-request-1',
    workspaceId: 'workspace-1',
    organizationId: 'organization-1',
    userId: 'owner-1',
    conversationAssetId: 'conversation-1',
    status: 'submitted',
    checkpointBlobHash: 'a'.repeat(64),
    checkpointSchemaVersion: 'media-generation-checkpoint-v1',
    bindings: [],
    unresolvedBindings: [],
    resolvedReferences: [],
    runs: [],
    plannedCanvasNodeIds: [],
    revision: 1,
    createdAt: 10,
    updatedAt: 10,
    statusUpdatedAt: 10,
}

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamo
    dynamo.transactWrite.mockResolvedValue(undefined)
})

describe('MediaGenerationRequest.create', () => {
    it('atomically writes the request, meta projection, owner access, and workspace access', async () => {
        await MediaGenerationRequestModel.create(request)

        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        const transaction = dynamo.transactWrite.mock.calls[0][0]
        expect(transaction.origin).toBe('MediaGenerationRequest.create')
        expect(transaction.operations).toHaveLength(4)
        expect(transaction.operations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'put',
                item: request,
                conditionExpression: 'attribute_not_exists(#generationRequestId)',
            }),
            expect.objectContaining({
                type: 'put',
                item: expect.objectContaining({
                    generationRequestId: request.generationRequestId,
                    workspaceId: request.workspaceId,
                    status: request.status,
                    revision: request.revision,
                }),
            }),
            expect.objectContaining({
                item: expect.objectContaining({
                    principalId: 'user#owner-1',
                    accessLevel: ACCESS_LEVEL.OWNER,
                }),
            }),
            expect.objectContaining({
                item: expect.objectContaining({
                    principalId: 'workspace#workspace-1',
                    accessLevel: ACCESS_LEVEL.OWNER,
                }),
            }),
        ]))
    })
})

describe('MediaGenerationRequest.transition', () => {
    it('requires an exact single revision increment before writing', async () => {
        await expect(MediaGenerationRequestModel.transition({
            request: { ...request, revision: 3 },
            expectedRevision: 1,
        })).rejects.toThrow('MEDIA_REQUEST_REVISION_INCREMENT_REQUIRED')

        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })

    it('conditions both primary and meta writes on the expected revision', async () => {
        const transitioned = { ...request, status: 'running' as const, revision: 2, updatedAt: 20, statusUpdatedAt: 20 }

        await MediaGenerationRequestModel.transition({ request: transitioned, expectedRevision: 1 })

        const transaction = dynamo.transactWrite.mock.calls[0][0]
        expect(transaction.origin).toBe('MediaGenerationRequest.transition')
        expect(transaction.operations).toEqual([
            expect.objectContaining({
                item: transitioned,
                conditionExpression: '#revision = :expectedRevision AND attribute_not_exists(#deletingAt)',
                expressionAttributeValues: { ':expectedRevision': 1 },
            }),
            expect.objectContaining({
                item: expect.objectContaining({ revision: 2, status: 'running' }),
                conditionExpression: '#revision = :expectedRevision',
                expressionAttributeValues: { ':expectedRevision': 1 },
            }),
        ])
    })
})

describe('MediaGenerationRequest.delete', () => {
    it('conditionally removes the request, meta projection, and both access rows', async () => {
        await MediaGenerationRequestModel.delete(request)

        const transaction = dynamo.transactWrite.mock.calls[0][0]
        expect(transaction.origin).toBe('MediaGenerationRequest.delete')
        expect(transaction.operations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'delete',
                key: { generationRequestId: request.generationRequestId, workspaceId: request.workspaceId },
                expressionAttributeValues: { ':expectedRevision': request.revision },
            }),
            expect.objectContaining({
                type: 'delete',
                key: { workspaceId: request.workspaceId, generationRequestId: request.generationRequestId },
                expressionAttributeValues: { ':expectedRevision': request.revision },
            }),
            expect.objectContaining({
                type: 'delete',
                key: { generationRequestId: request.generationRequestId, principalId: 'user#owner-1' },
            }),
            expect.objectContaining({
                type: 'delete',
                key: { generationRequestId: request.generationRequestId, principalId: 'workspace#workspace-1' },
            }),
        ]))
    })
})

describe('MediaGenerationRequest.getAuthorized', () => {
    it('allows the submitting owner without an access-list lookup', async () => {
        dynamo.getItem.mockResolvedValueOnce(request)

        await expect(MediaGenerationRequestModel.getAuthorized({
            generationRequestId: request.generationRequestId,
            workspaceId: request.workspaceId,
            userId: request.userId,
        })).resolves.toEqual(request)

        expect(dynamo.getItem).toHaveBeenCalledTimes(1)
    })

    it('allows a current workspace collaborator to read through the workspace principal', async () => {
        dynamo.getItem
            .mockResolvedValueOnce(request)
            .mockResolvedValueOnce({
                generationRequestId: request.generationRequestId,
                principalId: 'workspace#workspace-1',
                accessLevel: ACCESS_LEVEL.OWNER,
            })
        workspaceGetMock.mockResolvedValue({ workspaceId: request.workspaceId })

        await expect(MediaGenerationRequestModel.getAuthorized({
            generationRequestId: request.generationRequestId,
            workspaceId: request.workspaceId,
            userId: 'collaborator-1',
            requiredAccess: 'read',
        })).resolves.toEqual(request)

        expect(workspaceGetMock).toHaveBeenCalledWith({
            workspaceId: request.workspaceId,
            userId: 'collaborator-1',
        })
    })

    it('rejects a non-owner access row for an owner-only mutation', async () => {
        dynamo.getItem
            .mockResolvedValueOnce(request)
            .mockResolvedValueOnce({
                generationRequestId: request.generationRequestId,
                principalId: 'user#viewer-1',
                accessLevel: ACCESS_LEVEL.VIEWER,
            })

        await expect(MediaGenerationRequestModel.getAuthorized({
            generationRequestId: request.generationRequestId,
            workspaceId: request.workspaceId,
            userId: 'viewer-1',
            requiredAccess: 'owner',
        })).resolves.toEqual({ error: 'PERMISSION_DENIED' })
    })
})
