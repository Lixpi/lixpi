import {
    type Asset,
} from '@lixpi/constants'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import { createHash } from 'node:crypto'
import { buildBlobReferenceRemovalOperations } from '../models/blob.ts'
import { enqueueBlobDeletion } from '../services/asset-maintenance-queue.ts'
import { AgentPayloadStore } from '../llm/agent/agent-payload-store.ts'
import { ConversationRepository } from '../llm/agent/conversation-repository.ts'
import {
    type MediaRenderRecord,
} from './media-render-adapter.ts'

export const cleanupMediaRenderAsset = async (asset: Asset): Promise<void> => {
    if (!/^export-[a-f0-9]{64}$/u.test(asset.assetId))
        return

    const jobId = `render-${asset.assetId.slice(7)}`
    const pk = `ORG#${encodeURIComponent(asset.organizationId)}#RENDER#${jobId}`
    const repository = new ConversationRepository()
    const record = await repository.read<MediaRenderRecord>(pk, 'META')

    if (!record)
        return

    if (
        record.outputAssetId !== asset.assetId
        || record.access.organizationId !== asset.organizationId
    )
        throw new Error('MEDIA_RENDER_CLEANUP_IDENTITY_MISMATCH')

    const operations: TransactOperation[] = []
    const deleted: string[] = []

    for (const blobHash of new Set(
        record.inputs.map(input => input.blobHash),
    )) {
        const removal = await buildBlobReferenceRemovalOperations({
            organizationId: asset.organizationId,
            blobHash,
            referenceKey: `asset#${asset.assetId}#render-source#${blobHash}`,
        })
        operations.push(...removal.operations)

        if (removal.deletionRequired)
            deleted.push(blobHash)
    }

    const release = await new AgentPayloadStore(asset.organizationId, asset.assetId).release(record.payload, 'render-input')

    if (
        record.result
        && !record.inputs.some(input => input.blobHash === record.result!.blobHash)
    ) {
        const removal = await buildBlobReferenceRemovalOperations({
            organizationId: asset.organizationId,
            blobHash: record.result.blobHash,
            referenceKey: `asset#${asset.assetId}#render-result`,
        })
        operations.push(...removal.operations)

        if (removal.deletionRequired)
            deleted.push(record.result.blobHash)
    }

    await repository.commit([
        ...operations,
        ...release.operations,
        repository.remove(pk, 'META'),
        repository.remove(pk, 'EVIDENCE'),
        repository.remove(pk, 'PROGRESS'),
        repository.remove(`RENDER_DUE#${createHash('sha256').update(jobId).digest()[0] % 16}`, jobId),
    ])
    await release.afterCommit()

    for (const blobHash of deleted)
        await enqueueBlobDeletion({
            organizationId: asset.organizationId,
            blobHash,
        })
}
