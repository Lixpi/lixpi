'use strict'

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import type {
    CapabilityCatalogRecord,
    CapabilityMeta,
} from '@lixpi/constants'

vi.mock('./blob.ts', () => ({ default: {}, buildBlobReferenceBatchOperations: vi.fn() }))
vi.mock('../services/blob-storage.ts', () => ({ getContentAddressedBlob: vi.fn() }))

import {
    authorizeCapability,
    listAuthorizedCapabilities,
} from './capability.ts'

const record: CapabilityCatalogRecord = {
    capabilityId: 'tool-disabled',
    kind: 'tool',
    scope: 'organization',
    scopeOwnerId: 'org-1',
    storageOwnerId: 'org-1',
    manifestBlobHash: 'a'.repeat(64),
    catalogExposure: 'standalone',
    status: 'disabled',
    ownerUserId: 'owner-1',
    createdAt: 1,
    updatedAt: 2,
}

const meta: CapabilityMeta = {
    scopeAndOwner: 'organization#org-1',
    scope: 'organization',
    scopeOwnerId: 'org-1',
    searchKey: 'tool#disabled tool#tool-disabled',
    capabilityId: record.capabilityId,
    kind: record.kind,
    name: 'Disabled Tool',
    normalizedName: 'disabled tool',
    summary: 'Disabled for editing.',
    tags: [],
    manifestBlobHash: record.manifestBlobHash,
    catalogExposure: 'standalone',
    status: 'disabled',
    updatedAt: 2,
}

const internalMeta: CapabilityMeta = {
    ...meta,
    capabilityId: 'skill-internal',
    kind: 'skill',
    name: 'Bundled Internal Skill',
    normalizedName: 'bundled internal skill',
    searchKey: 'skill#bundled internal skill#skill-internal',
    parentModuleId: 'test-module',
    catalogExposure: 'module-internal',
    status: 'active',
}

describe('disabled Capability catalog visibility', () => {
    let accessLevel: 'viewer' | 'editor' | undefined

    beforeEach(() => {
        accessLevel = undefined
        ;(globalThis as any).dynamoDBService = {
            queryItems: vi.fn().mockImplementation(async ({
                keyConditions,
                sortKeyCondition,
            }: {
                keyConditions: { scopeAndOwner: string }
                sortKeyCondition: { value: string }
            }) => ({
                items: keyConditions.scopeAndOwner === 'organization#org-1'
                    ? sortKeyCondition.value.startsWith('tool#')
                        ? [meta]
                        : sortKeyCondition.value.startsWith('skill#')
                        ? [internalMeta]
                        : []
                    : [],
            })),
            getItem: vi.fn().mockImplementation(async ({ key }: { key: Record<string, unknown> }) => {
                if ('principalId' in key) {
                    return accessLevel
                        ? {
                            capabilityId: record.capabilityId,
                            principalId: key.principalId,
                            accessLevel,
                            createdAt: 1,
                            updatedAt: 1,
                        }
                        : undefined
                }
                return record
            }),
        }
    })

    it('keeps a disabled definition discoverable to its authoritative owner', async () => {
        const result = await listAuthorizedCapabilities({
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
        })

        expect(result.items).toEqual([meta])
    })

    it('keeps a disabled definition discoverable to an ACL editor', async () => {
        accessLevel = 'editor'

        const result = await listAuthorizedCapabilities({
            requester: { userId: 'editor-1', organizationIds: ['org-1'] },
        })

        expect(result.items).toEqual([meta])
    })

    it('hides a disabled definition from base-scope readers and ACL viewers', async () => {
        accessLevel = 'viewer'

        const result = await listAuthorizedCapabilities({
            requester: { userId: 'viewer-1', organizationIds: ['org-1'] },
        })

        expect(result.items).toEqual([])
    })

    it('hides internal bundle dependencies from every catalog search', async () => {
        const result = await listAuthorizedCapabilities({
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
        })

        expect(result.items).toEqual([meta])
        expect(result.items.some(item => item.capabilityId === internalMeta.capabilityId)).toBe(false)
    })

    it('binds standalone catalog cursors to the query and package kind', async () => {
        ;(globalThis as any).dynamoDBService.queryItems.mockImplementation(async ({
            keyConditions,
        }: {
            keyConditions: { scopeAndOwner: string }
        }) =>
            keyConditions.scopeAndOwner === 'organization#org-1'
                ? {
                    items: [meta],
                    lastEvaluatedKey: {
                        scopeAndOwner: meta.scopeAndOwner,
                        searchKey: meta.searchKey,
                    },
                }
                : { items: [] }
        )

        const first = await listAuthorizedCapabilities({
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
            query: 'disabled',
            kinds: ['tool'],
            limit: 1,
        })

        await expect(listAuthorizedCapabilities({
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
            query: 'different',
            kinds: ['tool'],
            cursor: first.cursor,
        })).rejects.toThrow('INVALID_CURSOR')
        await expect(listAuthorizedCapabilities({
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
            query: 'disabled',
            kinds: ['skill'],
            cursor: first.cursor,
        })).rejects.toThrow('INVALID_CURSOR')
    })

    it('maps legacy listed records to standalone exposure', async () => {
        const legacyListed = {
            ...record,
            catalogExposure: undefined,
            catalogVisibility: 'listed',
        }
        ;(globalThis as any).dynamoDBService.getItem.mockResolvedValue(legacyListed)

        await expect(authorizeCapability({
            capabilityId: legacyListed.capabilityId,
            requester: { userId: 'owner-1', organizationIds: ['org-1'] },
        })).resolves.toEqual(expect.objectContaining({
            catalogExposure: 'standalone',
        }))
    })
})
