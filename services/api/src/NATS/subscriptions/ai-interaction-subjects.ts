'use strict'

import { createHash } from 'node:crypto'

import chalk from 'chalk'
import { v4 as uuid } from 'uuid'

import NATS_Service from '@lixpi/nats-service'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'
import {
    aiGeneratedImageNodeType,
    aiGeneratedVideoNodeType,
    aiResponseMessageNodeType,
    aiUserMessageNodeType,
    findAiChatThreadContentNode,
    parseProseMirrorJsonContent,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror'
import {
    getAiInteractionCanonicalResponseSubject,
    getAiInteractionResponseSubject,
    NATS_SUBJECTS,
    type AiInteractionChatSendMessagePayload,
    type CanvasNode,
    type MediaBranchCandidateRoleHint,
    type MediaBranchCandidateSnapshot,
    type ProviderName,
    type WorkspaceContextSnapshot,
} from '@lixpi/constants'

import AiModel from '../../models/ai-model.ts'
import type { LlmModule } from '../../llm/index.ts'
import Workspace from '../../models/workspace.ts'
import { PipelineEventLog } from '../../llm/graph/pipeline-event-log.ts'
import AssetModel from '../../models/asset.ts'
import BlobModel from '../../models/blob.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'
import { ensureAiInteractionEventRelay } from '../../services/ai-interaction-event-relay.ts'
import AssetDocumentService from '../../services/asset-document-service.ts'
import { buildCandidateTranscriptContext } from '../../llm/graph/media-branch-snapshot.ts'

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS
type PipelineResumePayload = {
    user: { userId: string }
    workspaceId: string
    conversationAssetId?: string
    pipelineId?: string
    localStreamSeq?: number
    maxMessages?: number
}

let _llmModule: LlmModule | undefined

// Set by server.ts after createLlmModule is built — subscriptions are registered before the module exists.
export const setLlmModule = (mod: LlmModule): void => {
    _llmModule = mod
}

const getLlmModule = (): LlmModule => {
    if (!_llmModule) throw new Error('LLM module not initialized')
    return _llmModule
}

const normalizeModelOption = (
    requested: string | number | undefined,
    options: Array<{ value?: string; label?: string }> | undefined,
): string | undefined => {
    const requestedValue = requested == null ? '' : String(requested)
    if (!Array.isArray(options) || options.length === 0) return requestedValue || undefined

    const values = options
        .map(option => option.value)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (values.length === 0) return requestedValue || undefined
    if (requestedValue && values.includes(requestedValue)) return requestedValue
    return values[0]
}

const collectAuthoritativeMessageText = (node: ProseMirrorJsonNode): string => {
    let text = ''
    for (const child of node.content ?? []) {
        if (child.type === 'text') {
            text += child.text ?? ''
        } else if (child.type === 'hard_break') {
            text += '\n'
        } else if (child.type === 'code_block') {
            text += `\n\`\`\`\n${collectAuthoritativeMessageText(child)}\n\`\`\`\n`
        } else if (child.type === aiGeneratedImageNodeType || child.type === aiGeneratedVideoNodeType) {
            continue
        } else if (child.type === 'feature_reference') {
            if (typeof child.attrs?.featureName === 'string' && child.attrs.featureName) {
                text += `feature:${child.attrs.featureName}`
            }
        } else {
            text += collectAuthoritativeMessageText(child)
        }
    }
    return text
}

const buildAuthoritativeConversationMessages = (
    doc: object,
    conversationAssetId: string,
): Array<{ role: 'user' | 'assistant'; content: string }> => {
    const root = parseProseMirrorJsonContent(doc)
    const thread = root ? findAiChatThreadContentNode(root, conversationAssetId) : null
    if (!thread) throw new Error('CONVERSATION_THREAD_NOT_FOUND')
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const child of thread.content ?? []) {
        if (child.type !== aiUserMessageNodeType && child.type !== aiResponseMessageNodeType) continue
        const role = child.type === aiResponseMessageNodeType ? 'assistant' as const : 'user' as const
        const content = collectAuthoritativeMessageText(child)
        const previous = messages.at(-1)
        if (previous?.role === role) previous.content += `\n${content}`
        else messages.push({ role, content })
    }
    if (!messages.some((message) => message.role === 'user' && message.content.trim())) {
        throw new Error('CONVERSATION_USER_MESSAGE_NOT_FOUND')
    }
    return messages
}

const resolveAuthorizedCandidateSnapshot = async ({
    snapshot,
    requester,
    organizationId,
    conversationAssetId,
    workspaceNodes,
}: {
    snapshot: MediaBranchCandidateSnapshot | undefined
    requester: Awaited<ReturnType<typeof getAssetRequesterContext>>
    organizationId: string
    conversationAssetId: string
    workspaceNodes: CanvasNode[]
}): Promise<MediaBranchCandidateSnapshot | undefined> => {
    if (!snapshot) return undefined
    if (!Array.isArray(snapshot.candidates)) throw new Error('INVALID_MEDIA_BRANCH_CANDIDATES')
    if (snapshot.conversationAssetId !== conversationAssetId) throw new Error('MEDIA_BRANCH_CONVERSATION_MISMATCH')
    const workspaceNodeById = new Map(workspaceNodes.map((node) => [node.nodeId, node]))
    if (workspaceNodeById.size !== workspaceNodes.length) throw new Error('WORKSPACE_NODE_ID_CONFLICT')
    if (snapshot.regionNodeId !== `standalone:${conversationAssetId}` && !workspaceNodeById.has(snapshot.regionNodeId)) {
        throw new Error('MEDIA_BRANCH_REGION_NOT_IN_WORKSPACE')
    }
    const candidateNodeIds = new Set(snapshot.candidates.map((candidate) => candidate.nodeId))
    if (candidateNodeIds.size !== snapshot.candidates.length) throw new Error('DUPLICATE_MEDIA_BRANCH_CANDIDATE')
    if (snapshot.activeTargetNodeId && !candidateNodeIds.has(snapshot.activeTargetNodeId)) {
        throw new Error('MEDIA_BRANCH_ACTIVE_TARGET_INVALID')
    }
    if (snapshot.explicitReferenceNodeIds?.some((nodeId) => !candidateNodeIds.has(nodeId))) {
        throw new Error('MEDIA_BRANCH_EXPLICIT_REFERENCE_INVALID')
    }
    const candidates = await Promise.all(snapshot.candidates.map(async (candidate) => {
        const workspaceNode = workspaceNodeById.get(candidate.nodeId)
        if (!workspaceNode || (workspaceNode.type !== 'image' && workspaceNode.type !== 'video')
            || workspaceNode.assetId !== candidate.assetId) {
            throw new Error(`MEDIA_BRANCH_NODE_NOT_IN_WORKSPACE:${candidate.nodeId}`)
        }
        const asset = await AssetModel.get({ assetId: candidate.assetId, requester })
        if ('error' in asset || asset.organizationId !== organizationId || !asset.media
            || (asset.media.kind !== 'image' && asset.media.kind !== 'video')) {
            throw new Error(`MEDIA_BRANCH_ASSET_NOT_FOUND:${candidate.assetId}`)
        }
        const mediaKind = asset.media.kind
        if (mediaKind !== workspaceNode.type) throw new Error(`MEDIA_BRANCH_MEDIA_KIND_MISMATCH:${candidate.assetId}`)
        const renditionNames = mediaKind === 'image'
            ? ['preview', 'original'] as const
            : ['representativeFrame', 'poster', 'thumbnail'] as const
        const rendition = renditionNames
            .map((name) => asset.media!.renditions[name])
            .find((item) => item?.status === 'ready' && item.blobHash)
        if (rendition?.status !== 'ready' || !rendition.blobHash) {
            throw new Error(`MEDIA_BRANCH_ASSET_NOT_READY:${candidate.assetId}`)
        }
        const blob = await BlobModel.get({ organizationId, blobHash: rendition.blobHash })
        if (!blob) throw new Error(`MEDIA_BRANCH_BLOB_NOT_FOUND:${candidate.assetId}`)
        const generatedBy = workspaceNode.generatedBy
        const childExists = workspaceNodes.some((node) =>
            (node.type === 'image' || node.type === 'video')
            && node.generatedBy?.parentMediaNodeId === workspaceNode.nodeId)
        const roleHints = new Set<MediaBranchCandidateRoleHint>(['base-context'])
        if (generatedBy) {
            roleHints.add('generated-variant')
            roleHints.add(childExists ? 'branch-ancestor' : 'branch-leaf')
        }
        if (snapshot.activeTargetNodeId === workspaceNode.nodeId) roleHints.add('active-target')
        const ancestorNodeIds = [workspaceNode.nodeId]
        let parentNodeId = generatedBy?.parentMediaNodeId
        while (parentNodeId && !ancestorNodeIds.includes(parentNodeId)) {
            const parent = workspaceNodeById.get(parentNodeId)
            if (!parent || (parent.type !== 'image' && parent.type !== 'video')) break
            ancestorNodeIds.push(parentNodeId)
            parentNodeId = parent.generatedBy?.parentMediaNodeId
        }
        const sourceContextNodeIds = generatedBy?.sourceContextNodeIds
            ?.filter((nodeId) => workspaceNodeById.has(nodeId))
            ?? [workspaceNode.nodeId]
        return {
            nodeId: workspaceNode.nodeId,
            assetId: workspaceNode.assetId,
            imageUrl: `nats-obj://${blob.bucketName}/${blob.objectKey}`,
            mediaKind,
            roleHints: [...roleHints],
            ...(generatedBy?.branchId ? { branchId: generatedBy.branchId } : {}),
            ...(generatedBy?.parentMediaNodeId ? { parentMediaNodeId: generatedBy.parentMediaNodeId } : {}),
            ...(generatedBy?.parentImageNodeId ? { parentImageNodeId: generatedBy.parentImageNodeId } : {}),
            ancestorNodeIds,
            sourceContextNodeIds,
            ...(generatedBy?.promptText ? { promptText: generatedBy.promptText } : {}),
            ...(asset.descriptor?.summary ? {
                visualEntitySummary: asset.descriptor.summary,
                visualStyleSummary: asset.descriptor.summary,
            } : {}),
            entityTags: asset.descriptor?.entityTags ?? [],
            styleTags: asset.descriptor?.styleTags ?? [],
            ...(generatedBy?.createdAt ? { createdAt: generatedBy.createdAt } : {}),
        }
    }))
    const promptText = typeof snapshot.promptText === 'string' ? snapshot.promptText.slice(0, 20_000) : ''
    return {
        resolverVersion: 'image-branch-vlm-v1',
        conversationAssetId,
        regionNodeId: snapshot.regionNodeId,
        ...(snapshot.activeTargetNodeId ? { activeTargetNodeId: snapshot.activeTargetNodeId } : {}),
        ...(snapshot.explicitReferenceNodeIds?.length ? {
            explicitReferenceNodeIds: [...new Set(snapshot.explicitReferenceNodeIds)],
        } : {}),
        promptText,
        promptFingerprint: createHash('sha256').update(promptText).digest('hex'),
        candidates,
        transcriptContext: buildCandidateTranscriptContext(candidates, promptText, snapshot.activeTargetNodeId),
    }
}

const resolveAuthorizedWorkspaceContextSnapshot = ({
    snapshot,
    workspaceId,
    conversationAssetId,
    workspaceNodes,
}: {
    snapshot: WorkspaceContextSnapshot | undefined
    workspaceId: string
    conversationAssetId: string
    workspaceNodes: CanvasNode[]
}): WorkspaceContextSnapshot | undefined => {
    if (!snapshot) return undefined
    if (snapshot.workspaceId !== workspaceId) throw new Error('WORKSPACE_CONTEXT_WORKSPACE_MISMATCH')
    if (snapshot.conversationAssetId !== conversationAssetId) throw new Error('WORKSPACE_CONTEXT_CONVERSATION_MISMATCH')
    if (!Array.isArray(snapshot.nodes)) throw new Error('INVALID_WORKSPACE_CONTEXT_NODES')
    const workspaceNodeById = new Map(workspaceNodes.map((node) => [node.nodeId, node]))
    if (workspaceNodeById.size !== workspaceNodes.length) throw new Error('WORKSPACE_NODE_ID_CONFLICT')
    const seen = new Set<string>()
    const nodes = snapshot.nodes.map((node) => {
        if (seen.has(node.nodeId)) throw new Error(`DUPLICATE_WORKSPACE_CONTEXT_NODE:${node.nodeId}`)
        seen.add(node.nodeId)
        const workspaceNode = workspaceNodeById.get(node.nodeId)
        if (!workspaceNode
            || (workspaceNode.type !== 'document' && workspaceNode.type !== 'image' && workspaceNode.type !== 'video')
            || workspaceNode.type !== node.type
            || workspaceNode.assetId !== node.assetId) {
            throw new Error(`WORKSPACE_CONTEXT_NODE_NOT_IN_WORKSPACE:${node.nodeId}`)
        }
        const generatedBy = workspaceNode.type === 'image' || workspaceNode.type === 'video'
            ? workspaceNode.generatedBy
            : undefined
        return {
            nodeId: workspaceNode.nodeId,
            type: workspaceNode.type,
            assetId: workspaceNode.assetId,
            ...(node.descriptorStatus ? { descriptorStatus: node.descriptorStatus } : {}),
            ...(node.title ? { title: node.title } : {}),
            ...(node.descriptorSummary ? { descriptorSummary: node.descriptorSummary } : {}),
            ...(node.entityTags ? { entityTags: node.entityTags } : {}),
            ...(node.styleTags ? { styleTags: node.styleTags } : {}),
            ...(generatedBy?.branchId ? { branchId: generatedBy.branchId } : {}),
            ...(generatedBy?.conversationAssetId ? { sourceConversationAssetId: generatedBy.conversationAssetId } : {}),
            ...(generatedBy?.conversationAssetId === conversationAssetId ? { isCurrentConversationGenerated: true } : {}),
            isExplicitChip: node.isExplicitChip === true,
            isEdgeForced: false,
        }
    })
    return {
        resolverVersion: 'workspace-context-v1',
        workspaceId,
        conversationAssetId,
        promptText: typeof snapshot.promptText === 'string' ? snapshot.promptText.slice(0, 20_000) : '',
        nodes,
    }
}

export const aiInteractionSubjects = [
    {
        subject: AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE,
        type: 'subscribe',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE] },
            sub: { allow: [`${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.{userIdToken}.>`] },
        },
        handler: async (data: any, _msg: any) => {
            const {
                user: { userId, stripeCustomerId },
                messages,
                aiReasoningModels,
                aiImageModels,
                aiVideoModels,
                workspaceId,
                conversationAssetId,
                enableImageGeneration,
                imageSize,
                videoAspectRatio,
                videoResolution,
                videoDuration,
                videoSourceForExtension,
                referencedFeatureIds,
                mediaBranchCandidateSnapshot,
                workspaceContextSnapshot,
                canvasVisibleArea,
                mediaGenerationRequest,
            } = data as {
                user: { userId: string; stripeCustomerId: string }
                workspaceId: string
                conversationAssetId: string
                organizationId?: string
                enableImageGeneration?: boolean
                imageSize?: string
                aiImageModels?: string[]
                aiVideoModels?: string[]
                videoAspectRatio?: string
                videoResolution?: string
                videoDuration?: number | string
                videoSourceForExtension?: string
            } & AiInteractionChatSendMessagePayload

            // The selection is an ordered model-id array; the scalar provider
            // path below operates on the first model of each section.
            const aiModel = aiReasoningModels?.[0]
            const aiImageModel = aiImageModels?.[0]
            const aiVideoModel = aiVideoModels?.[0]

            const natsService = await NATS_Service.getInstance()
            const requesterResponseSubject = getAiInteractionResponseSubject(
                userId,
                typeof data.organizationId === 'string' && data.organizationId ? data.organizationId : workspaceId,
                conversationAssetId,
            )
            const rejectSend = (failure: { error: string } | string): undefined => {
                natsService?.publish(requesterResponseSubject, typeof failure === 'string' ? { error: failure } : failure)
                return undefined
            }
            let releaseLease = async (): Promise<void> => {}
            try {
            if (!Array.isArray(messages)) return rejectSend('INVALID_MESSAGES')
            if (!mediaGenerationRequest && (typeof aiModel !== 'string' || !aiModel.includes(':'))) {
                return rejectSend('AI_MODEL_REQUIRED')
            }
            const requester = await getAssetRequesterContext(userId)
            const conversationAsset = await AssetModel.get({ assetId: conversationAssetId, requester })
            if ('error' in conversationAsset || !conversationAsset.documents.conversation) return rejectSend('CONVERSATION_ASSET_NOT_FOUND')
            const workspace = await Workspace.getWorkspace({ workspaceId, userId })
            if ('error' in workspace) return rejectSend(workspace)
            if (workspace.deletingAt) return rejectSend('WORKSPACE_DELETING')
            if (workspace.organizationId !== conversationAsset.organizationId) return rejectSend('ORGANIZATION_BOUNDARY_VIOLATION')
            if (!workspace.accessList.some((entry) => entry.userId === userId && (entry.accessLevel === 'owner' || entry.accessLevel === 'editor'))) {
                return rejectSend('PERMISSION_DENIED')
            }
            const organizationId = conversationAsset.organizationId
            const aiChatThreadId = conversationAssetId
            const workspaceNodes = workspace.canvasState?.nodes ?? []
            let resolvedMediaBranchCandidateSnapshot = await resolveAuthorizedCandidateSnapshot({
                snapshot: mediaBranchCandidateSnapshot,
                requester,
                organizationId,
                conversationAssetId,
                workspaceNodes,
            })
            let resolvedWorkspaceContextSnapshot = resolveAuthorizedWorkspaceContextSnapshot({
                snapshot: workspaceContextSnapshot,
                workspaceId,
                conversationAssetId,
                workspaceNodes,
            })
            ensureAiInteractionEventRelay({ userId, scopeId: organizationId, pipelineId: aiChatThreadId })
            const canonicalResponseSubject = getAiInteractionCanonicalResponseSubject(organizationId, aiChatThreadId)
            const sourceAssetId = mediaGenerationRequest?.videoOptions?.sourceForExtension ?? videoSourceForExtension
            let resolvedVideoSourceForExtension: string | undefined
            if (sourceAssetId) {
                const sourceAsset = await AssetModel.get({ assetId: sourceAssetId, requester })
                if ('error' in sourceAsset
                    || sourceAsset.organizationId !== organizationId
                    || sourceAsset.media?.kind !== 'video') return rejectSend('VIDEO_SOURCE_ASSET_NOT_FOUND')
                const sourceRendition = sourceAsset.media.renditions.canonical?.status === 'ready'
                    ? sourceAsset.media.renditions.canonical
                    : sourceAsset.media.renditions.original
                if (sourceRendition?.status !== 'ready' || !sourceRendition.blobHash) return rejectSend('VIDEO_SOURCE_NOT_READY')
                const sourceBlob = await BlobModel.get({ organizationId: sourceAsset.organizationId, blobHash: sourceRendition.blobHash })
                if (!sourceBlob) return rejectSend('VIDEO_SOURCE_BLOB_NOT_FOUND')
                resolvedVideoSourceForExtension = `nats-obj://${sourceBlob.bucketName}/${sourceBlob.objectKey}`
            }
            const leaseHolderId = `ai-run:${uuid()}`
            const lease = await AssetModel.acquireLease({ assetId: conversationAssetId, workspaceId, holderId: leaseHolderId, requester })
            if ('error' in lease) return rejectSend(lease)
            let leaseReleased = false
            releaseLease = async (): Promise<void> => {
                if (leaseReleased) return
                leaseReleased = true
                await AssetModel.releaseLease({ assetId: conversationAssetId, workspaceId, leaseId: lease.leaseId, holderId: leaseHolderId }).catch(() => undefined)
            }
            const conversationSnapshot = await AssetDocumentService.loadCurrentSnapshot(conversationAsset, 'conversation')
            if (!conversationSnapshot) {
                await releaseLease()
                return rejectSend('CONVERSATION_SNAPSHOT_NOT_FOUND')
            }
            const authoritativeProseMirrorInitialDoc = conversationSnapshot.doc
            const authoritativeProseMirrorBaseVersion = conversationSnapshot.version
            const authoritativeMessages = buildAuthoritativeConversationMessages(
                authoritativeProseMirrorInitialDoc,
                conversationAssetId,
            )
            const authoritativePromptText = [...authoritativeMessages]
                .reverse()
                .find((message) => message.role === 'user' && message.content.trim())!
                .content
                .slice(0, 20_000)
            if (resolvedMediaBranchCandidateSnapshot) {
                resolvedMediaBranchCandidateSnapshot = {
                    ...resolvedMediaBranchCandidateSnapshot,
                    promptText: authoritativePromptText,
                    promptFingerprint: createHash('sha256').update(authoritativePromptText).digest('hex'),
                    transcriptContext: buildCandidateTranscriptContext(
                        resolvedMediaBranchCandidateSnapshot.candidates,
                        authoritativePromptText,
                        resolvedMediaBranchCandidateSnapshot.activeTargetNodeId,
                    ),
                }
            }
            if (resolvedWorkspaceContextSnapshot) {
                resolvedWorkspaceContextSnapshot = {
                    ...resolvedWorkspaceContextSnapshot,
                    promptText: authoritativePromptText,
                }
            }
            const runWithLease = async (run: () => Promise<void>): Promise<void> => {
                const renewal = setInterval(() => {
                    void AssetModel.renewLease({ assetId: conversationAssetId, workspaceId, leaseId: lease.leaseId, holderId: leaseHolderId })
                }, 10_000)
                try {
                    await run()
                } finally {
                    clearInterval(renewal)
                    await releaseLease()
                }
            }
            const claimConversation = async (): Promise<boolean> => {
                try {
                    const claimed = await AssetModel.claimConversationReceivingSystem({
                        assetId: conversationAssetId,
                        organizationId,
                    })
                    if (!('error' in claimed)) return true
                    natsService!.publish(canonicalResponseSubject, { error: claimed.error })
                    await releaseLease()
                    return false
                } catch (error) {
                    await releaseLease()
                    throw error
                }
            }

            if (mediaGenerationRequest) {
                if (!await claimConversation()) return
                infoStr([
                    chalk.cyan('🧬 [AI_INTERACTION]'),
                    ' :: Invoking media generation matrix',
                    ' :: generationRequestId:',
                    chalk.yellow(mediaGenerationRequest.generationRequestId),
                    ' :: reasoningCount:',
                    chalk.green(String(mediaGenerationRequest.reasoningModelIds.length)),
                ])

                const runMediaGenerationMatrix = async (): Promise<void> => {
                    try {
                        await runWithLease(async () => await getLlmModule().processMediaGenerationMatrix({
                            ...data,
                            messages: authoritativeMessages,
                            mediaBranchCandidateSnapshot: resolvedMediaBranchCandidateSnapshot,
                            workspaceContextSnapshot: resolvedWorkspaceContextSnapshot,
                            workspaceId,
                            aiChatThreadId,
                            organizationId,
                            assetLeaseId: lease.leaseId,
                            assetLeaseHolderId: leaseHolderId,
                            proseMirrorInitialDoc: authoritativeProseMirrorInitialDoc,
                            proseMirrorBaseVersion: authoritativeProseMirrorBaseVersion,
                            videoSourceForExtension: resolvedVideoSourceForExtension,
                            mediaGenerationRequest: {
                                ...mediaGenerationRequest,
                                ...(mediaGenerationRequest.videoOptions ? {
                                    videoOptions: {
                                        ...mediaGenerationRequest.videoOptions,
                                        ...(resolvedVideoSourceForExtension ? { sourceForExtension: resolvedVideoSourceForExtension } : {}),
                                    },
                                } : {}),
                            },
                            eventMeta: {
                                userId,
                                stripeCustomerId,
                                organizationId,
                                workspaceId,
                                aiChatThreadId,
                            },
                        }))
                        await AssetModel.updateConversationStateSystem({
                            assetId: conversationAssetId,
                            organizationId,
                            conversation: 'completed',
                            expectedConversation: 'receiving',
                        })
                    } catch (e) {
                        await AssetModel.updateConversationStateSystem({
                            assetId: conversationAssetId,
                            organizationId,
                            conversation: 'failed',
                            expectedConversation: 'receiving',
                        }).catch(() => undefined)
                        await releaseLease()
                        err(`Media generation matrix failed for ${workspaceId}:${aiChatThreadId}:`, e)
                        natsService!.publish(
                            canonicalResponseSubject,
                            { error: e instanceof Error ? e.message : String(e) },
                        )
                    }
                }
                void runMediaGenerationMatrix()
                return
            }

            const [provider, model] = (aiModel as string).split(':')

            try {
                const aiModelMetaInfo = await AiModel.getAiModel({
                    provider: provider!,
                    model: model!,
                    omitPricing: false,
                })
                if (!aiModelMetaInfo || !aiModelMetaInfo.modelVersion) {
                    err('AI model meta info not found in the database', { aiModel })
                    natsService!.publish(
                        canonicalResponseSubject,
                        { error: `AI model not found: ${aiModel}` },
                    )
                    await releaseLease()
                    return
                }

                let imageModelMetaInfo: any = null
                if (aiImageModel) {
                    const [imageProvider, imageModel] = (aiImageModel as string).split(':')
                    imageModelMetaInfo = await AiModel.getAiModel({
                        provider: imageProvider!,
                        model: imageModel!,
                        omitPricing: false,
                    })
                    if (imageModelMetaInfo) {
                        info(`Image model resolved: ${imageProvider}:${imageModel}`)
                    } else {
                        warn(`Image model not found: ${aiImageModel}, proceeding without image routing`)
                    }
                }

                let videoModelMetaInfo: any = null
                if (aiVideoModel) {
                    const [videoProvider, videoModel] = (aiVideoModel as string).split(':')
                    videoModelMetaInfo = await AiModel.getAiModel({
                        provider: videoProvider!,
                        model: videoModel!,
                        omitPricing: false,
                    })
                    if (videoModelMetaInfo) {
                        info(`Video model resolved: ${videoProvider}:${videoModel}`)
                    } else {
                        warn(`Video model not found: ${aiVideoModel}, proceeding without video routing`)
                    }
                }

                const normalizedVideoAspectRatio = normalizeModelOption(videoAspectRatio, videoModelMetaInfo?.videoAspectRatios)
                const normalizedVideoResolution = normalizeModelOption(videoResolution, videoModelMetaInfo?.videoResolutions)
                const normalizedVideoDuration = normalizeModelOption(videoDuration, videoModelMetaInfo?.videoDurations)
                if (!await claimConversation()) return

                const instanceKey = `${workspaceId}:${aiChatThreadId}`

                infoStr([
                    chalk.cyan('🚀 [AI_INTERACTION]'),
                    ' :: Invoking LLM module in-process',
                    ' :: instanceKey:',
                    chalk.yellow(instanceKey),
                    ' :: provider:',
                    chalk.green(provider!),
                ])

                // Fire-and-forget: the LLM module publishes streaming events
                // directly to NATS as it runs. We do not await here because
                // NATS message handlers should return quickly so the queue
                // worker can pick up the next request.
                const runLlmProcess = async (): Promise<void> => {
                    try {
                        await runWithLease(async () => await getLlmModule().process(instanceKey, provider as ProviderName, {
                            messages: authoritativeMessages,
                            aiModelMetaInfo,
                            imageModelMetaInfo,
                            videoModelMetaInfo,
                            workspaceId,
                            aiChatThreadId,
                            organizationId,
                            assetLeaseId: lease.leaseId,
                            assetLeaseHolderId: leaseHolderId,
                            enableImageGeneration,
                            imageSize,
                            videoAspectRatio: normalizedVideoAspectRatio,
                            videoResolution: normalizedVideoResolution,
                            videoDurationSeconds: normalizedVideoDuration ? Number(normalizedVideoDuration) : undefined,
                            videoSourceForExtension: resolvedVideoSourceForExtension,
                            referencedFeatureIds,
                            mediaBranchCandidateSnapshot: resolvedMediaBranchCandidateSnapshot,
                            workspaceContextSnapshot: resolvedWorkspaceContextSnapshot,
                            canvasVisibleArea,
                            proseMirrorInitialDoc: authoritativeProseMirrorInitialDoc,
                            proseMirrorBaseVersion: authoritativeProseMirrorBaseVersion,
                            eventMeta: {
                                userId,
                                stripeCustomerId,
                                organizationId,
                                workspaceId,
                                aiChatThreadId,
                            },
                        }))
                        await AssetModel.updateConversationStateSystem({
                            assetId: conversationAssetId,
                            organizationId,
                            conversation: 'completed',
                            expectedConversation: 'receiving',
                        })
                    } catch (e) {
                        await AssetModel.updateConversationStateSystem({
                            assetId: conversationAssetId,
                            organizationId,
                            conversation: 'failed',
                            expectedConversation: 'receiving',
                        }).catch(() => undefined)
                        await releaseLease()
                        err(`LLM module process failed for ${instanceKey}:`, e)
                        natsService!.publish(
                            canonicalResponseSubject,
                            { error: e instanceof Error ? e.message : String(e) },
                        )
                    }
                }
                void runLlmProcess()
            } catch (error) {
                await releaseLease()
                err('❌ [AI_INTERACTION] handler error:', error)
                natsService!.publish(
                    canonicalResponseSubject,
                    { error: error instanceof Error ? error.message : String(error) },
                )
            }
            } catch (error) {
                await releaseLease()
                err('❌ [AI_INTERACTION] preflight error:', error)
                rejectSend(error instanceof Error ? error.message : String(error))
            }
        },
    },

    {
        subject: AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME,
        type: 'reply',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME] },
            sub: { allow: [] },
        },
        handler: async (data: PipelineResumePayload, _msg: any) => {
            const { workspaceId } = data
            const userId = data.user.userId
            if (data.conversationAssetId && data.pipelineId && data.pipelineId !== data.conversationAssetId) {
                return { error: 'PIPELINE_CONVERSATION_MISMATCH' }
            }
            const pipelineId = data.conversationAssetId ?? data.pipelineId
            if (!pipelineId) {
                return { error: 'PIPELINE_ID_REQUIRED' }
            }

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }
            let responseScopeId = workspaceId
            if (data.conversationAssetId) {
                const requester = await getAssetRequesterContext(userId)
                const conversation = await AssetModel.get({ assetId: data.conversationAssetId, requester })
                if ('error' in conversation || !conversation.documents.conversation) {
                    return { error: 'CONVERSATION_ASSET_NOT_FOUND' }
                }
                if (conversation.organizationId !== workspace.organizationId) {
                    return { error: 'ORGANIZATION_BOUNDARY_VIOLATION' }
                }
                responseScopeId = conversation.organizationId
            }
            const liveSubject = ensureAiInteractionEventRelay({
                userId,
                scopeId: responseScopeId,
                pipelineId,
            })

            const localStreamSeq = Number.isSafeInteger(data.localStreamSeq) && data.localStreamSeq! >= 0
                ? data.localStreamSeq!
                : 0
            const maxMessages = Number.isSafeInteger(data.maxMessages) && data.maxMessages! > 0
                ? Math.min(data.maxMessages!, 10_000)
                : 1000
            const result = await PipelineEventLog.fromSingleton().replayPipelineEvents({
                workspaceId,
                pipelineId,
                startStreamSeq: Math.max(1, localStreamSeq + 1),
                maxMessages,
            })

            return {
                ...result,
                liveSubject,
                events: result.events.filter(event => event.streamSequence > localStreamSeq),
            }
        },
    },

    // Stop AI message streaming
    {
        subject: AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE,
        type: 'reply',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE] },
            sub: { allow: [] },
        },
        handler: async (data: any, _msg: any) => {
            const { workspaceId, conversationAssetId, generationRequestId } = data as {
                user: { userId: string }
                workspaceId: string
                conversationAssetId: string
                generationRequestId?: string
            }

            const requester = await getAssetRequesterContext(data.user.userId)
            const conversation = await AssetModel.get({ assetId: conversationAssetId, requester })
            if ('error' in conversation || !conversation.documents.conversation) return { error: 'CONVERSATION_ASSET_NOT_FOUND' }
            const workspace = await Workspace.getWorkspace({ workspaceId, userId: data.user.userId })
            if ('error' in workspace) return workspace
            if (workspace.organizationId !== conversation.organizationId) return { error: 'ORGANIZATION_BOUNDARY_VIOLATION' }
            if (!workspace.accessList.some((entry) => entry.userId === data.user.userId && (entry.accessLevel === 'owner' || entry.accessLevel === 'editor'))) {
                return { error: 'PERMISSION_DENIED' }
            }
            const instanceKey = `${workspaceId}:${conversationAssetId}`

            infoStr([
                chalk.yellow('🛑 [AI_INTERACTION]'),
                ' :: Stopping LLM workflow',
                ' :: instanceKey:',
                chalk.red(instanceKey),
            ])

            try {
                await getLlmModule().stop(instanceKey)
                await getLlmModule().stopMediaGenerationMatrix({
                    workspaceId,
                    aiChatThreadId: conversationAssetId,
                    generationRequestId,
                })
                await AssetModel.updateConversationStateSystem({
                    assetId: conversationAssetId,
                    organizationId: conversation.organizationId,
                    conversation: 'paused',
                })
                return {
                    status: 'stopped',
                    ...(generationRequestId ? { generationRequestId } : {}),
                }
            } catch (e) {
                err(`Failed to stop ${instanceKey}:`, e)
                return { error: e instanceof Error ? e.message : String(e) }
            }
        },
    },
]
