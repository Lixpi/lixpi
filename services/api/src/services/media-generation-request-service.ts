'use strict'

import { v4 as uuid } from 'uuid'

import type {
    AiModelId,
    MediaGenerationRequest,
    MediaGenerationRequestEvent,
    MediaGenerationRequestStatus,
    MediaGenerationRun,
    MediaReferenceBinding,
    UnresolvedReferenceBinding,
    MediaGenerationProblem,
    MediaBranchLineagePlan,
    MediaGenerationRunProgress,
    OperationProgressItem,
} from '@lixpi/constants'
import { getMediaGenerationOperationNodeId } from '@lixpi/canvas-engine'
import { createDefaultMediaGenerationRunProgress } from '@lixpi/constants'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'

import BlobModel from '../models/blob.ts'
import AssetModel from '../models/asset.ts'
import MediaGenerationRequestModel from '../models/media-generation-request.ts'
import type { AssetRequesterContext } from '@lixpi/constants'
import { createMediaReferenceBindings } from '../llm/media-reference/media-reference-compiler.ts'
import { getContentAddressedBlob } from './blob-storage.ts'
import { MediaGenerationRequestEventLog } from './media-generation-request-event-log.ts'
import {
    projectMediaGenerationOperationNodes,
    rebindMediaGenerationOperationNodes,
    removeMediaGenerationOperationNode,
    removeMediaGenerationOperationNodes,
    updateMediaGenerationOperationNode,
} from './media-generation-operation-projection.ts'

export const MEDIA_GENERATION_CHECKPOINT_SCHEMA_VERSION = 'media-generation-checkpoint-v1'
const checkpointReferenceKey = (generationRequestId: string): string =>
    `mediaGenerationRequest#${generationRequestId}#checkpoint`

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

const mediaProgressPhaseOrder: MediaGenerationRunProgress['phase'][] = [
    'preparing',
    'rendering',
    'assessing',
    'composing',
]

const mediaProgressItemStatusRank: Record<OperationProgressItem['status'], number> = {
    pending: 0,
    running: 1,
    completed: 2,
    failed: 2,
    cancelled: 2,
    skipped: 2,
}

function mergeMediaProgressItem(
    current: OperationProgressItem,
    incoming: OperationProgressItem,
): OperationProgressItem {
    const currentRank = mediaProgressItemStatusRank[current.status]
    const incomingRank = mediaProgressItemStatusRank[incoming.status]
    const keepCurrentStatus = currentRank > incomingRank
        || (currentRank === incomingRank && currentRank === 2 && current.status !== incoming.status)
    const currentChildrenById = new Map((current.children ?? []).map(child => [child.id, child]))
    const incomingChildIds = new Set((incoming.children ?? []).map(child => child.id))
    const children = [
        ...(incoming.children ?? []).map(child => {
            const currentChild = currentChildrenById.get(child.id)
            return currentChild ? mergeMediaProgressItem(currentChild, child) : child
        }),
        ...(current.children ?? []).filter(child => !incomingChildIds.has(child.id)),
    ]
    const selected = keepCurrentStatus ? current : incoming

    return {
        ...selected,
        status: keepCurrentStatus ? current.status : incoming.status,
        ...(children.length > 0 ? { children } : {}),
    }
}

function mergeMediaProgressItems(
    current: OperationProgressItem[] | undefined,
    incoming: OperationProgressItem[] | undefined,
): OperationProgressItem[] | undefined {
    if (!current?.length) return incoming
    if (!incoming?.length) return current
    const currentById = new Map(current.map(item => [item.id, item]))
    const incomingIds = new Set(incoming.map(item => item.id))
    return [
        ...incoming.map(item => {
            const currentItem = currentById.get(item.id)
            return currentItem ? mergeMediaProgressItem(currentItem, item) : item
        }),
        ...current.filter(item => !incomingIds.has(item.id)),
    ]
}

function mergeMediaGenerationRunProgress(
    current: MediaGenerationRunProgress | undefined,
    incoming: MediaGenerationRunProgress,
): MediaGenerationRunProgress {
    if (!current) return incoming
    const currentPhaseIndex = mediaProgressPhaseOrder.indexOf(current.phase)
    const incomingPhaseIndex = mediaProgressPhaseOrder.indexOf(incoming.phase)
    if (incomingPhaseIndex < currentPhaseIndex) return current
    if (incomingPhaseIndex === currentPhaseIndex && incoming.completedSteps < current.completedSteps) return current
    if (incomingPhaseIndex > currentPhaseIndex || incoming.completedSteps > current.completedSteps) return incoming

    const items = mergeMediaProgressItems(current.items, incoming.items)
    return {
        ...incoming,
        ...(items ? { items } : {}),
    }
}

const createDurableRunsFromLineagePlan = (lineagePlan: MediaBranchLineagePlan): MediaGenerationRun[] => {
    if (lineagePlan.runAssignments.length === 0) {
        throw new Error('MEDIA_REQUEST_LINEAGE_ASSIGNMENTS_EMPTY')
    }

    return lineagePlan.runAssignments.map((assignment, generationRun) => {
        if (!assignment.reasoningModelId
            || assignment.reasoningIndex === undefined
            || !assignment.mediaModelId) {
            throw new Error(`MEDIA_REQUEST_LINEAGE_ASSIGNMENT_INCOMPLETE:${generationRun}`)
        }
        const [provider] = assignment.mediaModelId.split(':')
        if (!provider) throw new Error(`MEDIA_REQUEST_LINEAGE_ASSIGNMENT_PROVIDER_MISSING:${generationRun}`)

        return {
            generationRun,
            reasoningModelId: assignment.reasoningModelId,
            reasoningIndex: assignment.reasoningIndex,
            provider: provider as MediaGenerationRun['provider'],
            modelId: assignment.mediaModelId,
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
            plannedCanvasNodeIds: runs.map(run => run.operationNodeId),
            revision: 1,
            createdAt: now,
            updatedAt: now,
            statusUpdatedAt: now,
        }
        let requestCreated = false
        try {
            await MediaGenerationRequestModel.create(request)
            requestCreated = true
            await projectMediaGenerationOperationNodes({ workspaceId, generationRequestId, runs, bindings })
            if (unresolvedBindings.length > 0 && runs[0]) {
                const unresolved = unresolvedBindings[0]!
                await updateMediaGenerationOperationNode({
                    workspaceId,
                    operationNodeId: runs[0].operationNodeId,
                    status: 'action-required',
                    message: 'Choose which attached Asset the prompt refers to.',
                    candidateAssetIds: [...new Set(unresolvedBindings.flatMap(binding => binding.candidates.map(candidate => candidate.assetId)))],
                    unresolvedBindingId: unresolved.bindingId,
                    requestRevision: request.revision,
                })
            }
            await this.events().append({
                userId,
                workspaceId,
                event: eventFor(
                    request,
                    unresolvedBindings.length > 0 ? 'MEDIA_GENERATION_ACTION_REQUIRED' : 'MEDIA_GENERATION_REQUEST_STATUS',
                    { status },
                ),
            })
            return request
        } catch (error) {
            if (requestCreated) {
                await Promise.allSettled([
                    removeMediaGenerationOperationNodes({ workspaceId, generationRequestId }),
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
                    candidate.reasoningIndex === run.reasoningIndex
                    && candidate.mediaModelId === run.modelId
                ))
                if (!assignment) throw new Error(`MEDIA_REQUEST_LINEAGE_ASSIGNMENT_NOT_FOUND:${run.generationRun}`)
                return [run.generationRun, assignment]
            }))
            const bindings = runs.map(run => ({
                previousNodeId: run.operationNodeId,
                operationNodeId: getMediaGenerationOperationNodeId(assignmentByRun.get(run.generationRun)!),
                lineageParentNodeId: assignmentByRun.get(run.generationRun)!.lineageParentNodeId
                    ?? assignmentByRun.get(run.generationRun)!.branchLineNodeId
                    ?? assignmentByRun.get(run.generationRun)!.branchForkNodeId
                    ?? assignmentByRun.get(run.generationRun)!.branchOriginNodeId
                    ?? assignmentByRun.get(run.generationRun)!.parentMediaNodeId
                    ?? '',
                run: {
                    ...run,
                    operationNodeId: getMediaGenerationOperationNodeId(assignmentByRun.get(run.generationRun)!),
                },
            }))
            const alreadyBound = !runsWereDeferred
                && bindings.every(binding => binding.previousNodeId === binding.operationNodeId)
            const next = alreadyBound ? request : {
                ...request,
                runs: bindings.map(binding => binding.run),
                plannedCanvasNodeIds: bindings.map(binding => binding.operationNodeId),
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
        const refreshedByAssetId = new Map(createMediaReferenceBindings({
            assets: currentAssets,
            selectedNodeIds: Object.fromEntries(authorized.bindings.flatMap(binding =>
                binding.nodeId ? [[binding.assetId, binding.nodeId]] : [])),
        }).map(binding => [binding.assetId, binding]))
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
                    forbiddenNameVariants: [...new Set([
                        ...binding.forbiddenNameVariants,
                        ...refreshed.forbiddenNameVariants,
                    ])],
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
        const operationNode = next.runs[0]
        if (operationNode) {
            const pending = remaining[0]
            await updateMediaGenerationOperationNode({
                workspaceId,
                operationNodeId: operationNode.operationNodeId,
                status: pending ? 'action-required' : 'in-progress',
                message: pending
                    ? 'Choose which attached Asset the prompt refers to.'
                    : 'Resuming the media request.',
                ...(pending ? {
                    candidateAssetIds: pending.candidates.map(candidate => candidate.assetId),
                    unresolvedBindingId: pending.bindingId,
                } : {}),
                requestRevision: next.revision,
                clearAction: !pending,
            })
        }
        await this.events().append({
            userId,
            workspaceId,
            event: eventFor(next, remaining.length > 0 ? 'MEDIA_GENERATION_ACTION_REQUIRED' : 'MEDIA_GENERATION_REQUEST_STATUS', {
                status: next.status,
                bindingId,
                assetId,
            }),
        })
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
        if (authorized.revision !== requestRevision) throw new Error('STALE_MEDIA_REQUEST_REVISION')
        if (['completed', 'cancelled'].includes(authorized.status)) throw new Error('MEDIA_REQUEST_ALREADY_TERMINAL')
        const now = Date.now()
        const next: MediaGenerationRequest = {
            ...authorized,
            status: 'cancelled',
            runs: authorized.runs.map(run => ['completed', 'failed', 'cancelled'].includes(run.status)
                ? run
                : { ...run, status: 'cancelled' }),
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
        })
        await this.releaseCheckpoint(next)
        return next
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
        const run = request.runs.find(candidate =>
            candidate.modelId === mediaModelId && candidate.reasoningIndex === reasoningIndex)
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
            runs: request.runs.map(candidate => candidate.generationRun === run.generationRun ? {
                ...candidate,
                status: 'awaiting-provider-verification',
                requiredVerificationAssetIds: [...new Set(assetIds)],
                problem,
            } : candidate),
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

    async recordRunStatus({
        generationRequestId,
        workspaceId,
        mediaModelId,
        reasoningIndex,
        status,
        problem,
    }: {
        generationRequestId: string
        workspaceId: string
        mediaModelId: AiModelId
        reasoningIndex: number
        status: 'running' | 'completed' | 'failed'
        problem?: MediaGenerationProblem
    }): Promise<MediaGenerationRequest> {
        for (let attempt = 0; attempt < 8; attempt++) {
            const request = await MediaGenerationRequestModel.get({ generationRequestId, workspaceId })
            if (!request) throw new Error('MEDIA_REQUEST_NOT_FOUND')
            const run = request.runs.find(candidate =>
                candidate.modelId === mediaModelId && candidate.reasoningIndex === reasoningIndex)
            if (!run) throw new Error('MEDIA_REQUEST_RUN_NOT_FOUND')
            if (run.status === status) {
                await this.reconcileRunProjection({ request, run })
                return request
            }
            if (['completed', 'failed', 'cancelled'].includes(run.status)) return request
            const now = Date.now()
            const runs = request.runs.map(candidate => candidate.generationRun === run.generationRun ? {
                ...candidate,
                status,
                ...(status === 'running' ? { startedAt: candidate.startedAt ?? now } : { completedAt: now }),
                ...(problem ? { problem: { ...problem, generationRun: candidate.generationRun } } : {}),
            } : candidate)
            const allTerminal = runs.every(candidate => ['completed', 'failed', 'cancelled'].includes(candidate.status))
            const completedCount = runs.filter(candidate => candidate.status === 'completed').length
            const failedCount = runs.filter(candidate => candidate.status === 'failed').length
            const hasActionRequired = runs.some(candidate => candidate.status === 'awaiting-provider-verification')
            const requestStatus: MediaGenerationRequestStatus = allTerminal
                ? failedCount === 0
                    ? 'completed'
                    : completedCount > 0 ? 'completed-with-errors' : 'failed'
                : hasActionRequired ? 'action-required' : 'running'
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
        progress,
    }: {
        generationRequestId: string
        workspaceId: string
        mediaModelId: AiModelId
        reasoningIndex: number
        progress: MediaGenerationRunProgress
    }): Promise<MediaGenerationRequest> {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const request = await MediaGenerationRequestModel.get({ generationRequestId, workspaceId })
            if (!request) throw new Error('MEDIA_REQUEST_NOT_FOUND')
            const run = request.runs.find(candidate =>
                candidate.modelId === mediaModelId && candidate.reasoningIndex === reasoningIndex)
            if (!run) throw new Error('MEDIA_REQUEST_RUN_NOT_FOUND')
            if (['completed', 'failed', 'cancelled'].includes(run.status)) return request
            const nextProgress = mergeMediaGenerationRunProgress(run.progress, progress)
            if (nextProgress === run.progress) return request
            const now = Date.now()
            const runs = request.runs.map(candidate => candidate.generationRun === run.generationRun
                ? { ...candidate, progress: nextProgress }
                : candidate)
            const next: MediaGenerationRequest = {
                ...request,
                status: request.status === 'submitted' ? 'running' : request.status,
                runs,
                revision: request.revision + 1,
                updatedAt: now,
                statusUpdatedAt: request.status === 'submitted' ? now : request.statusUpdatedAt,
            }
            try {
                await MediaGenerationRequestModel.transition({ request: next, expectedRevision: request.revision })
            } catch (error) {
                if (isTransactionConditionalCheckFailure(error) && attempt < 7) continue
                throw error
            }
            await updateMediaGenerationOperationNode({
                workspaceId,
                operationNodeId: run.operationNodeId,
                status: 'in-progress',
                message: nextProgress.message,
                progress: nextProgress,
                requestRevision: next.revision,
            })
            await this.events().append({
                userId: request.userId,
                workspaceId,
                event: eventFor(next, 'MEDIA_GENERATION_PROGRESS', {
                    status: next.status,
                    runStatus: run.status,
                    generationRun: run.generationRun,
                    progress: nextProgress,
                    message: nextProgress.message,
                }),
            })
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
        if (run.status === 'completed') {
            await removeMediaGenerationOperationNode({
                workspaceId: request.workspaceId,
                operationNodeId: run.operationNodeId,
            })
        } else {
            const message = run.status === 'running'
                ? run.progress?.message ?? 'The provider is generating media.'
                : problem?.detail ?? 'Generation failed.'
            await updateMediaGenerationOperationNode({
                workspaceId: request.workspaceId,
                operationNodeId: run.operationNodeId,
                status: run.status === 'failed' ? 'failed' : 'in-progress',
                message,
                progress: run.progress ?? createDefaultMediaGenerationRunProgress(run.status, message),
                ...(problem ? { problem } : {}),
                requestRevision: request.revision,
            })
        }
        await this.events().append({
            userId: request.userId,
            workspaceId: request.workspaceId,
            event: eventFor(request, problem ? 'MEDIA_GENERATION_PROBLEM' : 'MEDIA_GENERATION_REQUEST_STATUS', {
                status: request.status,
                runStatus: run.status,
                generationRun: run.generationRun,
                ...(problem ? { problem } : {}),
            }),
        })
        if (request.status === 'completed') await this.releaseCheckpoint(request)
    }

    async cleanupWorkspace(workspaceId: string): Promise<number> {
        const metas = await MediaGenerationRequestModel.listWorkspace(workspaceId)
        const requests = (await Promise.all(metas.map(meta => MediaGenerationRequestModel.get({
            generationRequestId: meta.generationRequestId,
            workspaceId,
        })))).filter((request): request is MediaGenerationRequest => Boolean(request))
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
