import {
    type CapabilityCatalogClient,
    type CapabilityDetails,
} from '@lixpi/capability-system/frontend'
import { fixtureTime } from './fixtures.ts'

// This standalone record is catalog data for the inspector. No executable
// action is registered, and the Use callback only reports a local selection.
const detail: CapabilityDetails = {
    capabilityId: 'fixture.catalog-inspection',
    kind: 'tool',
    name: 'Catalog inspection fixture',
    normalizedName: 'catalog inspection fixture',
    summary: 'Simulated standalone Tool metadata. Inspect this row or add its reference to the local prompt; no Tool or model is executed.',
    scope: 'user',
    scopeOwnerId: 'component-library-user',
    scopeAndOwner: 'user#component-library-user',
    searchKey: 'tool#catalog inspection fixture',
    tags: ['local-fixture'],
    manifestBlobHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    catalogExposure: 'standalone',
    status: 'active',
    updatedAt: fixtureTime,
    record: {
        capabilityId: 'fixture.catalog-inspection',
        kind: 'tool',
        scope: 'user',
        scopeOwnerId: 'component-library-user',
        storageOwnerId: 'component-library-user',
        manifestBlobHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        catalogExposure: 'standalone',
        status: 'active',
        ownerUserId: 'component-library-user',
        createdAt: fixtureTime,
        updatedAt: fixtureTime,
    },
    manifest: {
        schemaVersion: 1,
        capabilityId: 'fixture.catalog-inspection',
        kind: 'tool',
        name: 'Catalog inspection fixture',
        description: 'Component-library catalog metadata with no executable fixture transport.',
        references: [],
        resources: [],
    },
    permissions: {
        canEdit: false,
        canDelete: false,
        canShare: false,
        canSetStatus: false,
    },
    grants: [],
    references: [],
    inputSchema: {
        type: 'object',
        properties: {
            note: {
                type: 'string',
                title: 'Local note',
                description: 'A fixture field shown by catalog consumers.',
            },
        },
    },
}

export class FixtureCapabilityCatalog implements Pick<CapabilityCatalogClient, 'list' | 'get' | 'invalidate'> {
    constructor(private readonly state: 'populated' | 'empty' | 'error' = 'populated') {}

    async list() {
        if (this.state === 'error')
            throw new Error('Simulated catalog read failure')

        return { items: this.state === 'empty' ? [] : [detail] }
    }

    async get(capabilityId: string): Promise<CapabilityDetails> {
        if (capabilityId !== detail.capabilityId)
            throw new Error('Unknown local catalog fixture')

        return detail
    }

    invalidate(): void {}
}
