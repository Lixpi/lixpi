'use strict'

import type { Asset, AssetReference, CanvasState } from '@lixpi/constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: vi.fn(() => undefined) },
}))
vi.mock('./blob.ts', () => ({
    default: {},
    buildBlobReferenceBatchOperations: vi.fn(async () => []),
}))
vi.mock('../services/blob-storage.ts', () => ({
    ensureOrganizationAssetStorage: vi.fn(),
}))
vi.mock('../services/asset-maintenance-queue.ts', () => ({
    enqueueAssetDeletion: vi.fn(),
}))

import AssetModel, { buildAssetWorkspaceReferenceKey } from './asset.ts'

const dynamo = {
    getItem: vi.fn(),
    queryItems: vi.fn(),
    transactWrite: vi.fn(),
}

const asset: Asset = {
    assetId: 'asset-1',
    organizationId: 'organization-1',
    title: 'Generated image',
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    originWorkspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    documents: {},
    states: {
        lifecycle: 'creating',
        media: 'processing',
        conversation: 'none',
        provenance: 'building',
    },
    referenceCount: 2,
    revision: 3,
    createdAt: 1,
    updatedAt: 10,
}

const reference: AssetReference = {
    assetId: 'asset-1',
    referenceKey: buildAssetWorkspaceReferenceKey('workspace-1'),
    type: 'workspace',
    workspaceId: 'workspace-1',
    nodeIds: ['node-1'],
    surfaceIds: [],
    createdAt: 1,
    updatedAt: 10,
}

const canvasState = (positionX: number): CanvasState => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{
        nodeId: 'node-1',
        type: 'image',
        assetId: 'asset-1',
        position: { x: positionX, y: 20 },
        dimensions: { width: 800, height: 450 },
        mediaGenerationPhase: 'ready',
    }],
    edges: [],
})

const requester = {
    userId: 'user-1',
    workspaceIds: ['workspace-1'],
    editableWorkspaceIds: ['workspace-1'],
    organizationIds: ['organization-1'],
}

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamo
    dynamo.queryItems.mockResolvedValue({ items: [] })
    dynamo.transactWrite.mockResolvedValue(undefined)
})

describe('Asset.attachWorkspaceReference', () => {
    it('commits final API geometry even when the Asset reference already contains the generated node', async () => {
        dynamo.getItem
            .mockResolvedValueOnce(asset)
            .mockResolvedValueOnce({ organizationId: 'organization-1' })
            .mockResolvedValueOnce(reference)
            .mockResolvedValueOnce({
                updatedAt: 100,
                canvasStateUpdatedAt: 100,
                canvasState: canvasState(10),
            })

        const result = await AssetModel.attachWorkspaceReference({
            assetId: 'asset-1',
            workspaceId: 'workspace-1',
            requester,
            nodeId: 'node-1',
            workspaceMutation: {
                expectedCanvasStateUpdatedAt: 100,
                canvasStateUpdatedAt: 101,
                canvasState: canvasState(500),
            },
        })

        expect(result).toEqual(reference)
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        const transaction = dynamo.transactWrite.mock.calls[0][0]
        expect(transaction.origin).toBe('Asset.attachWorkspaceReference.canvasMutation')
        expect(transaction.operations).toHaveLength(2)
        expect(transaction.operations[0]).toMatchObject({
            type: 'update',
            key: { workspaceId: 'workspace-1' },
            updates: {
                canvasState: canvasState(500),
                canvasStateUpdatedAt: 101,
                updatedAt: 101,
            },
            expressionAttributeValues: { ':expectedCanvasStateUpdatedAt': 100 },
        })
    })

    it('keeps an unchanged surface-only attachment idempotent without a write', async () => {
        const surfaceReference: AssetReference = {
            ...reference,
            nodeIds: [],
            surfaceIds: ['conversation-1'],
        }
        dynamo.getItem
            .mockResolvedValueOnce(asset)
            .mockResolvedValueOnce({ organizationId: 'organization-1' })
            .mockResolvedValueOnce(surfaceReference)

        const result = await AssetModel.attachWorkspaceReference({
            assetId: 'asset-1',
            workspaceId: 'workspace-1',
            requester,
            surfaceId: 'conversation-1',
        })

        expect(result).toEqual(surfaceReference)
        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })
})
