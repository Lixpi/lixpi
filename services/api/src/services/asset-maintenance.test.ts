'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    buildAssetProjectionOperations: vi.fn(async () => []),
    buildBlobReferenceBatchOperations: vi.fn(),
    enqueueBlobDeletion: vi.fn(),
    getBlob: vi.fn(),
    getBlobReference: vi.fn(),
    getJetStreamStreamInfoOrNull: vi.fn(),
    getNatsInstance: vi.fn(),
    publishAssetEvent: vi.fn(),
    purgeJetStreamSubject: vi.fn(),
    removeSurfaceReferencesByPrefixSystem: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: mocks.getNatsInstance },
}))

vi.mock('../models/blob.ts', () => ({
    default: {
        get: mocks.getBlob,
        getReference: mocks.getBlobReference,
    },
    buildBlobReferenceBatchOperations: mocks.buildBlobReferenceBatchOperations,
}))

vi.mock('../models/asset.ts', () => ({
    default: {
        removeSurfaceReferencesByPrefixSystem: mocks.removeSurfaceReferencesByPrefixSystem,
    },
    buildAssetSearchRecord: vi.fn(() => null),
    buildAssetPrincipalScopeKey: vi.fn((principalId: string) => `principal#${principalId}`),
    buildAssetProjectionOperations: mocks.buildAssetProjectionOperations,
    buildAssetScopeAndOwnerKey: vi.fn((scope: string, ownerId: string) => `${scope}#${ownerId}`),
    publishAssetEvent: mocks.publishAssetEvent,
}))

vi.mock('./asset-maintenance-queue.ts', () => ({
    enqueueBlobDeletion: mocks.enqueueBlobDeletion,
}))

import AssetMaintenance from './asset-maintenance.ts'

const asset = {
    assetId: 'asset-1',
    organizationId: 'organization-1',
    ownerUserId: 'user-1',
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    referenceCount: 0,
    revision: 7,
    states: { lifecycle: 'deleting' },
    documents: {
        provenance: { blobHash: 'document-hash' },
    },
    media: {
        renditions: {
            original: { status: 'ready', blobHash: 'rendition-hash' },
        },
    },
    composition: {
        components: [{ componentId: 'detail-view', blobHash: 'component-hash' }],
    },
}

describe('Asset maintenance deletion', () => {
    const getItem = vi.fn()
    const queryItems = vi.fn()
    const transactWrite = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        getItem.mockResolvedValue(asset)
        queryItems
            .mockResolvedValueOnce({ items: [] })
            .mockResolvedValueOnce({ items: [{ assetId: 'asset-1', principalId: 'user-1' }] })
        transactWrite.mockResolvedValue(undefined)
        ;(globalThis as any).dynamoDBService = { getItem, queryItems, transactWrite }
        mocks.getNatsInstance.mockReturnValue({
            getJetStreamStreamInfoOrNull: mocks.getJetStreamStreamInfoOrNull,
            purgeJetStreamSubject: mocks.purgeJetStreamSubject,
        })
        mocks.getJetStreamStreamInfoOrNull.mockResolvedValue({})
        mocks.getBlob.mockImplementation(async ({ blobHash }: { blobHash: string }) => ({
            blobKey: `organization-1#${blobHash}`,
            blobHash,
            organizationId: 'organization-1',
            referenceCount: 1,
        }))
        mocks.getBlobReference.mockImplementation(async (_blobKey: string, referenceKey: string) => ({
            referenceKey,
        }))
        mocks.buildBlobReferenceBatchOperations.mockReturnValue({
            operations: [{ type: 'delete', tableName: 'Blob-References', key: { referenceKey: 'owned' } }],
            deletionBlobHashes: ['document-hash', 'rendition-hash', 'component-hash'],
        })
        mocks.removeSurfaceReferencesByPrefixSystem.mockResolvedValue(0)
    })

    it('removes dependent surfaces, Asset rows, and every zero-reference Blob', async () => {
        const result = await AssetMaintenance.deleteAsset({
            organizationId: 'organization-1',
            assetId: 'asset-1',
        })

        expect(result).toEqual({ deleted: true })
        expect(mocks.removeSurfaceReferencesByPrefixSystem.mock.calls.map(([request]) => request.surfacePrefix))
            .toEqual([
                'document#asset-1#',
                'conversation#asset-1#media#',
                'capabilityArtifact#asset-1',
            ])
        expect(mocks.buildBlobReferenceBatchOperations).toHaveBeenCalledWith({
            additions: [],
            removals: expect.arrayContaining([
                expect.objectContaining({ reference: expect.objectContaining({ referenceKey: 'asset#asset-1#document#provenance' }) }),
                expect.objectContaining({ reference: expect.objectContaining({ referenceKey: 'asset#asset-1#rendition#original' }) }),
                expect.objectContaining({ reference: expect.objectContaining({ referenceKey: 'asset#asset-1#composition#detail-view' }) }),
            ]),
        })
        expect(transactWrite).toHaveBeenCalledWith(expect.objectContaining({
            operations: expect.arrayContaining([
                expect.objectContaining({ type: 'delete', tableName: 'Blob-References' }),
                expect.objectContaining({ type: 'delete', key: { assetId: 'asset-1' } }),
            ]),
            origin: 'AssetMaintenance.deleteAsset',
        }))
        expect(mocks.enqueueBlobDeletion.mock.calls.map(([request]) => request.blobHash))
            .toEqual(['document-hash', 'rendition-hash', 'component-hash'])
    })
})
