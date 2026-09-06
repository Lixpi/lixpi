import { createHash } from 'node:crypto'

import NATS_Service from '@lixpi/nats-service'
import {
    type BlobRecord,
} from '@lixpi/constants'

const BLOB_HASH_PATTERN = /^[a-f0-9]{64}$/
const BLOB_OBJECT_KEY_PATTERN = /^sha256\/[a-f0-9]{2}\/([a-f0-9]{64})$/

const getNatsService = (): NATS_Service => {
    const natsService = NATS_Service.getInstance()

    if (!natsService)
        throw new Error('NATS service unavailable')

    return natsService
}

export const getOrganizationBlobBucketName = (organizationId: string): string => `blobs-${organizationId}-files`

export const getBlobObjectKey = (blobHash: string): string => {
    if (!BLOB_HASH_PATTERN.test(blobHash))
        throw new Error('INVALID_BLOB_HASH')

    return `sha256/${blobHash.slice(0, 2)}/${blobHash}`
}

export const getBlobKey = (
    organizationId: string,
    blobHash: string,
): string => {
    getBlobObjectKey(blobHash)

    return `${organizationId}#${blobHash}`
}

export const ensureOrganizationAssetStorage = async (organizationId: string): Promise<void> => {
    const natsService = getNatsService()
    const bucketName = getOrganizationBlobBucketName(organizationId)

    try {
        await natsService.getObjectStore(bucketName)
    } catch {
        try {
            await natsService.createObjectStore(
                bucketName,
                {
                    description: `Content-addressed Asset and Capability Blobs for ${organizationId}`,
                },
            )
        } catch (creationError) {
            try {
                await natsService.getObjectStore(bucketName)
            } catch {
                throw creationError
            }
        }
    }
}

export const hashBlobBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export const putContentAddressedBlob = async ({
    organizationId,
    bytes,
    mimeType,
    description,
}: {
    organizationId: string
    bytes: Uint8Array
    mimeType: string
    description?: string
}): Promise<Pick<BlobRecord, 'blobHash' | 'blobKey' | 'bucketName' | 'objectKey' | 'mimeType' | 'byteSize'>> => {
    const blobHash = hashBlobBytes(bytes)
    const bucketName = getOrganizationBlobBucketName(organizationId)
    const objectKey = getBlobObjectKey(blobHash)
    const natsService = getNatsService()

    await ensureOrganizationAssetStorage(organizationId)
    const existing = await natsService.getObjectInfo(bucketName, objectKey)

    // NATS Object Store keeps tombstone metadata after deletion. A tombstone has
    // no readable bytes and must be replaced, not validated as a live object.
    if (
        !existing
        || existing.deleted
    ) {
        await natsService.putObject(
            bucketName,
            objectKey,
            bytes,
            {
                name: objectKey,
                description: description ?? `sha256:${blobHash}`,
            },
        )
    } else {
        const existingBytes = await natsService.getObject(bucketName, objectKey)

        if (
            !existingBytes
            || existingBytes.byteLength !== bytes.byteLength
            || hashBlobBytes(existingBytes) !== blobHash
        )
            throw new Error('CONTENT_ADDRESSED_OBJECT_CONFLICT')
    }

    return {
        blobHash,
        blobKey: getBlobKey(organizationId, blobHash),
        bucketName,
        objectKey,
        mimeType,
        byteSize: bytes.byteLength,
    }
}

export const getContentAddressedBlob = async ({
    organizationId,
    blobHash,
}: {
    organizationId: string
    blobHash: string
}): Promise<Uint8Array> => {
    const natsService = getNatsService()
    const bucketName = getOrganizationBlobBucketName(organizationId)
    const objectKey = getBlobObjectKey(blobHash)
    const info = await natsService.getObjectInfo(bucketName, objectKey)

    if (
        !info
        || info.deleted
    )
        throw new Error('BLOB_NOT_FOUND')

    const bytes = await natsService.getObject(bucketName, objectKey)

    if (
        !bytes
        || hashBlobBytes(bytes) !== blobHash
    )
        throw new Error('BLOB_HASH_MISMATCH')

    return bytes
}

export const deleteContentAddressedBlob = async (blob: BlobRecord): Promise<void> => {
    const natsService = getNatsService()
    const info = await natsService.getObjectInfo(blob.bucketName, blob.objectKey)

    if (
        !info
        || info.deleted
    )
        return

    await natsService.deleteObject(blob.bucketName, blob.objectKey)
}

export const deleteUnregisteredContentAddressedObjects = async ({
    organizationIds,
    olderThan,
    isRegistered,
    limit = 100,
}: {
    organizationIds: string[]
    olderThan: number
    isRegistered: (
        organizationId: string,
        blobHash: string,
    ) => Promise<boolean>
    limit?: number
}): Promise<number> => {
    const natsService = getNatsService()
    let deleted = 0

    for (const organizationId of [...new Set(organizationIds)]) {
        if (deleted >= limit)
            break

        const bucketName = getOrganizationBlobBucketName(organizationId)
        const objects = await natsService.listObjects(bucketName)

        for (const object of objects) {
            if (deleted >= limit)
                break

            const match = BLOB_OBJECT_KEY_PATTERN.exec(object.name)

            if (
                !match
                || object.deleted
            )
                continue

            const objectUpdatedAt = Date.parse(
                String(object.mtime),
            )

            if (
                !Number.isFinite(objectUpdatedAt)
                || objectUpdatedAt > olderThan
            )
                continue

            const blobHash = match[1]!

            if (await isRegistered(organizationId, blobHash))
                continue

            const current = await natsService.getObjectInfo(bucketName, object.name)

            if (
                !current
                || current.deleted
                || String(current.mtime) !== String(object.mtime)
            )
                continue

            if (await isRegistered(organizationId, blobHash))
                continue

            await natsService.deleteObject(bucketName, object.name)
            deleted += 1
        }
    }

    return deleted
}
