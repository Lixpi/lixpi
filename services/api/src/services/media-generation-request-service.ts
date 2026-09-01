import { v4 as uuid } from 'uuid'

import {
    createDefaultMediaGenerationRunProgress,
    mergeMediaGenerationRunProgress,
    settleMediaGenerationRunProgress,
    type AiModelId,
    type AssetRequesterContext,
    type CanvasGeometryUpdate,
    type MediaGenerationRequest,
    type MediaGenerationRequestEvent,
    type MediaGenerationRequestStatus,
    type MediaGenerationRun,
    type MediaReferenceBinding,
    type UnresolvedReferenceBinding,
    type MediaGenerationProblem,
    type MediaBranchLineagePlan,
    type MediaGenerationRunProgress,
} from '@lixpi/constants'
import {
    getMediaGenerationOperationNodeId,
    getPendingGeneratedMediaNodeId,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { warn } from '@lixpi/debug-tools'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'

import BlobModel from '../models/blob.ts'
import AssetModel from '../models/asset.ts'
import MediaGenerationRequestModel from '../models/media-generation-request.ts'
import { createMediaReferenceBindings } from '../llm/media-reference/media-reference-compiler.ts'
import { enqueueAssetSurfaceCleanup } from './asset-maintenance-queue.ts'
import { getContentAddressedBlob } from './blob-storage.ts'
import { MediaGenerationRequestEventLog } from './media-generation-request-event-log.ts'
import {
    settleFailedGeneratedMediaRunOnCanvas,
    upsertMediaLineagePlanToCanvas,
} from './asset-canvas-projection.ts'
import {
    projectMediaGenerationOperationNodes,
    rebindMediaGenerationOperationNodes,
    removeMediaGenerationOperationNode,
    removeMediaGenerationOperationNodes,
    updateMediaGenerationOperationNode,
} from './media-generation-operation-projection.ts'

export const MEDIA_GENERATION_CHECKPOINT_SCHEMA_VERSION = 'media-generation-checkpoint-v1'
const checkpointReferenceKey = (generationRequestId: string): string => `mediaGenerationRequest#${generationRequestId}#checkpoint`

const getLineageMarkerNodeIds = (lineagePlan: MediaBranchLineagePlan | undefined): string[] =>
    lineagePlan
        ? [
            lineagePlan.branchOrigin?.nodeId,
            ...lineagePlan.branchForks.map(marker => marker.nodeId),
            ...lineagePlan.branchLines.map(marker => marker.nodeId),
        ].filter((nodeId): nodeId is string => Boolean(nodeId))
        : []

const mergeCanvasGeometryUpdates = (
    generationRequestId: string,
    updates: Array<CanvasGeometryUpdate | null | undefined>,
): CanvasGeometryUpdate => {
    const available = updates.filter((update): update is CanvasGeometryUpdate => Boolean(update))
    const byNodeId = new Map(available.flatMap(update => update.nodes).map(node => [node.nodeId, node]))
    const snapshotsByNodeId = new Map(
        available
            .flatMap(update => update.nodeSnapshots ?? [])
            .map(node => [node.nodeId, node]),
    )
    const edgesById = new Map(
        available
            .flatMap(update => update.edgeSnapshots ?? [])
            .map(edge => [edge.edgeId, edge]),
    )
    return {
        generationRequestId,
        layoutRevision: Math.max(...available.map(update => update.layoutRevision)),
        nodes: [...byNodeId.values()],
        ...(snapshotsByNodeId.size ? { nodeSnapshots: [...snapshotsByNodeId.values()] } : {}),
        ...(edgesById.size ? { edgeSnapshots: [...edgesById.values()] } : {}),
        ...(available.some(update => update.removedNodeIds?.length)
            ? {
                removedNodeIds: [...new Set(available.flatMap(update => update.removedNodeIds ?? []))],
            }
            : {}),
        ...(available.some(update => update.removedEdgeIds?.length)
            ? {
                removedEdgeIds: [...new Set(available.flatMap(update => update.removedEdgeIds ?? []))],
            }
            : {}),
    }
}

export type MediaGenerationCheckpoint = {
    schemaVersion: typeof MEDIA_GENERATION_CHECKPOINT_SCHEMA_VERSION
    promptDocument: unknown
    selectedReferences: Array<{ assetId: string; nodeId?: string }>
    modelSelection: unknown
    configuration: unknown
    createdAt: number
}

const CHECKPOINT_FORBIDDEN_KEYS = new Set([
    'accesstoken',
    'apikey',
    'authorization',
    'bytedtoken',
    'cookie',
    'providersessiontoken',
    'resulttoken',
    'secret',
    'statetoken',
    'token',
])

export const assertSafeMediaGenerationCheckpoint = (value: unknown, path = '$'): void => {
    if (typeof value === 'string') {
        if (/^data:[^,]*;base64,/iu.test(value)) throw new Error(`MEDIA_REQUEST_CHECKPOINT_MEDIA_BYTES_FORBIDDEN:${path}`)
        return
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        throw new Error(`MEDIA_REQUEST_CHECKPOINT_BINARY_FORBIDDEN:${path}`)
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertSafeMediaGenerationCheckpoint(item, `${path}[${index}]`))
        return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
        const normalizedKey = key.normalize('NFKC').replace(/[^a-z0-9]/giu, '').toLocaleLowerCase('en-US')
        if (CHECKPOINT_FORBIDDEN_KEYS.has(normalizedKey)) {
            throw new Error(`MEDIA_REQUEST_CHECKPOINT_SECRET_FORBIDDEN:${path}.${key}`)
        }
        assertSafeMediaGenerationCheckpoint(item, `${path}.${key}`)
    }
}

const eventFor = (request: MediaGenerationRequest, status: MediaGenerationRequestEvent['status'], payload: Record<string, unknown>): MediaGenerationRequestEvent => ({
    eventId: uuid(),
    generationRequestId: request.generationRequestId,
    sequence: request.revision,
    status,
    requestRevision: request.revision,
    payload,
    createdAt: request.updatedAt,
})

const isMediaGenerationRequestTerminal = (status: MediaGenerationRequestStatus): boolean => (
    status === 'completed'
    || status === 'completed-with-errors'
    || status === 'failed'
    || status === 'cancelled'
)

const isJetStreamExpectationFailure = (error: unknown): boolean => {
    const candidate = error as { code?: unknown; message?: unknown }
    return candidate.code === 10071
        || /expected.*sequence|wrong last sequence|last subject sequence/iu.test(String(candidate.message ?? ''))
}

const getReferenceResolutionAction = (
    unresolvedBindings: readonly UnresolvedReferenceBinding[],
): { bindingId: string; candidateAssetIds: string[] } | undefined => {
    const unresolved = unresolvedBindings[0]
    if (!unresolved) return undefined
    return {
        bindingId: unresolved.bindingId,
        candidateAssetIds: [...new Set(unresolved.candidates.map(candidate => candidate.assetId))],
    }
}

function deriveRequestStatus(runs: readonly MediaGenerationRun[]): MediaGenerationRequestStatus {
    const allTerminal = runs.every(run => ['completed', 'failed', 'cancelled'].includes(run.status))
    const completedCount = runs.filter(run => run.status === 'completed').length
    const failedCount = runs.filter(run => run.status === 'failed').length
    const hasActionRequired = runs.some(run => run.status === 'awaiting-provider-verification')
    return allTerminal
        ? failedCount === 0
            ? 'completed'
            : completedCount > 0
            ? 'completed-with-errors'
            : 'failed'
        : hasActionRequired
        ? 'action-required'
        : 'running'
}

const createDurableRunsFromLineagePlan = (lineagePlan: MediaBranchLineagePlan): MediaGenerationRun[] => {
    if (lineagePlan.runAssignments.length === 0) {
        throw new Error('MEDIA_REQUEST_LINEAGE_ASSIGNMENTS_EMPTY')
    }

    return lineagePlan.runAssignments.map((assignment, generationRun) => {
        if (
            !assignment.reasoningModelId
            || assignment.reasoningIndex === undefined
            || !assignment.mediaModelId
        ) {
            throw new Error(`MEDIA_REQUEST_LINEAGE_ASSIGNMENT_INCOMPLETE:${generationRun}`)
        }
        const [provider] = assignment.mediaModelId.split(':')
        if (!provider) throw new Error(`MEDIA_REQUEST_LINEAGE_ASSIGNMENT_PROVIDER_MISSING:${generationRun}`)

        return {
            generationRun,
            reasoningModelId: assignment.reasoningModelId,
            reasoningIndex: assignment.reasoningIndex,
            ...(assignment.reasoningRunId ? { reasoningRunId: assignment.reasoningRunId } : {}),
            provider: provider as MediaGenerationRun['provider'],
            modelId: assignment.mediaModelId,
            ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
            ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
            ...(assignment.mediaIndex === undefined ? {} : { mediaIndex: assignment.mediaIndex }),
            outputAssetId: assignment.assetId,
            outputNodeId: getPendingGeneratedMediaNodeId(assignment),
            status: 'pending',
            operationNodeId: getMediaGenerationOperationNodeId(assignment),
        }
    })
}

export class MediaGenerationRequestService {
    constructor(private readonly eventLog?: MediaGenerationRequestEventLog) {}

    private events(): MediaGenerationRequestEventLog {
        return this.eventLog ?? MediaGenerationRequestEventLog.fromSingleton()
    }

    private async getStreamedRunProgress(
        request: Pick<MediaGenerationRequest, 'workspaceId' | 'generationRequestId'>,
        generationRun: number,
    ): Promise<{ progress?: MediaGenerationRunProgress; streamSequence: number }> {
        const envelope = await this.events().getLatestRunProgress({
            workspaceId: request.workspaceId,
            generationRequestId: request.generationRequestId,
            generationRun,
        })
        const progress = envelope?.event.payload.progress
        return {
            ...(progress && typeof progress === 'object'
                ? { progress: progress as MediaGenerationRunProgress }
                : {}),
            streamSequence: envelope?.streamSequence ?? 0,
        }
    }

    async create({
        generationRequestId = uuid(),
        workspaceId,
        organizationId,
        userId,
        conversationAssetId,
        checkpoint,
        bindings,
        unresolvedBindings,
        runs,
        initialLineagePlan,
        canvasVisibleArea,
        onCanvasGeometryProjected,
    }: {
        generationRequestId?: string
        workspaceId: string
        organizationId: string
        userId: string
        conversationAssetId: string
        checkpoint: Omit<MediaGenerationCheckpoint, 'schemaVersion' | 'createdAt'>
        bindings: MediaReferenceBinding[]
        unresolvedBindings: UnresolvedReferenceBinding[]
        runs: MediaGenerationRun[]
        initialLineagePlan?: MediaBranchLineagePlan
        canvasVisibleArea?: { width: number; height: number }
        onCanvasGeometryProjected?: (canvasGeometry: CanvasGeometryUpdate) => void | Promise<void>
    }): Promise<MediaGenerationRequest> {
        const now = Date.now()
        const checkpointDocument: MediaGenerationCheckpoint = {
            ...checkpoint,
            schemaVersion: MEDIA_GENERATION_CHECKPOINT_SCHEMA_VERSION,
            createdAt: now,
        }
        assertSafeMediaGenerationCheckpoint(checkpointDocument)
        const blob = await BlobModel.store({
            organizationId,
            bytes: new TextEncoder().encode(JSON.stringify(checkpointDocument)),
            mimeType: 'application/json',
            description: `Media generation request ${generationRequestId} checkpoint`,
        })
        await BlobModel.addReference({
            organizationId,
            blobHash: blob.blobHash,
            referenceKey: checkpointReferenceKey(generationRequestId),
            ownerType: 'mediaGenerationRequest',
            ownerId: generationRequestId,
        })
        const status: MediaGenerationRequestStatus = unresolvedBindings.length > 0
            ? 'awaiting-reference-resolution'
            : 'submitted'
        const request: MediaGenerationRequest = {
            generationRequestId,
            workspaceId,
            organizationId,
            userId,
            conversationAssetId,
            status,
            checkpointBlobHash: blob.blobHash,
            checkpointSchemaVersion: MEDIA_GENERATION_CHECKPOINT_SCHEMA_VERSION,
            bindings,
            unresolvedBindings,
            resolvedReferences: [],
            runs,
            plannedCanvasNodeIds: runs.flatMap(run =>
                [
                    run.operationNodeId,
                    run.outputNodeId,
                ].filter((nodeId): nodeId is string => Boolean(nodeId))
            ).concat(
                getLineageMarkerNodeIds(initialLineagePlan),
            ),
            revision: 1,
            createdAt: now,
            updatedAt: now,
            statusUpdatedAt: now,
        }
        const referenceAction = getReferenceResolutionAction(unresolvedBindings)
        let requestCreated = false
        try {
            await MediaGenerationRequestModel.create(request)
            requestCreated = true
            const mediaCanvasGeometry = await projectMediaGenerationOperationNodes({
                workspaceId,
                generationRequestId,
                runs,
                bindings,
                ...(initialLineagePlan ? { lineagePlan: initialLineagePlan } : {}),
                ...(canvasVisibleArea ? { visibleArea: canvasVisibleArea } : {}),
            })
            const lineageCanvasGeometry = initialLineagePlan
                ? await upsertMediaLineagePlanToCanvas({
                    workspaceId,
                    conversationAssetId,
                    lineagePlan: initialLineagePlan,
                    ...(canvasVisibleArea ? { canvasVisibleArea } : {}),
                })
                : undefined
            const canvasGeometry = mergeCanvasGeometryUpdates(generationRequestId, [
                mediaCanvasGeometry,
                lineageCanvasGeometry,
            ])
            await onCanvasGeometryProjected?.(canvasGeometry)
            if (referenceAction && runs[0]) {
                await updateMediaGenerationOperationNode({
                    workspaceId,
                    operationNodeId: runs[0].operationNodeId,
                    status: 'action-required',
                    message: 'Choose which attached Asset the prompt refers to.',
                    candidateAssetIds: referenceAction.candidateAssetIds,
                    unresolvedBindingId: referenceAction.bindingId,
                    requestRevision: request.revision,
                })
            }
            await this.events().append({
                userId,
                workspaceId,
                event: eventFor(
                    request,
                    unresolvedBindings.length > 0 ? 'MEDIA_GENERATION_ACTION_REQUIRED' : 'MEDIA_GENERATION_REQUEST_STATUS',
                    { status, ...referenceAction },
                ),
            })
            return request
        } catch (error) {
            if (requestCreated) {
                await Promise.allSettled([
                    removeMediaGenerationOperationNodes({
                        workspaceId,
                        generationRequestId,
                        discardUnboundOutputNodes: true,
                    }),
                    MediaGenerationRequestModel.delete(request),
                    this.events().purgeRequest({ workspaceId, generationRequestId }),
                ])
            }
            await BlobModel.removeReference({
                organizationId,
                blobHash: blob.blobHash,
                referenceKey: checkpointReferenceKey(generationRequestId),
            }).catch(() => undefined)
            throw error
        }
    }

    async getCheckpoint(request: MediaGenerationRequest): Promise<MediaGenerationCheckpoint> {
        const bytes = await getContentAddressedBlob({
            organizationId: request.organizationId,
            blobHash: request.checkpointBlobHash,
        })
        const checkpoint = JSON.parse(new TextDecoder().decode(bytes)) as MediaGenerationCheckpoint
        if (checkpoint.schemaVersion !== MEDIA_GENERATION_CHECKPOINT_SCHEMA_VERSION) throw new Error('MEDIA_REQUEST_CHECKPOINT_SCHEMA_UNSUPPORTED')
        return checkpoint
    }

    async bindRunsToLineagePlan({
        generationRequestId,
        workspaceId,
        lineagePlan,
    }: {
        generationRequestId: string
        workspaceId: string
        lineagePlan: MediaBranchLineagePlan
    }): Promise<MediaGenerationRequest> {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const request = await MediaGenerationRequestModel.get({ generationRequestId, workspaceId })
            if (!request) throw new Error('MEDIA_REQUEST_NOT_FOUND')
            const runsWereDeferred = request.runs.length === 0
            const runs = runsWereDeferred
                ? createDurableRunsFromLineagePlan(lineagePlan)
                : request.runs
            const assignmentByRun = new Map(runs.map(run => {
                const assignment = lineagePlan.runAssignments.find(candidate => (
                    Boolean(run.mediaRunId && candidate.mediaRunId === run.mediaRunId)
                    || (candidate.reasoningIndex === run.reasoningIndex
                        && candidate.mediaModelId === run.modelId
                        && (run.mediaType === undefined || candidate.mediaType === run.mediaType)
                        && (run.mediaIndex === undefined || candidate.mediaIndex === run.mediaIndex))
                ))
                if (!assignment) throw new Error(`MEDIA_REQUEST_LINEAGE_ASSIGNMENT_NOT_FOUND:${run.generationRun}`)
                return [run.generationRun, assignment]
            }))
            const bindings = runs.map(run => {
                const assignment = assignmentByRun.get(run.generationRun)!
                return {
                    previousNodeId: run.operationNodeId,
                    previousOutputNodeId: run.outputNodeId,
                    operationNodeId: getMediaGenerationOperationNodeId(assignment),
                    lineageParentNodeId: assignment.lineageParentNodeId,
                    lineageAssignment: assignment,
                    run: {
                        ...run,
                        ...(assignment.reasoningRunId ? { reasoningRunId: assignment.reasoningRunId } : {}),
                        ...(assignment.mediaRunId ? { mediaRunId: assignment.mediaRunId } : {}),
                        ...(assignment.mediaType ? { mediaType: assignment.mediaType } : {}),
                        ...(assignment.mediaIndex === undefined ? {} : { mediaIndex: assignment.mediaIndex }),
                        outputAssetId: assignment.assetId,
                        outputNodeId: getPendingGeneratedMediaNodeId(assignment),
                        operationNodeId: getMediaGenerationOperationNodeId(assignment),
                    },
                }
            })
            const alreadyBound = !runsWereDeferred
                && bindings.every(binding => (
                    binding.previousNodeId === binding.operationNodeId
                    && binding.previousOutputNodeId === binding.run.outputNodeId
                    && binding.run.outputAssetId !== undefined
                    && binding.run.mediaRunId !== undefined
                ))
            const next = alreadyBound ? request : {
                ...request,
                runs: bindings.map(binding => binding.run),
                plannedCanvasNodeIds: bindings.flatMap(binding =>
                    [
                        binding.operationNodeId,
                        binding.run.outputNodeId,
                    ].filter((nodeId): nodeId is string => Boolean(nodeId))
                ).concat(
                    getLineageMarkerNodeIds(lineagePlan),
                ),
                revision: request.revision + 1,
                updatedAt: Date.now(),
            }
            if (!alreadyBound) {
                try {
                    await MediaGenerationRequestModel.transition({ request: next, expectedRevision: request.revision })
                } catch (error) {
                    if (isTransactionConditionalCheckFailure(error) && attempt < 7) continue
                    throw error
                }
            }
            await rebindMediaGenerationOperationNodes({
                workspaceId,
                generationRequestId,
                requestRevision: next.revision,
                bindings,
            })
            return next
        }
        throw new Error('MEDIA_REQUEST_CAS_RETRY_EXHAUSTED')
    }

    async resolveReference({ generationRequestId, workspaceId, userId, requestRevision, bindingId, assetId, requester }: {
        generationRequestId: string
        workspaceId: string
        userId: string
        requestRevision: number
        bindingId: string
        assetId: string
        requester: AssetRequesterContext
    }): Promise<MediaGenerationRequest> {
        const authorized = await MediaGenerationRequestModel.getAuthorized({ generationRequestId, workspaceId, userId })
        if ('error' in authorized) throw new Error(authorized.error)
        if (authorized.revision !== requestRevision) throw new Error('STALE_MEDIA_REQUEST_REVISION')
        if (authorized.status !== 'awaiting-reference-resolution') throw new Error('MEDIA_REQUEST_NOT_AWAITING_REFERENCE')
        const unresolved = authorized.unresolvedBindings.find(candidate => candidate.bindingId === bindingId)
        if (!unresolved || !unresolved.candidates.some(candidate => candidate.assetId === assetId)) {
            throw new Error('MEDIA_REFERENCE_CANDIDATE_NOT_AUTHORIZED')
        }
        const previousBinding = authorized.bindings.find(binding => binding.assetId === assetId)
        if (!previousBinding) throw new Error('MEDIA_REFERENCE_CANDIDATE_NOT_BOUND')
        const currentAssets = await Promise.all(authorized.bindings.map(async binding => {
            const current = await AssetModel.get({ assetId: binding.assetId, requester })
            if ('error' in current) throw new Error('MEDIA_REFERENCE_CANDIDATE_NOT_AUTHORIZED')
            return current
        }))
        const refreshedByAssetId = new Map(
            createMediaReferenceBindings({
                assets: currentAssets,
                selectedNodeIds: Object.fromEntries(authorized.bindings.flatMap(binding => binding.nodeId ? [[binding.assetId, binding.nodeId]] : [])),
            }).map(binding => [binding.assetId, binding]),
        )
        const remaining = authorized.unresolvedBindings.filter(candidate => candidate.bindingId !== bindingId)
        const now = Date.now()
        const next: MediaGenerationRequest = {
            ...authorized,
            bindings: authorized.bindings.map(binding => {
                const refreshed = refreshedByAssetId.get(binding.assetId)!
                return {
                    ...refreshed,
                    alias: binding.alias,
                    displayNameSnapshot: binding.displayNameSnapshot,
                    forbiddenNameVariants: [
                        ...new Set([
                            ...binding.forbiddenNameVariants,
                            ...refreshed.forbiddenNameVariants,
                        ]),
                    ],
                }
            }),
            unresolvedBindings: remaining,
            resolvedReferences: [
                ...authorized.resolvedReferences,
                {
                    bindingId,
                    originalText: unresolved.originalText,
                    assetId,
                    resolvedByUserId: userId,
                    resolvedAt: now,
                },
            ],
            status: remaining.length > 0 ? 'awaiting-reference-resolution' : 'submitted',
            revision: authorized.revision + 1,
            updatedAt: now,
            statusUpdatedAt: now,
        }
        await MediaGenerationRequestModel.transition({ request: next, expectedRevision: authorized.revision })
        const pendingAction = getReferenceResolutionAction(remaining)
        const operationNode = next.runs[0]
        if (operationNode) {
            await updateMediaGenerationOperationNode({
                workspaceId,
                operationNodeId: operationNode.operationNodeId,
                status: pendingAction ? 'action-required' : 'in-progress',
                message: pendingAction
                    ? 'Choose which attached Asset the prompt refers to.'
                    : 'Resuming the media request.',
                ...(pendingAction
                    ? {
                        candidateAssetIds: pendingAction.candidateAssetIds,
                        unresolvedBindingId: pendingAction.bindingId,
                    }
                    : {}),
                requestRevision: next.revision,
                clearAction: !pendingAction,
            })
        }
        await this.events().append({
            userId,
            workspaceId,
            event: eventFor(next, remaining.length > 0 ? 'MEDIA_GENERATION_ACTION_REQUIRED' : 'MEDIA_GENERATION_REQUEST_STATUS', {
                status: next.status,
                ...pendingAction,
                resolvedBindingId: bindingId,
                resolvedAssetId: assetId,
            }),
        })
        return next
    }

    private async cancelAuthorizedRequest(authorized: MediaGenerationRequest): Promise<MediaGenerationRequest> {
        const { generationRequestId, workspaceId, userId } = authorized
        if (['completed', 'completed-with-errors', 'failed', 'cancelled'].includes(authorized.status)) {
            await removeMediaGenerationOperationNodes({
                workspaceId,
                generationRequestId,
                terminalStatus: authorized.status === 'cancelled' ? 'cancelled' : 'completed',
                discardUnboundOutputNodes: true,
            })
            return authorized
        }
        const cancelledRuns = authorized.runs.filter(run => (
            !['completed', 'failed', 'cancelled'].includes(run.status)
        ))
        const streamedProgressByRun = new Map(
            await Promise.all(cancelledRuns.map(async run => {
                const streamed = await this.getStreamedRunProgress(authorized, run.generationRun)
                return [run.generationRun, streamed.progress] as const
            })),
        )
        const now = Date.now()
        const next: MediaGenerationRequest = {
            ...authorized,
            status: 'cancelled',
            runs: authorized.runs.map(run =>
                ['completed', 'failed', 'cancelled'].includes(run.status)
                    ? run
                    : {
                        ...run,
                        status: 'cancelled',
                        completedAt: now,
                        progress: settleMediaGenerationRunProgress(
                            streamedProgressByRun.get(run.generationRun) ?? run.progress,
                            'cancelled',
                            streamedProgressByRun.get(run.generationRun)?.message
                                ?? run.progress?.message
                                ?? 'Media generation cancelled.',
                        ),
                    }
            ),
            revision: authorized.revision + 1,
            updatedAt: now,
            statusUpdatedAt: now,
        }
        await MediaGenerationRequestModel.transition({ request: next, expectedRevision: authorized.revision })
        await this.events().append({ userId, workspaceId, event: eventFor(next, 'MEDIA_GENERATION_REQUEST_STATUS', { status: 'cancelled' }) })
        await removeMediaGenerationOperationNodes({
            workspaceId,
            generationRequestId,
            terminalStatus: 'cancelled',
            discardUnboundOutputNodes: true,
        })
        await Promise.all(cancelledRuns.map(async run => {
            if (!run.outputAssetId || !run.mediaRunId) return
            const surfaceId = `conversation#${authorized.conversationAssetId}#media#${run.mediaRunId}`
            try {
                await AssetModel.removeAssetSurfaceReferenceSystem({
                    assetId: run.outputAssetId,
                    organizationId: authorized.organizationId,
                    surfaceId,
                })
            } catch {
                await enqueueAssetSurfaceCleanup({
                    assetId: run.outputAssetId,
                    organizationId: authorized.organizationId,
                    surfaceId,
                })
            }
        }))
        await this.releaseCheckpoint(next)
        return next
    }

    async cancel({ generationRequestId, workspaceId, userId, requestRevision }: {
        generationRequestId: string
        workspaceId: string
        userId: string
        requestRevision: number
    }): Promise<MediaGenerationRequest> {
        const authorized = await MediaGenerationRequestModel.getAuthorized({ generationRequestId, workspaceId, userId })
        if ('error' in authorized) throw new Error(authorized.error)
        if (
            !['completed', 'completed-with-errors', 'failed', 'cancelled'].includes(authorized.status)
            && authorized.revision !== requestRevision
        ) {
            throw new Error('STALE_MEDIA_REQUEST_REVISION')
        }
        return await this.cancelAuthorizedRequest(authorized)
    }

    async cancelCurrent({ generationRequestId, workspaceId, userId }: {
        generationRequestId: string
        workspaceId: string
        userId: string
    }): Promise<MediaGenerationRequest> {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const authorized = await MediaGenerationRequestModel.getAuthorized({ generationRequestId, workspaceId, userId })
            if ('error' in authorized) throw new Error(authorized.error)
            try {
                return await this.cancelAuthorizedRequest(authorized)
            } catch (error) {
                if (isTransactionConditionalCheckFailure(error) && attempt < 7) continue
                throw error
            }
        }
        throw new Error('MEDIA_REQUEST_CAS_RETRY_EXHAUSTED')
    }

    async pauseForBranchResolution({ request, candidateAssetIds, userId }: {
        request: MediaGenerationRequest
        candidateAssetIds: string[]
        userId: string
    }): Promise<MediaGenerationRequest> {
        const candidates = [...new Set(candidateAssetIds)]
            .filter(assetId => request.bindings.some(binding => binding.assetId === assetId))
            .map(assetId => ({ assetId, score: 1, previewRenditionName: 'thumbnail' }))
        if (candidates.length < 2) throw new Error('MEDIA_BRANCH_AMBIGUITY_CANDIDATES_INVALID')
        const now = Date.now()
        const unresolved: UnresolvedReferenceBinding = {
            bindingId: `branch-target-${uuid()}`,
            promptRange: { from: 0, to: 0 },
            originalText: '',
            matcherVersion: 'media-branch-resolver-v1',
            candidates,
        }
        const next: MediaGenerationRequest = {
            ...request,
            status: 'awaiting-reference-resolution',
            unresolvedBindings: [unresolved],
            revision: request.revision + 1,
            updatedAt: now,
            statusUpdatedAt: now,
        }
        await MediaGenerationRequestModel.transition({ request: next, expectedRevision: request.revision })
        const operationNode = request.runs[0]
        if (operationNode) {
            await updateMediaGenerationOperationNode({
                workspaceId: request.workspaceId,
                operationNodeId: operationNode.operationNodeId,
                status: 'action-required',
                message: 'Choose the attached Asset that should continue as the target branch.',
                candidateAssetIds: candidates.map(candidate => candidate.assetId),
                unresolvedBindingId: unresolved.bindingId,
                requestRevision: next.revision,
            })
        }
        await this.events().append({
            userId,
            workspaceId: request.workspaceId,
            event: eventFor(next, 'MEDIA_GENERATION_ACTION_REQUIRED', {
                status: next.status,
                bindingId: unresolved.bindingId,
                candidateAssetIds: candidates.map(candidate => candidate.assetId),
            }),
        })
        return next
    }

    async requireProviderVerification({
        generationRequestId,
        workspaceId,
        mediaModelId,
        reasoningIndex,
        assetIds,
    }: {
        generationRequestId: string
        workspaceId: string
        mediaModelId: AiModelId
        reasoningIndex: number
        assetIds: string[]
    }): Promise<MediaGenerationRequest> {
        const request = await MediaGenerationRequestModel.get({ generationRequestId, workspaceId })
        if (!request) throw new Error('MEDIA_REQUEST_NOT_FOUND')
        const run = request.runs.find(candidate => candidate.modelId === mediaModelId && candidate.reasoningIndex === reasoningIndex)
        if (!run) throw new Error('MEDIA_REQUEST_RUN_NOT_FOUND')
        const now = Date.now()
        const problem: MediaGenerationProblem = {
            problemVersion: '1',
            type: 'urn:lixpi:media-problem:provider-verification-required',
            title: 'Provider identity verification required',
            detail: 'Complete the provider-hosted verification before this generation can continue.',
            category: 'provider-verification-required',
            stage: 'preflight',
            generationRequestId,
            generationRun: run.generationRun,
            provider: run.provider,
            modelId: run.modelId,
            supportCode: uuid(),
            action: 'verify-with-provider',
        }
        const next: MediaGenerationRequest = {
            ...request,
            status: 'action-required',
            runs: request.runs.map(candidate =>
                candidate.generationRun === run.generationRun
                    ? {
                        ...candidate,
                        status: 'awaiting-provider-verification',
                        requiredVerificationAssetIds: [...new Set(assetIds)],
                        problem,
                    }
                    : candidate
            ),
            revision: request.revision + 1,
            updatedAt: now,
            statusUpdatedAt: now,
        }
        await MediaGenerationRequestModel.transition({ request: next, expectedRevision: request.revision })
        await updateMediaGenerationOperationNode({
            workspaceId,
            operationNodeId: run.operationNodeId,
            status: 'action-required',
            message: problem.detail,
            problem,
            requestRevision: next.revision,
            verificationAssetId: assetIds[0],
        })
        await this.events().append({
            userId: request.userId,
            workspaceId,
            event: eventFor(next, 'MEDIA_GENERATION_ACTION_REQUIRED', {
                status: next.status,
                problem,
                generationRun: run.generationRun,
                assetIds,
            }),
        })
        return next
    }

    async releaseCheckpoint(request: MediaGenerationRequest): Promise<void> {
        if (!['completed', 'cancelled'].includes(request.status)) throw new Error('MEDIA_REQUEST_CHECKPOINT_RETENTION_REQUIRED')
        await BlobModel.removeReference({
            organizationId: request.organizationId,
            blobHash: request.checkpointBlobHash,
            referenceKey: checkpointReferenceKey(request.generationRequestId),
        })
        await this.events().purgeRequest({
            workspaceId: request.workspaceId,
            generationRequestId: request.generationRequestId,
        })
    }

    async failUnfinishedRuns({
        generationRequestId,
        workspaceId,
        detail,
    }: {
        generationRequestId: string
        workspaceId: string
        detail?: string
    }): Promise<MediaGenerationRequest | undefined> {
        const initialRequest = await MediaGenerationRequestModel.get({ generationRequestId, workspaceId })
        if (!initialRequest) return undefined
        if (['awaiting-reference-resolution', 'action-required', 'cancelled'].includes(initialRequest.status)) {
            return initialRequest
        }
        const unfinishedRunIds = initialRequest.runs
            .filter(run => run.status === 'pending' || run.status === 'running')
            .map(run => run.generationRun)
        let latestRequest = initialRequest

        for (const generationRun of unfinishedRunIds) {
            for (let attempt = 0; attempt < 8; attempt += 1) {
                const request = await MediaGenerationRequestModel.get({ generationRequestId, workspaceId })
                if (!request) return undefined
                if (['awaiting-reference-resolution', 'action-required', 'cancelled'].includes(request.status)) {
                    return request
                }
                const targetRun = request.runs.find(run => run.generationRun === generationRun)
                if (!targetRun || (targetRun.status !== 'pending' && targetRun.status !== 'running')) {
                    latestRequest = request
                    break
                }

                const now = Date.now()
                const problemDetail = detail ?? (targetRun.status === 'pending'
                    ? 'The reasoning model did not produce the required media invocation, so this planned media run did not start.'
                    : 'The generation workflow ended before this provider run reached a terminal result.')
                const problem: MediaGenerationProblem = {
                    problemVersion: '1',
                    type: targetRun.status === 'pending'
                        ? 'urn:lixpi:media-problem:media-invocation-missing'
                        : 'urn:lixpi:media-problem:media-run-unsettled',
                    title: targetRun.status === 'pending'
                        ? 'Media generation did not start'
                        : 'Media generation did not complete',
                    detail: problemDetail,
                    category: targetRun.status === 'pending' ? 'provider-output' : 'internal',
                    stage: targetRun.status === 'pending' ? 'preflight' : 'submit',
                    generationRequestId,
                    generationRun,
                    supportCode: uuid(),
                    action: 'none',
                }
                const streamed = await this.getStreamedRunProgress(request, generationRun)
                const accumulatedProgress = streamed.progress
                    ? mergeMediaGenerationRunProgress(targetRun.progress, streamed.progress)
                    : targetRun.progress
                const runs = request.runs.map(run =>
                    run.generationRun === generationRun
                        ? {
                            ...run,
                            status: 'failed' as const,
                            problem,
                            completedAt: now,
                            progress: settleMediaGenerationRunProgress(accumulatedProgress, 'failed', problemDetail),
                        }
                        : run
                )
                const status = deriveRequestStatus(runs)
                const next: MediaGenerationRequest = {
                    ...request,
                    status,
                    runs,
                    revision: request.revision + 1,
                    updatedAt: now,
                    statusUpdatedAt: request.status === status ? request.statusUpdatedAt : now,
                }
                try {
                    await MediaGenerationRequestModel.transition({ request: next, expectedRevision: request.revision })
                } catch (error) {
                    if (isTransactionConditionalCheckFailure(error) && attempt < 7) continue
                    throw error
                }
                await this.reconcileRunProjection({
                    request: next,
                    run: runs.find(run => run.generationRun === generationRun)!,
                })
                latestRequest = next
                break
            }
        }
        return latestRequest
    }

    async recordRunStatus({
        generationRequestId,
        workspaceId,
        mediaModelId,
        reasoningIndex,
        mediaRunId,
        status,
        problem,
    }: {
        generationRequestId: string
        workspaceId: string
        mediaModelId: AiModelId
        reasoningIndex: number
        mediaRunId?: string
        status: 'running' | 'completed' | 'failed'
        problem?: MediaGenerationProblem
    }): Promise<MediaGenerationRequest> {
        for (let attempt = 0; attempt < 8; attempt++) {
            const request = await MediaGenerationRequestModel.get({ generationRequestId, workspaceId })
            if (!request) throw new Error('MEDIA_REQUEST_NOT_FOUND')
            if (request.status === 'cancelled') return request
            const run = request.runs.find(candidate => (
                Boolean(mediaRunId && candidate.mediaRunId === mediaRunId)
                || (!mediaRunId
                    && candidate.modelId === mediaModelId
                    && candidate.reasoningIndex === reasoningIndex)
            ))
            if (!run) throw new Error('MEDIA_REQUEST_RUN_NOT_FOUND')
            if (run.status === status) {
                await this.reconcileRunProjection({ request, run })
                return request
            }
            const repairsSyntheticUnsettledFailure = status === 'completed'
                && run.status === 'failed'
                && run.problem?.type === 'urn:lixpi:media-problem:media-run-unsettled'
            if (
                ['completed', 'failed', 'cancelled'].includes(run.status)
                && !repairsSyntheticUnsettledFailure
            ) return request
            const streamed = status === 'running'
                ? { progress: undefined, streamSequence: 0 }
                : await this.getStreamedRunProgress(request, run.generationRun)
            const now = Date.now()
            const runs = request.runs.map(candidate => {
                if (candidate.generationRun !== run.generationRun) return candidate
                const accumulatedProgress = streamed.progress
                    ? mergeMediaGenerationRunProgress(candidate.progress, streamed.progress)
                    : candidate.progress
                const statusMessage = status === 'completed'
                    ? accumulatedProgress?.message ?? 'Media generation completed.'
                    : problem?.detail ?? accumulatedProgress?.message ?? 'Media generation failed.'
                const nextRun: MediaGenerationRun = {
                    ...candidate,
                    status,
                    ...(status === 'running'
                        ? { startedAt: candidate.startedAt ?? now }
                        : {
                            completedAt: now,
                            progress: settleMediaGenerationRunProgress(accumulatedProgress, status, statusMessage),
                        }),
                    ...(problem ? { problem: { ...problem, generationRun: candidate.generationRun } } : {}),
                }
                if (status === 'completed') delete nextRun.problem
                return nextRun
            })
            const requestStatus = deriveRequestStatus(runs)
            const next: MediaGenerationRequest = {
                ...request,
                status: requestStatus,
                runs,
                revision: request.revision + 1,
                updatedAt: now,
                statusUpdatedAt: request.status === requestStatus ? request.statusUpdatedAt : now,
            }
            try {
                await MediaGenerationRequestModel.transition({ request: next, expectedRevision: request.revision })
            } catch (error) {
                if (isTransactionConditionalCheckFailure(error) && attempt < 7) continue
                throw error
            }
            await this.reconcileRunProjection({
                request: next,
                run: runs.find(candidate => candidate.generationRun === run.generationRun)!,
            })
            return next
        }
        throw new Error('MEDIA_REQUEST_CAS_RETRY_EXHAUSTED')
    }

    async recordRunProgress({
        generationRequestId,
        workspaceId,
        mediaModelId,
        reasoningIndex,
        mediaRunId,
        progress,
    }: {
        generationRequestId: string
        workspaceId: string
        mediaModelId: AiModelId
        reasoningIndex: number
        mediaRunId?: string
        progress: MediaGenerationRunProgress
    }): Promise<MediaGenerationRequest> {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const request = await MediaGenerationRequestModel.get({ generationRequestId, workspaceId })
            if (!request) throw new Error('MEDIA_REQUEST_NOT_FOUND')
            if (request.status === 'cancelled') return request
            const run = request.runs.find(candidate => (
                Boolean(mediaRunId && candidate.mediaRunId === mediaRunId)
                || (!mediaRunId
                    && candidate.modelId === mediaModelId
                    && candidate.reasoningIndex === reasoningIndex)
            ))
            if (!run) throw new Error('MEDIA_REQUEST_RUN_NOT_FOUND')
            if (['completed', 'failed', 'cancelled'].includes(run.status)) return request
            const streamed = await this.getStreamedRunProgress(request, run.generationRun)
            const currentProgress = streamed.progress
                ? mergeMediaGenerationRunProgress(run.progress, streamed.progress)
                : run.progress
            const nextProgress = mergeMediaGenerationRunProgress(currentProgress, progress)
            const now = Date.now()
            const runs = request.runs.map(candidate =>
                candidate.generationRun === run.generationRun
                    ? { ...candidate, progress: nextProgress }
                    : candidate
            )
            const next: MediaGenerationRequest = {
                ...request,
                status: request.status === 'submitted' ? 'running' : request.status,
                runs,
                revision: request.revision,
                updatedAt: now,
                statusUpdatedAt: request.status === 'submitted' ? now : request.statusUpdatedAt,
            }
            try {
                await this.events().append({
                    userId: request.userId,
                    workspaceId,
                    event: eventFor(next, 'MEDIA_GENERATION_PROGRESS', {
                        status: next.status,
                        runStatus: run.status,
                        generationRun: run.generationRun,
                        ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
                        ...(run.outputNodeId ? { outputNodeId: run.outputNodeId } : {}),
                        progress: nextProgress,
                        message: nextProgress.message,
                    }),
                    expectedLastSubjectSequence: streamed.streamSequence,
                })
            } catch (error) {
                if (isJetStreamExpectationFailure(error) && attempt < 7) continue
                throw error
            }
            return next
        }
        throw new Error('MEDIA_REQUEST_CAS_RETRY_EXHAUSTED')
    }

    private async reconcileRunProjection({
        request,
        run,
    }: {
        request: MediaGenerationRequest
        run: MediaGenerationRun
    }): Promise<void> {
        const problem = run.problem
        const message = run.status === 'running'
            ? run.progress?.message ?? 'The provider is generating media.'
            : problem?.detail ?? 'Generation failed.'
        const projection = run.status === 'completed'
            ? removeMediaGenerationOperationNode({
                workspaceId: request.workspaceId,
                operationNodeId: run.operationNodeId,
                generationRequestId: request.generationRequestId,
                generationRun: run.generationRun,
                progress: run.progress,
            })
            : run.status === 'failed' && run.outputNodeId && run.outputAssetId
            ? settleFailedGeneratedMediaRunOnCanvas({
                workspaceId: request.workspaceId,
                generationRun: {
                    requestKind: 'media-generation-matrix',
                    generationRequestId: request.generationRequestId,
                    reasoningRunId: run.reasoningRunId
                        ?? `${request.generationRequestId}:reasoning:${run.reasoningIndex}`,
                    ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
                    reasoningModelId: run.reasoningModelId,
                    mediaModelId: run.modelId,
                    ...(run.mediaType ? { mediaType: run.mediaType } : {}),
                    reasoningIndex: run.reasoningIndex,
                    ...(run.mediaIndex === undefined ? {} : { mediaIndex: run.mediaIndex }),
                    variantIndex: run.generationRun,
                },
                outputNodeId: run.outputNodeId,
                assetId: run.outputAssetId,
                errorMessage: message,
                ...(problem ? { problem } : {}),
                ...(run.progress ? { progress: run.progress } : {}),
                requestRevision: request.revision,
            })
            : updateMediaGenerationOperationNode({
                workspaceId: request.workspaceId,
                operationNodeId: run.operationNodeId,
                generationRequestId: request.generationRequestId,
                generationRun: run.generationRun,
                status: run.status === 'failed' ? 'failed' : 'in-progress',
                message,
                progress: run.progress ?? createDefaultMediaGenerationRunProgress(run.status, message),
                ...(problem ? { problem } : {}),
                requestRevision: request.revision,
            })
        const event = this.events().append({
            userId: request.userId,
            workspaceId: request.workspaceId,
            event: eventFor(request, problem ? 'MEDIA_GENERATION_PROBLEM' : 'MEDIA_GENERATION_REQUEST_STATUS', {
                status: request.status,
                runStatus: run.status,
                generationRun: run.generationRun,
                ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
                ...(run.outputNodeId ? { outputNodeId: run.outputNodeId } : {}),
                ...(run.progress
                    ? {
                        progress: run.progress,
                        message: run.progress.message,
                    }
                    : {}),
                ...(problem ? { problem } : {}),
            }),
        })
        const [projectionResult, eventResult] = await Promise.allSettled([projection, event])
        if (projectionResult.status === 'rejected') {
            warn(`[MediaGenerationRequest] status projection failed: ${String(projectionResult.reason)}`)
        }
        if (eventResult.status === 'rejected') {
            warn(`[MediaGenerationRequest] status event failed: ${String(eventResult.reason)}`)
        }
        if (request.status === 'completed' || request.status === 'cancelled') {
            await this.releaseCheckpoint(request)
        } else if (isMediaGenerationRequestTerminal(request.status)) {
            await this.events().purgeRequest({
                workspaceId: request.workspaceId,
                generationRequestId: request.generationRequestId,
            })
        }
    }

    async cleanupWorkspace(workspaceId: string): Promise<number> {
        const metas = await MediaGenerationRequestModel.listWorkspace(workspaceId)
        const requests = (await Promise.all(metas.map(meta =>
            MediaGenerationRequestModel.get({
                generationRequestId: meta.generationRequestId,
                workspaceId,
            })
        ))).filter((request): request is MediaGenerationRequest => Boolean(request))
        for (const request of requests) {
            await BlobModel.removeReference({
                organizationId: request.organizationId,
                blobHash: request.checkpointBlobHash,
                referenceKey: checkpointReferenceKey(request.generationRequestId),
            })
            await this.events().purgeRequest({ workspaceId, generationRequestId: request.generationRequestId })
        }
        await MediaGenerationRequestModel.deleteWorkspace(workspaceId)
        return requests.length
    }
}
