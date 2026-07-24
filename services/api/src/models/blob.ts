'use strict'

import * as process from 'node:process'

import {
    getDynamoDbTableStageName,
    type AssetRenditionName,
    type BlobOwnerType,
    type BlobRecord,
    type BlobReference,
} from '@lixpi/constants'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'

import {
    deleteContentAddressedBlob,
    getBlobKey,
    putContentAddressedBlob,
} from '../services/blob-storage.ts'
import { enqueueBlobDeletion } from '../services/asset-maintenance-queue.ts'

const { ORG_NAME, STAGE } = process.env

const blobsTableName = (): string => getDynamoDbTableStageName('BLOBS', ORG_NAME, STAGE)
const blobReferencesTableName = (): string => getDynamoDbTableStageName('BLOB_REFERENCES', ORG_NAME, STAGE)

const getReference = async (blobKey: string, referenceKey: string): Promise<BlobReference | undefined> =>
    await dynamoDBService.getItem({
        tableName: blobReferencesTableName(),
        key: { blobKey, referenceKey },
        consistentRead: true,
        origin: 'Blob.getReference',
    }) as BlobReference | undefined

const assertMatchingReference = (existing: BlobReference, expected: BlobReference): void => {
    if (existing.blobKey !== expected.blobKey
        || existing.blobHash !== expected.blobHash
        || existing.organizationId !== expected.organizationId
        || existing.referenceKey !== expected.referenceKey
        || existing.ownerType !== expected.ownerType
        || existing.ownerId !== expected.ownerId) {
        throw new Error('BLOB_REFERENCE_METADATA_CONFLICT')
    }
}

export const buildBlobReferenceOperations = ({
    blob,
    reference,
    now = Date.now(),
}: {
    blob: Pick<BlobRecord, 'blobKey'>
    reference: BlobReference
    now?: number
}): TransactOperation[] => [
    {
        type: 'put',
        tableName: blobReferencesTableName(),
        item: reference,
        conditionExpression: 'attribute_not_exists(#referenceKey)',
        expressionAttributeNames: { '#referenceKey': 'referenceKey' },
    },
    {
        type: 'update',
        tableName: blobsTableName(),
        key: { blobKey: blob.blobKey },
        updateExpression: 'SET #status = :active, #updatedAt = :updatedAt ADD #referenceCount :one',
        conditionExpression: 'attribute_exists(#blobKey) AND (#status = :staging OR #status = :active)',
        expressionAttributeNames: {
            '#blobKey': 'blobKey',
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#referenceCount': 'referenceCount',
        },
        expressionAttributeValues: {
            ':staging': 'staging',
            ':active': 'active',
            ':updatedAt': now,
            ':one': 1,
        },
    },
]

export const buildBlobReferenceBatchOperations = ({
    additions,
    removals = [],
    now = Date.now(),
}: {
    additions: Array<{ blob: BlobRecord; reference: BlobReference }>
    removals?: Array<{ blob: BlobRecord; reference: BlobReference }>
    now?: number
}): { operations: TransactOperation[]; deletionBlobHashes: string[] } => {
    const groups = new Map<string, {
        blob: BlobRecord
        additions: BlobReference[]
        removals: BlobReference[]
    }>()
    for (const change of additions) {
        const group = groups.get(change.blob.blobKey) ?? { blob: change.blob, additions: [], removals: [] }
        group.additions.push(change.reference)
        groups.set(change.blob.blobKey, group)
    }
    for (const change of removals) {
        const group = groups.get(change.blob.blobKey) ?? { blob: change.blob, additions: [], removals: [] }
        group.removals.push(change.reference)
        groups.set(change.blob.blobKey, group)
    }

    const operations: TransactOperation[] = []
    const deletionBlobHashes: string[] = []
    for (const { blob, additions: blobAdditions, removals: blobRemovals } of groups.values()) {
        const addedKeys = new Set(blobAdditions.map((reference) => reference.referenceKey))
        const removedKeys = new Set(blobRemovals.map((reference) => reference.referenceKey))
        if (addedKeys.size !== blobAdditions.length || removedKeys.size !== blobRemovals.length) {
            throw new Error('DUPLICATE_BLOB_REFERENCE_MUTATION')
        }
        for (const referenceKey of addedKeys) {
            if (removedKeys.has(referenceKey)) throw new Error('CONFLICTING_BLOB_REFERENCE_MUTATION')
        }
        const nextReferenceCount = blob.referenceCount + blobAdditions.length - blobRemovals.length
        if (nextReferenceCount < 0) throw new Error('BLOB_REFERENCE_COUNT_CORRUPT')
        if (blobAdditions.length > 0 && blob.status === 'deleting') throw new Error('BLOB_DELETION_IN_PROGRESS')

        const counterOperation: TransactOperation = blobRemovals.length === 0
            ? {
                type: 'update',
                tableName: blobsTableName(),
                key: { blobKey: blob.blobKey },
                updateExpression: 'SET #status = :active, #updatedAt = :updatedAt ADD #referenceCount :increment',
                conditionExpression: '#status = :staging OR #status = :active',
                expressionAttributeNames: {
                    '#referenceCount': 'referenceCount',
                    '#status': 'status',
                    '#updatedAt': 'updatedAt',
                },
                expressionAttributeValues: {
                    ':increment': blobAdditions.length,
                    ':staging': 'staging',
                    ':active': 'active',
                    ':updatedAt': now,
                },
            }
            : {
                type: 'update',
                tableName: blobsTableName(),
                key: { blobKey: blob.blobKey },
                updates: {
                    referenceCount: nextReferenceCount,
                    status: nextReferenceCount === 0 ? 'deleting' : 'active',
                    updatedAt: now,
                },
                conditionExpression: '#referenceCount = :expectedReferenceCount AND (#status = :staging OR #status = :active)',
                expressionAttributeNames: {
                    '#referenceCount': 'referenceCount',
                    '#status': 'status',
                },
                expressionAttributeValues: {
                    ':expectedReferenceCount': blob.referenceCount,
                    ':staging': 'staging',
                    ':active': 'active',
                },
            }

        operations.push(
            ...blobAdditions.map((reference): TransactOperation => ({
                type: 'put',
                tableName: blobReferencesTableName(),
                item: reference,
                conditionExpression: 'attribute_not_exists(#referenceKey)',
                expressionAttributeNames: { '#referenceKey': 'referenceKey' },
            })),
            ...blobRemovals.map((reference): TransactOperation => ({
                type: 'delete',
                tableName: blobReferencesTableName(),
                key: { blobKey: blob.blobKey, referenceKey: reference.referenceKey },
                conditionExpression: 'attribute_exists(#referenceKey)',
                expressionAttributeNames: { '#referenceKey': 'referenceKey' },
            })),
            counterOperation,
        )
        if (nextReferenceCount === 0) deletionBlobHashes.push(blob.blobHash)
    }
    return { operations, deletionBlobHashes }
}

export const buildBlobReferenceRemovalOperations = async ({
    organizationId,
    blobHash,
    referenceKey,
    now = Date.now(),
}: {
    organizationId: string
    blobHash: string
    referenceKey: string
    now?: number
}): Promise<{ operations: TransactOperation[]; deletionRequired: boolean }> => {
    const blob = await BlobModel.get({ organizationId, blobHash })
    if (!blob) return { operations: [], deletionRequired: false }
    const reference = await getReference(blob.blobKey, referenceKey)
    if (!reference) return { operations: [], deletionRequired: blob.referenceCount === 0 }
    const deletionRequired = blob.referenceCount === 1
    const updateOperation: TransactOperation = deletionRequired
        ? {
            type: 'update',
            tableName: blobsTableName(),
            key: { blobKey: blob.blobKey },
            updateExpression: 'SET #referenceCount = :zero, #status = :deleting, #updatedAt = :updatedAt',
            conditionExpression: '#referenceCount = :expectedCount',
            expressionAttributeNames: {
                '#referenceCount': 'referenceCount',
                '#status': 'status',
                '#updatedAt': 'updatedAt',
            },
            expressionAttributeValues: {
                ':zero': 0,
                ':deleting': 'deleting',
                ':updatedAt': now,
                ':expectedCount': blob.referenceCount,
            },
        }
        : {
            type: 'update',
            tableName: blobsTableName(),
            key: { blobKey: blob.blobKey },
            updateExpression: 'SET #updatedAt = :updatedAt ADD #referenceCount :minusOne',
            conditionExpression: '#referenceCount = :expectedCount AND #referenceCount > :one',
            expressionAttributeNames: {
                '#referenceCount': 'referenceCount',
                '#updatedAt': 'updatedAt',
            },
            expressionAttributeValues: {
                ':updatedAt': now,
                ':minusOne': -1,
                ':expectedCount': blob.referenceCount,
                ':one': 1,
            },
        }
    return {
        operations: [
            {
                type: 'delete',
                tableName: blobReferencesTableName(),
                key: { blobKey: blob.blobKey, referenceKey },
                conditionExpression: 'attribute_exists(#referenceKey)',
                expressionAttributeNames: { '#referenceKey': 'referenceKey' },
            },
            updateOperation,
        ],
        deletionRequired,
    }
}

const BlobModel = {
    getReference,
    get: async ({
        organizationId,
        blobHash,
    }: {
        organizationId: string
        blobHash: string
    }): Promise<BlobRecord | undefined> => await dynamoDBService.getItem({
        tableName: blobsTableName(),
        key: { blobKey: getBlobKey(organizationId, blobHash) },
        consistentRead: true,
        origin: 'Blob.get',
    }) as BlobRecord | undefined,

    registerStoredBlob: async ({
        organizationId,
        blobHash,
        bucketName,
        objectKey,
        mimeType,
        byteSize,
        sourceBlobHash,
        derivationKind,
        derivationVersion,
    }: {
        organizationId: string
        blobHash: string
        bucketName: string
        objectKey: string
        mimeType: string
        byteSize: number
        sourceBlobHash?: string
        derivationKind?: AssetRenditionName
        derivationVersion?: string
    }): Promise<BlobRecord> => {
        const blobKey = getBlobKey(organizationId, blobHash)
        const existing = await BlobModel.get({ organizationId, blobHash })
        if (existing) {
            if (
                existing.organizationId !== organizationId
                || existing.blobHash !== blobHash
                || existing.bucketName !== bucketName
                || existing.objectKey !== objectKey
                || existing.mimeType !== mimeType
                || existing.byteSize !== byteSize
            ) {
                throw new Error('BLOB_METADATA_CONFLICT')
            }
            if (existing.status === 'deleting') throw new Error('BLOB_DELETION_IN_PROGRESS')
            return existing
        }

        const now = Date.now()
        const blob: BlobRecord = {
            blobKey,
            blobHash,
            organizationId,
            bucketName,
            objectKey,
            mimeType,
            byteSize,
            status: 'staging',
            referenceCount: 0,
            ...(sourceBlobHash ? { sourceBlobHash } : {}),
            ...(derivationKind ? { derivationKind } : {}),
            ...(derivationVersion ? { derivationVersion } : {}),
            createdAt: now,
            updatedAt: now,
        }

        try {
            await dynamoDBService.transactWrite({
                operations: [{
                    type: 'put',
                    tableName: blobsTableName(),
                    item: blob,
                    conditionExpression: 'attribute_not_exists(#blobKey)',
                    expressionAttributeNames: { '#blobKey': 'blobKey' },
                }],
                logConditionalCheckFailures: false,
                origin: 'Blob.registerStoredBlob',
            })
            return blob
        } catch (error) {
            if (!isTransactionConditionalCheckFailure(error)) throw error
            const concurrent = await BlobModel.get({ organizationId, blobHash })
            if (!concurrent) throw error
            if (
                concurrent.bucketName !== bucketName
                || concurrent.objectKey !== objectKey
                || concurrent.mimeType !== mimeType
                || concurrent.byteSize !== byteSize
            ) {
                throw new Error('BLOB_METADATA_CONFLICT')
            }
            return concurrent
        }
    },

    store: async ({
        organizationId,
        bytes,
        mimeType,
        description,
        sourceBlobHash,
        derivationKind,
        derivationVersion,
    }: {
        organizationId: string
        bytes: Uint8Array
        mimeType: string
        description?: string
        sourceBlobHash?: string
        derivationKind?: AssetRenditionName
        derivationVersion?: string
    }): Promise<BlobRecord> => {
        for (let attempt = 1; attempt <= 10; attempt++) {
            const stored = await putContentAddressedBlob({ organizationId, bytes, mimeType, description })
            try {
                return await BlobModel.registerStoredBlob({
                    organizationId,
                    ...stored,
                    ...(sourceBlobHash ? { sourceBlobHash } : {}),
                    ...(derivationKind ? { derivationKind } : {}),
                    ...(derivationVersion ? { derivationVersion } : {}),
                })
            } catch (error) {
                if ((error as Error).message !== 'BLOB_DELETION_IN_PROGRESS' || attempt === 10) throw error
                await new Promise(resolve => setTimeout(resolve, attempt * 50))
            }
        }
        throw new Error('BLOB_STORE_RETRY_EXHAUSTED')
    },

    addReference: async ({
        organizationId,
        blobHash,
        referenceKey,
        ownerType,
        ownerId,
    }: {
        organizationId: string
        blobHash: string
        referenceKey: string
        ownerType: BlobOwnerType
        ownerId: string
    }): Promise<{ created: boolean; reference: BlobReference }> => {
        const blob = await BlobModel.get({ organizationId, blobHash })
        if (!blob) throw new Error('BLOB_NOT_FOUND')
        const reference: BlobReference = {
            blobKey: blob.blobKey,
            blobHash,
            organizationId,
            referenceKey,
            ownerType,
            ownerId,
            createdAt: Date.now(),
        }
        const existing = await getReference(blob.blobKey, referenceKey)
        if (existing) {
            assertMatchingReference(existing, reference)
            return { created: false, reference: existing }
        }

        try {
            await dynamoDBService.transactWrite({
                operations: buildBlobReferenceOperations({ blob, reference }),
                logConditionalCheckFailures: false,
                origin: 'Blob.addReference',
            })
            return { created: true, reference }
        } catch (error) {
            if (!isTransactionConditionalCheckFailure(error)) throw error
            const concurrent = await getReference(blob.blobKey, referenceKey)
            if (!concurrent) throw error
            assertMatchingReference(concurrent, reference)
            return { created: false, reference: concurrent }
        }
    },

    removeReference: async ({
        organizationId,
        blobHash,
        referenceKey,
    }: {
        organizationId: string
        blobHash: string
        referenceKey: string
    }): Promise<{ removed: boolean; deletionRequired: boolean }> => {
        const blob = await BlobModel.get({ organizationId, blobHash })
        if (!blob) return { removed: false, deletionRequired: false }
        const reference = await getReference(blob.blobKey, referenceKey)
        if (!reference) return { removed: false, deletionRequired: blob.referenceCount === 0 }

        const deletionRequired = blob.referenceCount === 1
        const now = Date.now()
        const updateOperation: TransactOperation = deletionRequired
            ? {
                type: 'update',
                tableName: blobsTableName(),
                key: { blobKey: blob.blobKey },
                updateExpression: 'SET #referenceCount = :zero, #status = :deleting, #updatedAt = :updatedAt',
                conditionExpression: '#referenceCount = :expectedCount',
                expressionAttributeNames: {
                    '#referenceCount': 'referenceCount',
                    '#status': 'status',
                    '#updatedAt': 'updatedAt',
                },
                expressionAttributeValues: {
                    ':zero': 0,
                    ':deleting': 'deleting',
                    ':updatedAt': now,
                    ':expectedCount': blob.referenceCount,
                },
            }
            : {
                type: 'update',
                tableName: blobsTableName(),
                key: { blobKey: blob.blobKey },
                updateExpression: 'SET #updatedAt = :updatedAt ADD #referenceCount :minusOne',
                conditionExpression: '#referenceCount = :expectedCount AND #referenceCount > :one',
                expressionAttributeNames: {
                    '#referenceCount': 'referenceCount',
                    '#updatedAt': 'updatedAt',
                },
                expressionAttributeValues: {
                    ':updatedAt': now,
                    ':minusOne': -1,
                    ':expectedCount': blob.referenceCount,
                    ':one': 1,
                },
            }

        try {
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'delete',
                        tableName: blobReferencesTableName(),
                        key: { blobKey: blob.blobKey, referenceKey },
                        conditionExpression: 'attribute_exists(#referenceKey)',
                        expressionAttributeNames: { '#referenceKey': 'referenceKey' },
                    },
                    updateOperation,
                ],
                logConditionalCheckFailures: false,
                origin: 'Blob.removeReference',
            })
            if (deletionRequired) {
                await enqueueBlobDeletion({ organizationId, blobHash })
            }
            return { removed: true, deletionRequired }
        } catch (error) {
            if (!isTransactionConditionalCheckFailure(error)) throw error
            const concurrentReference = await getReference(blob.blobKey, referenceKey)
            if (!concurrentReference) {
                const current = await BlobModel.get({ organizationId, blobHash })
                return { removed: false, deletionRequired: current?.referenceCount === 0 }
            }
            return await BlobModel.removeReference({ organizationId, blobHash, referenceKey })
        }
    },

    deleteZeroReferenceBlob: async ({
        organizationId,
        blobHash,
    }: {
        organizationId: string
        blobHash: string
    }): Promise<boolean> => {
        const blob = await BlobModel.get({ organizationId, blobHash })
        if (!blob) return false
        if (blob.referenceCount !== 0) return false
        if (blob.status === 'staging') return false

        const deletionClaim = `${Date.now()}-${crypto.randomUUID()}`
        try {
            await dynamoDBService.updateItem({
                tableName: blobsTableName(),
                key: { blobKey: blob.blobKey },
                updateExpression: 'SET #status = :deleting, #deletionClaim = :deletionClaim, #updatedAt = :updatedAt',
                conditionExpression: '#referenceCount = :zero AND attribute_not_exists(#deletionClaim)',
                expressionAttributeNames: {
                    '#status': 'status',
                    '#deletionClaim': 'deletionClaim',
                    '#updatedAt': 'updatedAt',
                    '#referenceCount': 'referenceCount',
                },
                expressionAttributeValues: {
                    ':deleting': 'deleting',
                    ':deletionClaim': deletionClaim,
                    ':updatedAt': Date.now(),
                    ':zero': 0,
                },
                logConditionalCheckFailures: false,
                origin: 'Blob.deleteZeroReferenceBlob.claim',
            })
        } catch (error) {
            if (!isTransactionConditionalCheckFailure(error)) throw error
            return false
        }

        await deleteContentAddressedBlob({ ...blob, status: 'deleting' })
        try {
            await dynamoDBService.transactWrite({
                operations: [{
                    type: 'delete',
                    tableName: blobsTableName(),
                    key: { blobKey: blob.blobKey },
                    conditionExpression: '#referenceCount = :zero AND #status = :deleting AND #deletionClaim = :deletionClaim',
                    expressionAttributeNames: {
                        '#referenceCount': 'referenceCount',
                        '#status': 'status',
                        '#deletionClaim': 'deletionClaim',
                    },
                    expressionAttributeValues: {
                        ':zero': 0,
                        ':deleting': 'deleting',
                        ':deletionClaim': deletionClaim,
                    },
                }],
                logConditionalCheckFailures: false,
                origin: 'Blob.deleteZeroReferenceBlob.finalize',
            })
            return true
        } catch (error) {
            if (!isTransactionConditionalCheckFailure(error)) throw error
            return false
        }
    },

    collectOrphanedStagingBlobs: async ({
        olderThan,
        limit = 100,
    }: {
        olderThan: number
        limit?: number
    }): Promise<number> => {
        const result = await dynamoDBService.scanItems({
            tableName: blobsTableName(),
            limit: 1000,
            fetchAllItems: true,
            origin: 'Blob.collectOrphanedStagingBlobs',
        })
        const candidates = ((result?.items ?? []) as BlobRecord[])
            .filter((blob) => blob.referenceCount === 0 && (
                blob.status === 'deleting'
                || (blob.status === 'staging' && blob.updatedAt <= olderThan)
            ))
            .slice(0, limit)
        let deleted = 0
        for (const blob of candidates) {
            try {
                if (blob.status === 'staging') {
                    await dynamoDBService.updateItem({
                        tableName: blobsTableName(),
                        key: { blobKey: blob.blobKey },
                        updateExpression: 'SET #status = :deleting, #updatedAt = :updatedAt',
                        conditionExpression: '#status = :staging AND #referenceCount = :zero AND #updatedAt <= :olderThan',
                        expressionAttributeNames: {
                            '#status': 'status',
                            '#referenceCount': 'referenceCount',
                            '#updatedAt': 'updatedAt',
                        },
                        expressionAttributeValues: {
                            ':staging': 'staging',
                            ':deleting': 'deleting',
                            ':zero': 0,
                            ':olderThan': olderThan,
                            ':updatedAt': Date.now(),
                        },
                        logConditionalCheckFailures: false,
                        origin: 'Blob.collectOrphanedStagingBlobs.mark',
                    })
                }
                if (await BlobModel.deleteZeroReferenceBlob({
                    organizationId: blob.organizationId,
                    blobHash: blob.blobHash,
                })) {
                    deleted += 1
                }
            } catch (error) {
                if ((error as { name?: string })?.name !== 'ConditionalCheckFailedException') throw error
            }
        }
        return deleted
    },
}

export default BlobModel
