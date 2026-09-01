import { createHash } from 'node:crypto'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    type CapabilityCatalogRecord,
    type CapabilityManifest,
    type CapabilityResourceRef,
} from '@lixpi/constants'

import { CapabilityError } from '../shared/capability-errors.ts'
import {
    type CapabilityRequesterContext,
    type CapabilityResolverStore,
    resolveCapabilities,
} from './capability-resolver.ts'

const requester: CapabilityRequesterContext = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: 'organization-1',
}

type Fixture = {
    store: CapabilityResolverStore
    records: Map<string, CapabilityCatalogRecord>
    manifests: Map<string, Uint8Array>
    resources: Map<string, Uint8Array>
}

function bytes(value: string): Uint8Array {
    return new TextEncoder().encode(value)
}

function hash(value: Uint8Array): string {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function resourceKey(capabilityId: string, resourceId: string): string {
    return `${capabilityId}/${resourceId}`
}

function makeResource(resourceId: string, value: Uint8Array): CapabilityResourceRef {
    return {
        resourceId,
        blobHash: hash(value),
        mediaType: 'text/markdown',
        role: 'instructions',
    }
}

function makeSkill(
    capabilityId: string,
    references: CapabilityManifest['references'] = [],
    resources: CapabilityResourceRef[] = [],
): CapabilityManifest {
    return {
        schemaVersion: 1,
        capabilityId,
        kind: 'skill',
        name: capabilityId,
        description: `Instructions for ${capabilityId}`,
        references,
        resources,
    }
}

function makeFixture(manifestValues: CapabilityManifest[], resourceValues: Map<string, Uint8Array> = new Map()): Fixture {
    const records = new Map<string, CapabilityCatalogRecord>()
    const manifests = new Map<string, Uint8Array>()
    for (const manifest of manifestValues) {
        const manifestBytes = bytes(JSON.stringify(manifest))
        manifests.set(manifest.capabilityId, manifestBytes)
        records.set(manifest.capabilityId, {
            capabilityId: manifest.capabilityId,
            kind: manifest.kind,
            scope: 'global',
            scopeOwnerId: 'system',
            storageOwnerId: 'system',
            manifestBlobHash: hash(manifestBytes),
            catalogExposure: 'standalone',
            status: 'active',
            ownerUserId: 'system',
            createdAt: 1,
            updatedAt: 1,
        })
    }
    const store: CapabilityResolverStore = {
        batchGetAuthorizedCatalogRecords: vi.fn(async ({ capabilityIds }) =>
            new Map(
                capabilityIds.flatMap(capabilityId => {
                    const record = records.get(capabilityId)
                    return record ? [[capabilityId, record] as const] : []
                }),
            )
        ),
        readManifest: vi.fn(async ({ record }) => manifests.get(record.capabilityId)!),
        readResource: vi.fn(async ({ record, resource }) =>
            resourceValues.get(
                resourceKey(record.capabilityId, resource.resourceId),
            )!
        ),
    }
    return { store, records, manifests, resources: resourceValues }
}

// =============================================================================
// AUTHORIZED SEALED RESOLUTION
// =============================================================================

describe('resolveCapabilities', () => {
    it('batch-authorizes each frontier, preserves deterministic order, loads resources, and seals provenance', async () => {
        const markdown = bytes('# Layout')
        const layoutResource = makeResource('instructions', markdown)
        const fixture = makeFixture([
            makeSkill('root', [
                { capabilityId: 'layout', kind: 'skill' },
                { capabilityId: 'palette', kind: 'skill' },
            ]),
            makeSkill('layout', [{ capabilityId: 'shared', kind: 'skill' }], [layoutResource]),
            makeSkill('palette', [{ capabilityId: 'shared', kind: 'skill' }]),
            makeSkill('shared'),
        ], new Map([[resourceKey('layout', 'instructions'), markdown]]))

        const plan = await resolveCapabilities([{ capabilityId: 'root', kind: 'skill' }], {
            store: fixture.store,
            requester,
        })

        expect(plan.serializable.capabilities.map(capability => capability.capabilityId)).toEqual([
            'root',
            'layout',
            'palette',
            'shared',
        ])
        expect(plan.serializable.resolvedManifests).toEqual(plan.serializable.capabilities.map(capability => ({
            capabilityId: capability.capabilityId,
            manifestBlobHash: capability.manifestBlobHash,
        })))
        expect(plan.getResource('layout', 'instructions')?.bytes).toEqual(markdown)
        expect(Object.isFrozen(plan)).toBe(true)
        expect(Object.isFrozen(plan.serializable.capabilities[0]!.manifest)).toBe(true)
        expect(fixture.store.batchGetAuthorizedCatalogRecords).toHaveBeenCalledTimes(3)
    })

    it('does not disclose whether a missing transitive Capability exists but is unauthorized', async () => {
        const fixture = makeFixture([
            makeSkill('root', [{ capabilityId: 'secret', kind: 'skill' }]),
            makeSkill('secret'),
        ])
        fixture.store.batchGetAuthorizedCatalogRecords = vi.fn(async ({ capabilityIds }) =>
            new Map(
                capabilityIds.flatMap(capabilityId => {
                    if (capabilityId === 'secret') return []
                    const record = fixture.records.get(capabilityId)
                    return record ? [[capabilityId, record] as const] : []
                }),
            )
        )

        await expect(resolveCapabilities([{ capabilityId: 'root', kind: 'skill' }], {
            store: fixture.store,
            requester,
        })).rejects.toMatchObject({
            code: 'CAPABILITY_NOT_FOUND_OR_FORBIDDEN',
        })
    })

    it('rejects manifest and resource hash mismatches before returning a plan', async () => {
        const markdown = bytes('# Secret')
        const resource = makeResource('instructions', markdown)
        const fixture = makeFixture([
            makeSkill('root', [], [resource]),
        ], new Map([[resourceKey('root', 'instructions'), bytes('# Tampered')]]))

        await expect(resolveCapabilities([{ capabilityId: 'root', kind: 'skill' }], {
            store: fixture.store,
            requester,
        })).rejects.toMatchObject({ code: 'CAPABILITY_RESOURCE_INTEGRITY_FAILED' })

        fixture.records.get('root')!.manifestBlobHash = hash(bytes('different'))
        await expect(resolveCapabilities([{ capabilityId: 'root', kind: 'skill' }], {
            store: fixture.store,
            requester,
        })).rejects.toMatchObject({ code: 'CAPABILITY_MANIFEST_INTEGRITY_FAILED' })
    })

    it('rejects reference cycles and closure limits with request-visible codes', async () => {
        const fixture = makeFixture([
            makeSkill('first', [{ capabilityId: 'second', kind: 'skill' }]),
            makeSkill('second', [{ capabilityId: 'first', kind: 'skill' }]),
        ])

        await expect(resolveCapabilities([{ capabilityId: 'first', kind: 'skill' }], {
            store: fixture.store,
            requester,
        })).rejects.toMatchObject({ code: 'CAPABILITY_MANIFEST_INVALID' })

        await expect(resolveCapabilities([{ capabilityId: 'first', kind: 'skill' }], {
            store: fixture.store,
            requester,
            maxResolvedCapabilities: 1,
        })).rejects.toMatchObject({ code: 'CAPABILITY_RESOLUTION_LIMIT_EXCEEDED' })
    })

    it('rejects aggregate package and prompt-resource byte limits', async () => {
        const markdown = bytes('# Instructions')
        const resource = makeResource('instructions', markdown)
        const fixture = makeFixture([
            makeSkill('root', [], [resource]),
        ], new Map([[resourceKey('root', 'instructions'), markdown]]))

        await expect(resolveCapabilities([{ capabilityId: 'root', kind: 'skill' }], {
            store: fixture.store,
            requester,
            maxAggregateResourceBytes: markdown.byteLength - 1,
        })).rejects.toMatchObject({ code: 'CAPABILITY_RESOLUTION_LIMIT_EXCEEDED' })

        await expect(resolveCapabilities([{ capabilityId: 'root', kind: 'skill' }], {
            store: fixture.store,
            requester,
            maxAggregateTextResourceBytes: markdown.byteLength - 1,
        })).rejects.toMatchObject({ code: 'CAPABILITY_RESOLUTION_LIMIT_EXCEEDED' })
    })

    it('honors cancellation before catalog access', async () => {
        const fixture = makeFixture([makeSkill('root')])
        const controller = new AbortController()
        controller.abort(new Error('stop'))

        await expect(resolveCapabilities([{ capabilityId: 'root', kind: 'skill' }], {
            store: fixture.store,
            requester,
            signal: controller.signal,
        })).rejects.toThrow('stop')
        expect(fixture.store.batchGetAuthorizedCatalogRecords).not.toHaveBeenCalled()
    })

    it('uses CapabilityError for conflicting duplicate references', async () => {
        const fixture = makeFixture([makeSkill('root')])
        const promise = resolveCapabilities([
            { capabilityId: 'root', kind: 'skill' },
            { capabilityId: 'root', kind: 'tool' },
        ], { store: fixture.store, requester })

        await expect(promise).rejects.toBeInstanceOf(CapabilityError)
    })
})
