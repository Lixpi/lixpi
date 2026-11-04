import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type MediaSourceProbeResult,
} from '@lixpi/capability-system/backend'
import { createMediaSequence } from '@lixpi/capability-system/shared'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { MediaSequenceAdapter } from './media-sequence-adapter.ts'
import { ConversationRepository } from '../llm/agent/conversation-repository.ts'
import { AtomicConversationTestDatabase,createConversationExecutionFixture } from '../llm/agent/conversation-test-support.ts'
import { AgentExecutionScope } from '../llm/agent/agent-execution-scope.ts'

const mocks = vi.hoisted(() => ({
    getAsset: vi.fn(),
    listAssets: vi.fn(),
    authorize: vi.fn(),
    getBlob: vi.fn(),
    retain: vi.fn(),
    commit: vi.fn(),
}))
vi.mock('../models/asset.ts', () => ({
    default: {
        get: mocks.getAsset,
        listAvailable: mocks.listAssets,
    },
    buildAssetScopeAndOwnerKey: () => 'workspace#workspace',
}))
vi.mock('./artifact-revision-store.ts', () => ({ ArtifactRevisionStore: class { commit = mocks.commit } }))
vi.mock('../models/blob.ts', () => ({
    default: { get: mocks.getBlob },
    buildBlobReferenceBatchOperations: mocks.retain,
}))
vi.mock('../llm/agent/conversation-adapters.ts', () => ({ ConversationAdapters: class { authorize = mocks.authorize } }))
vi.mock('../services/account-request-context.ts', () => ({ AccountRequestContext: {
    workContext: () => undefined,
    assertActive: () => {},
} }))

const access = {
    userId: 'user',
    workspaceId: 'workspace',
    organizationId: 'org',
}
const input = {
    sourceId: 'source',
    assetId: 'asset',
    renditionId: 'original',
}
const blobHash = 'a'.repeat(64)
const asset = {
    assetId: 'asset',
    title: 'Video',
    organizationId: 'org',
    scopeOwnerId: 'workspace',
    primaryCategory: 'video',
    revision: 7,
    states: { lifecycle: 'active' },
    media: {
        kind: 'video',
        width: 64,
        height: 64,
        durationSeconds: 1,
        renditions: { original: {
            name: 'original',
            status: 'ready',
            blobHash,
            byteSize: 200,
        } },
    },
}
const probe: MediaSourceProbeResult = {
    probeVersion: 'media-source-v1',
    blobHash,
    width: 64,
    height: 64,
    durationSeconds: 1.25,
    hasAudio: true,
    channels: 1,
    audioSampleRate: 48000,
    peaks: new Array<number>(512).fill(0.25),
}
const fixture = () => {
    const database = new AtomicConversationTestDatabase()
    const repository = new ConversationRepository(database as never, 'Conversations')
    const nats = { request: vi.fn(async () => structuredClone(probe)) }
    const adapter = new MediaSequenceAdapter(repository, async () => [], nats as never)

    return {
        database,
        repository,
        nats,
        adapter,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAsset.mockResolvedValue(asset)
    mocks.listAssets.mockResolvedValue({ items: [asset] })
    mocks.authorize.mockResolvedValue(access)
    mocks.getBlob.mockResolvedValue({
        blobKey: 'blob',
        blobHash,
        status: 'active',
    })
    mocks.retain.mockReturnValue({ operations: [] })
    mocks.commit.mockResolvedValue(true)
})

describe('selected media source probes', () => {
    it.each([0, 1])('publishes one committed sequence edit summary across duplicate results, base revision %s', async baseRevision => {
        const test = await createConversationExecutionFixture()
        const adapter = new MediaSequenceAdapter(test.repository, async () => [], { request: vi.fn() } as never)
        const origin = {
            kind: 'conversation' as const,
            conversationAssetId: test.owner.job.conversationAssetId,
            turnId: test.turn.turnId,
            operationId: 'edit',
        }
        const sequence = {
            ...createMediaSequence('sequence'),
            revision: baseRevision + 1,
        }
        const result = {
            status: 'committed' as const,
            sequence,
            rebased: false,
            revision: {
                sequenceId: 'sequence',
                revision: sequence.revision,
                baseRevision,
                clientMutationId: 'mutation',
                requestHash: 'hash',
                origin,
                changedObjectIds: [],
                readObjectIds: [],
                inverse: [],
                forward: [],
                createdAt: new Date().toISOString(),
            },
        }
        await AgentExecutionScope.run({
            owner: test.owner,
            turn: test.turn,
            continuationEpoch: 0,
            responseMessageId: 'response',
            createdAssetIds: new Set(),
            intent: {
                intent: 'execute',
                operationFamilies: ['sequence-edit'],
                targetAssetIds: [],
                confidence: 1,
                needsClarification: false,
            },
        }, async () => {
            await adapter.reportEdit({
                ...access,
                origin,
            }, result)
            await adapter.reportEdit({
                ...access,
                origin,
            }, {
                ...result,
                status: 'duplicate',
            })
        })
        const summaries = await test.repository.query(test.owner.partition, 'PUBLIC_OPERATION#')
        expect(summaries.items).toHaveLength(1)
        expect(summaries.items[0]).toMatchObject({
            operationKey: baseRevision === 0 ? 'sequence.create' : 'sequence.revise',
            state: 'succeeded',
            outputAssetIds: { sequence: 'sequence' },
        })
        expect([...test.database.rows.values()].filter(row => row.type === 'output.committed')).toHaveLength(1)
    })

    it('lists sources without decoding and probes only a selected source into a hash-scoped cache', async () => {
        const {
            adapter,
            nats,
            database,
        } = fixture()
        expect((await adapter.listSources(access)).items).toHaveLength(1)
        expect(nats.request).not.toHaveBeenCalled()
        const result = await adapter.probeSource(access, input)
        expect(result.source).toMatchObject({
            sourceId: 'source',
            blobHash,
            duration: 1250000,
            channels: 1,
            hasAudio: true,
        })
        expect(result.waveform).toEqual(probe.peaks)
        expect(nats.request).toHaveBeenCalledExactlyOnceWith(NATS_SUBJECTS.MEDIA_RENDER_SUBJECTS.PROBE_SOURCE, expect.objectContaining({
            organizationId: 'org',
            source: expect.objectContaining({
                blobHash,
                byteSize: 200,
            }),
        }), 95000)
        const row = [...database.rows.values()][0]
        expect(row).toMatchObject({
            pk: 'ORG#org#MEDIA_SOURCE_PROBES',
            sk: `media-source-v1#${blobHash}`,
            byteSize: 200,
        })
        expect(row.expiresAt).toBeGreaterThan(Date.now() / 1000)
        expect(await adapter.probeSource(access, {
            ...input,
            sourceId: 'second-reference',
        })).toMatchObject({ source: {
            sourceId: 'second-reference',
            duration: 1250000,
        } })
        expect(nats.request).toHaveBeenCalledTimes(1)
        expect((await adapter.listSources(access)).items[0].waveform).toEqual(probe.peaks)
        expect(nats.request).toHaveBeenCalledTimes(1)
    })

    it('revalidates source access on cache hits and rejects an organization mismatch', async () => {
        const {
            adapter,
            nats,
        } = fixture()
        await adapter.probeSource(access, input)
        mocks.getAsset.mockResolvedValueOnce({ error: 'ACCESS_DENIED' })
        await expect(adapter.probeSource(access, input)).rejects.toThrow('SOURCE_UNAVAILABLE')
        mocks.authorize.mockResolvedValueOnce({
            ...access,
            organizationId: 'other-org',
        })
        await expect(adapter.probeSource(access, input)).rejects.toThrow('SOURCE_UNAVAILABLE')
        expect(nats.request).toHaveBeenCalledTimes(1)
    })

    it('refreshes expired or invalid cache values and rejects malformed worker measurements', async () => {
        const {
            adapter,
            nats,
            database,
            repository,
        } = fixture()
        const pk = 'ORG#org#MEDIA_SOURCE_PROBES'
        const sk = `media-source-v1#${blobHash}`
        await repository.commit([repository.replace(pk, sk, {
            byteSize: 200,
            expiresAt: Math.floor(Date.now() / 1000) + 30,
            result: {
                ...probe,
                peaks: [100],
            },
        })])
        await adapter.probeSource(access, input)
        expect(nats.request).toHaveBeenCalledTimes(1)
        database.rows.get(`${pk}|${sk}`)!.expiresAt = 1
        nats.request.mockResolvedValueOnce({
            ...probe,
            channels: 0,
        })
        await expect(adapter.probeSource(access, input)).rejects.toThrow('INVALID_SOURCE_PROBE')
        expect(nats.request).toHaveBeenCalledTimes(2)
    })

    it('refuses source replacement or access revocation while a probe is running', async () => {
        const {
            adapter,
            nats,
            database,
        } = fixture()
        nats.request.mockImplementationOnce(async () => {
            mocks.getAsset.mockResolvedValueOnce({
                ...asset,
                media: {
                    ...asset.media,
                    renditions: { original: {
                        ...asset.media.renditions.original,
                        blobHash: 'b'.repeat(64),
                    } },
                },
            })

            return probe
        })
        await expect(adapter.probeSource(access, input)).rejects.toThrow('STALE_SOURCE')
        expect(database.commits).toHaveLength(0)
        nats.request.mockImplementationOnce(async () => {
            mocks.getAsset.mockResolvedValueOnce({ error: 'ACCESS_DENIED' })

            return probe
        })
        await expect(adapter.probeSource(access, input)).rejects.toThrow('SOURCE_UNAVAILABLE')
        expect(database.commits).toHaveLength(0)
    })

    it('checks each source Asset revision in the sequence transaction and deduplicates repeated Assets', async () => {
        const { adapter } = fixture()
        const source = await adapter.resolveSource(access, input)
        const sequence = createMediaSequence('sequence', 'Test')
        sequence.sources = [source, {
            ...source,
            sourceId: 'second',
        }]
        await adapter.ports().commit({
            ...access,
            origin: { kind: 'manual' },
        } as never, {
            expectedRevision: 1,
            sequence,
            revision: { clientMutationId: 'edit' },
        } as never)
        const operations = mocks.commit.mock.calls[0][0].additionalOperations
        expect(operations).toEqual([expect.objectContaining({
            type: 'check',
            key: { assetId: 'asset' },
            conditionExpression: '#revision = :revision',
            expressionAttributeValues: { ':revision': 7 },
        })])
        expect(mocks.retain.mock.calls[0][0].additions).toHaveLength(2)
    })

    it('rejects more than 24 bindings before reading or retaining any source', async () => {
        const { adapter } = fixture()
        const source = await adapter.resolveSource(access, input)
        const sequence = createMediaSequence('sequence', 'Test')
        sequence.sources = Array.from({ length: 25 }, (_, index) => ({
            ...source,
            sourceId: `source-${index}`,
        }))
        mocks.getAsset.mockClear()
        await expect(adapter.ports().commit({
            ...access,
            origin: { kind: 'manual' },
        }, {
            expectedRevision: 1,
            sequence,
            revision: { clientMutationId: 'edit' },
        } as never)).rejects.toThrow('MEDIA_SEQUENCE_SOURCE_LIMIT')
        expect(mocks.getAsset).not.toHaveBeenCalled()
        expect(mocks.retain).not.toHaveBeenCalled()
        expect(mocks.commit).not.toHaveBeenCalled()
    })

    it('rejects a sequence save atomically when source access changes after validation', async () => {
        const {
            adapter,
            database,
            repository,
        } = fixture()
        const source = await adapter.resolveSource(access, input)
        const sequence = createMediaSequence('sequence', 'Test')
        sequence.sources = [source]
        // The fixture stores this single external Asset under its non-agent key.
        database.rows.set('undefined|undefined', { ...asset })
        mocks.commit.mockImplementationOnce(async request => {
            database.rows.get('undefined|undefined')!.revision = 8
            await repository.commit([
                ...request.additionalOperations,
                repository.put('revision', 'accepted', { value: true }),
            ])
        })
        await expect(adapter.ports().commit({
            ...access,
            origin: { kind: 'manual' },
        } as never, {
            expectedRevision: 1,
            sequence,
            revision: { clientMutationId: 'edit' },
        } as never)).rejects.toThrow('Conditional transaction conflict')
        expect(database.rows.has('revision|accepted')).toBe(false)
        expect(database.commits).toHaveLength(0)
    })
})
