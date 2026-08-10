'use strict'

import * as process from 'node:process'

import {
    getDynamoDbTableStageName,
    NATS_SUBJECTS,
    settleMediaGenerationRunProgress,
    type Asset,
    type MediaBranchLineagePlan,
    type MediaGenerationProgressState,
    type MediaGenerationRunMeta,
    type OperationProgressItem,
} from '@lixpi/constants'
import {
    buildGeneratedMediaTurnProjectionFromThreadContent,
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    PROSEMIRROR_SCHEMA_VERSION,
} from '@lixpi/prosemirror'

import { buildAssetProjectionOperations, getAssetRecord, publishAssetEvent } from '../models/asset.ts'
import BlobModel, { buildBlobReferenceOperations, buildBlobReferenceRemovalOperations } from '../models/blob.ts'
import MediaGenerationRequestModel from '../models/media-generation-request.ts'
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

const collectDocumentText = (value: unknown): string => {
    if (!value || typeof value !== 'object') return ''
    if (Array.isArray(value)) return value.map(collectDocumentText).filter(Boolean).join(' ')
    const node = value as Record<string, unknown>
    return [
        typeof node.text === 'string' ? node.text : '',
        ...(Array.isArray(node.content) ? node.content.map(collectDocumentText) : []),
    ].filter(Boolean).join(' ')
}

const getReasoningSummary = (
    document: unknown,
    generationRun: MediaGenerationRunMeta,
): string => {
    let summary = ''
    const visit = (value: unknown): void => {
        if (summary || !value || typeof value !== 'object') return
        if (Array.isArray(value)) {
            value.forEach(visit)
            return
        }
        const node = value as Record<string, unknown>
        const attrs = node.attrs && typeof node.attrs === 'object'
            ? node.attrs as Record<string, unknown>
            : undefined
        if (node.type === 'aiReasoningSection' && (
            attrs?.reasoningRunId === generationRun.reasoningRunId
            || attrs?.generationRequestId === generationRun.generationRequestId
        )) {
            summary = collectDocumentText(node).replace(/\s+/gu, ' ').trim().slice(0, 600)
            return
        }
        if (Array.isArray(node.content)) node.content.forEach(visit)
    }
    visit(document)
    return summary
}

export const includeLineageProgressInAssetProvenance = (
    progress: MediaGenerationProgressState,
    reasoningSummary = '',
): MediaGenerationProgressState => {
    const sharedItems: OperationProgressItem[] = [
        {
            id: 'lineage:understand-request',
            title: 'Understand request',
            status: 'completed',
            ...(reasoningSummary ? { summary: reasoningSummary } : {}),
        },
        {
            id: 'lineage:resolve-capabilities-and-references',
            title: 'Resolve capabilities, tools, and references',
            status: 'completed',
        },
        {
            id: 'lineage:resolve-branch-lineage',
            title: 'Resolve branch lineage and media runs',
            status: 'completed',
        },
    ]
    return {
        ...progress,
        progress: {
            ...progress.progress,
            items: [
                ...sharedItems,
                ...(progress.progress.items ?? []),
            ],
        },
    }
}

const createProvenanceMediaNode = ({
    assetId,
    generationRun,
    generationProgress,
}: {
    assetId: string
    generationRun: MediaGenerationRunMeta
    generationProgress: MediaGenerationProgressState
}): Record<string, unknown> => ({
    type: generationRun.mediaType === 'video' ? 'aiGeneratedVideo' : 'aiGeneratedImage',
    attrs: {
        assetId,
        generationRequestId: generationRun.generationRequestId,
        reasoningRunId: generationRun.reasoningRunId,
        mediaRunId: generationRun.mediaRunId ?? '',
        reasoningModelId: generationRun.reasoningModelId,
        mediaModelId: generationRun.mediaModelId ?? '',
        mediaType: generationRun.mediaType ?? '',
        variantIndex: generationRun.variantIndex ?? generationRun.mediaIndex ?? null,
        generationProgress,
        ...(generationRun.mediaType === 'video'
            ? { isPending: false }
            : { isPartial: false }),
    },
})

const embedGenerationProgressInProvenance = ({
    document,
    assetId,
    generationRun,
    generationProgress,
}: {
    document: Record<string, unknown>
    assetId: string
    generationRun: MediaGenerationRunMeta
    generationProgress: MediaGenerationProgressState
}): Record<string, unknown> => {
    let embedded = false
    const visit = (value: unknown): unknown => {
        if (!value || typeof value !== 'object') return value
        if (Array.isArray(value)) return value.map(visit)
        const node = value as Record<string, unknown>
        const attrs = node.attrs && typeof node.attrs === 'object'
            ? node.attrs as Record<string, unknown>
            : undefined
        const matches = (node.type === 'aiGeneratedImage' || node.type === 'aiGeneratedVideo') && (
            attrs?.assetId === assetId
            || Boolean(generationRun.mediaRunId && attrs?.mediaRunId === generationRun.mediaRunId)
        )
        if (matches) {
            embedded = true
            return {
                ...node,
                attrs: { ...attrs, generationProgress },
                ...(Array.isArray(node.content) ? { content: node.content.map(visit) } : {}),
            }
        }
        return {
            ...node,
            ...(Array.isArray(node.content) ? { content: node.content.map(visit) } : {}),
        }
    }
    const projected = visit(document) as Record<string, unknown>
    if (embedded) return projected

    let appended = false
    const appendToResponse = (value: unknown): unknown => {
        if (!value || typeof value !== 'object') return value
        if (Array.isArray(value)) return value.map(appendToResponse)
        const node = value as Record<string, unknown>
        if (!appended && node.type === 'aiResponseMessage') {
            appended = true
            return {
                ...node,
                content: [
                    ...(Array.isArray(node.content) ? node.content : []),
                    createProvenanceMediaNode({ assetId, generationRun, generationProgress }),
                ],
            }
        }
        return {
            ...node,
            ...(Array.isArray(node.content) ? { content: node.content.map(appendToResponse) } : {}),
        }
    }
    return appendToResponse(projected) as Record<string, unknown>
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
    const request = await MediaGenerationRequestModel.get({
        generationRequestId: generationRun.generationRequestId,
        workspaceId,
    })
    const durableRun = request?.runs.find(run => (
        Boolean(generationRun.mediaRunId && run.mediaRunId === generationRun.mediaRunId)
        || (run.reasoningIndex === generationRun.reasoningIndex
            && run.modelId === generationRun.mediaModelId)
    ))
    const progressMessage = durableRun?.progress?.message
        ?? (terminalStatus === 'completed'
            ? 'Media generation completed.'
            : terminalStatus === 'cancelled'
                ? 'Media generation cancelled.'
                : durableRun?.problem?.detail ?? 'Media generation failed.')
    const mediaGenerationProgress: MediaGenerationProgressState = {
        generationRequestId: generationRun.generationRequestId,
        status: terminalStatus,
        message: progressMessage,
        progress: settleMediaGenerationRunProgress(
            durableRun?.progress,
            terminalStatus,
            progressMessage,
        ),
        ...(durableRun?.generationRun === undefined ? {} : {
            generationRun: durableRun.generationRun,
        }),
        ...(generationRun.mediaRunId ? { mediaRunId: generationRun.mediaRunId } : {}),
        updatedAt: durableRun?.completedAt ?? request?.updatedAt ?? Date.now(),
    }
    const generationProgress = includeLineageProgressInAssetProvenance(
        mediaGenerationProgress,
        getReasoningSummary(conversationSnapshot?.doc, generationRun),
    )
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
    const baseProvenanceDocument = projectedContent
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
    const provenanceDocument = embedGenerationProgressInProvenance({
        document: baseProvenanceDocument,
        assetId,
        generationRun,
        generationProgress,
    })
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
