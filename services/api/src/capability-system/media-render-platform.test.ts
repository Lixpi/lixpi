import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type MediaRenderResult,
} from '@lixpi/capability-system/backend'
import {
    type default as NatsService,
} from '@lixpi/nats-service'
import { marshall } from '@lixpi/dynamodb-service'
import { MediaRenderPlatform } from './media-render-platform.ts'
import {
    type MediaRenderRecord,
} from './media-render-adapter.ts'
import { ConversationRepository } from '../llm/agent/conversation-repository.ts'
import { AtomicConversationTestDatabase } from '../llm/agent/conversation-test-support.ts'

const mocks = vi.hoisted(() => ({
    getAsset: vi.fn(),
    createAsset: vi.fn(),
    publishAsset: vi.fn(),
    storeBlob: vi.fn(),
    registerBlob: vi.fn(),
    getBlob: vi.fn(),
    retain: vi.fn(),
    release: vi.fn(),
    enqueueRenditions: vi.fn(),
    enqueueDeletion: vi.fn(),
}))
vi.mock('../models/asset.ts', () => ({
    default: {
        get: mocks.getAsset,
        prepareCreate: mocks.createAsset,
    },
    publishAssetEvent: mocks.publishAsset,
}))
vi.mock('../models/blob.ts', () => ({
    default: {
        store: mocks.storeBlob,
        registerStoredBlob: mocks.registerBlob,
        get: mocks.getBlob,
    },
    buildBlobReferenceBatchOperations: mocks.retain,
    buildBlobReferenceRemovalOperations: mocks.release,
}))
vi.mock('../services/asset-maintenance-queue.ts', () => ({
    enqueueRenditionRetry: mocks.enqueueRenditions,
    enqueueBlobDeletion: mocks.enqueueDeletion,
}))
vi.mock('../llm/agent/conversation-adapters.ts', () => ({ ConversationAdapters: class {
    async authorize(workspaceId: string, userId: string) {
        return {
            workspaceId,
            userId,
            organizationId: 'org',
            fences: [{
                type: 'check',
                tableName: 'Workspaces',
                key: { workspaceId },
            }],
        }
    }
} }))

const access = {
    organizationId: 'org',
    workspaceId: 'workspace',
    userId: 'user',
}
const source = {
    filename: 'input-0',
    sourceId: 'source',
    assetId: 'input_asset',
    renditionId: 'original',
    blobHash: 'a'.repeat(64),
    byteSize: 100,
    kind: 'image' as const,
    timeBase: {
        numerator: 1,
        denominator: 1,
    },
    duration: 0,
    width: 64,
    height: 64,
}
const record: MediaRenderRecord = {
    jobId: 'job',
    outputAssetId: 'output',
    sequenceId: 'sequence',
    sequenceRevision: 3,
    state: 'running',
    attempt: 2,
    access,
    revision: 4,
    inputHash: 'hash',
    payload: {
        type: 'json',
        hash: 'hash',
        byteSize: 2,
        inline: 'e30=',
    },
    inputs: [source],
    leaseExpiresAt: 99999,
    createdAt: 1000,
    durationSeconds: 1,
}
const result: MediaRenderResult = {
    jobId: 'job',
    attempt: 2,
    organizationId: 'org',
    outputAssetId: 'output',
    sequenceId: 'sequence',
    sequenceRevision: 3,
    presetId: 'wav-pcm',
    blobHash: 'b'.repeat(64),
    byteSize: 500,
    bucketName: 'blobs-org-files',
    objectKey: `sha256/bb/${'b'.repeat(64)}`,
    mimeType: 'audio/wav',
    durationSeconds: 1,
    audioSampleRate: 48000,
    channels: 2,
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAsset.mockResolvedValue({
        assetId: 'input_asset',
        organizationId: 'org',
        revision: 7,
        states: { lifecycle: 'active' },
        media: { renditions: { original: {
            status: 'ready',
            blobHash: source.blobHash,
            byteSize: 100,
        } } },
    })
    mocks.createAsset.mockImplementation(async asset => ({
        asset,
        operations: [{
            type: 'update',
            tableName: 'Workspaces',
            key: { workspaceId: 'workspace' },
        }, {
            type: 'put',
            tableName: 'Assets',
            item: asset,
        }],
    }))
    mocks.storeBlob.mockResolvedValue({ blobHash: 'c'.repeat(64) })
    mocks.registerBlob.mockResolvedValue({
        blobHash: result.blobHash,
        blobKey: 'output',
        organizationId: 'org',
    })
    mocks.getBlob.mockResolvedValue({
        blobHash: source.blobHash,
        blobKey: 'source',
        status: 'active',
    })
    mocks.retain.mockReturnValue({ operations: [{
        type: 'check',
        tableName: 'References',
        key: { id: 'source' },
    }] })
    mocks.enqueueRenditions.mockResolvedValue(undefined)
})

// =============================================================================
// NORMAL ASSET INGEST AND SOURCE AUTHORIZATION
// =============================================================================

describe('media render platform', () => {
    const platform = () => new MediaRenderPlatform(new ConversationRepository(new AtomicConversationTestDatabase() as never, 'Conversations'), {} as NatsService).ports()

    it('validates the source snapshot and returns current authorization fences', async () => {
        const ports = platform()
        expect(await ports.authorize(access, [source], true)).toHaveLength(2)
        await expect(ports.authorize(access, [{
            ...source,
            blobHash: 'd'.repeat(64),
        }], true)).rejects.toThrow('SOURCE_BINDING_CHANGED')
        expect(await ports.authorize(access, [{
            ...source,
            blobHash: 'd'.repeat(64),
        }], false)).toHaveLength(2)
        mocks.getAsset.mockResolvedValueOnce({ error: 'ACCESS_DENIED' })
        await expect(ports.authorize(access, [source], false)).rejects.toThrow('SOURCE_ACCESS_DENIED')
    })

    it('pins a received output until finalization and reuses an identical retained source pin', async () => {
        await platform().retainResult(record, result)
        expect(mocks.retain).toHaveBeenCalledWith({ additions: [expect.objectContaining({
            reference: expect.objectContaining({
                referenceKey: 'asset#output#render-result',
                blobHash: result.blobHash,
                ownerId: 'output',
            }),
        })] })
        mocks.retain.mockClear()
        await expect(platform().retainResult({
            ...record,
            inputs: [{
                ...source,
                blobHash: result.blobHash,
            }],
        }, result)).resolves.toEqual([])
        expect(mocks.retain).not.toHaveBeenCalled()
    })

    it('creates a playable normal audio Asset with schema-valid sealed provenance and typed render evidence', async () => {
        const commit = vi.fn(async () => {})
        await platform().finalize(record, result, commit)
        const asset = mocks.createAsset.mock.calls[0][0]
        expect(asset).toMatchObject({
            assetId: 'output',
            states: {
                lifecycle: 'active',
                media: 'ready',
                provenance: 'sealed',
            },
            lineage: {
                parentAssetId: 'sequence',
                sourceArtifact: {
                    artifactId: 'sequence',
                    artifactTypeId: 'media-sequence',
                    revision: 3,
                },
                sourceAssetIds: ['input_asset'],
                mediaRunId: 'job',
            },
        })
        expect(asset.media.renditions.original).toMatchObject({
            status: 'ready',
            blobHash: result.blobHash,
            mimeType: 'audio/wav',
        })
        const operations = commit.mock.calls[0][0]
        expect(operations.some(operation => operation.tableName === 'Workspaces')).toBe(false)
        expect(operations.find(operation => operation.type === 'put' && operation.item.sk === 'EVIDENCE')?.item).toMatchObject({
            sequenceRevision: 3,
            attempt: 2,
            sources: [{
                blobHash: source.blobHash,
                assetId: 'input_asset',
                renditionId: 'original',
                byteSize: 100,
            }],
        })
        expect(mocks.publishAsset).toHaveBeenCalledTimes(1)
    })

    it('keeps a failed atomic commit from publishing an Asset and rejects object-store path substitution', async () => {
        const ports = platform()
        await expect(ports.finalize(record, {
            ...result,
            objectKey: '/tmp/export',
        }, async () => {})).rejects.toThrow('OUTPUT_INVALID')
        const commit = vi.fn(async () => { throw new Error('CONFLICT') })
        await expect(ports.finalize(record, result, commit)).rejects.toThrow('CONFLICT')
        expect(mocks.publishAsset).not.toHaveBeenCalled()
    })

    it.each([
        {
            presetId: 'wav-pcm',
            mimeType: 'audio/wav',
        },
        {
            presetId: 'mp3',
            mimeType: 'audio/mpeg',
        },
    ] as const)('marshals $presetId output metadata without absent video dimensions', async format => {
        const commit = vi.fn(async operations => {
            for (const operation of operations)
                if (operation.type === 'put')
                    expect(() => marshall(operation.item)).not.toThrow()
        })
        await platform().finalize(record, {
            ...result,
            ...format,
        }, commit)
        const asset = mocks.createAsset.mock.calls[0][0]
        expect(asset.media).not.toHaveProperty('width')
        expect(asset.media).not.toHaveProperty('height')
        expect(asset.media.renditions.original).not.toHaveProperty('width')
        expect(asset.media.renditions.original).not.toHaveProperty('height')
        expect(commit).toHaveBeenCalledOnce()
    })
})
