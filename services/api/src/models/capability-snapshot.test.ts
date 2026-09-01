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
    CapabilityManifest,
} from '@lixpi/constants'

const { getContentAddressedBlobMock } = vi.hoisted(() => ({
    getContentAddressedBlobMock: vi.fn(),
}))

vi.mock('../services/blob-storage.ts', () => ({
    getContentAddressedBlob: getContentAddressedBlobMock,
}))

import { readAuthorizedCapabilityManifestSnapshot } from './capability.ts'

const manifest: CapabilityManifest = {
    schemaVersion: 1,
    capabilityId: 'skill-sealed',
    kind: 'skill',
    name: 'Sealed Skill',
    description: 'A sealed definition.',
    references: [],
    resources: [],
}

const capturedRecord: CapabilityCatalogRecord = {
    capabilityId: manifest.capabilityId,
    kind: manifest.kind,
    scope: 'organization',
    scopeOwnerId: 'org-1',
    storageOwnerId: 'org-1',
    manifestBlobHash: 'a'.repeat(64),
    catalogExposure: 'standalone',
    status: 'active',
    ownerUserId: 'owner-1',
    createdAt: 1,
    updatedAt: 2,
}

describe('Capability sealed manifest reads', () => {
    beforeEach(() => {
        getContentAddressedBlobMock.mockReset()
        getContentAddressedBlobMock.mockResolvedValue(new TextEncoder().encode(JSON.stringify(manifest)))
    })

    it('reads the BatchGet-captured hash without consulting the mutable catalog pointer', async () => {
        const result = await readAuthorizedCapabilityManifestSnapshot({
            record: capturedRecord,
            requester: { userId: 'member-1', organizationIds: ['org-1'] },
        })

        expect(getContentAddressedBlobMock).toHaveBeenCalledWith({
            organizationId: 'org-1',
            blobHash: capturedRecord.manifestBlobHash,
        })
        expect(result.record).toBe(capturedRecord)
        expect(result.manifest).toEqual(manifest)
    })
})
