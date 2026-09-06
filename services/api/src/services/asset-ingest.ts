import { err as debugError } from '@lixpi/debug-tools'
import {
    MEDIA_POLICY,
    type AssetMediaKind,
} from '@lixpi/constants'

import AssetModel from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import { detectFileType } from './file-type-detection.ts'
import AssetRenditionService from './asset-rendition-service.ts'
import { enqueueRenditionRetry } from './asset-maintenance-queue.ts'

export class AssetFileRejectedError extends Error {
    constructor(public readonly reason: string) {
        super(reason)
        this.name = 'AssetFileRejectedError'
    }
}

export type AssetIngestResult = {
    assetId: string
    status: 'processing'
    kind: AssetMediaKind
    originalUrl: string
}

export const ingestAssetFile = async ({
    organizationId,
    workspaceId,
    ownerUserId,
    buffer,
    originalName,
    expectedKind,
}: {
    organizationId: string
    workspaceId: string
    ownerUserId: string
    buffer: Buffer
    originalName: string
    expectedKind?: AssetMediaKind
}): Promise<AssetIngestResult> => {
    const detection = await detectFileType(buffer, originalName)

    if (detection.rejected)
        throw new AssetFileRejectedError(detection.reason)

    const policy = MEDIA_POLICY[detection.mimeType]

    if (!policy)
        throw new AssetFileRejectedError('Unsupported file type')

    if (
        expectedKind
        && detection.kind !== expectedKind
    )
        throw new AssetFileRejectedError(`Expected a ${expectedKind} file`)

    const blob = await BlobModel.store({
        organizationId,
        bytes: buffer,
        mimeType: detection.mimeType,
        description: originalName,
    })
    const now = Date.now()
    const asset = await AssetModel.create({
        organizationId,
        title: originalName,
        scope: 'workspace',
        scopeOwnerId: workspaceId,
        originWorkspaceId: workspaceId,
        ownerUserId,
        documents: {},
        media: {
            kind: detection.kind,
            originalName,
            sourceMimeType: detection.mimeType,
            modelSafe: detection.modelSafe,
            renditions: {
                original: {
                    name: 'original',
                    status: 'ready',
                    blobHash: blob.blobHash,
                    mimeType: blob.mimeType,
                    byteSize: blob.byteSize,
                    updatedAt: now,
                },
            },
        },
        states: {
            lifecycle: 'creating',
            media: 'processing',
            conversation: 'none',
            provenance: 'none',
        },
    })
    void (async () => {
        try {
            await AssetRenditionService.process({ assetId: asset.assetId })
        } catch (error) {
            debugError(
                'Asset rendition processing failed:',
                {
                    assetId: asset.assetId,
                    error,
                },
            )
            await enqueueRenditionRetry({
                organizationId,
                assetId: asset.assetId,
                retryAttempt: 1,
            })
        }
    })()

    return {
        assetId: asset.assetId,
        status: 'processing',
        kind: detection.kind,
        originalUrl: `/api/assets/${asset.assetId}/renditions/original`,
    }
}
