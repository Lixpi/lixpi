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

import AssetModel, {
    buildAssetSearchRecord,
    buildAssetWorkspaceReferenceKey,
    normalizeAssetTitle,
} from './asset.ts'

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

    it('activates a creating Artifact atomically with its first canvas placement', async () => {
        const nextCanvasState = {
            ...canvasState(500),
            nodes: [{
                nodeId: 'node-artifact',
                type: 'capabilityArtifact' as const,
                artifactTypeId: 'action-timeline',
                assetId: 'asset-1',
                position: { x: 500, y: 20 },
                dimensions: { width: 520, height: 360 },
            }],
        }
        dynamo.getItem
            .mockResolvedValueOnce({
                ...asset,
                artifact: { artifactTypeId: 'action-timeline', schemaVersion: 'action-timeline-v1' },
                documents: {
                    capabilityArtifact: {
                        role: 'capabilityArtifact',
                        blobHash: 'a'.repeat(64),
                        version: 0,
                        schemaVersion: 'action-timeline-v1',
                        byteSize: 100,
                        updatedAt: 10,
                    },
                },
                states: { ...asset.states, media: 'none' },
            })
            .mockResolvedValueOnce({ organizationId: 'organization-1' })
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce({
                updatedAt: 100,
                canvasStateUpdatedAt: 100,
                canvasState: { ...nextCanvasState, nodes: [] },
            })

        await AssetModel.attachWorkspaceReference({
            assetId: 'asset-1',
            workspaceId: 'workspace-1',
            requester,
            nodeId: 'node-artifact',
            activateOnAttach: true,
            workspaceMutation: {
                expectedCanvasStateUpdatedAt: 100,
                canvasStateUpdatedAt: 101,
                canvasState: nextCanvasState,
            },
        })

        const operations = dynamo.transactWrite.mock.calls[0][0].operations
        const activationOperation = operations.find((operation: any) => (
            operation.updates?.states?.lifecycle === 'active'
        ))
        expect(activationOperation).toMatchObject({
            updates: expect.objectContaining({ states: expect.objectContaining({ lifecycle: 'active' }) }),
            conditionExpression: expect.stringContaining('#states.#lifecycle = :creating'),
            expressionAttributeValues: {
                ':expectedRevision': asset.revision,
                ':expectedReferenceCount': asset.referenceCount,
                ':creating': 'creating',
            },
        })
        expect(activationOperation.expressionAttributeValues).not.toHaveProperty(':active')
        expect(operations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                updates: expect.objectContaining({ canvasState: nextCanvasState }),
            }),
        ]))
    })
})

describe('Asset prompt-reference search', () => {
    it('normalizes titles and excludes conversation Assets from the search projection', () => {
        expect(normalizeAssetTitle('  PoRTRAIT\u00a0  Study  ')).toBe('portrait study')
        expect(buildAssetSearchRecord({
            ...asset,
            title: '  Portrait Study  ',
            documents: { content: {
                role: 'content',
                blobHash: 'a'.repeat(64),
                version: 1,
                schemaVersion: '1',
                byteSize: 10,
                updatedAt: 1,
            } },
        })).toMatchObject({
            searchKey: 'document#portrait study#asset-1',
            normalizedTitle: 'portrait study',
            primaryCategory: 'document',
        })
        expect(buildAssetSearchRecord({
            ...asset,
            documents: { conversation: {
                role: 'conversation',
                blobHash: 'a'.repeat(64),
                version: 1,
                schemaVersion: '1',
                byteSize: 10,
                updatedAt: 1,
            } },
        })).toBeNull()
        expect(buildAssetSearchRecord({
            ...asset,
            title: 'Action Timeline',
            artifact: { artifactTypeId: 'action-timeline', schemaVersion: 'action-timeline-v1' },
            documents: { capabilityArtifact: {
                role: 'capabilityArtifact',
                blobHash: 'b'.repeat(64),
                version: 0,
                schemaVersion: 'action-timeline-v1',
                byteSize: 100,
                updatedAt: 1,
            } },
            states: { ...asset.states, media: 'none' },
        })).toMatchObject({
            primaryCategory: 'capabilityArtifact',
            artifactTypeId: 'action-timeline',
            artifactSchemaVersion: 'action-timeline-v1',
            searchKey: 'capabilityArtifact#action-timeline#action timeline#asset-1',
        })
    })

    it('queries category prefixes, deduplicates scope rows, and prefers a principal projection', async () => {
        const baseRecord = buildAssetSearchRecord({
            ...asset,
            title: 'Portrait Study',
            scope: 'organization',
            scopeOwnerId: 'organization-1',
            states: { ...asset.states, lifecycle: 'active' },
        })!
        dynamo.queryItems.mockImplementation(async ({ keyConditions }: { keyConditions: { scopeAndOwner: string } }) => ({
            items: keyConditions.scopeAndOwner === 'organization#organization-1'
                ? [baseRecord]
                : keyConditions.scopeAndOwner === 'principal#user-1'
                    ? [{ ...baseRecord, scopeAndOwner: 'principal#user-1' }]
                    : [],
        }))

        const result = await AssetModel.searchAvailable({
            scopeAndOwners: ['organization#organization-1'],
            principalId: 'user-1',
            organizationIds: ['organization-1'],
            query: 'POR',
            categories: ['document'],
        })

        expect(result.items).toEqual([{ ...baseRecord, scopeAndOwner: 'principal#user-1' }])
        expect(dynamo.queryItems).toHaveBeenCalledWith(expect.objectContaining({
            sortKeyCondition: { key: 'searchKey', operator: 'begins_with', value: 'document#por' },
        }))
    })

    it('does not autocomplete Assets that are not active and model-usable', async () => {
        const creatingDocument = buildAssetSearchRecord({ ...asset, title: 'Still creating' })!
        const failedImage = {
            ...creatingDocument,
            primaryCategory: 'image' as const,
            searchKey: 'image#failed image#asset-1',
            normalizedTitle: 'failed image',
            lifecycleStatus: 'active' as const,
            mediaStatus: 'failed' as const,
        }
        dynamo.queryItems.mockResolvedValue({ items: [creatingDocument, failedImage] })

        const result = await AssetModel.searchAvailable({
            scopeAndOwners: [creatingDocument.scopeAndOwner],
            principalId: 'user-1',
            organizationIds: ['organization-1'],
            categories: ['document', 'image'],
        })

        expect(result.items).toEqual([])
    })

    it('binds opaque cursors to the normalized query and category set', async () => {
        const record = buildAssetSearchRecord({ ...asset, title: 'Portrait Study' })!
        dynamo.queryItems.mockResolvedValue({
            items: [record],
            lastEvaluatedKey: { scopeAndOwner: record.scopeAndOwner, searchKey: record.searchKey },
        })
        const first = await AssetModel.searchAvailable({
            scopeAndOwners: [record.scopeAndOwner],
            principalId: 'user-1',
            organizationIds: ['organization-1'],
            query: 'portrait',
            categories: ['document'],
            limit: 1,
        })

        expect(first.cursor).toEqual(expect.any(String))
        await expect(AssetModel.searchAvailable({
            scopeAndOwners: [record.scopeAndOwner],
            principalId: 'user-1',
            organizationIds: ['organization-1'],
            query: 'different',
            categories: ['document'],
            cursor: first.cursor,
        })).rejects.toThrow('INVALID_ASSET_SEARCH_CURSOR')
    })

    it('reauthorizes buffered search cursor rows instead of trusting cursor metadata', async () => {
        const cursor = Buffer.from(JSON.stringify({
            partitions: {},
            query: 'portrait',
            categories: ['document'],
            completed: [
                'organization#organization-1|document',
                'principal#user-1|document',
            ],
            buffered: [{
                scopeAndOwner: 'organization#organization-1',
                searchKey: 'document#portrait secret#asset-secret',
            }],
        }), 'utf8').toString('base64url')
        dynamo.getItem.mockResolvedValue(undefined)

        const result = await AssetModel.searchAvailable({
            scopeAndOwners: ['organization#organization-1'],
            principalId: 'user-1',
            organizationIds: ['organization-1'],
            query: 'portrait',
            categories: ['document'],
            cursor,
        })

        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: {
                scopeAndOwner: 'organization#organization-1',
                searchKey: 'document#portrait secret#asset-secret',
            },
        }))
        expect(result.items).toEqual([])
    })

    it('atomically replaces title-dependent search keys with every metadata projection', async () => {
        const catalogReference: AssetReference = {
            assetId: asset.assetId,
            referenceKey: 'catalog#workspace#workspace-1',
            type: 'catalog',
            scope: 'workspace',
            scopeOwnerId: 'workspace-1',
            createdAt: 1,
            updatedAt: 10,
        }
        dynamo.getItem
            .mockResolvedValueOnce(asset)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(catalogReference)
            .mockResolvedValueOnce(catalogReference)
        dynamo.queryItems.mockResolvedValue({ items: [] })

        await AssetModel.updateMetadata({
            assetId: asset.assetId,
            requester,
            expectedRevision: asset.revision,
            title: 'Renamed Portrait',
        })

        const transaction = dynamo.transactWrite.mock.calls[0]![0]
        expect(transaction.origin).toBe('Asset.updateMetadata')
        expect(transaction.operations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'delete',
                key: expect.objectContaining({ searchKey: 'document#generated image#asset-1' }),
            }),
            expect.objectContaining({
                type: 'put',
                item: expect.objectContaining({ searchKey: 'document#renamed portrait#asset-1' }),
            }),
        ]))
    })

    it('creates and removes principal search projections with Asset grants', async () => {
        const grant = {
            assetId: asset.assetId,
            principalId: 'user-2',
            accessLevel: 'viewer' as const,
            createdAt: 1,
            updatedAt: 2,
        }
        dynamo.getItem
            .mockResolvedValueOnce(asset)
            .mockResolvedValueOnce(undefined)
        dynamo.queryItems.mockResolvedValue({ items: [] })

        await AssetModel.grantAccess({
            assetId: asset.assetId,
            requester,
            principalId: 'user-2',
            accessLevel: 'viewer',
        })
        expect(dynamo.transactWrite.mock.calls[0]![0]).toMatchObject({
            origin: 'Asset.grantAccess',
            operations: expect.arrayContaining([
                expect.objectContaining({
                    type: 'put',
                    item: expect.objectContaining({
                        scopeAndOwner: 'principal#user-2',
                        searchKey: 'document#generated image#asset-1',
                    }),
                }),
            ]),
        })

        vi.clearAllMocks()
        ;(globalThis as any).dynamoDBService = dynamo
        dynamo.getItem
            .mockResolvedValueOnce(asset)
            .mockResolvedValueOnce(grant)
        dynamo.queryItems.mockResolvedValue({ items: [grant] })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await AssetModel.revokeAccess({
            assetId: asset.assetId,
            requester,
            principalId: 'user-2',
        })
        expect(dynamo.transactWrite.mock.calls[0]![0]).toMatchObject({
            origin: 'Asset.revokeAccess',
            operations: expect.arrayContaining([
                expect.objectContaining({
                    type: 'delete',
                    key: {
                        scopeAndOwner: 'principal#user-2',
                        searchKey: 'document#generated image#asset-1',
                    },
                }),
            ]),
        })
    })

    it('removes the searchable catalog projection when an Asset leaves the catalog', async () => {
        const catalogReference: AssetReference = {
            assetId: asset.assetId,
            referenceKey: 'catalog#workspace#workspace-1',
            type: 'catalog',
            scope: 'workspace',
            scopeOwnerId: 'workspace-1',
            createdAt: 1,
            updatedAt: 10,
        }
        dynamo.getItem
            .mockResolvedValueOnce(asset)
            .mockResolvedValueOnce(catalogReference)

        await AssetModel.detachCatalogReference({ assetId: asset.assetId, requester })

        expect(dynamo.transactWrite).toHaveBeenCalledWith(expect.objectContaining({
            origin: 'Asset.detachCatalogReference',
            operations: expect.arrayContaining([expect.objectContaining({
                type: 'delete',
                tableName: expect.stringContaining('Assets-Search'),
                key: {
                    scopeAndOwner: 'workspace#workspace-1',
                    searchKey: 'document#generated image#asset-1',
                },
            })]),
        }))
    })
})
