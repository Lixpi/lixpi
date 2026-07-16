'use strict'

import * as process from 'node:process'

import {
    getDynamoDbTableStageName,
    NATS_SUBJECTS,
    type Asset,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
} from '@lixpi/constants'
import {
    buildGeneratedMediaTurnProjectionFromThreadContent,
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    PROSEMIRROR_SCHEMA_VERSION,
} from '@lixpi/prosemirror'

import { buildAssetProjectionOperations, getAssetRecord, publishAssetEvent } from '../models/asset.ts'
import BlobModel, { buildBlobReferenceOperations, buildBlobReferenceRemovalOperations } from '../models/blob.ts'
import { enqueueBlobDeletion, enqueueProvenanceRebuild } from './asset-maintenance-queue.ts'
import AssetDocumentService from './asset-document-service.ts'

const { ORG_NAME, STAGE } = process.env

const isRevisionConflict = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false
    const record = error as {
        name?: unknown
        CancellationReasons?: Array<{ Code?: unknown }>
    }
    return record.name === 'TransactionCanceledException'
        && Boolean(record.CancellationReasons?.some((reason) => reason.Code === 'ConditionalCheckFailed'))
}

const materializeAssetProvenanceAttempt = async ({
    assetId,
    workspaceId,
    conversationAssetId,
    generationRun,
    terminalStatus,
    revisionRetryAttempt,
    allowMinimalCompletedProjection,
}: {
    assetId: string
    workspaceId: string
    conversationAssetId: string
    generationRun: MediaGenerationRunMeta
    terminalStatus: 'completed' | 'failed' | 'cancelled'
    revisionRetryAttempt: number
    allowMinimalCompletedProjection: boolean
}): Promise<void> => {
    const asset = await getAssetRecord(assetId)
    if (!asset) throw new Error('ASSET_NOT_FOUND')
    if (asset.states.lifecycle === 'deleting') return
    if (terminalStatus !== 'completed' && asset.media?.renditions.original?.status === 'ready') return
    if (asset.documents.provenance && ['sealed', 'failed', 'cancelled'].includes(asset.states.provenance)) return
    if (asset.lineage?.sourceConversationAssetId !== conversationAssetId
        || asset.lineage?.reasoningRunId !== generationRun.reasoningRunId
        || asset.lineage?.mediaRunId !== generationRun.mediaRunId) {
        throw new Error('PROVENANCE_LINEAGE_MISMATCH')
    }
    const conversationAsset = await getAssetRecord(conversationAssetId)
    if (!conversationAsset || conversationAsset.organizationId !== asset.organizationId) {
        throw new Error('PROVENANCE_CONVERSATION_ASSET_NOT_FOUND')
    }
    const conversationSnapshot = await AssetDocumentService.loadCurrentSnapshot(conversationAsset, 'conversation')
    const projection = conversationSnapshot
        ? buildGeneratedMediaTurnProjectionFromThreadContent(
            conversationSnapshot.doc,
            {
                assetId,
                reasoningRunId: generationRun.reasoningRunId,
                reasoningModelId: generationRun.reasoningModelId,
                mediaRunId: generationRun.mediaRunId,
                mediaType: generationRun.mediaType,
                variantIndex: generationRun.variantIndex ?? generationRun.mediaIndex,
            },
            {
                threadId: conversationAssetId,
                forceGenerationDetailsOpen: true,
                limitToLocatorMedia: true,
                lineageProjectionScope: 'media-run',
            },
        )
        : null
    if (terminalStatus === 'completed' && !projection && !allowMinimalCompletedProjection) {
        throw new Error('PROVENANCE_PROJECTION_NOT_READY')
    }
    const projectedContent = projection?.content
    const provenanceDocument = projectedContent
        ? {
            ...projectedContent,
            content: projectedContent.content,
        }
        : {
        type: 'doc',
        content: [{
            type: 'aiChatThread',
            attrs: { threadId: conversationAssetId, status: terminalStatus },
            content: [{
                type: 'aiResponseMessage',
                attrs: {
                    generationRequestId: generationRun.generationRequestId,
                    reasoningRunId: generationRun.reasoningRunId,
                    mediaRunId: generationRun.mediaRunId ?? '',
                    reasoningModelId: generationRun.reasoningModelId,
                    mediaModelId: generationRun.mediaModelId ?? '',
                    mediaType: generationRun.mediaType ?? '',
                },
                content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: `Generation ${terminalStatus}.` }],
                }],
            }],
        }],
        }
    new HeadlessProseMirrorEngine({
        documentType: DOCUMENT_TYPE.ASSET_PROVENANCE,
        doc: provenanceDocument,
        version: 1,
    })
    AssetDocumentService.assertAssetBackedMediaNodes(provenanceDocument)
    const bytes = Buffer.from(JSON.stringify(provenanceDocument), 'utf8')
    const blob = await BlobModel.store({
        organizationId: asset.organizationId,
        bytes,
        mimeType: 'application/json',
        description: `Sealed provenance for ${assetId}`,
    })
    const now = Date.now()
    const pointer = {
        role: 'provenance' as const,
        blobHash: blob.blobHash,
        version: 1,
        schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
        byteSize: bytes.byteLength,
        updatedAt: now,
        sealedAt: now,
    }
    const next: Asset = {
        ...asset,
        documents: { ...asset.documents, provenance: pointer },
        states: {
            ...asset.states,
            ...(terminalStatus === 'failed' ? { lifecycle: 'failed' as const, media: 'failed' as const } : {}),
            ...(terminalStatus === 'cancelled' ? { lifecycle: 'failed' as const, media: 'cancelled' as const } : {}),
            provenance: terminalStatus === 'completed' ? 'sealed' : terminalStatus,
        },
        revision: asset.revision + 1,
        updatedAt: now,
    }
    const referenceKey = `asset#${assetId}#document#provenance`
    const existingReference = await BlobModel.getReference(blob.blobKey, referenceKey)
    const operations = existingReference ? [] : buildBlobReferenceOperations({
                blob,
                reference: {
                    blobKey: blob.blobKey,
                    blobHash: blob.blobHash,
                    organizationId: blob.organizationId,
                    referenceKey,
                    ownerType: 'asset',
                    ownerId: assetId,
                    createdAt: now,
                },
                now,
            })
    const previousBlobHash = asset.documents.provenance?.blobHash
    let previousBlobDeletionRequired = false
    if (previousBlobHash && previousBlobHash !== blob.blobHash) {
        const removal = await buildBlobReferenceRemovalOperations({
            organizationId: asset.organizationId,
            blobHash: previousBlobHash,
            referenceKey,
            now,
        })
        operations.push(...removal.operations)
        previousBlobDeletionRequired = removal.deletionRequired
    }
    try {
        await dynamoDBService.transactWrite({
            operations: [
                ...operations,
                {
                    type: 'update',
                    tableName: getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE),
                    key: { assetId },
                    updates: { documents: next.documents, states: next.states, revision: next.revision, updatedAt: now },
                    conditionExpression: '#revision = :expectedRevision',
                    expressionAttributeNames: { '#revision': 'revision' },
                    expressionAttributeValues: { ':expectedRevision': asset.revision },
                },
                ...await buildAssetProjectionOperations(next),
            ],
            logConditionalCheckFailures: false,
            origin: 'materializeAssetProvenance',
        })
    } catch (error) {
        if (revisionRetryAttempt < 3 && isRevisionConflict(error)) {
            return await materializeAssetProvenanceAttempt({
                assetId,
                workspaceId,
                conversationAssetId,
                generationRun,
                terminalStatus,
                revisionRetryAttempt: revisionRetryAttempt + 1,
                allowMinimalCompletedProjection,
            })
        }
        throw error
    }
    publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
    if (previousBlobHash && previousBlobDeletionRequired) {
        await enqueueBlobDeletion({ organizationId: asset.organizationId, blobHash: previousBlobHash })
    }
}

export const materializeAssetProvenance = async (payload: {
    assetId: string
    workspaceId: string
    conversationAssetId: string
    generationRun: MediaGenerationRunMeta
    terminalStatus: 'completed' | 'failed' | 'cancelled'
    allowMinimalCompletedProjection?: boolean
}): Promise<void> => await materializeAssetProvenanceAttempt({
    ...payload,
    revisionRetryAttempt: 0,
    allowMinimalCompletedProjection: payload.allowMinimalCompletedProjection === true,
})

export const settleUnfinishedGeneratedAssets = async ({
    plan,
    organizationId,
    workspaceId,
    conversationAssetId,
    terminalStatus,
}: {
    plan: MediaBranchLineagePlan
    organizationId: string
    workspaceId: string
    conversationAssetId: string
    terminalStatus: 'failed' | 'cancelled'
}): Promise<void> => {
    await Promise.all(plan.runAssignments.map(async (assignment) => {
        if (!assignment.reasoningRunId || !assignment.reasoningModelId) return
        const asset = await getAssetRecord(assignment.assetId)
        if (!asset || asset.organizationId !== organizationId) return
        if (asset.documents.provenance || asset.states.provenance === 'sealed') return
        if (asset.media?.renditions.original?.status === 'ready') return
        const generationRun: MediaGenerationRunMeta = {
            requestKind: 'media-generation-matrix',
            generationRequestId: assignment.generationRequestId,
            reasoningRunId: assignment.reasoningRunId,
            reasoningModelId: assignment.reasoningModelId,
            reasoningIndex: assignment.reasoningIndex ?? 0,
            ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
            ...(assignment.mediaModelId ? { mediaModelId: assignment.mediaModelId } : {}),
            ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
            ...(typeof assignment.mediaIndex === 'number' ? { mediaIndex: assignment.mediaIndex } : {}),
            lineageAssignment: assignment,
        }
        const payload = {
            organizationId,
            assetId: assignment.assetId,
            workspaceId,
            conversationAssetId,
            generationRun,
            terminalStatus,
        }
        try {
            await materializeAssetProvenance(payload)
        } catch {
            await enqueueProvenanceRebuild(payload)
        }
    }))
}
