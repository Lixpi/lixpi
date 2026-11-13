import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    getNatsSubjectPath,
    type SaveWorkspaceNavigationRequest,
    type WorkspaceNavigationDocument,
} from '@lixpi/constants'
import { settings } from '../../settings.ts'
import { InMemoryWorkspaceTreeRepository } from './in-memory-workspace-tree-repository.ts'
import { WorkspaceTreeService } from './workspace-tree-service.ts'
import { createWorkspaceTreeHandlers } from './workspace-tree-handlers.ts'
import { assertNavigationRequestBounds } from './workspace-navigation-limits.ts'

const document = (text: string): WorkspaceNavigationDocument => ({
    type: 'doc',
    content: [{
        type: 'paragraph',
        attrs: { entryId: 'paragraph' },
        ...(text ? { content: [{
            type: 'text',
            text,
        }] } : {}),
    }],
})

const request = (doc: WorkspaceNavigationDocument, mutationId = crypto.randomUUID()): SaveWorkspaceNavigationRequest => ({
    organizationId: 'org',
    mutationId,
    baseRevision: 0,
    document: doc,
})

const fixture = () => {
    const repository = new InMemoryWorkspaceTreeRepository()
    const clock = { now: 1000 }
    const members = new Set(['owner'])
    const service = () => new WorkspaceTreeService({
        repository,
        now: () => clock.now,
        organizations: {
            getMembershipLevel: async userId => members.has(userId) ? 'owner' : undefined,
            getOrganization: async organizationId => ({
                organizationId,
                name: 'Organization',
                tags: {},
            }),
            listUserOrganizationIds: async () => ['org'],
        },
        deletion: {
            cleanupWorkspace: async () => {},
            stopConversations: async () => {},
        },
    })

    return {
        repository,
        clock,
        members,
        service,
    }
}

describe('Navigation autosave admission', () => {
    it('shares a user budget across service instances and replenishes it at the configured cadence', async () => {
        const f = fixture()
        const snapshot = await f.service().getNavigationSnapshot('owner', 'org')

        for (let index = 0; index < settings.navigationPersistence.requestBurst; index += 1)
            expect(await f.service().saveNavigation('owner', request(snapshot.document))).toHaveProperty('snapshot')

        const blocked = await f.service().saveNavigation('owner', {
            ...request(snapshot.document),
            organizationId: 'another-organization',
        })
        expect(blocked).toEqual({
            error: 'WORKSPACE_NAVIGATION_RATE_LIMITED',
            retryAfterMs: settings.navigationPersistence.requestIntervalMs,
        })
        f.clock.now += settings.navigationPersistence.requestIntervalMs
        expect(await f.service().saveNavigation('owner', request(snapshot.document))).toHaveProperty('snapshot')
    })

    it('returns the typed retry delay through the authenticated request handler', async () => {
        const f = fixture()
        const snapshot = await f.service().getNavigationSnapshot('owner', 'org')
        const service = f.service()

        for (let index = 0; index < settings.navigationPersistence.requestBurst; index += 1)
            await service.saveNavigation('owner', request(snapshot.document))

        const handlers = createWorkspaceTreeHandlers(service)
        const handler = handlers[getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.SAVE_WORKSPACE_NAVIGATION)]
        expect(await handler({
            ...request(snapshot.document),
            user: { userId: 'owner' },
        })).toEqual({
            error: 'WORKSPACE_NAVIGATION_RATE_LIMITED',
            retryAfterMs: settings.navigationPersistence.requestIntervalMs,
        })
    })

    it('rejects oversized input before reading or reserving database capacity', async () => {
        const f = fixture()
        const admission = vi.spyOn(f.repository, 'admitNavigationWrite')
        const read = vi.spyOn(f.repository, 'getNavigationRecord')

        await expect(f.service().saveNavigation('owner', request(document('x'.repeat(settings.navigationPersistence.maxDocumentBytes + 1))))).rejects.toThrow('WORKSPACE_NAVIGATION_INVALID')
        expect(admission).not.toHaveBeenCalled()
        expect(read).not.toHaveBeenCalled()
    })
})

describe('Unchanged navigation acknowledgement', () => {
    it('records idempotency without publishing another revision for equivalent schema defaults', async () => {
        const f = fixture()
        const service = f.service()
        const snapshot = await service.getNavigationSnapshot('owner', 'org')
        const equivalent = structuredClone(snapshot.document)
        delete equivalent.content![0].content
        delete equivalent.content![0].attrs!.bold
        const unchanged = request(equivalent, 'unchanged')
        const revisions = f.repository.navigationDocuments.size

        expect(await service.saveNavigation('owner', unchanged)).toMatchObject({ snapshot: { revision: 0 } })
        expect(await service.saveNavigation('owner', unchanged)).toMatchObject({ snapshot: { revision: 0 } })
        expect(f.repository.navigationDocuments.size).toBe(revisions)
        expect(f.repository.navigationRecords.get('org#MUTATION#unchanged')).toMatchObject({
            userId: 'owner',
            revision: 0,
        })
        await expect(service.saveNavigation('owner', {
            ...unchanged,
            document: document('Different'),
        })).rejects.toThrow('WORKSPACE_NAVIGATION_MUTATION_REUSED')
    })

    it('does not acknowledge a no-op against a head changed by another writer', async () => {
        const f = fixture()
        const service = f.service()
        const snapshot = await service.getNavigationSnapshot('owner', 'org')
        const record = f.repository.recordUnchangedNavigation
        vi.spyOn(f.repository, 'recordUnchangedNavigation').mockImplementationOnce(async (...args) => {
            await f.service().saveNavigation('owner', request(document('Other writer'), 'other'))

            return await record(...args)
        })

        expect(await service.saveNavigation('owner', request(snapshot.document, 'unchanged'))).toMatchObject({
            error: 'WORKSPACE_NAVIGATION_STALE',
            snapshot: { revision: 1 },
        })
        expect(f.repository.navigationRecords.has('org#MUTATION#unchanged')).toBe(false)
    })

    it('accepts concurrent retries of the same unchanged mutation without another revision', async () => {
        const f = fixture()
        const snapshot = await f.service().getNavigationSnapshot('owner', 'org')
        const unchanged = request(snapshot.document, 'same')
        const results = await Promise.all([
            f.service().saveNavigation('owner', unchanged),
            f.service().saveNavigation('owner', unchanged),
        ])

        expect(results).toEqual([{ snapshot }, { snapshot }])
        expect(f.repository.navigationDocuments.size).toBe(1)
    })

    it('does not overwrite a no-op receipt recorded while a different payload with the same ID stages', async () => {
        const f = fixture()
        const service = f.service()
        const snapshot = await service.getNavigationSnapshot('owner', 'org')
        const stage = f.repository.putNavigationDocument
        vi.spyOn(f.repository, 'putNavigationDocument').mockImplementationOnce(async (...args) => {
            await f.service().saveNavigation('owner', request(snapshot.document, 'same'))
            await stage(...args)
        })

        await expect(service.saveNavigation('owner', request(document('Unexpected change'), 'same'))).rejects.toThrow('WORKSPACE_NAVIGATION_MUTATION_REUSED')
        expect(await service.getNavigationSnapshot('owner', 'org')).toEqual(snapshot)
        expect(f.repository.locks.size).toBe(0)
    })

    it('returns the current authorized snapshot when an acknowledged mutation is retried after another edit', async () => {
        const f = fixture()
        const service = f.service()
        const snapshot = await service.getNavigationSnapshot('owner', 'org')
        const unchanged = request(snapshot.document, 'acknowledged')
        await service.saveNavigation('owner', unchanged)
        await service.saveNavigation('owner', request(document('Later edit'), 'later'))
        const current = await service.getNavigationSnapshot('owner', 'org')

        expect(await service.saveNavigation('owner', unchanged)).toEqual({ snapshot: current })
        expect(current.revision).toBe(1)
    })

    it('reauthorizes access when retrying a previously acknowledged mutation', async () => {
        const f = fixture()
        const service = f.service()
        const snapshot = await service.getNavigationSnapshot('owner', 'org')
        const unchanged = request(snapshot.document, 'acknowledged')
        await service.saveNavigation('owner', unchanged)
        f.members.delete('owner')

        await expect(service.saveNavigation('owner', unchanged)).rejects.toThrow('PERMISSION_DENIED')
        expect(f.repository.navigationRecords.has('org#MUTATION#acknowledged')).toBe(true)
    })

    it('still requires access before recording an unchanged acknowledgement', async () => {
        const f = fixture()
        const snapshot = await f.service().getNavigationSnapshot('owner', 'org')

        await expect(f.service().saveNavigation('outsider', request(snapshot.document, 'denied'))).rejects.toThrow('PERMISSION_DENIED')
        expect(f.repository.navigationRecords.has('org#MUTATION#denied')).toBe(false)
    })
})

describe('Navigation input bounds', () => {
    it('rejects deep or cyclic raw JSON before recursive serialization', () => {
        let deep: WorkspaceNavigationDocument = document('')

        for (let index = 0; index < 1000; index += 1)
            deep = {
                type: 'bullet_list',
                content: [deep],
            }

        expect(() => assertNavigationRequestBounds(request(deep), settings.navigationPersistence)).toThrow('WORKSPACE_NAVIGATION_INVALID')
        const cyclic = document('')
        cyclic.content!.push(cyclic)
        expect(() => assertNavigationRequestBounds(request(cyclic), settings.navigationPersistence)).toThrow('WORKSPACE_NAVIGATION_INVALID')
    })

    it('bounds node count and the combined explicit workspace-change count', () => {
        const nodes = {
            type: 'doc',
            content: Array.from({ length: settings.navigationPersistence.maxNodes }, () => ({ type: 'paragraph' })),
        }
        expect(() => assertNavigationRequestBounds(request(nodes), settings.navigationPersistence)).toThrow('WORKSPACE_NAVIGATION_INVALID')
        expect(() => assertNavigationRequestBounds({
            ...request(document('')),
            createdWorkspaceIds: Array.from({ length: 65 }, (_, index) => `created-${index}`),
            deletedWorkspaceIds: Array.from({ length: 64 }, (_, index) => `deleted-${index}`),
        }, settings.navigationPersistence)).toThrow('WORKSPACE_NAVIGATION_INVALID')
    })

    it('bounds block identities before they become DynamoDB keys', () => {
        const oversized = document('')
        oversized.content![0].attrs!.entryId = 'x'.repeat(201)
        expect(() => assertNavigationRequestBounds(request(oversized), settings.navigationPersistence)).toThrow('WORKSPACE_NAVIGATION_INVALID')
    })

    it('measures encoded UTF-8 and escaped JSON bytes rather than string length', () => {
        const limits = {
            ...settings.navigationPersistence,
            maxDocumentBytes: 200,
        }
        expect(() => assertNavigationRequestBounds(request(document('🙂'.repeat(30))), limits)).toThrow('WORKSPACE_NAVIGATION_INVALID')
        expect(() => assertNavigationRequestBounds(request(document('\n'.repeat(70))), limits)).toThrow('WORKSPACE_NAVIGATION_INVALID')
        expect(() => assertNavigationRequestBounds(request(document('A normal label')), settings.navigationPersistence)).not.toThrow()
    })
})
