import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type Asset,
} from '@lixpi/constants'
import { cleanupMediaRenderAsset } from './media-render-maintenance.ts'

const mocks = vi.hoisted(() => ({
    read: vi.fn(),
    commit: vi.fn(),
    removeReference: vi.fn(),
    release: vi.fn(),
    afterRelease: vi.fn(),
    enqueueDeletion: vi.fn(),
}))
vi.mock('../models/blob.ts', () => ({ buildBlobReferenceRemovalOperations: mocks.removeReference }))
vi.mock('../services/asset-maintenance-queue.ts', () => ({ enqueueBlobDeletion: mocks.enqueueDeletion }))
vi.mock('../llm/agent/agent-payload-store.ts', () => ({ AgentPayloadStore: class {
    release = mocks.release
} }))
vi.mock('../llm/agent/conversation-repository.ts', () => ({ ConversationRepository: class {
    read = mocks.read
    commit = mocks.commit
    remove(pk: string, sk: string) { return {
        type: 'delete',
        tableName: 'Conversations',
        key: {
            pk,
            sk,
        },
    } }
} }))

const digest = '1'.repeat(64)
const asset = {
    organizationId: 'org',
    assetId: `export-${digest}`,
} as Asset
const payload = {
    type: 'json',
    hash: '2'.repeat(64),
    byteSize: 99,
    blobHash: '2'.repeat(64),
}
const record = {
    jobId: `render-${digest}`,
    outputAssetId: asset.assetId,
    access: { organizationId: 'org' },
    inputs: [{ blobHash: 'a'.repeat(64) }, { blobHash: 'a'.repeat(64) }, { blobHash: 'b'.repeat(64) }],
    payload,
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.read.mockResolvedValue(record)
    mocks.commit.mockResolvedValue(undefined)
    mocks.removeReference.mockImplementation(async ({ blobHash }) => ({
        operations: [{
            type: 'delete',
            tableName: 'References',
            key: { blobHash },
        }],
        deletionRequired: blobHash === 'a'.repeat(64),
    }))
    mocks.release.mockResolvedValue({
        operations: [{
            type: 'delete',
            tableName: 'References',
            key: { id: 'payload' },
        }],
        afterCommit: mocks.afterRelease,
    })
})

describe('media render Asset cleanup', () => {
    it('releases unique source references and frozen payload with the durable job records atomically', async () => {
        await cleanupMediaRenderAsset(asset)
        expect(mocks.removeReference).toHaveBeenCalledTimes(2)
        expect(mocks.removeReference).toHaveBeenCalledWith({
            organizationId: 'org',
            blobHash: 'a'.repeat(64),
            referenceKey: `asset#${asset.assetId}#render-source#${'a'.repeat(64)}`,
        })
        expect(mocks.release).toHaveBeenCalledWith(payload, 'render-input')
        const operations = mocks.commit.mock.calls[0][0]
        expect(operations).toHaveLength(7)
        expect(operations.filter(operation => operation.tableName === 'Conversations').map(operation => operation.key.sk)).toEqual(['META', 'EVIDENCE', 'PROGRESS', `render-${digest}`])
        expect(mocks.afterRelease).toHaveBeenCalledTimes(1)
        expect(mocks.enqueueDeletion).toHaveBeenCalledExactlyOnceWith({
            organizationId: 'org',
            blobHash: 'a'.repeat(64),
        })
    })

    it('does not enqueue blob deletion before a successful transaction', async () => {
        mocks.commit.mockRejectedValueOnce(new Error('CONFLICT'))
        await expect(cleanupMediaRenderAsset(asset)).rejects.toThrow('CONFLICT')
        expect(mocks.afterRelease).not.toHaveBeenCalled()
        expect(mocks.enqueueDeletion).not.toHaveBeenCalled()
    })

    it('releases the durable encoded-output pin with the job and avoids a duplicate source Blob update', async () => {
        mocks.read.mockResolvedValueOnce({
            ...record,
            result: { blobHash: 'c'.repeat(64) },
        })
        await cleanupMediaRenderAsset(asset)
        expect(mocks.removeReference).toHaveBeenCalledWith({
            organizationId: 'org',
            blobHash: 'c'.repeat(64),
            referenceKey: `asset#${asset.assetId}#render-result`,
        })
        mocks.removeReference.mockClear()
        mocks.read.mockResolvedValueOnce({
            ...record,
            result: { blobHash: 'a'.repeat(64) },
        })
        await cleanupMediaRenderAsset(asset)
        expect(mocks.removeReference).toHaveBeenCalledTimes(2)
    })

    it('ignores ordinary Assets and already removed jobs and refuses a mismatched owner', async () => {
        await cleanupMediaRenderAsset({
            ...asset,
            assetId: 'ordinary_asset',
        })
        expect(mocks.read).not.toHaveBeenCalled()
        mocks.read.mockResolvedValueOnce(undefined)
        await cleanupMediaRenderAsset(asset)
        expect(mocks.commit).not.toHaveBeenCalled()
        mocks.read.mockResolvedValueOnce({
            ...record,
            access: { organizationId: 'another-org' },
        })
        await expect(cleanupMediaRenderAsset(asset)).rejects.toThrow('MEDIA_RENDER_CLEANUP_IDENTITY_MISMATCH')
        expect(mocks.removeReference).not.toHaveBeenCalled()
    })
})
