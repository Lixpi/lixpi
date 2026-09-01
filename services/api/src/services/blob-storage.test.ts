import { createHash } from 'node:crypto'
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    createObjectStore: vi.fn(),
    deleteObject: vi.fn(),
    getObject: vi.fn(),
    getObjectInfo: vi.fn(),
    getObjectStore: vi.fn(),
    getInstance: vi.fn(),
    putObject: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: mocks.getInstance,
    },
}))

import {
    deleteContentAddressedBlob,
    getBlobObjectKey,
    putContentAddressedBlob,
} from './blob-storage.ts'

describe('Content-addressed blob storage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getInstance.mockReturnValue({
            createObjectStore: mocks.createObjectStore,
            deleteObject: mocks.deleteObject,
            getObject: mocks.getObject,
            getObjectInfo: mocks.getObjectInfo,
            getObjectStore: mocks.getObjectStore,
            putObject: mocks.putObject,
        })
        mocks.getObjectStore.mockResolvedValue({})
    })

    it('replaces an Object Store tombstone with the requested content', async () => {
        const bytes = Buffer.from('{"type":"doc","content":[{"type":"paragraph"}]}', 'utf8')
        const blobHash = createHash('sha256').update(bytes).digest('hex')
        const objectKey = getBlobObjectKey(blobHash)
        mocks.getObjectInfo.mockResolvedValue({
            name: objectKey,
            deleted: true,
            size: 0,
            chunks: 0,
        })
        mocks.putObject.mockResolvedValue({})

        const stored = await putContentAddressedBlob({
            organizationId: 'organization-1',
            bytes,
            mimeType: 'application/json',
        })

        expect(stored).toMatchObject({ blobHash, objectKey, byteSize: bytes.byteLength })
        expect(mocks.putObject).toHaveBeenCalledWith(
            'blobs-organization-1-files',
            objectKey,
            bytes,
            { name: objectKey, description: `sha256:${blobHash}` },
        )
        expect(mocks.getObject).not.toHaveBeenCalled()
    })

    it('validates bytes when a live content-addressed object already exists', async () => {
        const bytes = Buffer.from('existing bytes', 'utf8')
        mocks.getObjectInfo.mockResolvedValue({ deleted: false })
        mocks.getObject.mockResolvedValue(bytes)

        await expect(putContentAddressedBlob({
            organizationId: 'organization-1',
            bytes,
            mimeType: 'application/octet-stream',
        })).resolves.toMatchObject({ byteSize: bytes.byteLength })

        expect(mocks.putObject).not.toHaveBeenCalled()
    })

    it('treats an Object Store tombstone as already deleted', async () => {
        mocks.getObjectInfo.mockResolvedValue({ deleted: true })

        await deleteContentAddressedBlob({
            blobKey: 'organization-1#hash',
            blobHash: 'hash',
            organizationId: 'organization-1',
            bucketName: 'blobs-organization-1-files',
            objectKey: 'sha256/aa/hash',
            mimeType: 'image/png',
            byteSize: 10,
            status: 'deleting',
            referenceCount: 0,
            createdAt: 1,
            updatedAt: 2,
        })

        expect(mocks.deleteObject).not.toHaveBeenCalled()
    })
})
