import * as process from 'node:process'

import {
    MEDIA_POLICY,
    getDynamoDbTableStageName,
    NATS_SUBJECTS,
    type Asset,
    type AssetRenditionName,
    type AssetMediaComposition,
    type CanvasGeometryUpdate,
    type MediaBranchCandidateSnapshot,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
    type MediaRunLineageAssignment,
    type WorkspaceContextSnapshot,
} from '@lixpi/constants'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'

import AssetModel, {
    assertAssetComponents,
    buildAssetProjectionOperations,
    getAssetRecord,
    publishAssetEvent,
} from '../models/asset.ts'
import BlobModel, {
    buildBlobReferenceBatchOperations,
    buildBlobReferenceOperations,
} from '../models/blob.ts'
import Workspace from '../models/workspace.ts'
import {
    buildAssetCanvasGeometryUpdate,
    projectGeneratedAssetNode,
} from './asset-canvas-projection.ts'
import AssetRenditionService from './asset-rendition-service.ts'
import { enqueueRenditionRetry } from './asset-maintenance-queue.ts'
import { deriveSubjectIdentityFromLineage } from './asset-subject-identity-service.ts'

const { ORG_NAME, STAGE } = process.env

const isRetryableCanvasAttachmentConflict = (error: unknown): boolean => {
    return isTransactionConditionalCheckFailure(error)
        || (error instanceof Error && error.message === 'STALE_CANVAS_STATE')
}

export function collectGeneratedAssetSourceIds(
    assignment: MediaRunLineageAssignment,
    mediaBranchCandidateSnapshot?: MediaBranchCandidateSnapshot,
    workspaceContextSnapshot?: WorkspaceContextSnapshot,
): string[] {
    const assetIdByNodeId = new Map<string, string>()
    for (const candidate of mediaBranchCandidateSnapshot?.candidates ?? []) {
        if (candidate.nodeId) assetIdByNodeId.set(candidate.nodeId, candidate.assetId)
    }
    for (const contextNode of workspaceContextSnapshot?.nodes ?? []) {
        if (contextNode.assetId) assetIdByNodeId.set(contextNode.nodeId, contextNode.assetId)
    }
    return [
        ...new Set([
            ...assignment.referenceAssetIds,
            ...assignment.sourceContextNodeIds.flatMap((nodeId) => assetIdByNodeId.get(nodeId) ?? []),
        ]),
    ]
}

// A generation that continues an existing Asset, or that references one, reuses
// the seed the referenced Asset was generated with so the new output stays close
// to it. The pending Asset already records the resolved parent and sources, so
// this walks that lineage rather than re-deriving node-to-Asset mappings.
//
// Order is parent first, then sources in the order the lineage recorded them,
// and the first Asset carrying a seed wins. A seed outside the target provider's
// accepted range is skipped, so a value inherited across providers can never be
// rejected by the request.
export const resolveInheritedGenerationSeed = async ({
    assetId,
    maxValue,
}: {
    assetId: string
    maxValue: number
}): Promise<number | undefined> => {
    const asset = await getAssetRecord(assetId)
    if (!asset?.lineage) return undefined
    const candidateAssetIds = [
        asset.lineage.parentAssetId,
        ...(asset.lineage.sourceAssetIds ?? []),
    ].filter((candidateId): candidateId is string => Boolean(candidateId))
    for (const candidateAssetId of candidateAssetIds) {
        const candidate = await getAssetRecord(candidateAssetId)
        const seed = candidate?.lineage?.generationSeed
        if (seed !== undefined && seed > 0 && seed <= maxValue) return seed
    }
    return undefined
}

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
        if (candidate.nodeId) assetIdByNodeId.set(candidate.nodeId, candidate.assetId)
    }
    for (const contextNode of workspaceContextSnapshot?.nodes ?? []) {
        if (contextNode.assetId) assetIdByNodeId.set(contextNode.nodeId, contextNode.assetId)
    }
    const regenerationSource = lineagePlan.regenerationTarget
    if (regenerationSource?.sourceMediaNodeId && regenerationSource.sourceMediaAssetId) {
        assetIdByNodeId.set(regenerationSource.sourceMediaNodeId, regenerationSource.sourceMediaAssetId)
    }

    await Promise.all(lineagePlan.runAssignments.map(async (assignment) => {
        const parentAssetId = assignment.parentMediaNodeId
            ? assetIdByNodeId.get(assignment.parentMediaNodeId)
            : undefined
        const sourceAssetIds = collectGeneratedAssetSourceIds(
            assignment,
            mediaBranchCandidateSnapshot,
            workspaceContextSnapshot,
        )
        const sourceAssets = (await Promise.all(sourceAssetIds.map(getAssetRecord)))
            .filter((asset): asset is Asset => Boolean(asset))
        const parentAsset = parentAssetId ? await getAssetRecord(parentAssetId) : undefined
        const subjectIdentity = deriveSubjectIdentityFromLineage(
            parentAsset ? [...sourceAssets, parentAsset] : sourceAssets,
            { generatedOutput: true },
        )
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
            if (
                !existing
                || existing.organizationId !== organizationId
                || existing.originWorkspaceId !== workspaceId
                || existing.ownerUserId !== ownerUserId
                || existing.lineage?.generationRequestId !== lineage.generationRequestId
                || existing.lineage?.reasoningRunId !== lineage.reasoningRunId
                || existing.lineage?.mediaRunId !== lineage.mediaRunId
            ) {
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
                subjectIdentity,
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
    width,
    height,
    generationSeed,
    posterBuffer,
    representativeFrameBuffer,
}: {
    generationRun: MediaGenerationRunMeta
    workspaceId: string
    buffer: Buffer
    originalName: string
    mimeType: string
    kind: 'image' | 'video'
    width?: number
    height?: number
    generationSeed?: number
    posterBuffer?: Buffer | null
    representativeFrameBuffer?: Buffer | null
}): Promise<{ assetId: string; organizationId: string; url: string }> => {
    const assetId = generationRun.lineageAssignment?.assetId
    if (!assetId) throw new Error('Generated media run is missing assetId')
    const asset = await getAssetRecord(assetId)
    if (!asset) throw new Error(`Pending Asset not found: ${assetId}`)
    const mediaPolicy = MEDIA_POLICY[mimeType]
    if (!mediaPolicy || mediaPolicy.kind !== kind) throw new Error(`GENERATED_ASSET_MEDIA_POLICY_MISMATCH:${mimeType}`)
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
    const supplementalInputs: Array<{
        name: Extract<AssetRenditionName, 'poster' | 'representativeFrame'>
        buffer: Buffer
    }> = [
        ...(posterBuffer?.length ? [{ name: 'poster' as const, buffer: posterBuffer }] : []),
        ...(representativeFrameBuffer?.length
            ? [{ name: 'representativeFrame' as const, buffer: representativeFrameBuffer }]
            : []),
    ]
    const supplementalBlobs = await Promise.all(supplementalInputs.map(async input => ({
        ...input,
        blob: await BlobModel.store({
            organizationId: asset.organizationId,
            bytes: input.buffer,
            mimeType: 'image/png',
            description: `generated-video-${input.name}.png`,
        }),
    })))
    const now = Date.now()
    const media: NonNullable<Asset['media']> = {
        kind,
        originalName,
        sourceMimeType: mimeType,
        modelSafe: mediaPolicy.modelSafe,
        ...(width && height ? { width, height, aspectRatio: width / height } : {}),
        renditions: {
            original: {
                name: 'original',
                status: 'ready',
                blobHash: blob.blobHash,
                mimeType,
                byteSize: buffer.byteLength,
                updatedAt: now,
            },
            ...Object.fromEntries(supplementalBlobs.map(input => [input.name, {
                name: input.name,
                status: 'ready' as const,
                blobHash: input.blob.blobHash,
                mimeType: 'image/png',
                byteSize: input.buffer.byteLength,
                updatedAt: now,
            }])),
        },
    }
    // The seed only exists once the provider has run, so it lands on the lineage
    // written when the pending Asset was created rather than at creation time.
    const lineage = generationSeed !== undefined && asset.lineage
        ? { ...asset.lineage, generationSeed }
        : asset.lineage
    const next: Asset = {
        ...asset,
        media,
        ...(lineage ? { lineage } : {}),
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
                ...supplementalBlobs.flatMap(input =>
                    buildBlobReferenceOperations({
                        blob: input.blob,
                        reference: {
                            blobKey: input.blob.blobKey,
                            blobHash: input.blob.blobHash,
                            organizationId: input.blob.organizationId,
                            referenceKey: `asset#${assetId}#rendition#${input.name}`,
                            ownerType: 'asset',
                            ownerId: assetId,
                            createdAt: now,
                        },
                        now,
                    })
                ),
                {
                    type: 'update',
                    tableName: getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE),
                    key: { assetId },
                    updates: {
                        media,
                        ...(lineage ? { lineage } : {}),
                        states: next.states,
                        revision: next.revision,
                        updatedAt: now,
                    },
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

export const settleGeneratedAssetComposition = async ({
    generationRun,
    composition: inputComposition,
}: {
    generationRun: MediaGenerationRunMeta
    composition: {
        kind: string
        capabilityId: string
        sourceAssetIds: string[]
        components: Array<{
            componentId: string
            role: string
            title: string
            imageBase64: string
            mimeType: 'image/png'
        }>
    }
}): Promise<AssetMediaComposition> => {
    const assetId = generationRun.lineageAssignment?.assetId
    if (!assetId) throw new Error('Generated media composition is missing assetId')
    if (!inputComposition.kind.trim() || !inputComposition.capabilityId.trim()) {
        throw new Error('GENERATED_MEDIA_COMPOSITION_IDENTITY_REQUIRED')
    }
    if (inputComposition.components.length === 0 || inputComposition.components.length > 32) {
        throw new Error('GENERATED_MEDIA_COMPOSITION_COMPONENT_COUNT_INVALID')
    }
    const componentIds = new Set<string>()
    for (const component of inputComposition.components) {
        if (
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(component.componentId)
            || componentIds.has(component.componentId)
            || !component.role.trim()
            || !component.title.trim()
            || component.mimeType !== 'image/png'
        ) {
            throw new Error('GENERATED_MEDIA_COMPOSITION_COMPONENT_INVALID')
        }
        componentIds.add(component.componentId)
    }

    const asset = await getAssetRecord(assetId)
    if (!asset) throw new Error(`Pending Asset not found: ${assetId}`)
    const storedComponents = await Promise.all(inputComposition.components.map(async component => {
        const bytes = decodeCapabilityImage(component.imageBase64)
        const blob = await BlobModel.store({
            organizationId: asset.organizationId,
            bytes,
            mimeType: component.mimeType,
            description: `${component.title} component for Asset ${assetId}`,
        })
        return {
            blob,
            component: {
                componentId: component.componentId,
                role: component.role.trim(),
                title: component.title.trim(),
                blobHash: blob.blobHash,
                mimeType: component.mimeType,
                byteSize: bytes.byteLength,
            },
        }
    }))
    const composition: AssetMediaComposition = {
        schemaVersion: 'asset-media-composition-v1',
        kind: inputComposition.kind.trim(),
        capabilityId: inputComposition.capabilityId.trim(),
        sourceAssetIds: [...new Set(inputComposition.sourceAssetIds)],
        components: storedComponents.map(entry => entry.component),
    }
    const assertMatchingComposition = (candidate: AssetMediaComposition | undefined): void => {
        if (!candidate || JSON.stringify(candidate) !== JSON.stringify(composition)) {
            throw new Error('GENERATED_MEDIA_COMPOSITION_CONFLICT')
        }
    }
    if (asset.composition) {
        assertMatchingComposition(asset.composition)
        return asset.composition
    }

    const now = Date.now()
    const next: Asset = {
        ...asset,
        composition,
        revision: asset.revision + 1,
        updatedAt: now,
    }
    assertAssetComponents(next)
    const additions = storedComponents.map(({ blob, component }) => ({
        blob,
        reference: {
            blobKey: blob.blobKey,
            blobHash: blob.blobHash,
            organizationId: blob.organizationId,
            referenceKey: `asset#${assetId}#composition#${component.componentId}`,
            ownerType: 'asset' as const,
            ownerId: assetId,
            createdAt: now,
        },
    }))
    try {
        await dynamoDBService.transactWrite({
            operations: [
                ...buildBlobReferenceBatchOperations({ additions, now }).operations,
                {
                    type: 'update',
                    tableName: getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE),
                    key: { assetId },
                    updates: { composition, revision: next.revision, updatedAt: now },
                    conditionExpression: '#revision = :expectedRevision AND attribute_not_exists(#composition)',
                    expressionAttributeNames: {
                        '#revision': 'revision',
                        '#composition': 'composition',
                    },
                    expressionAttributeValues: { ':expectedRevision': asset.revision },
                },
                ...await buildAssetProjectionOperations(next),
            ],
            logConditionalCheckFailures: false,
            origin: 'settleGeneratedAssetComposition',
        })
    } catch (error) {
        if (!isTransactionConditionalCheckFailure(error)) throw error
        const concurrent = await getAssetRecord(assetId)
        assertMatchingComposition(concurrent?.composition)
        return concurrent!.composition!
    }
    publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
    return composition
}

function decodeCapabilityImage(value: string): Buffer {
    const dataUrlMatch = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(value)
    const base64 = dataUrlMatch?.[1] ?? value
    if (!/^[A-Za-z0-9+/=\r\n]+$/u.test(base64)) {
        throw new Error('GENERATED_MEDIA_COMPOSITION_COMPONENT_ENCODING_INVALID')
    }
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length === 0) throw new Error('GENERATED_MEDIA_COMPOSITION_COMPONENT_EMPTY')
    return bytes
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
        const existingProjectedNode = workspace.canvasState.nodes.find(node => node.nodeId === projection.nodeId)
        if (
            asset.media?.renditions.original?.status !== 'ready'
            && existingProjectedNode
            && (existingProjectedNode.type === 'image' || existingProjectedNode.type === 'video')
            && existingProjectedNode.assetId === assetId
            && existingProjectedNode.mediaGenerationPhase === 'pending-before-first-frame'
            && existingProjectedNode.generatedBy?.generationRequestId === generationRun.generationRequestId
        ) {
            return buildAssetCanvasGeometryUpdate({
                state: workspace.canvasState,
                layoutRevision: persistedCanvasRevision,
                generationRequestId: generationRun.generationRequestId,
                geometryNodes: [],
            })
        }
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
                    adoptUnboundGeneratedMediaReservation: {
                        generationRequestId: generationRun.generationRequestId,
                        ...(generationRun.mediaRunId ? { mediaRunId: generationRun.mediaRunId } : {}),
                    },
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
            if (isRetryableCanvasAttachmentConflict(error)) continue
            throw error
        }
    }

    throw lastError ?? new Error(`Generated Asset canvas attach exhausted retries: ${assetId}`)
}

export const attachPlannedGeneratedAssetNodes = async ({
    lineagePlan,
    workspaceId,
    conversationAssetId,
}: {
    lineagePlan: MediaBranchLineagePlan
    workspaceId: string
    conversationAssetId: string
}): Promise<CanvasGeometryUpdate | null> => {
    let canvasGeometry: CanvasGeometryUpdate | null = null

    for (const assignment of lineagePlan.runAssignments) {
        if (
            !assignment.assetId
            || !assignment.mediaType
            || !assignment.reasoningRunId
            || !assignment.reasoningModelId
        ) continue
        const generationRun: MediaGenerationRunMeta = {
            requestKind: 'media-generation-matrix',
            generationRequestId: assignment.generationRequestId,
            reasoningRunId: assignment.reasoningRunId,
            reasoningModelId: assignment.reasoningModelId,
            reasoningIndex: assignment.reasoningIndex ?? 0,
            ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
            ...(assignment.mediaModelId ? { mediaModelId: assignment.mediaModelId } : {}),
            mediaType: assignment.mediaType,
            ...(typeof assignment.mediaIndex === 'number'
                ? {
                    mediaIndex: assignment.mediaIndex,
                    variantIndex: assignment.mediaIndex,
                }
                : {}),
            lineageAssignment: assignment,
        }
        const asset = await getAssetRecord(assignment.assetId)
        canvasGeometry = await attachGeneratedAssetNode({
            assetId: assignment.assetId,
            workspaceId,
            kind: assignment.mediaType,
            aspectRatio: asset?.media?.aspectRatio ?? 1,
            generationRun,
            conversationAssetId,
        })
    }

    return canvasGeometry
}
