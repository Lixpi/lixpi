import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    putContentAddressedBlob: vi.fn(),
    deleteContentAddressedBlob: vi.fn(),
    enqueueBlobDeletion: vi.fn(),
}))

vi.mock('../services/blob-storage.ts', () => ({
    getBlobKey: (organizationId: string, blobHash: string) => `${organizationId}#${blobHash}`,
    putContentAddressedBlob: mocks.putContentAddressedBlob,
    deleteContentAddressedBlob: mocks.deleteContentAddressedBlob,
}))

vi.mock('../services/asset-maintenance-queue.ts', () => ({
    enqueueBlobDeletion: mocks.enqueueBlobDeletion,
}))

import BlobModel from './blob.ts'

const deletingBlob = {
    blobKey: 'org#hash',
    blobHash: 'hash',
    organizationId: 'org',
    bucketName: 'bucket',
    objectKey: 'object',
    mimeType: 'text/markdown',
    byteSize: 3,
    status: 'deleting',
    referenceCount: 0,
    createdAt: 1,
    updatedAt: 2,
}

describe('Blob deletion and store race', () => {
    const getItem = vi.fn()
    const transactWrite = vi.fn()
    const updateItem = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        getItem.mockReset()
        transactWrite.mockReset()
        updateItem.mockReset()
        ;(globalThis as any).dynamoDBService = { getItem, transactWrite, updateItem }
        mocks.putContentAddressedBlob.mockResolvedValue({
            blobHash: 'hash',
            bucketName: 'bucket',
            objectKey: 'object',
            mimeType: 'text/markdown',
            byteSize: 3,
        })
    })

    it('re-uploads and registers content after an in-flight deletion removes the old row', async () => {
        getItem
            .mockResolvedValueOnce(deletingBlob)
            .mockResolvedValueOnce(undefined)
        transactWrite.mockResolvedValue(undefined)

        const result = await BlobModel.store({
            organizationId: 'org',
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'text/markdown',
        })

        expect(mocks.putContentAddressedBlob).toHaveBeenCalledTimes(2)
        expect(result.status).toBe('staging')
    })

    it('lets only one deletion worker claim an unreferenced Blob', async () => {
        getItem.mockResolvedValue(deletingBlob)
        updateItem.mockRejectedValue({ name: 'ConditionalCheckFailedException' })

        expect(
            await BlobModel.deleteZeroReferenceBlob({
                organizationId: 'org',
                blobHash: 'hash',
            }),
        ).toBe(false)
        expect(mocks.deleteContentAddressedBlob).not.toHaveBeenCalled()
    })

    it('releases its deletion claim when Object Store deletion fails so a retry can proceed', async () => {
        getItem.mockResolvedValue(deletingBlob)
        updateItem.mockResolvedValue(undefined)
        mocks.deleteContentAddressedBlob.mockRejectedValueOnce(new Error('storage unavailable'))

        await expect(BlobModel.deleteZeroReferenceBlob({
            organizationId: 'org',
            blobHash: 'hash',
        })).rejects.toThrow('storage unavailable')

        expect(updateItem).toHaveBeenCalledTimes(2)
        expect(updateItem.mock.calls[1]?.[0]).toMatchObject({
            updateExpression: 'SET #updatedAt = :updatedAt REMOVE #deletionClaim',
            conditionExpression: '#referenceCount = :zero AND #deletionClaim = :deletionClaim',
            origin: 'Blob.deleteZeroReferenceBlob.releaseClaim',
        })
    })

    it('can take over a stale deletion claim after the worker timeout', async () => {
        getItem.mockResolvedValue({ ...deletingBlob, deletionClaim: 'abandoned-claim' })
        updateItem.mockResolvedValue(undefined)
        transactWrite.mockResolvedValue(undefined)
        mocks.deleteContentAddressedBlob.mockResolvedValue(undefined)

        expect(
            await BlobModel.deleteZeroReferenceBlob({
                organizationId: 'org',
                blobHash: 'hash',
            }),
        ).toBe(true)

        expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({
            conditionExpression: '#referenceCount = :zero AND (attribute_not_exists(#deletionClaim) OR #updatedAt <= :staleBefore)',
        }))
        expect(mocks.deleteContentAddressedBlob).toHaveBeenCalledTimes(1)
        expect(transactWrite).toHaveBeenCalledTimes(1)
    })
})
