import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'
import {
    MediaSequenceRenderCompiler,
    defaultMediaRenderLimits,
    type MediaRenderRequest,
    type MediaRenderResult,
} from '@lixpi/capability-system/backend'
import {
    createMediaSequence,
    defaultSequenceAudio,
    defaultSequenceTransform,
} from '@lixpi/capability-system/shared'
import {
    AtomicConversationTestDatabase,
    MemoryAgentPayloads,
} from '../llm/agent/conversation-test-support.ts'
import { ConversationRepository } from '../llm/agent/conversation-repository.ts'
import {
    MediaRenderAdapter,
    type MediaRenderAdapterPorts,
    type MediaRenderRecord,
} from './media-render-adapter.ts'

vi.mock('../services/account-request-context.ts', () => ({ AccountRequestContext: {
    workContext: () => undefined,
    resumeWork: async (_account: unknown, operation: () => Promise<unknown>) => await operation(),
} }))
vi.mock('@lixpi/debug-tools', () => ({
    warn: vi.fn(),
    info: vi.fn(),
    err: vi.fn(),
    debug: vi.fn(),
}))

const subjects = NATS_SUBJECTS.MEDIA_RENDER_SUBJECTS
const access = {
    organizationId: 'org',
    workspaceId: 'workspace',
    userId: 'user',
}
const resultFor = (request: MediaRenderRequest): MediaRenderResult => ({
    jobId: request.jobId,
    attempt: request.attempt,
    organizationId: request.organizationId,
    outputAssetId: request.outputAssetId,
    sequenceId: 'sequence',
    sequenceRevision: 1,
    presetId: 'mp4-h264-aac',
    blobHash: 'b'.repeat(64),
    byteSize: 500,
    bucketName: 'blobs-org-files',
    objectKey: `sha256/bb/${'b'.repeat(64)}`,
    mimeType: 'video/mp4',
    durationSeconds: 0.5,
    width: 64,
    height: 64,
    audioSampleRate: 48000,
    channels: 2,
})

const fixture = () => {
    const database = new AtomicConversationTestDatabase()
    const repository = new ConversationRepository(database as unknown as ConstructorParameters<typeof ConversationRepository>[0], 'Conversations')
    const clock = { now: 1000 }
    const payloads = new MemoryAgentPayloads()
    const render = vi.fn(async (request: MediaRenderRequest) => resultFor(request))
    const nats = {
        request: vi.fn(async (subject: string, input: unknown) => {
            if (subject === subjects.READINESS)
                return {
                    ready: true,
                    limits: defaultMediaRenderLimits,
                    presets: [{
                        presetId: 'mp4-h264-aac',
                        available: true,
                    }],
                }

            if (subject === subjects.RENDER)
                return await render(input as MediaRenderRequest)

            return { cancelled: true }
        }),
    }
    const ports: MediaRenderAdapterPorts = {
        nats: nats as unknown as MediaRenderAdapterPorts['nats'],
        authorize: vi.fn(async () => []),
        retainInputs: vi.fn(async () => [repository.put('BLOBS', 'source-reference', { held: true })]),
        releaseInputs: vi.fn(async () => ({
            operations: [repository.remove('BLOBS', 'source-reference')],
            afterCommit: async () => {},
        })),
        payloads: () => payloads,
        finalize: vi.fn(async (record, _result, commit) => await commit([repository.put('ASSETS', record.outputAssetId, { assetId: record.outputAssetId })])),
        retainResult: vi.fn(async () => []),
        publish: vi.fn(async () => {}),
        now: () => clock.now,
    }
    const adapter = new MediaRenderAdapter(repository, new MediaSequenceRenderCompiler(), ports)
    const sequence = createMediaSequence('sequence')
    sequence.width = 64
    sequence.height = 64
    sequence.duration = 120000
    sequence.audioSampleRate = 48000
    sequence.tracks = [{
        trackId: 'video',
        name: 'Video',
        kind: 'video',
        locked: false,
        visible: true,
        muted: false,
        solo: false,
    }]
    sequence.sources = [{
        sourceId: 'source',
        assetId: 'input_asset',
        renditionId: 'original',
        blobHash: 'a'.repeat(64),
        byteSize: 100,
        kind: 'image',
        duration: 0,
        timeBase: {
            numerator: 1,
            denominator: 1,
        },
        width: 64,
        height: 64,
    }]
    sequence.clips = [{
        clipId: 'clip',
        trackId: 'video',
        sourceId: 'source',
        sourceIn: 0,
        sourceOut: 0,
        start: 0,
        duration: 120000,
        rate: {
            numerator: 1,
            denominator: 1,
        },
        transform: defaultSequenceTransform(),
        audio: defaultSequenceAudio(),
        keyframes: [],
    }]
    const request = {
        sequence,
        preset: {
            presetId: 'mp4-h264-aac',
            quality: 'draft',
        },
        clientMutationId: 'mutation',
    }

    return {
        database,
        repository,
        clock,
        payloads,
        render,
        nats,
        ports,
        adapter,
        request,
    }
}

beforeEach(() => vi.clearAllMocks())

// =============================================================================
// DURABLE EXPORT DISPATCH AND ATOMIC OUTPUTS
// =============================================================================

describe('media render adapter', () => {
    it.each([
        { presetId: 'wav-pcm' },
        { mimeType: 'audio/wav' },
        { durationSeconds: 5 },
        { width: 128 },
        { audioSampleRate: 8000 },
        { channels: 1 },
    ])('rejects worker media metadata that contradicts frozen export settings: %j', async invalid => {
        const {
            adapter,
            request,
            render,
            ports,
        } = fixture()
        render.mockImplementationOnce(async input => ({
            ...resultFor(input),
            ...invalid,
        } as MediaRenderResult))
        const handle = await adapter.submit(access, request)
        await adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })
        expect(await adapter.get(access, handle.jobId)).toMatchObject({
            state: 'failed',
            error: 'MEDIA_RENDER_RESULT_MISMATCH',
        })
        expect(ports.finalize).not.toHaveBeenCalled()
    })

    it('persists staged progress for the current authorized attempt and ignores stale or malformed updates', async () => {
        const {
            adapter,
            request,
            render,
        } = fixture()
        const handle = await adapter.submit(access, request)
        render.mockImplementationOnce(async running => {
            const progress = {
                organizationId: access.organizationId,
                jobId: handle.jobId,
                attempt: running.attempt,
                phase: 'encode',
                durationSeconds: 0.5,
                processedDurationSeconds: 0.2,
            }
            await adapter.recordProgress(progress)
            expect((await adapter.get(access, handle.jobId)).progress).toEqual({
                phase: 'encode',
                durationSeconds: 0.5,
                processedDurationSeconds: 0.2,
            })
            await adapter.recordProgress({
                ...progress,
                attempt: running.attempt + 1,
                processedDurationSeconds: 0.4,
            })
            await adapter.recordProgress({
                ...progress,
                phase: 'decode',
                processedDurationSeconds: 0,
            })
            await adapter.recordProgress({
                ...progress,
                durationSeconds: 10,
            })
            await adapter.recordProgress({
                ...progress,
                processedDurationSeconds: Number.NaN,
            })
            await adapter.recordProgress({
                ...progress,
                processedDurationSeconds: 0.1,
            })
            expect((await adapter.get(access, handle.jobId)).progress?.processedDurationSeconds).toBe(0.2)

            return resultFor(running)
        })
        expect(await adapter.execute({
            organizationId: access.organizationId,
            jobId: handle.jobId,
        })).toBe('done')
        await adapter.recordProgress({
            organizationId: access.organizationId,
            jobId: handle.jobId,
            attempt: 1,
            phase: 'finalize',
            durationSeconds: 0.5,
            processedDurationSeconds: 0.5,
        })
        expect(await adapter.get(access, handle.jobId)).toMatchObject({
            state: 'completed',
            progress: {
                phase: 'encode',
                processedDurationSeconds: 0.2,
            },
        })
    })

    it('can persist final progress while committing the output without restarting the render attempt', async () => {
        const {
            adapter,
            request,
            ports,
            render,
        } = fixture()
        const handle = await adapter.submit(access, request)
        const finalize = ports.finalize
        ports.finalize = async (record, result, commit) => {
            await adapter.recordProgress({
                organizationId: access.organizationId,
                jobId: record.jobId,
                attempt: record.attempt,
                phase: 'finalize',
                durationSeconds: 0.5,
                processedDurationSeconds: 0.5,
            })
            await finalize(record, result, commit)
        }
        expect(await adapter.execute({
            organizationId: access.organizationId,
            jobId: handle.jobId,
        })).toBe('done')
        expect(render).toHaveBeenCalledTimes(1)
        expect(await adapter.get(access, handle.jobId)).toMatchObject({
            state: 'completed',
            progress: {
                phase: 'finalize',
                processedDurationSeconds: 0.5,
            },
        })
    })

    it('does not allow a different user to cancel another user\'s export', async () => {
        const {
            adapter,
            request,
            ports,
        } = fixture()
        const handle = await adapter.submit(access, request)
        await expect(adapter.cancel({
            ...access,
            userId: 'another-user',
        }, handle.jobId)).rejects.toThrow('MEDIA_RENDER_NOT_FOUND')
        expect(ports.releaseInputs).not.toHaveBeenCalled()
    })

    it('refuses admission and retains no source blobs when a source changes before the freeze transaction', async () => {
        const {
            adapter,
            request,
            database,
            ports,
        } = fixture()
        database.rows.set('SOURCE|input_asset', {
            pk: 'SOURCE',
            sk: 'input_asset',
            revision: 7,
        })
        vi.mocked(ports.authorize).mockResolvedValue([{
            type: 'check',
            tableName: 'Conversations',
            key: {
                pk: 'SOURCE',
                sk: 'input_asset',
            },
            conditionExpression: '#revision = :revision',
            expressionAttributeNames: { '#revision': 'revision' },
            expressionAttributeValues: { ':revision': 7 },
        }])
        database.beforeCommit = () => void (database.rows.get('SOURCE|input_asset')!.revision = 8)
        await expect(adapter.submit(access, request)).rejects.toThrow('Conditional transaction conflict')
        expect(database.rows.has('BLOBS|source-reference')).toBe(false)
        expect([...database.rows.values()].filter(row => row.sk === 'META')).toHaveLength(0)
        expect(ports.publish).not.toHaveBeenCalled()
    })

    it('rejects a manifest larger than the private worker transport budget before admission', async () => {
        const {
            adapter,
            request,
            database,
            nats,
        } = fixture()
        request.sequence.name = 'x'.repeat(512 * 1024)
        await expect(adapter.submit(access, request)).rejects.toThrow('MEDIA_RENDER_MANIFEST_LIMIT')
        expect(nats.request).not.toHaveBeenCalled()
        expect(database.commits).toHaveLength(0)
    })

    it('does not return a concurrent idempotency winner belonging to another user', async () => {
        const {
            adapter,
            request,
            database,
        } = fixture()
        const pending = await Promise.allSettled([adapter.submit(access, request), adapter.submit({
            ...access,
            userId: 'other-user',
        }, request)])
        expect(pending.filter(result => result.status === 'fulfilled')).toHaveLength(1)
        expect(pending.filter(result => result.status === 'rejected')).toHaveLength(1)
        expect([...database.rows.values()].filter(row => row.sk === 'META')).toHaveLength(1)
    })

    it('deduplicates admission and commits source retention with a durable dispatch intent', async () => {
        const {
            adapter,
            request,
            database,
        } = fixture()
        const [first, second] = await Promise.all([adapter.submit(access, request), adapter.submit(access, request)])
        expect(second).toEqual(first)
        const commit = database.commits[0]
        expect(commit.filter(operation => operation.type === 'put')).toHaveLength(3)
        expect(database.rows.has('BLOBS|source-reference')).toBe(true)
        expect([...database.rows.values()].filter(row => String(row.pk).startsWith('RENDER_DUE#'))).toHaveLength(1)
        await expect(adapter.submit(access, {
            ...request,
            preset: {
                presetId: 'mp4-h264-aac',
                quality: 'high',
            },
        })).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    })

    it('renders the frozen revision and atomically commits one stable Asset and terminal receipt', async () => {
        const {
            adapter,
            request,
            render,
            database,
            ports,
        } = fixture()
        const handle = await adapter.submit(access, request)
        request.sequence.revision = 2
        expect(await adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })).toBe('done')
        expect((render.mock.calls[0][0].sequence as { revision: number }).revision).toBe(1)
        expect(await adapter.get(access, handle.jobId)).toMatchObject({
            state: 'completed',
            attempt: 1,
            outputAssetId: handle.outputAssetId,
        })
        const completion = database.commits.at(-1)!
        expect(completion.some(operation => operation.type === 'put' && operation.item.pk === 'ASSETS')).toBe(true)
        expect(completion.some(operation => operation.type === 'put' && operation.item.state === 'completed')).toBe(true)
        await adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })
        expect(render).toHaveBeenCalledTimes(1)
        expect(ports.finalize).toHaveBeenCalledTimes(1)
    })

    it('fences an output arriving after cancellation and releases frozen source references', async () => {
        const {
            adapter,
            request,
            render,
            database,
            ports,
        } = fixture()
        const pending = Promise.withResolvers<MediaRenderResult>()
        const started = Promise.withResolvers<MediaRenderRequest>()
        render.mockImplementationOnce(async input => { started.resolve(input)

        return await pending.promise })
        const handle = await adapter.submit(access, request)
        const executing = adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })
        const input = await started.promise
        expect(await adapter.cancel(access, handle.jobId)).toMatchObject({ state: 'cancelled' })
        pending.resolve(resultFor(input))
        await executing
        expect(ports.finalize).not.toHaveBeenCalled()
        expect(database.rows.has('BLOBS|source-reference')).toBe(false)
    })

    it('allows a replacement attempt after lease expiry without publishing the stale result', async () => {
        const {
            adapter,
            request,
            render,
            ports,
            clock,
        } = fixture()
        const pending = Promise.withResolvers<MediaRenderResult>()
        const started = Promise.withResolvers<MediaRenderRequest>()
        render.mockImplementationOnce(async input => { started.resolve(input)

        return await pending.promise })
        const handle = await adapter.submit(access, request)
        const old = adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })
        const first = await started.promise
        clock.now += 30001
        expect(await adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })).toBe('done')
        pending.resolve(resultFor(first))
        await old
        expect(ports.finalize).toHaveBeenCalledTimes(1)
        expect(await adapter.get(access, handle.jobId)).toMatchObject({
            state: 'completed',
            attempt: 2,
        })
    })

    it('recovers lost finalization acknowledgements without rendering or creating the output again', async () => {
        const {
            adapter,
            request,
            render,
            database,
            ports,
            repository,
        } = fixture()
        vi.mocked(ports.finalize).mockImplementationOnce(async (record, _result, commit) => {
            database.failAfterCommit = true
            await commit([repository.put('ASSETS', record.outputAssetId, { assetId: record.outputAssetId })])
        })
        const handle = await adapter.submit(access, request)
        expect(await adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })).toBe('defer')
        expect(await adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })).toBe('done')
        expect(render).toHaveBeenCalledTimes(1)
        expect(ports.finalize).toHaveBeenCalledTimes(1)
        expect(await adapter.get(access, handle.jobId)).toMatchObject({ state: 'completed' })
    })

    it('retains a validated output before finalization and reuses it after a metadata commit failure', async () => {
        const {
            adapter,
            request,
            render,
            ports,
            repository,
        } = fixture()
        vi.mocked(ports.finalize).mockRejectedValueOnce(new Error('METADATA_COMMIT_FAILED'))
        const handle = await adapter.submit(access, request)
        const job = {
            jobId: handle.jobId,
            organizationId: 'org',
        }
        expect(await adapter.execute(job)).toBe('defer')
        const received = await repository.read<MediaRenderRecord>(`ORG#org#RENDER#${handle.jobId}`, 'META')
        expect(received?.result).toMatchObject({
            attempt: 1,
            blobHash: 'b'.repeat(64),
        })
        expect(ports.retainResult).toHaveBeenCalledOnce()
        expect(await adapter.execute(job)).toBe('done')
        expect(render).toHaveBeenCalledOnce()
        expect(ports.retainResult).toHaveBeenCalledOnce()
        expect(ports.finalize).toHaveBeenCalledTimes(2)
        expect(await adapter.get(access, handle.jobId)).toMatchObject({
            state: 'completed',
            attempt: 2,
        })
    })

    it('recovers a lost receipt acknowledgement without rendering again', async () => {
        const {
            adapter,
            request,
            render,
            ports,
            database,
        } = fixture()
        vi.mocked(ports.retainResult).mockImplementationOnce(async () => {
            database.failAfterCommit = true

            return []
        })
        const handle = await adapter.submit(access, request)
        const job = {
            jobId: handle.jobId,
            organizationId: 'org',
        }
        expect(await adapter.execute(job)).toBe('defer')
        expect(ports.finalize).not.toHaveBeenCalled()
        expect(await adapter.execute(job)).toBe('done')
        expect(render).toHaveBeenCalledOnce()
        expect(ports.finalize).toHaveBeenCalledOnce()
    })

    it('fences a receipt and its output pin when cancellation wins before persistence', async () => {
        const {
            adapter,
            request,
            ports,
        } = fixture()
        const handle = await adapter.submit(access, request)
        vi.mocked(ports.retainResult).mockImplementationOnce(async () => {
            await adapter.cancel(access, handle.jobId)

            return []
        })
        await adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })
        expect(ports.finalize).not.toHaveBeenCalled()
        expect(await adapter.get(access, handle.jobId)).toMatchObject({ state: 'cancelled' })
    })

    it('rejects mismatched worker attempts and authorization loss before dispatch', async () => {
        const {
            adapter,
            request,
            render,
            ports,
        } = fixture()
        render.mockImplementationOnce(async input => ({
            ...resultFor(input),
            attempt: 999,
        }))
        const handle = await adapter.submit(access, request)
        await adapter.execute({
            jobId: handle.jobId,
            organizationId: 'org',
        })
        expect(await adapter.get(access, handle.jobId)).toMatchObject({
            state: 'failed',
            error: 'MEDIA_RENDER_RESULT_MISMATCH',
        })
        expect(ports.finalize).not.toHaveBeenCalled()
        const other = fixture()
        const next = await other.adapter.submit(access, other.request)
        vi.mocked(other.ports.authorize).mockRejectedValueOnce(new Error('MEDIA_RENDER_SOURCE_ACCESS_DENIED'))
        expect(await other.adapter.execute({
            jobId: next.jobId,
            organizationId: 'org',
        })).toBe('done')
        expect(await other.adapter.get(access, next.jobId)).toMatchObject({ state: 'failed' })
        expect(other.render).not.toHaveBeenCalled()
    })
})
