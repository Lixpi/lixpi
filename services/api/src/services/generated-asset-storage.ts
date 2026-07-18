'use strict'

import * as process from 'node:process'

import {
    getDynamoDbTableStageName,
    NATS_SUBJECTS,
    type Asset,
    type CanvasGeometryUpdate,
    type MediaBranchCandidateSnapshot,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
    type WorkspaceContextSnapshot,
} from '@lixpi/constants'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'

import AssetModel, {
    buildAssetProjectionOperations,
    getAssetRecord,
    publishAssetEvent,
} from '../models/asset.ts'
import BlobModel, { buildBlobReferenceOperations } from '../models/blob.ts'
import Workspace from '../models/workspace.ts'
import {
    buildAssetCanvasGeometryUpdate,
    projectGeneratedAssetNode,
} from './asset-canvas-projection.ts'
import AssetRenditionService from './asset-rendition-service.ts'
import { enqueueRenditionRetry } from './asset-maintenance-queue.ts'

const { ORG_NAME, STAGE } = process.env

export const ensurePendingGeneratedAssets = async ({
    lineagePlan,
    workspaceId,
    conversationAssetId,
    organizationId,
    ownerUserId,
    mediaBranchCandidateSnapshot,
    workspaceContextSnapshot,
}: {
    lineagePlan: MediaBranchLineagePlan
    workspaceId: string
    conversationAssetId: string
    organizationId: string
    ownerUserId: string
    mediaBranchCandidateSnapshot?: MediaBranchCandidateSnapshot
    workspaceContextSnapshot?: WorkspaceContextSnapshot
}): Promise<void> => {
    const assetIdByNodeId = new Map<string, string>()
    for (const candidate of mediaBranchCandidateSnapshot?.candidates ?? []) {
        if (candidate.assetId) assetIdByNodeId.set(candidate.nodeId, candidate.assetId)
    }
    for (const contextNode of workspaceContextSnapshot?.nodes ?? []) {
        if (contextNode.assetId) assetIdByNodeId.set(contextNode.nodeId, contextNode.assetId)
    }

    await Promise.all(lineagePlan.runAssignments.map(async (assignment) => {
        const parentAssetId = assignment.parentMediaNodeId
            ? assetIdByNodeId.get(assignment.parentMediaNodeId)
            : undefined
        const sourceAssetIds = [...new Set([
            ...assignment.referenceNodeIds,
            ...assignment.sourceContextNodeIds,
        ].flatMap((nodeId) => assetIdByNodeId.get(nodeId) ?? []))]
        const lineage = {
            sourceConversationAssetId: conversationAssetId,
            ...(parentAssetId ? { parentAssetId } : {}),
            sourceAssetIds,
            generationRequestId: assignment.generationRequestId,
            reasoningRunId: assignment.reasoningRunId,
            mediaRunId: assignment.mediaRunId,
            reasoningModelId: assignment.reasoningModelId,
            mediaModelId: assignment.mediaModelId,
            promptFingerprint: assignment.promptFingerprint,
        }
        const assertMatchingPendingAsset = (existing: Awaited<ReturnType<typeof getAssetRecord>>): void => {
            if (!existing
                || existing.organizationId !== organizationId
                || existing.originWorkspaceId !== workspaceId
                || existing.ownerUserId !== ownerUserId
                || existing.lineage?.generationRequestId !== lineage.generationRequestId
                || existing.lineage?.reasoningRunId !== lineage.reasoningRunId
                || existing.lineage?.mediaRunId !== lineage.mediaRunId) {
                throw new Error(`MEDIA_RUN_ASSET_ID_CONFLICT:${assignment.assetId}`)
            }
        }
        const existing = await getAssetRecord(assignment.assetId)
        if (existing) {
            assertMatchingPendingAsset(existing)
            return
        }
        try {
            await AssetModel.create({
                assetId: assignment.assetId,
                organizationId,
                title: assignment.mediaType === 'video' ? 'Generated video' : 'Generated image',
                scope: 'workspace',
                scopeOwnerId: workspaceId,
                originWorkspaceId: workspaceId,
                ownerUserId,
                documents: {},
                lineage,
                generatedOutputReview: { status: 'candidate' },
                states: {
                    lifecycle: 'creating',
                    media: 'processing',
                    conversation: 'none',
                    provenance: 'building',
                },
                workspaceReference: {
                    workspaceId,
                    surfaceIds: [
                        `conversation#${conversationAssetId}#media#${assignment.mediaRunId ?? assignment.reasoningRunId}`,
                    ],
                },
            })
        } catch (error) {
            if (!isTransactionConditionalCheckFailure(error)) throw error
            assertMatchingPendingAsset(await getAssetRecord(assignment.assetId))
        }
    }))
}

export const settleGeneratedAssetOriginal = async ({
    generationRun,
    workspaceId,
    buffer,
    originalName,
    mimeType,
    kind,
}: {
    generationRun: MediaGenerationRunMeta
    workspaceId: string
    buffer: Buffer
    originalName: string
    mimeType: string
    kind: 'image' | 'video'
}): Promise<{ assetId: string; organizationId: string; url: string }> => {
    const assetId = generationRun.lineageAssignment?.assetId
    if (!assetId) throw new Error('Generated media run is missing assetId')
    const asset = await getAssetRecord(assetId)
    if (!asset) throw new Error(`Pending Asset not found: ${assetId}`)
    const blob = await BlobModel.store({
        organizationId: asset.organizationId,
        bytes: buffer,
        mimeType,
        description: originalName,
    })
    const existingOriginal = asset.media?.renditions.original
    if (existingOriginal?.status === 'ready') {
        if (existingOriginal.blobHash !== blob.blobHash) {
            throw new Error('GENERATED_ASSET_ORIGINAL_CONFLICT')
        }
        if (asset.states.media === 'processing') {
            await enqueueRenditionRetry({ organizationId: asset.organizationId, assetId, retryAttempt: 1 })
        }
        return { assetId, organizationId: asset.organizationId, url: `/api/assets/${assetId}/renditions/original` }
    }
    const now = Date.now()
    const media: NonNullable<Asset['media']> = {
        kind,
        originalName,
        sourceMimeType: mimeType,
        modelSafe: true,
        renditions: {
            original: {
                name: 'original',
                status: 'ready',
                blobHash: blob.blobHash,
                mimeType,
                byteSize: buffer.byteLength,
                updatedAt: now,
            },
        },
    }
    const next: Asset = {
        ...asset,
        media,
        states: { ...asset.states, media: 'processing' },
        revision: asset.revision + 1,
        updatedAt: now,
    }
    const referenceKey = `asset#${assetId}#rendition#original`
    try {
        await dynamoDBService.transactWrite({
            operations: [
                ...buildBlobReferenceOperations({
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
                }),
                {
                    type: 'update',
                    tableName: getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE),
                    key: { assetId },
                    updates: { media, states: next.states, revision: next.revision, updatedAt: now },
                    conditionExpression: '#revision = :expectedRevision AND attribute_not_exists(#media) AND #states.#lifecycle = :creating',
                    expressionAttributeNames: {
                        '#revision': 'revision',
                        '#media': 'media',
                        '#states': 'states',
                        '#lifecycle': 'lifecycle',
                    },
                    expressionAttributeValues: { ':expectedRevision': asset.revision, ':creating': 'creating' },
                },
                ...await buildAssetProjectionOperations(next),
            ],
            logConditionalCheckFailures: false,
            origin: 'settleGeneratedAssetOriginal',
        })
    } catch (error) {
        if (!isTransactionConditionalCheckFailure(error)) throw error
        const concurrent = await getAssetRecord(assetId)
        const concurrentOriginal = concurrent?.media?.renditions.original
        if (concurrentOriginal?.status !== 'ready' || concurrentOriginal.blobHash !== blob.blobHash) throw error
        if (concurrent.states.media === 'processing') {
            await enqueueRenditionRetry({ organizationId: concurrent.organizationId, assetId, retryAttempt: 1 })
        }
        return { assetId, organizationId: concurrent.organizationId, url: `/api/assets/${assetId}/renditions/original` }
    }
    publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.RENDITION_UPDATED, next)
    void (async () => {
        try {
            await AssetRenditionService.process({ assetId })
        } catch (error) {
            console.error('Generated Asset rendition processing failed:', { assetId, error })
            await enqueueRenditionRetry({ organizationId: asset.organizationId, assetId, retryAttempt: 1 })
        }
    })()
    return { assetId, organizationId: asset.organizationId, url: `/api/assets/${assetId}/renditions/original` }
}

export const attachGeneratedAssetNode = async ({
    assetId,
    workspaceId,
    kind,
    aspectRatio,
    generationRun,
    conversationAssetId,
}: {
    assetId: string
    workspaceId: string
    kind: 'image' | 'video'
    aspectRatio: number
    generationRun: MediaGenerationRunMeta
    conversationAssetId: string
}): Promise<CanvasGeometryUpdate> => {
    const maxAttempts = 5
    let lastError: unknown

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const asset = await getAssetRecord(assetId)
        if (!asset) throw new Error('ASSET_NOT_FOUND')
        const userId = asset.ownerUserId
        const workspace = await Workspace.getWorkspace({ workspaceId, userId })
        if ('error' in workspace) throw new Error(workspace.error)
        const projection = projectGeneratedAssetNode({
            canvasState: workspace.canvasState,
            assetId,
            kind,
            aspectRatio,
            generationRun,
            conversationAssetId,
            pendingBeforeFirstFrame: asset.media?.renditions.original?.status !== 'ready',
        })
        const persistedCanvasRevision = workspace.canvasStateUpdatedAt ?? workspace.updatedAt ?? 0
        const canvasStateUpdatedAt = Math.max(Date.now(), persistedCanvasRevision + 1)

        try {
            const attached = await AssetModel.attachWorkspaceReference({
                assetId,
                workspaceId,
                requester: {
                    userId,
                    workspaceIds: [workspaceId],
                    editableWorkspaceIds: [workspaceId],
                    organizationIds: [asset.organizationId],
                },
                nodeId: projection.nodeId,
                workspaceMutation: {
                    expectedCanvasStateUpdatedAt: workspace.canvasStateUpdatedAt,
                    canvasStateUpdatedAt,
                    canvasState: projection.canvasState,
                },
            })
            if ('error' in attached) throw new Error(attached.error)
            return buildAssetCanvasGeometryUpdate({
                state: projection.canvasState,
                layoutRevision: canvasStateUpdatedAt,
                generationRequestId: generationRun.generationRequestId,
                geometryNodes: projection.geometryNodes,
            })
        } catch (error) {
            lastError = error
            if (isTransactionConditionalCheckFailure(error)) continue
            throw error
        }
    }

    throw lastError ?? new Error(`Generated Asset canvas attach exhausted retries: ${assetId}`)
}
