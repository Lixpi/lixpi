import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    NATS_SUBJECTS,
    type CapabilityCatalogRecord,
    type CapabilityManifest,
} from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    model: {
        listAuthorized: vi.fn(),
        readManifest: vi.fn(),
        readResource: vi.fn(),
        authorize: vi.fn(),
        listAccessGrants: vi.fn(),
        save: vi.fn(),
        setStatus: vi.fn(),
        remove: vi.fn(),
        grantAccess: vi.fn(),
        revokeAccess: vi.fn(),
        getAudienceUserIds: vi.fn(),
    },
    publish: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => ({ getConnection: () => ({ publish: mocks.publish }) }),
    },
}))
vi.mock('../../models/capability.ts', () => ({ default: mocks.model }))
vi.mock('../../models/capability-run.ts', () => ({ default: {} }))
vi.mock('../../models/workspace.ts', () => ({ default: {} }))
vi.mock('../../services/asset-requester-context.ts', () => ({
    getAssetRequesterContext: async () => ({ organizationIds: ['org-1'] }),
}))
vi.mock('../../services/capability-run-event-log.ts', () => ({ CapabilityRunEventLog: {} }))
vi.mock('../../services/capability-catalog-event-relay.ts', () => ({ ensureCapabilityCatalogEventRelay: vi.fn() }))
vi.mock('../../capability-system/capability-runtime.ts', () => ({
    capabilityActionRegistry: { allowedActionKeys: () => new Set(['visual-style.apply']) },
}))

import { capabilitySubjects } from './capability-subjects.ts'

const { CATALOG } = NATS_SUBJECTS.CAPABILITY_SUBJECTS
const handler = (subject: string) => capabilitySubjects.find(candidate => candidate.subject === subject)!.handler

const manifest: CapabilityManifest = {
    schemaVersion: 1,
    capabilityId: 'skill-1',
    kind: 'skill',
    name: 'Skill One',
    description: 'Test skill.',
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
    catalogExposure: 'standalone',
    status: 'active',
    ownerUserId: 'owner-1',
    createdAt: 1,
    updatedAt: 2,
}

describe('Capability catalog management transport', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.model.readManifest.mockResolvedValue({ record, manifest })
        mocks.model.authorize.mockResolvedValue(record)
        mocks.model.listAccessGrants.mockResolvedValue([{
            capabilityId: record.capabilityId,
            principalId: 'editor-1',
            accessLevel: 'editor',
            createdAt: 1,
            updatedAt: 1,
        }])
        mocks.model.save.mockResolvedValue(record)
        mocks.model.getAudienceUserIds.mockResolvedValue(['editor-1'])
        mocks.model.setStatus.mockResolvedValue({
            record: { ...record, status: 'disabled', updatedAt: 3 },
            audienceUserIds: ['editor-1'],
        })
    })

    it('returns management permissions and grants to an authorized editor', async () => {
        const result = await handler(CATALOG.GET)({ user: { userId: 'owner-1' }, capabilityId: record.capabilityId })

        expect(result).toMatchObject({
            record,
            manifest,
            permissions: { canEdit: true, canDelete: true, canShare: true },
            grants: [expect.objectContaining({ principalId: 'editor-1', accessLevel: 'editor' })],
        })
    })

    it('keeps manifest create and optimistic manifest update payloads functional', async () => {
        const common = {
            user: { userId: 'owner-1' },
            manifest,
            scope: 'organization',
            scopeOwnerId: 'org-1',
            storageOwnerId: 'org-1',
            summary: 'Summary',
            tags: ['test'],
        }
        await handler(CATALOG.CREATE)(common)
        await handler(CATALOG.UPDATE)({ ...common, expectedManifestBlobHash: record.manifestBlobHash })

        expect(mocks.model.save).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                manifest,
                expectedManifestBlobHash: undefined,
            }),
        )
        expect(mocks.model.save).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                manifest,
                expectedManifestBlobHash: record.manifestBlobHash,
            }),
        )
    })

    it('uses UPDATE as a status-only active/disabled mutation with optimistic concurrency', async () => {
        const result = await handler(CATALOG.UPDATE)({
            user: { userId: 'owner-1' },
            capabilityId: record.capabilityId,
            expectedManifestBlobHash: record.manifestBlobHash,
            status: 'disabled',
        })

        expect(mocks.model.setStatus).toHaveBeenCalledWith(expect.objectContaining({
            capabilityId: record.capabilityId,
            expectedManifestBlobHash: record.manifestBlobHash,
            status: 'disabled',
        }))
        expect(result).toMatchObject({ status: 'disabled' })

        const invalid = await handler(CATALOG.UPDATE)({
            user: { userId: 'owner-1' },
            capabilityId: record.capabilityId,
            expectedManifestBlobHash: record.manifestBlobHash,
            status: 'active',
            manifest,
        })
        expect(invalid).toEqual({ error: 'CAPABILITY_STATUS_UPDATE_MUST_NOT_INCLUDE_MANIFEST' })
    })
})
