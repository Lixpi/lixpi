'use strict'

import * as process from 'node:process'
import { createHash } from 'node:crypto'
import { v4 as uuid } from 'uuid'

import NATS_Service from '@lixpi/nats-service'
import {
    ASSET_REQUIRED_RENDITIONS,
    MEDIA_POLICY,
    NATS_SUBJECTS,
    getDynamoDbTableStageName,
    type Asset,
    type AssetMedia,
    type AssetRenditionName,
    type BlobReference,
    type GenerateRenditionsRequest,
    type GenerateRenditionsResponse,
    type GeneratedRenditionResult,
} from '@lixpi/constants'
import type { TransactOperation } from '@lixpi/dynamodb-service'

import BlobModel, {
    buildBlobReferenceBatchOperations,
} from '../models/blob.ts'
import {
    buildAssetProjectionOperations,
    getAssetRecord,
    publishAssetEvent,
} from '../models/asset.ts'
import { enqueueBlobDeletion, enqueueRenditionRetry } from './asset-maintenance-queue.ts'
import { getBlobObjectKey } from './blob-storage.ts'

const { ORG_NAME, STAGE } = process.env
const assetsTableName = (): string => getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE)

const getNatsService = (): NATS_Service => {
    const natsService = NATS_Service.getInstance()
    if (!natsService) throw new Error('NATS service unavailable')
    return natsService
}

// The rendition responder lives in the `file-conversion` NEX workload, which the
// NEX node deploys only after installing its dependencies — minutes after the API
// itself is serving. A request landing in that window (or while the node restarts)
// fails with NATS "no responders", which is transient unavailability rather than a
// failed conversion job: callers must re-queue instead of marking the asset failed.
export const RENDITION_WORKER_UNAVAILABLE = 'RENDITION_WORKER_UNAVAILABLE'

const isWorkerUnavailableError = (error: unknown): boolean => {
    const candidates = [error, (error as { cause?: unknown })?.cause]
    return candidates.some((candidate) => {
        const record = candidate as { code?: string; message?: string } | undefined
        return record?.code === '503' || /no responders/i.test(record?.message ?? '')
    })
}

const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const getRequestedRenditions = (asset: Asset): AssetRenditionName[] => {
    if (!asset.media) return []
    const requested = [...ASSET_REQUIRED_RENDITIONS[asset.media.kind]]
    if (!asset.media.modelSafe) requested.push('canonical')
    return [...new Set(requested)]
}

const getMediaStatus = (media: AssetMedia): Asset['states']['media'] => {
    const required = [...ASSET_REQUIRED_RENDITIONS[media.kind]]
    if (!media.modelSafe) required.push('canonical')
    const requiredRenditions = required.map((name) => media.renditions[name])
    const usableSource = media.renditions.original?.status === 'ready'
        && (media.modelSafe || media.renditions.canonical?.status === 'ready')
    if (requiredRenditions.every((rendition) => rendition?.status === 'ready')) return 'ready'
    if (requiredRenditions.some((rendition) => rendition?.status === 'pending')) return 'processing'
    return usableSource ? 'degraded' : 'failed'
}

const buildPendingAsset = ({
    asset,
    jobKey,
    requestedRenditions,
    now,
}: {
    asset: Asset
    jobKey: string
    requestedRenditions: AssetRenditionName[]
    now: number
}): Asset => {
    if (!asset.media) throw new Error('ASSET_HAS_NO_MEDIA')
    const renditions = { ...asset.media.renditions }
    for (const name of requestedRenditions) {
        if (name === 'original') continue
        renditions[name] = {
            name,
            status: 'pending',
            jobKey,
            updatedAt: now,
        }
    }
    return {
        ...asset,
        media: { ...asset.media, renditions },
        states: { ...asset.states, media: 'processing' },
        revision: asset.revision + 1,
        updatedAt: now,
    }
}

const registerReturnedBlob = async ({
    asset,
    result,
    sourceBlobHash,
    derivationVersion,
}: {
    asset: Asset
    result: GeneratedRenditionResult
    sourceBlobHash: string
    derivationVersion: string
}) => {
    if (result.objectKey !== getBlobObjectKey(result.blobHash)) {
        throw new Error(`RENDITION_OBJECT_KEY_MISMATCH:${result.name}`)
    }
    const bytes = await getNatsService().getObject(`blobs-${asset.organizationId}-files`, result.objectKey)
    if (!bytes) throw new Error(`RENDITION_OBJECT_NOT_FOUND:${result.name}`)
    if (bytes.byteLength !== result.byteSize) throw new Error(`RENDITION_SIZE_MISMATCH:${result.name}`)
    if (hashBytes(bytes) !== result.blobHash) throw new Error(`RENDITION_HASH_MISMATCH:${result.name}`)
    return await BlobModel.registerStoredBlob({
        organizationId: asset.organizationId,
        blobHash: result.blobHash,
        bucketName: `blobs-${asset.organizationId}-files`,
        objectKey: result.objectKey,
        mimeType: result.mimeType,
        byteSize: result.byteSize,
        sourceBlobHash,
        derivationKind: result.name,
        derivationVersion,
    })
}

const AssetRenditionService = {
    commitResponse: async ({
        response,
        derivationVersion,
    }: {
        response: GenerateRenditionsResponse
        derivationVersion: string
    }): Promise<Asset> => {
        const asset = await getAssetRecord(response.assetId)
        if (!asset?.media) throw new Error('ASSET_MEDIA_NOT_FOUND')
        if (asset.states.lifecycle === 'deleting') throw new Error('ASSET_MEDIA_NOT_FOUND')
        if (asset.organizationId !== response.organizationId) throw new Error('RENDITION_TENANT_MISMATCH')
        const original = asset.media.renditions.original
        if (original?.blobHash !== response.sourceBlobHash) throw new Error('RENDITION_SOURCE_MISMATCH')

        const now = Date.now()
        const renditions = { ...asset.media.renditions }
        const operations: TransactOperation[] = []
        const blobsToDelete: string[] = []
        const blobReferenceAdditions: Parameters<typeof buildBlobReferenceBatchOperations>[0]['additions'] = []
        const blobReferenceRemovals: NonNullable<Parameters<typeof buildBlobReferenceBatchOperations>[0]['removals']> = []
        const returnedNames = new Set<AssetRenditionName>()

        for (const result of response.renditions) {
            if (returnedNames.has(result.name)) throw new Error(`DUPLICATE_RENDITION_RESULT:${result.name}`)
            returnedNames.add(result.name)
            if (result.name === 'original') continue
            const current = renditions[result.name]
            if (!current || current.jobKey !== response.jobKey) throw new Error('UNEXPECTED_OR_STALE_RENDITION')
            if (result.status === 'failed') {
                if (current?.status !== 'ready') {
                    renditions[result.name] = {
                        name: result.name,
                        status: 'failed',
                        errorCode: result.errorCode,
                        jobKey: response.jobKey,
                        updatedAt: now,
                    }
                }
                continue
            }

            const blob = await registerReturnedBlob({
                asset,
                result,
                sourceBlobHash: response.sourceBlobHash,
                derivationVersion,
            })
            const referenceKey = `asset#${asset.assetId}#rendition#${result.name}`
            if (current?.status !== 'ready' || current.blobHash !== result.blobHash) {
                const reference: BlobReference = {
                    blobKey: blob.blobKey,
                    blobHash: blob.blobHash,
                    organizationId: blob.organizationId,
                    referenceKey,
                    ownerType: 'asset',
                    ownerId: asset.assetId,
                    createdAt: now,
                }
                blobReferenceAdditions.push({ blob, reference })
            }
            if (current?.status === 'ready' && current.blobHash && current.blobHash !== result.blobHash) {
                const oldBlob = await BlobModel.get({ organizationId: asset.organizationId, blobHash: current.blobHash })
                if (!oldBlob) throw new Error(`OLD_RENDITION_BLOB_NOT_FOUND:${current.blobHash}`)
                const oldReference = await BlobModel.getReference(oldBlob.blobKey, referenceKey)
                if (!oldReference) throw new Error(`OLD_RENDITION_REFERENCE_NOT_FOUND:${referenceKey}`)
                blobReferenceRemovals.push({ blob: oldBlob, reference: oldReference })
            }
            renditions[result.name] = {
                name: result.name,
                status: 'ready',
                blobHash: result.blobHash,
                mimeType: result.mimeType,
                byteSize: result.byteSize,
                ...(typeof result.width === 'number' ? { width: result.width } : {}),
                ...(typeof result.height === 'number' ? { height: result.height } : {}),
                ...(typeof result.durationSeconds === 'number' ? { durationSeconds: result.durationSeconds } : {}),
                jobKey: response.jobKey,
                updatedAt: now,
            }
        }

        const blobReferenceBatch = buildBlobReferenceBatchOperations({
            additions: blobReferenceAdditions,
            removals: blobReferenceRemovals,
            now,
        })
        operations.push(...blobReferenceBatch.operations)
        blobsToDelete.push(...blobReferenceBatch.deletionBlobHashes)

        for (const name of getRequestedRenditions(asset)) {
            if (name === 'original' || returnedNames.has(name)) continue
            const current = renditions[name]
            if (current?.status === 'ready') continue
            renditions[name] = {
                name,
                status: 'failed',
                errorCode: 'RENDITION_MISSING_FROM_RESPONSE',
                jobKey: response.jobKey,
                updatedAt: now,
            }
        }

        const media: AssetMedia = {
            ...asset.media,
            renditions,
            ...(typeof response.width === 'number' ? { width: response.width } : {}),
            ...(typeof response.height === 'number' ? { height: response.height } : {}),
            ...(typeof response.aspectRatio === 'number' ? { aspectRatio: response.aspectRatio } : {}),
            ...(typeof response.durationSeconds === 'number' ? { durationSeconds: response.durationSeconds } : {}),
            ...(typeof response.hasAudio === 'boolean' ? { hasAudio: response.hasAudio } : {}),
            ...(typeof response.pageCount === 'number' ? { pageCount: response.pageCount } : {}),
        }
        const mediaStatus = getMediaStatus(media)
        const next: Asset = {
            ...asset,
            media,
            states: {
                ...asset.states,
                lifecycle: mediaStatus === 'failed' ? 'failed' : 'active',
                media: mediaStatus,
            },
            revision: asset.revision + 1,
            updatedAt: now,
        }
        operations.push(
            {
                type: 'update',
                tableName: assetsTableName(),
                key: { assetId: asset.assetId },
                updates: {
                    media,
                    states: next.states,
                    revision: next.revision,
                    updatedAt: now,
                },
                conditionExpression: '#revision = :expectedRevision',
                expressionAttributeNames: { '#revision': 'revision' },
                expressionAttributeValues: { ':expectedRevision': asset.revision },
            },
            ...await buildAssetProjectionOperations(next),
        )
        if (operations.length > 100) throw new Error('RENDITION_TRANSACTION_TOO_LARGE')
        await dynamoDBService.transactWrite({
            operations,
            origin: 'AssetRenditionService.commitResponse',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.RENDITION_UPDATED, next)

        for (const blobHash of blobsToDelete) {
            await enqueueBlobDeletion({ organizationId: asset.organizationId, blobHash })
        }
        return next
    },

    process: async ({
        assetId,
        derivationVersion = 'asset-renditions-v1',
        retryAttempt = 0,
    }: {
        assetId: string
        derivationVersion?: string
        retryAttempt?: number
    }): Promise<Asset> => {
        const asset = await getAssetRecord(assetId)
        if (!asset?.media) throw new Error('ASSET_MEDIA_NOT_FOUND')
        if (asset.states.lifecycle === 'deleting') throw new Error('ASSET_MEDIA_NOT_FOUND')
        const original = asset.media.renditions.original
        if (original?.status !== 'ready' || !original.blobHash) throw new Error('ASSET_ORIGINAL_NOT_READY')
        const sourceBlob = await BlobModel.get({
            organizationId: asset.organizationId,
            blobHash: original.blobHash,
        })
        if (!sourceBlob) throw new Error('SOURCE_BLOB_NOT_FOUND')
        const policy = MEDIA_POLICY[asset.media.sourceMimeType]
        if (!policy || policy.kind !== asset.media.kind) throw new Error('MEDIA_POLICY_MISMATCH')
        const requestedRenditions = getRequestedRenditions(asset).filter((name) =>
            name === 'original'
                ? retryAttempt === 0
                : asset.media!.renditions[name]?.status !== 'ready')
        if (requestedRenditions.length === 0) return asset
        const jobId = uuid()
        const renditionSetKey = [...requestedRenditions].sort().join('+')
        const jobKey = `${asset.assetId}:${original.blobHash}:${derivationVersion}:${renditionSetKey}`
        const now = Date.now()
        const pending = buildPendingAsset({ asset, jobKey, requestedRenditions, now })
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: {
                        media: pending.media,
                        states: pending.states,
                        revision: pending.revision,
                        updatedAt: now,
                    },
                    conditionExpression: '#revision = :expectedRevision',
                    expressionAttributeNames: { '#revision': 'revision' },
                    expressionAttributeValues: { ':expectedRevision': asset.revision },
                },
                ...await buildAssetProjectionOperations(pending),
            ],
            origin: 'AssetRenditionService.process.markPending',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.RENDITION_UPDATED, pending)

        const request: GenerateRenditionsRequest = {
            jobId,
            jobKey,
            organizationId: asset.organizationId,
            assetId,
            bucketName: sourceBlob.bucketName,
            sourceBlobHash: sourceBlob.blobHash,
            sourceObjectKey: sourceBlob.objectKey,
            originalName: asset.media.originalName,
            sourceMimeType: asset.media.sourceMimeType,
            mediaKind: asset.media.kind,
            modelSafe: asset.media.modelSafe,
            canonicalMimeType: policy.canonicalMime,
            derivationVersion,
            requestedRenditions,
        }
        let response: GenerateRenditionsResponse
        try {
            response = await getNatsService().request<GenerateRenditionsRequest, GenerateRenditionsResponse>(
                NATS_SUBJECTS.BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS,
                request,
                10 * 60 * 1000,
            )
        } catch (error) {
            if (isWorkerUnavailableError(error)) throw new Error(RENDITION_WORKER_UNAVAILABLE)
            throw error
        }
        const committed = await AssetRenditionService.commitResponse({ response, derivationVersion })
        if ((committed.states.media === 'degraded' || committed.states.media === 'failed') && retryAttempt < 5) {
            await enqueueRenditionRetry({
                organizationId: committed.organizationId,
                assetId,
                retryAttempt: retryAttempt + 1,
            })
        }
        return committed
    },
}

export default AssetRenditionService
