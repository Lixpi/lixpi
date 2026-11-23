import { createHash } from 'node:crypto'
import {
    type AiInteractionMediaGenerationRequest,
    type AiModelId,
    type Asset,
    type CanvasNode,
    type ImageCanvasNode,
    type ImageGenerationSize,
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    canvasRegenerationNodes,
    type CanvasGenerationRecoveryAccess,
    type CapabilityActionAuthorizationContext,
    type MediaPipelineRegenerationAdmission,
} from '@lixpi/capability-system/backend'
import AssetModel from '../models/asset.ts'
import MediaGenerationRequestModel from '../models/media-generation-request.ts'
import { AgentToolInvocation } from '../llm/agent/agent-tool-invocation.ts'
import { AgentExecutionScope } from '../llm/agent/agent-execution-scope.ts'
import { canvasCollaboration } from '../services/canvas-collaboration.ts'
import { scopeAssetRequesterToWorkspace } from '../services/workspace-reference-scope.ts'
import { getAssetRequesterContext } from '../services/asset-requester-context.ts'
import { MediaGenerationRequestService } from '../services/media-generation-request-service.ts'
import AssetDocumentService from '../services/asset-document-service.ts'
import {
    findSealedMediaReplayTrace,
    resumeAiInteractionMediaGenerationRequest,
    startAiInteractionCanvasRegeneration,
} from '../NATS/subscriptions/ai-interaction-subjects.ts'

type MediaNode = ImageCanvasNode | VideoCanvasNode

const isMedia = (node: CanvasNode): node is MediaNode => node.type === 'image' || node.type === 'video'
const isBranch = (node: CanvasNode) => node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const readReplayPrompt = async (
    asset: Asset,
    node: MediaNode,
) => {
    const reasoningModelId = asset.lineage?.reasoningModelId
    const mediaModelId = asset.lineage?.mediaModelId
    const provenance = await AssetDocumentService.loadCurrentSnapshot(asset, 'provenance')

    if (
        !provenance
        || asset.states.provenance !== 'sealed'
        || !reasoningModelId
        || !mediaModelId
    )
        throw new Error('CANVAS_REGENERATION_PROVENANCE_UNAVAILABLE')

    const trace = findSealedMediaReplayTrace(
        provenance.doc,
        {
            reasoningRunId: asset.lineage?.reasoningRunId,
            mediaRunId: asset.lineage?.mediaRunId,
            reasoningModelId,
            mediaModelId,
            mediaType: node.type,
        },
    )

    if (!trace)
        throw new Error('CANVAS_REGENERATION_PROVENANCE_UNAVAILABLE')

    return {
        sourceAssetId: asset.assetId,
        reasoningModelId: reasoningModelId as AiModelId,
        mediaModelId: mediaModelId as AiModelId,
        mediaType: node.type,
        finalPrompt: trace.finalPrompt,
        imageSize: trace.imageSize as ImageGenerationSize | undefined,
        aspectRatio: trace.aspectRatio,
        resolution: trace.resolution,
        duration: trace.durationSeconds === undefined ? undefined : String(trace.durationSeconds),
    }
}

type SavedGeneration = {
    generation?: AiInteractionMediaGenerationRequest
    resumePayload?: Record<string, unknown>
}

export const createCanvasGenerationRecoveryAccess = (
    regeneratePipeline: (
        authorization: CapabilityActionAuthorizationContext,
        input: {
            assets: Asset[]
            regenerationId: string
            mode: 'existing-prompt' | 'regenerate-prompt'
            admit: MediaPipelineRegenerationAdmission
        },
    ) => Promise<{
        status: 'pending'
        operationId: string
    }>,
): CanvasGenerationRecoveryAccess =>
async context => {
    const execution = AgentExecutionScope.current()
    const { owner } = execution
    const {
        userId,
        workspaceId,
        organizationId,
    } = owner.job

    if (
        context.origin !== 'model'
        || context.userId !== userId
        || context.workspaceId !== workspaceId
        || context.conversationAssetId !== owner.job.conversationAssetId
    )
        throw new Error('AGENT_CANVAS_SCOPE_DENIED')

    const fence = async () => {
        owner.abort.signal.throwIfAborted()
        await execution.assertContextCurrent?.()

        return await owner.fences(execution.continuationEpoch)
    }
    const requester = () => getAssetRequesterContext(userId)
    const scope = {
        workspaceId,
        organizationId,
    }
    const actor = {
        userId,
        workspaceId,
        sessionId: owner.ownerId,
        name: 'Canvas agent',
    }
    const readRequest = async (generationRequestId: string) => {
        const request = await MediaGenerationRequestModel.getAuthorized({
            generationRequestId,
            workspaceId,
            userId,
        })

        if (
            'error' in request
            || request.organizationId !== organizationId
        )
            throw new Error('MEDIA_REQUEST_NOT_FOUND')

        return request
    }
    const service = new MediaGenerationRequestService()
    const invocationId = AgentToolInvocation.current()

    return {
        resolve: async (input, leases) => {
            await fence()
            const current = await readRequest(input.generationRequestId)
            const existing = current.resolvedReferences.find(
                item => item.bindingId === input.bindingId && item.assetId === input.assetId && item.resolvedByUserId === userId,
            )
            const request = existing ? current : await canvasCollaboration.withAgentLeases(
                actor,
                leases,
                async () => await service.resolveReference({
                    ...input,
                    workspaceId,
                    userId,
                    requester: scopeAssetRequesterToWorkspace(await requester(), scope),
                }),
                fence,
            )

            if (
                request.status === 'submitted'
                && request.unresolvedBindings.length === 0
            ) {
                await fence()
                await resumeAiInteractionMediaGenerationRequest({
                    request,
                    user: { userId },
                })
            }

            return {
                generationRequestId: request.generationRequestId,
                status: request.status,
                revision: request.revision,
                pendingBindings: request.unresolvedBindings.length,
            }
        },
        regenerate: async (input, leases) => {
            await fence()
            const generationRequestId = `regen-${createHash('sha256').update(
                JSON.stringify([
                    owner.job.conversationAssetId,
                    context.runId,
                    invocationId,
                ]),
            ).digest('hex')}`
            const previous = await MediaGenerationRequestModel.getAuthorized({
                generationRequestId,
                workspaceId,
                userId,
            })

            if (!('error' in previous))
                return {
                    generationRequestId,
                    status: previous.status,
                    revision: previous.revision,
                }

            const snapshot = await canvasCollaboration.syncAgentCanvas(actor)
            const canvasState = snapshot.canvasState
            const node = canvasState?.nodes.find(item => item.nodeId === input.nodeId)

            if (
                !canvasState
                || !node
            )
                throw new Error('CANVAS_REGENERATION_TARGET_UNAVAILABLE')

            const nodes = canvasRegenerationNodes(canvasState.nodes, input.nodeId).filter(isMedia)
            const owned = new Set(
                leases.map(lease => lease.target),
            )

            if (nodes.some(item => !owned.has(`node:${  item.nodeId}`)))
                throw new Error('CANVAS_REGENERATION_TARGETS_CHANGED')

            const source = nodes[0]
            const sourceGenerationId = source?.generatedBy?.generationRequestId

            if (
                !source
                || nodes.some(item => item.generatedBy?.generationRequestId !== sourceGenerationId)
            )
                throw new Error('CANVAS_REGENERATION_HISTORY_UNAVAILABLE')

            const identity = scopeAssetRequesterToWorkspace(await requester(), scope)

            if (!sourceGenerationId) {
                const assets = await Promise.all(
                    nodes.map(async item => {
                        const asset = await AssetModel.get({
                            assetId: item.assetId,
                            requester: identity,
                        })

                        if (
                            'error' in asset
                            || asset.organizationId !== organizationId
                        )
                            throw new Error('CANVAS_REGENERATION_HISTORY_UNAVAILABLE')

                        return asset
                    }),
                )

                return await regeneratePipeline(
                    context,
                    {
                        assets,
                        regenerationId: generationRequestId,
                        mode: input.mode,
                        admit: async write => await canvasCollaboration.withAgentLeases(
                            actor,
                            leases,
                            write,
                        ),
                    },
                )
            }

            if (
                input.mode === 'regenerate-prompt'
                && !isBranch(node)
            )
                throw new Error('CANVAS_REGENERATION_HISTORY_UNAVAILABLE')

            const original = await readRequest(sourceGenerationId)

            if (
                original.userId !== userId
                || !['completed', 'completed-with-errors'].includes(original.status)
            )
                throw new Error('CANVAS_REGENERATION_HISTORY_UNAVAILABLE')

            const checkpoint = await service.getCheckpoint(original)
            const saved = checkpoint.configuration as SavedGeneration

            if (
                !saved.resumePayload
                || saved.generation?.requestVersion !== 'media-generation-matrix-v1'
            )
                throw new Error('CANVAS_REGENERATION_HISTORY_UNAVAILABLE')

            const conversation = await AssetModel.get({
                assetId: original.conversationAssetId,
                requester: identity,
            })

            if (
                'error' in conversation
                || conversation.conversationRuntime === 'deep-agents'
            )
                throw new Error('CANVAS_REGENERATION_HISTORY_UNAVAILABLE')

            const generation: AiInteractionMediaGenerationRequest = {
                ...saved.generation,
                generationRequestId,
                regeneration: {
                    mode: 'regenerate-prompt',
                    forceFreshLineage: true,
                },
            }

            if (input.mode === 'existing-prompt') {
                const parentId = isBranch(node) ? node.nodeId : source.generatedBy?.lineageParentNodeId
                    ?? source.generatedBy?.branchLineNodeId ?? source.generatedBy?.branchForkNodeId ?? source.generatedBy?.branchOriginNodeId
                const parent = canvasState.nodes.find(item => item.nodeId === parentId)

                if (
                    !parent
                    || (parent.type !== 'branchOrigin' && parent.type !== 'branchFork' && parent.type !== 'branchLine')
                )
                    throw new Error('CANVAS_REGENERATION_LINEAGE_UNAVAILABLE')

                const replayPrompts = await Promise.all(
                    nodes.map(async item => {
                        const asset = await AssetModel.get({
                            assetId: item.assetId,
                            requester: identity,
                        })

                        if (
                            'error' in asset
                            || asset.organizationId !== organizationId
                        )
                            throw new Error('CANVAS_REGENERATION_PROVENANCE_UNAVAILABLE')

                        return await readReplayPrompt(asset, item)
                    }),
                )

                generation.reasoningModelIds = [...new Set(
                    replayPrompts.map(item => item.reasoningModelId),
                )]
                generation.imageModelIds = [...new Set(
                    replayPrompts.filter(item => item.mediaType === 'image').map(item => item.mediaModelId),
                )]
                generation.videoModelIds = [...new Set(
                    replayPrompts.filter(item => item.mediaType === 'video').map(item => item.mediaModelId),
                )]
                const modelPairs = new Set(
                    replayPrompts.map(item => JSON.stringify([item.reasoningModelId, item.mediaModelId])),
                )

                if (modelPairs.size !== generation.reasoningModelIds.length * (generation.imageModelIds.length + generation.videoModelIds.length))
                    throw new Error('CANVAS_REGENERATION_MATRIX_UNAVAILABLE')

                const firstImageSize = replayPrompts.find(item => item.mediaType === 'image')?.imageSize

                if (firstImageSize)
                    generation.imageOptions = {
                        ...generation.imageOptions,
                        imageSize: firstImageSize,
                        configGroups: generation.imageModelIds.map(
                            (modelId, index) => ({
                                groupId: `replay-image-${index}`,
                                modelIds: [modelId],
                                values: {
                                    ...saved.generation?.imageOptions?.configGroups?.find(group => group.modelIds.includes(modelId))?.values,
                                    imageSize: replayPrompts.find(item => item.mediaModelId === modelId)?.imageSize ?? firstImageSize,
                                },
                            }),
                        ),
                    }

                if (generation.videoModelIds.length)
                    generation.videoOptions = {
                        ...generation.videoOptions,
                        configGroups: generation.videoModelIds.map((modelId, index) => {
                            const trace = replayPrompts.find(item => item.mediaModelId === modelId)!

                            return {
                                groupId: `replay-video-${index}`,
                                modelIds: [modelId],
                                values: {
                                    ...saved.generation?.videoOptions?.configGroups?.find(group => group.modelIds.includes(modelId))?.values,
                                    ...(trace.aspectRatio ? { aspectRatio: trace.aspectRatio } : {}),
                                    ...(trace.resolution ? { resolution: trace.resolution } : {}),
                                    ...(trace.duration ? { duration: trace.duration } : {}),
                                },
                            }
                        }),
                    }

                generation.regeneration = {
                    mode: 'existing-prompt',
                    branchId: parent.branchId,
                    lineageParentNodeId: parent.nodeId,
                    lineageParentType: parent.type,
                    ...(nodes.length === 1 ? { sourceNodeId: source.nodeId } : {}),
                    replayPrompts: replayPrompts.map(
                        ({
                            imageSize: _size,
                            aspectRatio: _aspect,
                            resolution: _resolution,
                            duration: _duration,
                            ...prompt
                        }) => prompt,
                    ),
                }
            }

            for (const lease of leases)
                if (!await canvasCollaboration.isAgentLeaseCurrent(actor, lease))
                    throw new Error('CANVAS_LEASE_LOST')

            await fence()
            const result = await startAiInteractionCanvasRegeneration({
                original,
                generation,
                prompt: checkpoint.promptDocument,
                sourceNodeIds: nodes.map(item => item.nodeId),
                resumePayload: saved.resumePayload,
                admit: async write => await canvasCollaboration.withAgentLeases(
                    actor,
                    leases,
                    write,
                    fence,
                ),
            })

            return {
                generationRequestId: result.generationRequestId,
                status: result.status,
                revision: result.revision,
            }
        },
    }
}
