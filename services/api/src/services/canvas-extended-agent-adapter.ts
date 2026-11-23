import {
    type Asset,
    type AssetRequesterContext,
    type AssetScope,
    type CanvasCollaborationLease,
    type CanvasState,
    type GeneratedOutputReviewRequest,
    type MediaGenerationRequest,
} from '@lixpi/constants'
import {
    type CanvasExtendedAccess,
    type CanvasExtendedSession,
} from '@lixpi/capability-system/backend'

import AssetModel from '../models/asset.ts'
import MediaGenerationRequestModel from '../models/media-generation-request.ts'
import { getAssetRequesterContext } from './asset-requester-context.ts'
import {
    isAssetAvailableInWorkspaceScope,
    scopeAssetRequesterToWorkspace,
} from './workspace-reference-scope.ts'
import { canvasCollaboration } from './canvas-collaboration.ts'
import { detachReviewedGeneratedOutputsFromCanvas } from './asset-canvas-projection.ts'
import GeneratedOutputReviewService from './generated-output-review-service.ts'
import { MediaGenerationRequestService } from './media-generation-request-service.ts'
import { AgentExecutionScope } from '../llm/agent/agent-execution-scope.ts'

type ReviewInput = Parameters<CanvasExtendedSession['reviewGeneratedOutput']>[0]

const ASSET_SCOPES: readonly AssetScope[] = [
    'workspace',
    'user',
    'organization',
]

const unwrap = <T>(result: T | { error: string }): T => {
    if (
        result
        && typeof result === 'object'
        && 'error' in result
    )
        throw new Error(
            String(result.error),
        )

    return result as T
}

const placesAsset = (
    state: CanvasState,
    assetId: string,
): boolean => state.nodes.some(node => 'assetId' in node && node.assetId === assetId)

// The package acquires leases, but the host still refuses a write whose
// lease set does not cover every canvas target it changes.
const requireLeases = (
    leases: readonly CanvasCollaborationLease[],
    targets: readonly string[],
): void => {
    if (targets.some(target => !leases.some(lease => lease.target === target)))
        throw new Error('CANVAS_LEASE_LOST')
}

const presentNodeTargets = (
    state: CanvasState,
    nodeIds: readonly string[],
): string[] => nodeIds.filter(nodeId => state.nodes.some(node => node.nodeId === nodeId)).map(nodeId => `node:${nodeId}`)

const reviewPlan = (
    state: CanvasState,
    review: ReviewInput,
) => {
    const prepared = detachReviewedGeneratedOutputsFromCanvas({
        canvasState: state,
        scope: review.scope,
        nodeId: review.nodeId,
    })

    return {
        nodeIds: [...new Set([
            ...prepared.affectedNodes.map(node => node.nodeId),
            ...prepared.affectedNodes.flatMap(node => node.generatedBy?.lineageParentNodeId ?? []),
            ...prepared.geometryNodes.map(node => node.nodeId),
            ...prepared.removedNodeIds,
        ])],
        edgeIds: [...prepared.removedEdgeIds],
        assetIds: [...new Set(
            prepared.affectedNodes.map(node => node.assetId),
        )],
    }
}

const reviewRequest = (
    workspaceId: string,
    review: ReviewInput,
): GeneratedOutputReviewRequest => {
    if (!['output-node', 'branch-lineage'].includes(review.scope))
        throw new Error('INVALID_REVIEW_SCOPE')

    if (review.action === 'supersede')
        return {
            workspaceId,
            scope: review.scope,
            action: 'supersede',
            nodeId: review.nodeId,
            preserveLineage: review.preserveLineage === true,
        } as GeneratedOutputReviewRequest

    if (!['accept', 'reject'].includes(review.action))
        throw new Error('INVALID_REVIEW_ACTION')

    return {
        workspaceId,
        scope: review.scope,
        action: review.action,
        nodeId: review.nodeId,
    }
}

const generationCanvasNodeIds = (request: MediaGenerationRequest): string[] => [
    ...request.plannedCanvasNodeIds,
    ...request.runs.flatMap(run => run.outputNodeId ? [run.operationNodeId, run.outputNodeId] : [run.operationNodeId]),
]

class CanvasExtendedAgentAdapter {
    private readonly reviews = new GeneratedOutputReviewService()
    private readonly generations = new MediaGenerationRequestService()

    readonly access: CanvasExtendedAccess = async context => {
        const execution = AgentExecutionScope.current()
        const { owner } = execution
        const {
            userId,
            workspaceId,
            organizationId,
            conversationAssetId,
        } = owner.job

        if (
            context.origin !== 'model'
            || context.userId !== userId
            || context.workspaceId !== workspaceId
            || context.organizationId !== organizationId
            || context.conversationAssetId !== conversationAssetId
        )
            throw new Error('AGENT_CANVAS_SCOPE_DENIED')

        const scope = {
            workspaceId,
            organizationId,
        }
        // The base canvas adapter joins this collaboration actor for the
        // conversation owner before any extended tool runs. Its leases are
        // verified against the same derived actor identity.
        const actor = {
            workspaceId,
            userId,
            sessionId: owner.ownerId,
            name: 'Canvas agent',
        }
        const assertCurrent = async () => {
            owner.abort.signal.throwIfAborted()
            await execution.assertContextCurrent?.()

            return await owner.fences(execution.continuationEpoch)
        }
        const requester = async (): Promise<AssetRequesterContext> => {
            const result = scopeAssetRequesterToWorkspace(await getAssetRequesterContext(userId), scope)

            if (
                !result.editableWorkspaceIds.includes(workspaceId)
                || !result.organizationIds.includes(organizationId)
            )
                throw new Error('WORKSPACE_ACCESS_DENIED')

            return result
        }
        const canvas = async (): Promise<CanvasState> => {
            await assertCurrent()
            const snapshot = await canvasCollaboration.syncAgentCanvas(actor)

            if (!snapshot.canvasState)
                throw new Error('CANVAS_STATE_UNAVAILABLE')

            return snapshot.canvasState
        }
        const withLeases = async <T>(
            leases: CanvasCollaborationLease[],
            work: () => Promise<T>,
        ): Promise<T> =>
            await canvasCollaboration.withAgentLeases(
                actor,
                leases,
                async () => {
                    await assertCurrent()

                    return await work()
                },
                assertCurrent,
            )
        // An unplaced Asset must already be admitted to the turn, exactly as
        // when the base adapter places one on the canvas.
        const readAsset = async (assetId: string): Promise<Asset> => {
            if (!placesAsset(await canvas(), assetId))
                await AgentExecutionScope.assertReadTargets([assetId])

            const asset = unwrap(await AssetModel.get({
                assetId,
                requester: await requester(),
                origin: 'CanvasExtendedAgentAdapter.readAsset',
            }))

            if (!isAssetAvailableInWorkspaceScope(asset, scope))
                throw new Error('NOT_FOUND')

            return asset
        }
        const readGeneration = async (generationRequestId: string): Promise<MediaGenerationRequest> => {
            await assertCurrent()
            const request = unwrap(
                await MediaGenerationRequestModel.getAuthorized({
                    generationRequestId,
                    workspaceId,
                    userId,
                    requiredAccess: 'read',
                }),
            )

            if (
                request.workspaceId !== workspaceId
                || request.organizationId !== organizationId
            )
                throw new Error('NOT_FOUND')

            return request
        }

        return {
            readAsset,
            updateAssetMetadata: async (
                assetId,
                patch,
                expectedRevision,
                lease,
            ) => {
                requireLeases([lease], [`asset:${assetId}`])
                await readAsset(assetId)

                return await withLeases(
                    [lease],
                    async () => unwrap(
                        await AssetModel.updateMetadata({
                            assetId,
                            requester: await requester(),
                            expectedRevision,
                            ...(patch.title === undefined ? {} : { title: patch.title }),
                            ...(patch.depictionMedium === undefined ? {} : { depictionMedium: patch.depictionMedium }),
                        }),
                    ),
                )
            },
            removeLibraryEntry: async (
                assetId,
                expectedRevision,
                lease,
            ) => {
                requireLeases([lease], [`asset:${assetId}`])
                await readAsset(assetId)

                return await withLeases(
                    [lease],
                    async () => unwrap(await AssetModel.detachCatalogReference({
                        assetId,
                        requester: await requester(),
                        expectedRevision,
                    })),
                )
            },
            changeAssetScope: async (
                assetId,
                assetScope,
                expectedRevision,
                lease,
            ) => {
                if (!ASSET_SCOPES.includes(assetScope))
                    throw new Error('INVALID_SCOPE')

                requireLeases([lease], [`asset:${assetId}`])
                await readAsset(assetId)
                // The owner of the new scope always comes from the
                // execution, never from model input.
                const scopeOwnerId = assetScope === 'workspace'
                    ? workspaceId
                    : assetScope === 'user'
                        ? userId
                        : organizationId

                return await withLeases(
                    [lease],
                    async () => unwrap(
                        await AssetModel.changeScope({
                            assetId,
                            requester: await requester(),
                            expectedRevision,
                            scope: assetScope,
                            scopeOwnerId,
                        }),
                    ),
                )
            },
            planGeneratedOutputReview: async review => reviewPlan(await canvas(), review),
            reviewGeneratedOutput: async (review, leases) => {
                const request = reviewRequest(workspaceId, review)
                const state = await canvas()
                const plan = reviewPlan(state, review)
                requireLeases(
                    leases,
                    [
                        ...presentNodeTargets(
                            state,
                            [
                                review.nodeId,
                                ...plan.nodeIds,
                            ],
                        ),
                        ...plan.assetIds.map(assetId => `asset:${assetId}`),
                    ],
                )

                return await withLeases(
                    leases,
                    async () => unwrap(await this.reviews.review({
                        request,
                        requester: await requester(),
                    })),
                )
            },
            readGeneration,
            cancelGeneration: async (
                generationRequestId,
                expectedRevision,
                leases,
            ) => {
                const request = await readGeneration(generationRequestId)
                requireLeases(
                    leases,
                    presentNodeTargets(
                        await canvas(),
                        generationCanvasNodeIds(request),
                    ),
                )

                return await withLeases(
                    leases,
                    async () => await this.generations.cancel({
                        generationRequestId,
                        workspaceId,
                        userId,
                        requestRevision: expectedRevision,
                    }),
                )
            },
        }
    }
}

export const createCanvasExtendedAccess = (): CanvasExtendedAccess => new CanvasExtendedAgentAdapter().access
