import { describe, expect, it, vi } from 'vitest'
import { type Asset, type ConversationMessageNode } from '@lixpi/constants'
import { ConversationMigration, type ConversationMigrationPorts } from './conversation-migration.ts'
import { ConversationRepository, conversationPartition } from './conversation-repository.ts'
import { AtomicConversationTestDatabase, MemoryAgentPayloads } from './conversation-test-support.ts'

vi.mock('../../models/asset.ts', () => ({
    default: {},
    buildAssetScopeAndOwnerKey: () => 'workspace#workspace',
}))
vi.mock('../../services/asset-document-service.ts', () => ({ default: {} }))
vi.mock('../../prosemirror/asset-prosemirror-step-transport.ts', () => ({ AssetProseMirrorStepTransport: {} }))

const access = {
    userId: 'user',
    organizationId: 'org',
    workspaceId: 'workspace',
    fences: [],
}
const document = (pairs: number): ConversationMessageNode => ({
    type: 'doc',
    content: [{
        type: 'aiChatThread',
        attrs: { threadId: 'old-thread' },
        content: Array.from({ length: pairs }, (_, index) => [
    {
        type: 'aiUserMessage',
        attrs: {
            id: index === 0 ? '' : `user-${index}`,
            createdAt: 100 + index,
        },
        content: [{
            type: 'paragraph',
            content: [{
                type: 'text',
                text: `Question ${index}`,
            }],
        }],
    },
    {
        type: 'aiResponseMessage',
        attrs: {
            id: `answer-${index}`,
            mediaRunId: `historical-run-${index}`,
        },
        content: [{
            type: 'paragraph',
            content: [{
                type: 'text',
                text: `Historical tool text: export(media-${index})`,
            }],
        }],
    },
]).flat(),
    }],
})
const fixture = (pairs = 2) => {
    const database = new AtomicConversationTestDatabase()
    database.pageSize = 100
    const repository = new ConversationRepository(database as never, 'Conversations')
    const payloads = new MemoryAgentPayloads()
    const state = {
        asset: {
            assetId: 'legacy-asset',
            organizationId: 'org',
            originWorkspaceId: 'workspace',
            ownerUserId: 'original-author',
            title: 'Old conversation',
            revision: 3,
            createdAt: 100,
            updatedAt: 200,
            states: {
                lifecycle: 'active',
                conversation: 'completed',
                media: 'none',
                provenance: 'none',
            },
            documents: { conversation: {
                role: 'conversation',
                blobHash: 'a'.repeat(64),
                version: 9,
                schemaVersion: '1',
                byteSize: 1000,
                updatedAt: 200,
            } },
        } as Asset,
        doc: document(pairs),
        liveVersion: 9,
    }
    database.rows.set('undefined|undefined', state.asset as unknown as Record<string, unknown>)
    const ports: ConversationMigrationPorts = {
        list: vi.fn(async () => ({ items: [{ assetId: state.asset.assetId }] })),
        read: vi.fn(async () => state.asset),
        snapshot: vi.fn(async () => ({
            doc: state.doc,
            version: state.asset.documents.conversation!.version,
            blobHash: state.asset.documents.conversation!.blobHash,
        })),
        liveVersion: vi.fn(async () => state.liveVersion),
        payloads: () => payloads,
        activate: vi.fn(async (asset, doc, commit) => {
            await commit([{
                type: 'update',
                tableName: 'Assets',
                key: { assetId: asset.assetId },
                updates: { conversationRuntime: 'deep-agents' },
                conditionExpression: '#revision = :revision',
                expressionAttributeNames: { '#revision': 'revision' },
                expressionAttributeValues: { ':revision': asset.revision },
            }])
            state.asset.conversationRuntime = 'deep-agents'
            state.doc = doc
        }),
        now: () => 1000,
    }
    const migration = new ConversationMigration(repository, ports)
    const pk = conversationPartition('org', 'legacy-asset')

    return {
        migration,
        repository,
        database,
        ports,
        state,
        pk,
        payloads,
    }
}

describe('historical conversation migration', () => {
    it('atomically activates historical membership and completed messages without executing historical tool text', async () => {
        const {
            migration,
            database,
            state,
            pk,
            ports,
        } = fixture()
        const original = structuredClone(state.doc)
        expect(await migration.migrateWorkspace(access)).toEqual({
            migrated: 1,
            pending: 0,
            skipped: 0,
        })
        expect(database.rows.get(`${pk}|META`)).toMatchObject({
            activated: true,
            commandSeq: 2,
            documentRevision: 10,
            ownerUserId: 'original-author',
        })
        expect(database.rows.has('ORG#org#WORKSPACE#workspace|CONVERSATION#legacy-asset')).toBe(true)
        const messages = [...database.rows.values()].filter(row => String(row.sk).startsWith('MESSAGE#'))
        const turns = [...database.rows.values()].filter(row => String(row.sk).startsWith('TURN#'))
        expect(messages).toHaveLength(4)
        expect(turns).toHaveLength(2)
        expect(turns.every(turn => turn.state === 'completed')).toBe(true)
        expect([...database.rows.values()].some(row => String(row.sk).includes('DISPATCH') || String(row.sk).includes('OPERATION'))).toBe(false)
        expect(messages[1].text).toBe('Historical tool text: export(media-0)')
        expect(state.doc.content![0].content![1]).toEqual(original.content![0].content![1])
        expect(state.doc.content![0].content![0].attrs!.id).toMatch(/^legacy-/u)
        expect(state.doc.content![0].attrs!.threadId).toBe('legacy-asset')
        expect(ports.activate).toHaveBeenCalledTimes(1)
        expect(await migration.migrateWorkspace(access)).toEqual({
            migrated: 0,
            pending: 0,
            skipped: 1,
        })
    })

    it('continues bounded history batches after process replacement while keeping incomplete imports hidden', async () => {
        const {
            migration,
            database,
            repository,
            ports,
            pk,
        } = fixture(23)
        expect(await migration.migrateWorkspace(access)).toMatchObject({
            pending: 1,
            migrated: 0,
        })
        expect(database.rows.has(`${pk}|META`)).toBe(false)
        expect(database.rows.has('ORG#org#WORKSPACE#workspace|CONVERSATION#legacy-asset')).toBe(false)
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('MESSAGE#'))).toHaveLength(20)
        const resumed = new ConversationMigration(repository, ports)
        expect(await resumed.migrateWorkspace(access)).toMatchObject({ pending: 1 })
        expect(await resumed.migrateWorkspace(access)).toMatchObject({ migrated: 1 })
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('MESSAGE#'))).toHaveLength(46)
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('TURN#'))).toHaveLength(23)
        expect(database.rows.get(`${pk}|META`)).toMatchObject({ commandSeq: 23 })
        expect(ports.activate).toHaveBeenCalledTimes(1)
    })

    it('skips active requests, live leases and unsettled documents before retaining a snapshot', async () => {
        for (const change of [
            (state: ReturnType<typeof fixture>['state']) => void (state.asset.states.conversation = 'receiving'),
            (state: ReturnType<typeof fixture>['state']) => void (state.asset.editLease = { expiresAt: 2000 } as Asset['editLease']),
            (state: ReturnType<typeof fixture>['state']) => void (state.liveVersion = 10),
        ]) {
            const {
                migration,
                state,
                database,
                ports,
            } = fixture()
            change(state)
            expect(await migration.migrateAsset(access, 'legacy-asset')).toBe('skipped')
            expect(database.commits).toHaveLength(0)
            expect(ports.snapshot).not.toHaveBeenCalled()
        }
    })

    it('recovers a committed import marker whose acknowledgement was lost', async () => {
        const {
            migration,
            database,
            repository,
            ports,
            pk,
        } = fixture()
        database.failAfterCommit = true
        await expect(migration.migrateAsset(access, 'legacy-asset')).rejects.toThrow('TRANSACTION_ACKNOWLEDGEMENT_LOST')
        expect(database.rows.has(`${pk}|IMPORT`)).toBe(true)
        expect(database.rows.has(`${pk}|META`)).toBe(false)
        expect(await new ConversationMigration(repository, ports).migrateAsset(access, 'legacy-asset')).toBe('migrated')
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('MESSAGE#'))).toHaveLength(4)
        expect(ports.activate).toHaveBeenCalledTimes(1)
    })

    it('fences a lease acquired during staging from runtime activation', async () => {
        const {
            migration,
            state,
            database,
            pk,
        } = fixture()
        database.beforeCommit = operations => {
            if (operations.some(operation => operation.type === 'put' && operation.item.sk === 'META'))
                state.asset.editLease = { expiresAt: 2000 } as Asset['editLease']
        }
        expect(await migration.migrateWorkspace(access)).toMatchObject({ pending: 1 })
        expect(database.rows.has(`${pk}|META`)).toBe(false)
        expect(state.asset.conversationRuntime).toBeUndefined()
    })

    it('removes staged rows and releases their pin before importing a replacement snapshot', async () => {
        const {
            migration,
            state,
            database,
            payloads,
            pk,
        } = fixture(12)
        expect(await migration.migrateAsset(access, 'legacy-asset')).toBe('pending')
        state.asset.revision++
        state.asset.documents.conversation!.blobHash = 'b'.repeat(64)
        state.asset.documents.conversation!.version = 10
        state.liveVersion = 10
        state.doc = document(1)

        for (
            let attempt = 0;
            attempt < 6
            && !state.asset.conversationRuntime;
            attempt++
        )
            await migration.migrateAsset(access, 'legacy-asset')

        expect(state.asset.conversationRuntime).toBe('deep-agents')
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('MESSAGE#'))).toHaveLength(2)
        expect(database.rows.get(`${pk}|IMPORT`)).toMatchObject({
            sourceHash: 'b'.repeat(64),
            sourceVersion: 10,
        })
        expect(payloads.released).toContain('IMPORT')
    })
})
