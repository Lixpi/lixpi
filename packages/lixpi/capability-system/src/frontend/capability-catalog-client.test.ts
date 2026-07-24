import { describe, expect, it, vi } from 'vitest'
import {
    getCapabilityUserEventSubject,
    NATS_SUBJECTS,
    type CapabilityCatalogRecord,
    type CapabilityManifest,
} from '@lixpi/constants'

import {
    CapabilityCatalogClient,
    CAPABILITY_CATALOG_SUBJECTS,
    normalizeQuery,
    parseCapabilityManifestJson,
    rankEmptyCapabilityQuery,
    type CapabilityCatalogItem,
    type CapabilityCatalogPage,
} from './capability-catalog-client.ts'

const emptyPage: CapabilityCatalogPage = { items: [] }

function item(capabilityId: string, options: Partial<CapabilityCatalogItem> = {}): CapabilityCatalogItem {
    const name = options.name ?? capabilityId
    return {
        scopeAndOwner: 'global#system',
        scopeOwnerId: 'system',
        searchKey: `tool#${name}`,
        capabilityId,
        kind: 'tool',
        scope: 'global',
        name,
        normalizedName: name.toLocaleLowerCase(),
        summary: '',
        tags: [],
        manifestBlobHash: `hash-${capabilityId}`,
        catalogVisibility: 'listed',
        status: 'active',
        updatedAt: 1,
        ...options,
    }
}

describe('CapabilityCatalogClient', () => {
    it('rejects malformed and schema-invalid manifest JSON before transport', () => {
        expect(() => parseCapabilityManifestJson('{')).toThrow('Manifest must be valid JSON')
        expect(() => parseCapabilityManifestJson('{"schemaVersion":1}')).toThrow('Invalid manifest')
    })

    it('normalizes picker queries', () => {
        expect(normalizeQuery('  Character   CREATOR ')).toBe('character creator')
    })

    it('deduplicates concurrent searches and caches the result', async () => {
        const request = vi.fn().mockResolvedValue(emptyPage)
        const client = new CapabilityCatalogClient({
            transport: { request },
            getToken: vi.fn().mockResolvedValue('token'),
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
        })

        const [first, second] = await Promise.all([
            client.search('Character'),
            client.search(' character '),
        ])
        const third = await client.search('CHARACTER')

        expect(first).toEqual(emptyPage)
        expect(second).toBe(first)
        expect(third).toBe(first)
        expect(request).toHaveBeenCalledTimes(1)
        expect(request).toHaveBeenCalledWith(CAPABILITY_CATALOG_SUBJECTS.list, {
            token: 'token',
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
            query: 'character',
            limit: 20,
        })
    })

    it('keeps distinct pagination cursors out of the same cache entry', async () => {
        const request = vi.fn().mockResolvedValue(emptyPage)
        const client = new CapabilityCatalogClient({
            transport: { request },
            getToken: vi.fn().mockResolvedValue('token'),
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
        })

        await client.list({ cursor: 'page-1' })
        await client.list({ cursor: 'page-2' })

        expect(request).toHaveBeenCalledTimes(2)
    })

    it('resolves the Tool input schema and dependency names from authorized details', async () => {
        const request = vi.fn().mockResolvedValue({
            record: {
                capabilityId: 'tool-1', kind: 'tool', scope: 'global', scopeOwnerId: 'system',
                storageOwnerId: 'system', manifestBlobHash: 'hash-1', status: 'active', ownerUserId: 'system',
                catalogVisibility: 'listed',
                createdAt: 1, updatedAt: 2,
            },
            manifest: {
                schemaVersion: 1,
                capabilityId: 'tool-1',
                kind: 'tool',
                name: 'Character Creator',
                description: 'Build a character sheet.',
                references: [{ capabilityId: 'skill-1', kind: 'skill' }],
                resources: [],
                tool: {
                    toolType: 'character-creator',
                    inputSchema: { resourceId: 'input', blobHash: 'input-hash', mediaType: 'application/schema+json', role: 'schema' },
                    outputSchema: { resourceId: 'output', blobHash: 'output-hash', mediaType: 'application/schema+json', role: 'schema' },
                    executionPolicy: 'required',
                    workflow: { steps: [], outputs: {} },
                },
            },
            references: [{ capabilityId: 'skill-1', kind: 'skill', name: 'Layout' }],
            resources: [{ resourceId: 'input', content: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } }],
        })
        const client = new CapabilityCatalogClient({
            transport: { request },
            getToken: vi.fn().mockResolvedValue('token'),
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
        })

        const details = await client.get('tool-1')

        expect(details.scope).toBe('global')
        expect(details.references).toEqual([{ capabilityId: 'skill-1', kind: 'skill', name: 'Layout' }])
        expect(details.inputSchema?.required).toEqual(['prompt'])
        expect(details.permissions.canEdit).toBe(false)
        expect(details.grants).toEqual([])
    })

    it('sends optimistic catalog management payloads through the dedicated subjects', async () => {
        const record: CapabilityCatalogRecord = {
            capabilityId: 'skill-1', kind: 'skill', scope: 'user', scopeOwnerId: 'user-1',
            storageOwnerId: 'org-1', manifestBlobHash: 'hash-1', status: 'active', ownerUserId: 'user-1',
            catalogVisibility: 'listed',
            createdAt: 1, updatedAt: 2,
        }
        const manifest: CapabilityManifest = {
            schemaVersion: 1,
            capabilityId: 'skill-1',
            kind: 'skill',
            name: 'Skill One',
            description: 'Reusable instructions.',
            references: [],
            resources: [],
        }
        const request = vi.fn().mockResolvedValue(record)
        const client = new CapabilityCatalogClient({
            transport: { request },
            getToken: vi.fn().mockResolvedValue('token'),
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
        })
        const details = {
            ...item('skill-1', { kind: 'skill', scope: 'user', scopeOwnerId: 'user-1' }),
            record,
            manifest,
            references: [],
            permissions: { canEdit: true, canDelete: true, canShare: true, canSetStatus: true },
            grants: [],
        }

        await client.create({ manifest, scope: 'user', scopeOwnerId: 'user-1', storageOwnerId: 'org-1', summary: 'Summary', tags: ['tag'] })
        await client.update(details, { ...manifest, description: 'Updated.' })
        await client.setStatus(details, 'disabled')
        await client.delete(details)
        await client.grant('skill-1', 'user-2', 'editor')
        await client.revoke('skill-1', 'user-2')

        expect(request).toHaveBeenNthCalledWith(1, CAPABILITY_CATALOG_SUBJECTS.create, expect.objectContaining({ manifest, scope: 'user' }))
        expect(request).toHaveBeenNthCalledWith(2, CAPABILITY_CATALOG_SUBJECTS.update, expect.objectContaining({ expectedManifestBlobHash: 'hash-1' }))
        expect(request).toHaveBeenNthCalledWith(3, CAPABILITY_CATALOG_SUBJECTS.update, expect.objectContaining({ capabilityId: 'skill-1', status: 'disabled' }))
        expect(request).toHaveBeenNthCalledWith(4, CAPABILITY_CATALOG_SUBJECTS.delete, expect.objectContaining({ capabilityId: 'skill-1' }))
        expect(request).toHaveBeenNthCalledWith(5, CAPABILITY_CATALOG_SUBJECTS.grant, expect.objectContaining({ principalId: 'user-2', accessLevel: 'editor' }))
        expect(request).toHaveBeenNthCalledWith(6, CAPABILITY_CATALOG_SUBJECTS.revoke, expect.objectContaining({ principalId: 'user-2' }))
    })

    it('combines RUN.GET with envelope-based replay and advances its cursor', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce({
                runId: 'run-1', rootCapabilityId: 'tool-1', resolvedManifests: [], workspaceId: 'workspace-1',
                origin: 'panel', status: 'running', currentStepIds: [], outputAssetIds: [], eventStreamName: 'events',
                createdAt: 1, updatedAt: 2,
            })
            .mockResolvedValueOnce({
                events: [{
                    streamSequence: 8,
                    event: { runId: 'run-1', sequence: 1, eventType: 'RUN_STARTED', timestamp: 1, runStatus: 'running' },
                }],
                hasMore: true,
            })
        const client = new CapabilityCatalogClient({
            transport: { request },
            getToken: vi.fn().mockResolvedValue('token'),
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
        })

        const replay = await client.replay('run-1')

        expect(replay.events).toHaveLength(1)
        expect(replay.cursor).toBe('9')
        expect(request).toHaveBeenNthCalledWith(2, CAPABILITY_CATALOG_SUBJECTS.replay, expect.objectContaining({
            runId: 'run-1',
            startStreamSequence: 1,
        }))
    })

    it('subscribes to the tokenized user run-event subject and filters by workspace and run', () => {
        let transportListener: ((payload: unknown) => void) | undefined
        const unsubscribe = vi.fn()
        const subscribe = vi.fn((_subject: string, listener: (payload: unknown) => void) => {
            transportListener = listener
            return { unsubscribe }
        })
        const client = new CapabilityCatalogClient({
            transport: { request: vi.fn(), subscribe },
            getToken: vi.fn().mockResolvedValue('token'),
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
            getUserId: () => 'user-1',
        })
        const listener = vi.fn()
        const stop = client.subscribeToRunEvents('run-1', listener)
        const runEvent = { runId: 'run-1', sequence: 1, eventType: 'RUN_STARTED', timestamp: 1, runStatus: 'running' } as const

        expect(subscribe).toHaveBeenCalledWith(
            `${getCapabilityUserEventSubject('user-1', NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.STATUS)}.workspace-1.run-1`,
            expect.any(Function),
        )
        transportListener?.({ workspaceId: 'other-workspace', event: runEvent })
        transportListener?.({ workspaceId: 'workspace-1', event: { ...runEvent, runId: 'other-run' } })
        transportListener?.({ workspaceId: 'workspace-1', event: runEvent })
        expect(listener).toHaveBeenCalledOnce()
        expect(listener).toHaveBeenCalledWith(runEvent)

        stop()
        expect(unsubscribe).toHaveBeenCalledOnce()
    })

    it('ranks newest recents first, then deterministic recommendations, without duplicates', () => {
        const page = {
            items: [
                item('ordinary'),
                item('recommended-z', { name: 'Zulu', tags: ['recommended'] }),
                item('recent-a'),
                item('recommended-a', { name: 'Alpha', tags: ['recommended'] }),
            ],
            cursor: 'next',
        }

        const ranked = rankEmptyCapabilityQuery(page, [item('recent-a'), item('recent-b')])

        expect(ranked.items.map((entry) => entry.capabilityId)).toEqual([
            'recent-b',
            'recent-a',
            'recommended-a',
            'recommended-z',
            'ordinary',
        ])
        expect(ranked.cursor).toBe('next')
    })

    it('remembers no more than 20 selections for empty-query results', async () => {
        const client = new CapabilityCatalogClient({
            transport: { request: vi.fn().mockResolvedValue(emptyPage) },
            getToken: vi.fn().mockResolvedValue('token'),
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
        })
        for (let index = 0; index < 22; index += 1) client.rememberSelection(item(`recent-${index}`))

        const page = await client.search('')

        expect(page.items).toHaveLength(20)
        expect(page.items[0]?.capabilityId).toBe('recent-21')
        expect(page.items.at(-1)?.capabilityId).toBe('recent-2')
    })
})
