'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
    BlobRecord,
    BlobReference,
    CapabilityCatalogRecord,
    CapabilityManifest,
    CapabilityRun,
} from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    addReference: vi.fn(),
    removeReference: vi.fn(),
    store: vi.fn(),
    getContentAddressedBlob: vi.fn(),
}))

vi.mock('./blob.ts', () => ({
    default: {
        addReference: mocks.addReference,
        removeReference: mocks.removeReference,
        store: mocks.store,
    },
    buildBlobReferenceBatchOperations: ({ additions }: { additions: Array<{ blob: BlobRecord }> }) => ({
        operations: additions.flatMap(({ blob }) => [
            { type: 'put', tableName: 'Blob-References', item: { blobKey: blob.blobKey } },
            { type: 'update', tableName: 'Blobs', key: { blobKey: blob.blobKey }, updates: { referenceCount: 1 } },
        ]),
        deletionBlobHashes: [],
    }),
}))

vi.mock('../services/blob-storage.ts', () => ({
    getContentAddressedBlob: mocks.getContentAddressedBlob,
}))

import {
    CAPABILITY_BLOB_RETIREMENT_GRACE_MS,
    retireSupersededCapabilityBlobReferences,
    saveCapability,
} from './capability.ts'

const oldResourceHash = '1'.repeat(64)
const newResourceHash = '2'.repeat(64)
const oldManifestHash = 'a'.repeat(64)
const newManifestHash = 'b'.repeat(64)

const oldManifest: CapabilityManifest = {
    schemaVersion: 1,
    capabilityId: 'skill-lifecycle',
    kind: 'skill',
    name: 'Lifecycle',
    description: 'Old definition.',
    references: [],
    resources: [{
        resourceId: 'instructions',
        blobHash: oldResourceHash,
        mediaType: 'text/markdown',
        role: 'instructions',
    }],
}

const nextManifest: CapabilityManifest = {
    ...oldManifest,
    description: 'New definition.',
    resources: [{
        resourceId: 'instructions',
        blobHash: newResourceHash,
        mediaType: 'text/markdown',
        role: 'instructions',
    }],
}

const record: CapabilityCatalogRecord = {
    capabilityId: oldManifest.capabilityId,
    kind: 'skill',
    scope: 'organization',
    scopeOwnerId: 'org-1',
    storageOwnerId: 'org-1',
    manifestBlobHash: oldManifestHash,
    catalogExposure: 'standalone',
    status: 'active',
    ownerUserId: 'owner-1',
    createdAt: 1,
    updatedAt: 2,
}

const storedManifestBlob: BlobRecord = {
    blobKey: `org-1#${newManifestHash}`,
    blobHash: newManifestHash,
    organizationId: 'org-1',
    bucketName: 'blobs-org-1-files',
    objectKey: `sha256/${newManifestHash.slice(0, 2)}/${newManifestHash}`,
    mimeType: 'application/json',
    byteSize: 100,
    status: 'staging',
    referenceCount: 0,
    createdAt: 3,
    updatedAt: 3,
}

describe('Capability Blob reference lifecycle', () => {
    let transactWrite: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.useFakeTimers()
        transactWrite = vi.fn().mockResolvedValue(undefined)
        ;(globalThis as any).dynamoDBService = {
            getItem: vi.fn().mockResolvedValue(record),
            queryItems: vi.fn().mockResolvedValue({ items: [] }),
            scanItems: vi.fn().mockResolvedValue({ items: [] }),
            transactWrite,
        }
        mocks.getContentAddressedBlob.mockResolvedValue(new TextEncoder().encode(JSON.stringify(oldManifest)))
        mocks.store.mockResolvedValue(storedManifestBlob)
        mocks.addReference.mockResolvedValue({ created: true })
        mocks.removeReference.mockResolvedValue({ removed: true, deletionRequired: false })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
    })

    it('rolls back only newly registered resource references when the pointer CAS fails', async () => {
        transactWrite.mockRejectedValue({ name: 'ConditionalCheckFailedException' })

        await expect(saveCapability({
            manifest: nextManifest,
            scope: 'organization',
            scopeOwnerId: 'org-1',
            storageOwnerId: 'org-1',
            summary: 'Summary',
            tags: [],
            catalogExposure: 'standalone',
            expectedManifestBlobHash: oldManifestHash,
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
            allowedActions: new Set(),
        })).rejects.toThrow('CAPABILITY_CONCURRENT_UPDATE')

        expect(mocks.removeReference).toHaveBeenCalledTimes(1)
        expect(mocks.removeReference).toHaveBeenCalledWith({
            organizationId: 'org-1',
            blobHash: newResourceHash,
            referenceKey: 'capability#skill-lifecycle#resource#instructions',
        })
    })

    it('retires superseded hashes only after grace and after sealed open runs release them', async () => {
        await saveCapability({
            manifest: nextManifest,
            scope: 'organization',
            scopeOwnerId: 'org-1',
            storageOwnerId: 'org-1',
            summary: 'Summary',
            tags: [],
            catalogExposure: 'standalone',
            expectedManifestBlobHash: oldManifestHash,
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
            allowedActions: new Set(),
        })

        expect(mocks.removeReference).not.toHaveBeenCalled()
        const currentRecord: CapabilityCatalogRecord = {
            ...record,
            manifestBlobHash: newManifestHash,
            updatedAt: 4,
        }
        const oldReferences: BlobReference[] = [
            {
                blobKey: `org-1#${oldManifestHash}`,
                blobHash: oldManifestHash,
                organizationId: 'org-1',
                referenceKey: 'capability#skill-lifecycle#manifest',
                ownerType: 'capability',
                ownerId: 'skill-lifecycle',
                createdAt: 1,
            },
            {
                blobKey: `org-1#${oldResourceHash}`,
                blobHash: oldResourceHash,
                organizationId: 'org-1',
                referenceKey: 'capability#skill-lifecycle#resource#instructions',
                ownerType: 'capability',
                ownerId: 'skill-lifecycle',
                createdAt: 1,
            },
        ]
        const openRun: CapabilityRun = {
            runId: 'run-1',
            rootCapabilityId: 'skill-lifecycle',
            resolvedManifests: [{ capabilityId: 'skill-lifecycle', manifestBlobHash: oldManifestHash }],
            workspaceId: 'workspace-1',
            origin: 'panel',
            status: 'running',
            currentStepIds: [],
            outputAssetIds: [],
            eventStreamName: 'CAPABILITY_RUN_run-1',
            createdAt: 1,
            updatedAt: 1,
        }
        let runs: CapabilityRun[] = [openRun]
        ;(globalThis as any).dynamoDBService.scanItems.mockImplementation(({ tableName }: { tableName: string }) => {
            if (tableName.includes('Blob-References')) return { items: oldReferences }
            if (tableName.includes('Capability-Runs')) return { items: runs }
            if (tableName.includes('Capabilities')) return { items: [currentRecord] }
            return { items: [] }
        })
        mocks.getContentAddressedBlob.mockImplementation(({ blobHash }: { blobHash: string }) =>
            new TextEncoder().encode(JSON.stringify(blobHash === newManifestHash ? nextManifest : oldManifest)))

        const now = CAPABILITY_BLOB_RETIREMENT_GRACE_MS + 10
        const protectedResult = await retireSupersededCapabilityBlobReferences({ now, limit: 10 })
        expect(protectedResult).toMatchObject({ eligibleReferences: 2, protectedReferences: 2, retiredReferences: 0 })
        expect(mocks.removeReference).not.toHaveBeenCalled()

        runs = []
        const retiredResult = await retireSupersededCapabilityBlobReferences({ now, limit: 10 })

        expect(retiredResult).toMatchObject({ eligibleReferences: 2, protectedReferences: 0, retiredReferences: 2 })
        expect(mocks.removeReference).toHaveBeenCalledWith({
            organizationId: 'org-1',
            blobHash: oldManifestHash,
            referenceKey: 'capability#skill-lifecycle#manifest',
        })
        expect(mocks.removeReference).toHaveBeenCalledWith({
            organizationId: 'org-1',
            blobHash: oldResourceHash,
            referenceKey: 'capability#skill-lifecycle#resource#instructions',
        })
    })

    it('fails closed without retiring anything when any bounded safety scan is truncated', async () => {
        ;(globalThis as any).dynamoDBService.scanItems.mockImplementation(({ tableName }: { tableName: string }) => ({
            items: tableName.includes('Blob-References') ? [{
                blobKey: `org-1#${oldManifestHash}`,
                blobHash: oldManifestHash,
                organizationId: 'org-1',
                referenceKey: 'capability#skill-lifecycle#manifest',
                ownerType: 'capability',
                ownerId: 'skill-lifecycle',
                createdAt: 1,
            }] : [],
            ...(tableName.includes('Capability-Runs') ? { lastEvaluatedKey: { runId: 'next' } } : {}),
        }))

        const result = await retireSupersededCapabilityBlobReferences({
            now: CAPABILITY_BLOB_RETIREMENT_GRACE_MS + 10,
            limit: 10,
            scanLimit: 10,
        })

        expect(result).toMatchObject({
            scanTruncated: true,
            retiredReferences: 0,
            unsafeCapabilityIds: ['SCAN_TRUNCATED'],
        })
        expect(mocks.removeReference).not.toHaveBeenCalled()
    })

    it('preserves grants and atomically rewrites their projections when a capability is renamed', async () => {
        const existingGrant = {
            capabilityId: record.capabilityId,
            principalId: 'viewer-1',
            accessLevel: 'viewer',
            createdAt: 1,
            updatedAt: 2,
        }
        ;(globalThis as any).dynamoDBService.queryItems.mockResolvedValue({ items: [existingGrant] })

        await saveCapability({
            manifest: { ...nextManifest, name: 'Renamed Lifecycle' },
            scope: 'organization',
            scopeOwnerId: 'org-1',
            storageOwnerId: 'org-1',
            summary: 'Summary',
            tags: [],
            catalogExposure: 'standalone',
            expectedManifestBlobHash: oldManifestHash,
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
            allowedActions: new Set(),
        })

        const operations = transactWrite.mock.calls[0]![0].operations
        expect(operations).toContainEqual({
            type: 'delete',
            tableName: expect.stringContaining('Capabilities-Meta'),
            key: {
                scopeAndOwner: 'principal#viewer-1',
                searchKey: 'skill#lifecycle#skill-lifecycle',
            },
        })
        expect(operations).toContainEqual(expect.objectContaining({
            type: 'put',
            tableName: expect.stringContaining('Capabilities-Access-List'),
            item: expect.objectContaining({ principalId: 'viewer-1', accessLevel: 'viewer' }),
        }))
        expect(operations).toContainEqual(expect.objectContaining({
            type: 'put',
            tableName: expect.stringContaining('Capabilities-Meta'),
            item: expect.objectContaining({
                scopeAndOwner: 'principal#viewer-1',
                searchKey: 'skill#renamed lifecycle#skill-lifecycle',
                manifestBlobHash: newManifestHash,
            }),
        }))
    })

    it('rejects a patterned but unregistered workflow action before storage', async () => {
        ;(globalThis as any).dynamoDBService.getItem.mockResolvedValue(undefined)
        const toolManifest: CapabilityManifest = {
            schemaVersion: 1,
            capabilityId: 'tool-unregistered',
            kind: 'tool',
            name: 'Unregistered Tool',
            description: 'Must not become live.',
            references: [],
            resources: [
                {
                    resourceId: 'input-schema',
                    blobHash: '3'.repeat(64),
                    mediaType: 'application/schema+json',
                    role: 'schema',
                },
                {
                    resourceId: 'output-schema',
                    blobHash: '4'.repeat(64),
                    mediaType: 'application/schema+json',
                    role: 'schema',
                },
            ],
            tool: {
                toolType: 'test-tool',
                inputSchema: {
                    resourceId: 'input-schema',
                    blobHash: '3'.repeat(64),
                    mediaType: 'application/schema+json',
                    role: 'schema',
                },
                outputSchema: {
                    resourceId: 'output-schema',
                    blobHash: '4'.repeat(64),
                    mediaType: 'application/schema+json',
                    role: 'schema',
                },
                executionPolicy: 'required',
                workflow: {
                    steps: [{
                        stepId: 'execute',
                        title: 'Execute',
                        action: 'unregistered.execute',
                        dependsOn: [],
                        input: {},
                        progress: {},
                    }],
                    outputs: {},
                },
            },
        }

        await expect(saveCapability({
            manifest: toolManifest,
            scope: 'organization',
            scopeOwnerId: 'org-1',
            storageOwnerId: 'org-1',
            summary: 'Summary',
            tags: [],
            catalogExposure: 'standalone',
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
            allowedActions: new Set(),
        })).rejects.toThrow('INVALID_CAPABILITY_MANIFEST')

        expect(mocks.store).not.toHaveBeenCalled()
        expect(transactWrite).not.toHaveBeenCalled()
    })
})
