'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CapabilityCatalogRecord, CapabilityManifest, CapabilityMeta } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    getContentAddressedBlob: vi.fn(),
}))

vi.mock('./blob.ts', () => ({
    default: {},
    buildBlobReferenceBatchOperations: vi.fn(),
}))

vi.mock('../services/blob-storage.ts', () => ({
    getContentAddressedBlob: mocks.getContentAddressedBlob,
}))

import { grantCapabilityAccess, revokeCapabilityAccess, setCapabilityStatus } from './capability.ts'

const manifest: CapabilityManifest = {
    schemaVersion: 1,
    capabilityId: 'skill-access',
    kind: 'skill',
    name: 'Access Skill',
    description: 'Tests authorized mutations.',
    references: [],
    resources: [],
}

const record: CapabilityCatalogRecord = {
    capabilityId: manifest.capabilityId,
    kind: manifest.kind,
    scope: 'organization',
    scopeOwnerId: 'org-1',
    storageOwnerId: 'org-1',
    manifestBlobHash: 'a'.repeat(64),
    catalogVisibility: 'listed',
    status: 'active',
    ownerUserId: 'owner-1',
    createdAt: 1,
    updatedAt: 2,
}

const meta: CapabilityMeta = {
    scopeAndOwner: 'organization#org-1',
    scope: 'organization',
    scopeOwnerId: 'org-1',
    searchKey: 'skill#access skill#skill-access',
    capabilityId: record.capabilityId,
    kind: record.kind,
    name: manifest.name,
    normalizedName: 'access skill',
    summary: 'Summary',
    tags: [],
    manifestBlobHash: record.manifestBlobHash,
    catalogVisibility: 'listed',
    status: 'active',
    updatedAt: record.updatedAt,
}

describe('Capability access-list mutations', () => {
    let transactWrite: ReturnType<typeof vi.fn>

    beforeEach(() => {
        transactWrite = vi.fn().mockResolvedValue(undefined)
        ;(globalThis as any).dynamoDBService = {
            getItem: vi.fn().mockImplementation(async ({ key }: { key: Record<string, unknown> }) => {
                if ('principalId' in key) return undefined
                if ('searchKey' in key) return meta
                return record
            }),
            queryItems: vi.fn().mockResolvedValue({ items: [meta] }),
            transactWrite,
        }
        mocks.getContentAddressedBlob.mockResolvedValue(
            new TextEncoder().encode(JSON.stringify(manifest)),
        )
    })

    it('lets the authoritative owner grant access and writes the ACL and catalog projection atomically', async () => {
        const grant = await grantCapabilityAccess({
            capabilityId: record.capabilityId,
            principalId: 'viewer-1',
            accessLevel: 'viewer',
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
        })

        expect(grant).toEqual(expect.objectContaining({
            capabilityId: record.capabilityId,
            principalId: 'viewer-1',
            accessLevel: 'viewer',
        }))
        expect(transactWrite).toHaveBeenCalledWith(expect.objectContaining({
            origin: 'Capability.grantAccess',
            operations: [
                expect.objectContaining({
                    type: 'put',
                    item: expect.objectContaining({ principalId: 'viewer-1', accessLevel: 'viewer' }),
                }),
                expect.objectContaining({
                    type: 'put',
                    item: expect.objectContaining({
                        scopeAndOwner: 'principal#viewer-1',
                        searchKey: meta.searchKey,
                    }),
                }),
            ],
        }))
    })

    it('denies grant mutation to an organization reader who is not an owner or editor', async () => {
        await expect(grantCapabilityAccess({
            capabilityId: record.capabilityId,
            principalId: 'viewer-1',
            accessLevel: 'viewer',
            requester: { userId: 'member-1', organizationIds: ['org-1'] },
        })).rejects.toThrow('PERMISSION_DENIED')

        expect(transactWrite).not.toHaveBeenCalled()
    })

    it('revokes the ACL and its principal catalog projection in one transaction', async () => {
        await revokeCapabilityAccess({
            capabilityId: record.capabilityId,
            principalId: 'viewer-1',
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
        })

        expect(transactWrite).toHaveBeenCalledWith(expect.objectContaining({
            origin: 'Capability.revokeAccess',
            operations: [
                expect.objectContaining({
                    type: 'delete',
                    key: { capabilityId: record.capabilityId, principalId: 'viewer-1' },
                }),
                expect.objectContaining({
                    type: 'delete',
                    key: { scopeAndOwner: 'principal#viewer-1', searchKey: meta.searchKey },
                }),
            ],
        }))
    })

    it('atomically disables the authority record and every catalog projection', async () => {
        const grants = [{
            capabilityId: record.capabilityId,
            principalId: 'editor-1',
            accessLevel: 'editor',
            createdAt: 1,
            updatedAt: 2,
        }]
        ;(globalThis as any).dynamoDBService.queryItems.mockResolvedValue({ items: grants })

        const result = await setCapabilityStatus({
            capabilityId: record.capabilityId,
            expectedManifestBlobHash: record.manifestBlobHash,
            status: 'disabled',
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
        })

        expect(result).toEqual({
            record: expect.objectContaining({ status: 'disabled' }),
            audienceUserIds: ['editor-1'],
        })
        expect(transactWrite).toHaveBeenCalledWith(expect.objectContaining({
            origin: 'Capability.setStatus',
            operations: [
                expect.objectContaining({
                    type: 'update',
                    updates: expect.objectContaining({ status: 'disabled' }),
                }),
                expect.objectContaining({
                    type: 'put',
                    item: expect.objectContaining({
                        scopeAndOwner: 'organization#org-1',
                        status: 'disabled',
                    }),
                }),
                expect.objectContaining({
                    type: 'put',
                    item: expect.objectContaining({
                        scopeAndOwner: 'principal#editor-1',
                        status: 'disabled',
                    }),
                }),
            ],
        }))
    })
})
