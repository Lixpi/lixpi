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
    parseCapabilityInputsAttr,
    parseProseMirrorJsonContent,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror'
import {
    getAiInteractionCanonicalResponseSubject,
    getAiInteractionResponseSubject,
    NATS_SUBJECTS,
    type AiInteractionChatSendMessagePayload,
    type CapabilityJsonValue,
    type CanvasNode,
    type MediaBranchCandidateRoleHint,
    type MediaBranchCandidateSnapshot,
    type ProviderName,
    type WorkspaceContextSnapshot,
} from '@lixpi/constants'
import {
    ACTION_TIMELINE_TOOL_ID,
    resolveCharacterCreatorRouting,
    restrictMediaRequestToCharacterImages,
} from '@lixpi/capability-system'
import {
    resolveCapabilities,
    validateJsonSchemaValue,
} from '@lixpi/capability-system/backend'

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
import {
    addPromptReferenceAudioToLatestUserMessage,
    addPromptReferenceMediaToLatestUserMessage,
    authorizePromptReferences,
    extractLatestUserPromptReferences,
} from '../../services/prompt-reference-resolver.ts'
import PromptReferenceRecentModel from '../../models/prompt-reference-recent.ts'
import { CapabilityModelResolverStore } from '../../capability-system/capability-runtime-adapters.ts'
import { capabilityActionRegistry } from '../../capability-system/capability-runtime.ts'
import { resolveActionTimelineInput } from '../../capability-system/action-timeline-input.ts'

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

type SealedMediaReplayTrace = {
    traceVersion: 'image-generation-trace-v1' | 'video-generation-trace-v1'
    finalPrompt: string
    imageSize?: string
    aspectRatio?: string
    resolution?: string
    durationSeconds?: number
    generationRun?: {
        reasoningRunId?: string
        mediaRunId?: string
        reasoningModelId?: string
        mediaModelId?: string
        mediaType?: 'image' | 'video'
    }
}

const findSealedMediaReplayTrace = (
    doc: object,
    expected: {
        reasoningRunId?: string
        mediaRunId?: string
        reasoningModelId: string
        mediaModelId: string
        mediaType: 'image' | 'video'
    },
): SealedMediaReplayTrace | undefined => {
    const root = parseProseMirrorJsonContent(doc)
    if (!root) return undefined
    const traces: SealedMediaReplayTrace[] = []
    const visit = (node: ProseMirrorJsonNode): void => {
        const imageTrace = node.attrs?.imageGenerationTrace
        const videoTrace = node.attrs?.videoGenerationTrace
        const candidate = imageTrace ?? videoTrace
        if (candidate && typeof candidate === 'object') {
            traces.push(candidate as SealedMediaReplayTrace)
        }
        for (const child of node.content ?? []) visit(child)
    }
    visit(root)
    const exactTrace = traces.find((trace) => {
        const run = trace.generationRun
        const mediaType = trace.traceVersion === 'image-generation-trace-v1' ? 'image' : 'video'
        return mediaType === expected.mediaType
            && run?.reasoningModelId === expected.reasoningModelId
            && run.mediaModelId === expected.mediaModelId
            && (!expected.reasoningRunId || run.reasoningRunId === expected.reasoningRunId)
            && (!expected.mediaRunId || run.mediaRunId === expected.mediaRunId)
    })
    if (exactTrace) return exactTrace

    // Older sealed per-Asset projections can contain one correctly scoped trace
    // without embedded media-run metadata. The provenance document itself is
    // already scoped to this source Asset, so that single trace is authoritative.
    if (traces.length !== 1) return undefined
    const onlyTrace = traces[0]!
    const mediaType = onlyTrace.traceVersion === 'image-generation-trace-v1' ? 'image' : 'video'
    return mediaType === expected.mediaType ? onlyTrace : undefined
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
    if (!messages.some((message) => message.role === 'user')) {
        throw new Error('CONVERSATION_USER_MESSAGE_NOT_FOUND')
    }
    return messages
}

const readAuthoritativeCapabilityInputs = (
    doc: object,
    conversationAssetId: string,
): Record<string, Record<string, CapabilityJsonValue>> => {
    const root = parseProseMirrorJsonContent(doc)
    const thread = root ? findAiChatThreadContentNode(root, conversationAssetId) : null
    if (!thread) throw new Error('CONVERSATION_THREAD_NOT_FOUND')
    return parseCapabilityInputsAttr(thread.attrs?.capabilityInputs)
}

const validateCapabilityInputs = async ({
    inputs,
    references,
    requester,
    workspaceId,
    organizationId,
}: {
    inputs: Record<string, Record<string, CapabilityJsonValue>>
    references: Array<{ capabilityId: string; kind: 'tool' | 'skill' }>
    requester: Awaited<ReturnType<typeof getAssetRequesterContext>>
    workspaceId: string
    organizationId: string
}): Promise<void> => {
    if (Object.keys(inputs).length === 0) return
    const allowedToolIds = new Set(references.filter(reference => reference.kind === 'tool')
        .map(reference => reference.capabilityId))
    for (const capabilityId of Object.keys(inputs)) {
        if (!allowedToolIds.has(capabilityId)) throw new Error(`CAPABILITY_INPUT_NOT_AUTHORIZED:${capabilityId}`)
    }
    const plan = await resolveCapabilities(references, {
        store: new CapabilityModelResolverStore(),
        requester: {
            userId: requester.userId,
            workspaceId,
            organizationId,
        },
        allowedActions: capabilityActionRegistry.allowedActionKeys(),
    })
    for (const [capabilityId, input] of Object.entries(inputs)) {
        const manifest = plan.getManifest(capabilityId)?.manifest
        const schemaRef = manifest?.tool?.inputSchema
        const resource = schemaRef ? plan.getResource(capabilityId, schemaRef.resourceId) : undefined
        if (!manifest?.tool || !resource) throw new Error(`CAPABILITY_INPUT_SCHEMA_NOT_FOUND:${capabilityId}`)
        let schema: unknown
        try {
            schema = JSON.parse(new TextDecoder().decode(resource.bytes))
        } catch {
            throw new Error(`CAPABILITY_INPUT_SCHEMA_INVALID:${capabilityId}`)
        }
        const validation = validateJsonSchemaValue(schema, input)
        if (!validation.valid) {
            throw new Error(`CAPABILITY_INPUT_INVALID:${capabilityId}:${validation.errors.join('; ')}`)
        }
    }
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
    const candidateIds = new Set(snapshot.candidates.map((candidate) => candidate.candidateId))
    if (candidateIds.size !== snapshot.candidates.length) throw new Error('DUPLICATE_MEDIA_BRANCH_CANDIDATE')
    if (snapshot.activeTargetCandidateId && !candidateIds.has(snapshot.activeTargetCandidateId)) {
        throw new Error('MEDIA_BRANCH_ACTIVE_TARGET_INVALID')
    }
    if (snapshot.explicitReferenceCandidateIds?.some((candidateId) => !candidateIds.has(candidateId))) {
        throw new Error('MEDIA_BRANCH_EXPLICIT_REFERENCE_INVALID')
    }
    const candidates = await Promise.all(snapshot.candidates.map(async (candidate) => {
        if (!candidate.nodeId || candidate.candidateId !== `node:${candidate.nodeId}`) {
            throw new Error(`INVALID_MEDIA_BRANCH_CANDIDATE_ID:${candidate.candidateId}`)
        }
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
        if (snapshot.activeTargetCandidateId === candidate.candidateId) roleHints.add('active-target')
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
            candidateId: candidate.candidateId,
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
    const promptText = typeof snapshot.promptText === 'string' ? snapshot.promptText : ''
    return {
        resolverVersion: 'image-branch-vlm-v1',
        conversationAssetId,
        regionNodeId: snapshot.regionNodeId,
        ...(snapshot.activeTargetCandidateId ? { activeTargetCandidateId: snapshot.activeTargetCandidateId } : {}),
        ...(snapshot.explicitReferenceCandidateIds?.length ? {
            explicitReferenceCandidateIds: [...new Set(snapshot.explicitReferenceCandidateIds)],
        } : {}),
        promptText,
        promptFingerprint: createHash('sha256').update(promptText).digest('hex'),
        candidates,
        transcriptContext: buildCandidateTranscriptContext(candidates, promptText, snapshot.activeTargetCandidateId),
    }
}

type AuthorizedWorkspaceContextCanvasNode = Extract<CanvasNode, {
    type: 'document' | 'image' | 'video' | 'capabilityArtifact'
}>

const isAuthorizedWorkspaceContextCanvasNode = (
    node: CanvasNode | undefined,
): node is AuthorizedWorkspaceContextCanvasNode => node?.type === 'document'
    || node?.type === 'image'
    || node?.type === 'video'
    || node?.type === 'capabilityArtifact'

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
        if (!isAuthorizedWorkspaceContextCanvasNode(workspaceNode)
            || workspaceNode.type !== node.type
            || workspaceNode.assetId !== node.assetId) {
            throw new Error(`WORKSPACE_CONTEXT_NODE_NOT_IN_WORKSPACE:${node.nodeId}`)
        }
        const generatedBy = workspaceNode.type === 'image'
            || workspaceNode.type === 'video'
            || workspaceNode.type === 'capabilityArtifact'
            ? workspaceNode.generatedBy
            : undefined
        return {
            nodeId: workspaceNode.nodeId,
            type: workspaceNode.type,
            assetId: workspaceNode.assetId,
            ...(workspaceNode.type === 'capabilityArtifact' ? {
                artifactTypeId: workspaceNode.artifactTypeId,
            } : {}),
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
        promptText: typeof snapshot.promptText === 'string' ? snapshot.promptText : '',
        nodes,
    }
}

const mergePromptReferenceMediaCandidates = ({
    snapshot,
    candidates,
    conversationAssetId,
    promptText,
}: {
    snapshot: MediaBranchCandidateSnapshot | undefined
    candidates: MediaBranchCandidateSnapshot['candidates']
    conversationAssetId: string
    promptText: string
}): MediaBranchCandidateSnapshot | undefined => {
    if (!snapshot && candidates.length === 0) return undefined
    const candidatesById = new Map<string, MediaBranchCandidateSnapshot['candidates'][number]>()
    for (const candidate of snapshot?.candidates ?? []) candidatesById.set(candidate.candidateId, candidate)
    for (const candidate of candidates) {
        const existing = candidatesById.get(candidate.candidateId)
        candidatesById.set(candidate.candidateId, existing ? {
            ...existing,
            ...candidate,
            roleHints: [...new Set([...existing.roleHints, ...candidate.roleHints])],
            ancestorNodeIds: [...new Set([...existing.ancestorNodeIds, ...candidate.ancestorNodeIds])],
            sourceContextNodeIds: [...new Set([...existing.sourceContextNodeIds, ...candidate.sourceContextNodeIds])],
        } : candidate)
    }
    const mergedCandidates = [...candidatesById.values()]
    const explicitReferenceCandidateIds = [...new Set([
        ...(snapshot?.explicitReferenceCandidateIds ?? []),
        ...candidates.map(candidate => candidate.candidateId),
    ])]
    const activeTargetCandidateId = snapshot?.activeTargetCandidateId
    return {
        resolverVersion: 'image-branch-vlm-v1',
        conversationAssetId,
        regionNodeId: snapshot?.regionNodeId ?? `standalone:${conversationAssetId}`,
        ...(activeTargetCandidateId ? { activeTargetCandidateId } : {}),
        ...(explicitReferenceCandidateIds.length > 0 ? { explicitReferenceCandidateIds } : {}),
        promptText,
        promptFingerprint: createHash('sha256').update(promptText).digest('hex'),
        candidates: mergedCandidates,
        transcriptContext: buildCandidateTranscriptContext(mergedCandidates, promptText, activeTargetCandidateId),
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
            const regeneration = mediaGenerationRequest?.regeneration
            let resolvedRegeneration = regeneration
            if (regeneration
                && regeneration.mode !== 'existing-prompt'
                && regeneration.mode !== 'regenerate-prompt') {
                return rejectSend('INVALID_REGENERATION_MODE')
            }
            if (regeneration?.mode === 'regenerate-prompt' && regeneration.forceFreshLineage !== true) {
                return rejectSend('INVALID_REGENERATION_MODE')
            }
            if (regeneration?.mode === 'existing-prompt') {
                const canonicalReplayPrompts: typeof regeneration.replayPrompts = []
                const lineageNode = workspaceNodes.find(node => node.nodeId === regeneration.lineageParentNodeId)
                if (!lineageNode
                    || !['branchOrigin', 'branchFork', 'branchLine'].includes(lineageNode.type)
                    || lineageNode.type !== regeneration.lineageParentType
                    || !('branchId' in lineageNode)
                    || lineageNode.branchId !== regeneration.branchId) {
                    return rejectSend('REGENERATION_LINEAGE_NOT_FOUND')
                }
                if (!regeneration.replayPrompts.length
                    || regeneration.replayPrompts.some(prompt =>
                        !prompt.sourceAssetId
                        || !mediaGenerationRequest.reasoningModelIds.includes(prompt.reasoningModelId)
                        || (prompt.mediaType === 'image'
                            ? !mediaGenerationRequest.imageModelIds.includes(prompt.mediaModelId)
                            : !mediaGenerationRequest.videoModelIds.includes(prompt.mediaModelId)))) {
                    return rejectSend('INVALID_REGENERATION_PROMPTS')
                }
                for (const replayPrompt of regeneration.replayPrompts) {
                    const sourceAsset = await AssetModel.get({ assetId: replayPrompt.sourceAssetId, requester })
                    if ('error' in sourceAsset
                        || sourceAsset.organizationId !== organizationId
                        || sourceAsset.generatedOutputReview?.status !== 'superseded'
                        || sourceAsset.generatedOutputReview?.regenerationMode !== 'existing-prompt'
                        || sourceAsset.states.provenance !== 'sealed'
                        || sourceAsset.lineage?.reasoningModelId !== replayPrompt.reasoningModelId
                        || sourceAsset.lineage?.mediaModelId !== replayPrompt.mediaModelId) {
                        return rejectSend('REGENERATION_SOURCE_NOT_FOUND')
                    }
                    const provenance = await AssetDocumentService.loadCurrentSnapshot(sourceAsset, 'provenance')
                    const trace = provenance ? findSealedMediaReplayTrace(provenance.doc, {
                        reasoningRunId: sourceAsset.lineage?.reasoningRunId,
                        mediaRunId: sourceAsset.lineage?.mediaRunId,
                        reasoningModelId: replayPrompt.reasoningModelId,
                        mediaModelId: replayPrompt.mediaModelId,
                        mediaType: replayPrompt.mediaType,
                    }) : undefined
                    if (!trace || !trace.finalPrompt.trim() || trace.finalPrompt.length > 20_000) {
                        return rejectSend('REGENERATION_PROVENANCE_MISMATCH')
                    }
                    if (replayPrompt.mediaType === 'image') {
                        const requestedSize = mediaGenerationRequest.imageOptions?.configGroups
                            ?.find(group => group.modelIds.includes(replayPrompt.mediaModelId))
                            ?.values.imageSize
                            ?? mediaGenerationRequest.imageOptions?.imageSize
                        if (requestedSize !== trace.imageSize) return rejectSend('REGENERATION_PARAMETERS_MISMATCH')
                    } else {
                        const config = mediaGenerationRequest.videoOptions?.configGroups
                            ?.find(group => group.modelIds.includes(replayPrompt.mediaModelId))
                        const requestedAspectRatio = config?.values.aspectRatio ?? mediaGenerationRequest.videoOptions?.aspectRatio
                        const requestedResolution = config?.values.resolution ?? mediaGenerationRequest.videoOptions?.resolution
                        const requestedDuration = config?.values.duration ?? mediaGenerationRequest.videoOptions?.duration
                        if (requestedAspectRatio !== trace.aspectRatio
                            || requestedResolution !== trace.resolution
                            || String(requestedDuration ?? '') !== String(trace.durationSeconds ?? '')) {
                            return rejectSend('REGENERATION_PARAMETERS_MISMATCH')
                        }
                    }
                    canonicalReplayPrompts.push({
                        ...replayPrompt,
                        finalPrompt: trace.finalPrompt,
                    })
                }
                resolvedRegeneration = {
                    ...regeneration,
                    replayPrompts: canonicalReplayPrompts,
                }
            }
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
            // Token-metered video vendors charge for input duration too, and price
            // a run with video input differently from one without, so the source
            // clip's length is captured here where its Asset is already loaded.
            // Downstream it is only ever a URI, which carries no duration.
            let resolvedVideoSourceDurationSeconds: number | undefined
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
                const measuredDuration = sourceRendition.durationSeconds ?? sourceAsset.media.durationSeconds
                if (typeof measuredDuration === 'number' && measuredDuration > 0) {
                    resolvedVideoSourceDurationSeconds = measuredDuration
                }
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
            const submittedPromptReferences = extractLatestUserPromptReferences(
                authoritativeProseMirrorInitialDoc,
                conversationAssetId,
            )
            const authorizedPromptReferences = await authorizePromptReferences({
                references: submittedPromptReferences,
                requester,
                workspace,
                moduleCatalog: getLlmModule().capabilityModuleCatalog,
            })
            const latestAuthoritativeUserMessage = [...authoritativeMessages]
                .reverse()
                .find((message) => message.role === 'user')
            if (!latestAuthoritativeUserMessage) throw new Error('CONVERSATION_USER_MESSAGE_NOT_FOUND')
            if (!latestAuthoritativeUserMessage.content.trim() && authorizedPromptReferences.references.length > 0) {
                latestAuthoritativeUserMessage.content = 'Use the selected prompt references.'
            }
            const authoritativePromptText = latestAuthoritativeUserMessage.content
            if (authorizedPromptReferences.documentContext.length > 0) {
                latestAuthoritativeUserMessage.content = [
                    latestAuthoritativeUserMessage.content,
                    ...authorizedPromptReferences.documentContext,
                ].filter(Boolean).join('\n\n')
            }
            const moduleCatalog = getLlmModule().capabilityModuleCatalog
            const routedModule = typeof moduleCatalog?.routePrompt === 'function'
                ? moduleCatalog.routePrompt(authoritativePromptText)
                : undefined
            const routedCapabilityReferences = routedModule
                && !authorizedPromptReferences.capabilityReferences.some(reference => (
                    reference.kind === routedModule.kind && reference.capabilityId === routedModule.capabilityId
                ))
                ? [
                    ...authorizedPromptReferences.capabilityReferences,
                    { capabilityId: routedModule.capabilityId, kind: routedModule.kind },
                ]
                : authorizedPromptReferences.capabilityReferences
            const submittedCapabilityInputs = readAuthoritativeCapabilityInputs(
                authoritativeProseMirrorInitialDoc,
                conversationAssetId,
            )
            const actionTimelineSelected = routedCapabilityReferences.some(reference => (
                reference.kind === 'tool' && reference.capabilityId === ACTION_TIMELINE_TOOL_ID
            ))
            const capabilityInputs = { ...submittedCapabilityInputs }
            if (actionTimelineSelected) {
                const submittedTiming = submittedCapabilityInputs[ACTION_TIMELINE_TOOL_ID] ?? {}
                const routedTiming = routedModule?.capabilityId === ACTION_TIMELINE_TOOL_ID
                    ? routedModule.input
                    : {}
                const resolution = resolveActionTimelineInput({
                    prompt: authoritativePromptText,
                    referenceAssetIds: authorizedPromptReferences.modelInputs.map(input => input.assetId),
                    routedInput: routedTiming,
                    submittedInput: submittedTiming,
                })
                if (!resolution.valid) return rejectSend(resolution.error)
                capabilityInputs[ACTION_TIMELINE_TOOL_ID] = {
                    prompt: resolution.input.prompt,
                    referenceAssetIds: resolution.input.referenceAssetIds,
                    durationMs: resolution.input.durationMs,
                    precisionMs: resolution.input.precisionMs,
                }
            }
            await validateCapabilityInputs({
                inputs: capabilityInputs,
                references: routedCapabilityReferences,
                requester,
                workspaceId,
                organizationId: workspace.organizationId,
            })
            const characterCreatorRouting = resolveCharacterCreatorRouting(
                authoritativePromptText,
                routedCapabilityReferences,
            )
            const canonicalMediaGenerationRequest = mediaGenerationRequest
                ? {
                    ...mediaGenerationRequest,
                    ...(resolvedRegeneration ? { regeneration: resolvedRegeneration } : {}),
                }
                : undefined
            const routedMediaGenerationRequest = canonicalMediaGenerationRequest
                ? actionTimelineSelected
                    ? {
                        ...canonicalMediaGenerationRequest,
                        useMultipleImageModels: false,
                        useMultipleVideoModels: false,
                        imageModelIds: [],
                        videoModelIds: [],
                    }
                    : characterCreatorRouting.isCharacterCreator
                        ? restrictMediaRequestToCharacterImages(canonicalMediaGenerationRequest)
                        : canonicalMediaGenerationRequest
                : undefined
            const routedAiImageModel = actionTimelineSelected ? undefined : aiImageModel
            const routedAiVideoModel = actionTimelineSelected || characterCreatorRouting.isCharacterCreator
                ? undefined
                : aiVideoModel
            const hasMediaModelSelection = Boolean(
                routedMediaGenerationRequest?.imageModelIds.length
                || routedMediaGenerationRequest?.videoModelIds.length
                || routedAiImageModel
                || routedAiVideoModel,
            )
            const providerMessagesWithoutAudio = hasMediaModelSelection
                ? authoritativeMessages
                : addPromptReferenceMediaToLatestUserMessage(
                    authoritativeMessages,
                    authorizedPromptReferences.mediaCandidates,
                )
            const providerMessages = addPromptReferenceAudioToLatestUserMessage(
                providerMessagesWithoutAudio,
                authorizedPromptReferences.modelInputs,
            )
            if (characterCreatorRouting.isCharacterCreator) {
                info('[CHARACTER_CREATOR] Enforcing selected reasoning/image model axes and excluding video', {
                    reasoningModelIds: routedMediaGenerationRequest?.reasoningModelIds ?? aiReasoningModels,
                    imageModelIds: routedMediaGenerationRequest?.imageModelIds ?? aiImageModels,
                })
            }
            resolvedMediaBranchCandidateSnapshot = mergePromptReferenceMediaCandidates({
                snapshot: resolvedMediaBranchCandidateSnapshot,
                candidates: authorizedPromptReferences.mediaCandidates,
                conversationAssetId,
                promptText: authoritativePromptText,
            })
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
            const recordAcceptedReferences = async (): Promise<void> => {
                if (authorizedPromptReferences.references.length === 0) return
                await PromptReferenceRecentModel.recordAccepted({
                    userId,
                    references: authorizedPromptReferences.references,
                }).catch(error => warn('Failed to record accepted prompt-reference recents', error))
            }

            if (routedMediaGenerationRequest) {
                if (!await claimConversation()) return
                await recordAcceptedReferences()
                infoStr([
                    chalk.cyan('🧬 [AI_INTERACTION]'),
                    ' :: Invoking media generation matrix',
                    ' :: generationRequestId:',
                    chalk.yellow(routedMediaGenerationRequest.generationRequestId),
                    ' :: reasoningCount:',
                    chalk.green(String(routedMediaGenerationRequest.reasoningModelIds.length)),
                ])

                const runMediaGenerationMatrix = async (): Promise<void> => {
                    try {
                        await runWithLease(async () => await getLlmModule().processMediaGenerationMatrix({
                            ...data,
                            aiImageModels: actionTimelineSelected ? [] : aiImageModels,
                            aiVideoModels: actionTimelineSelected || characterCreatorRouting.isCharacterCreator
                                ? []
                                : aiVideoModels,
                            messages: providerMessages,
                            capabilityReferences: characterCreatorRouting.capabilityReferences,
                            capabilityInputs,
                            promptReferenceAssetIds: authorizedPromptReferences.assetIds,
                            mediaBranchCandidateSnapshot: resolvedMediaBranchCandidateSnapshot,
                            workspaceContextSnapshot: resolvedWorkspaceContextSnapshot,
                            workspaceId,
                            aiChatThreadId,
                            organizationId,
                            assetLeaseId: lease.leaseId,
                            assetLeaseHolderId: leaseHolderId,
                            proseMirrorInitialDoc: authoritativeProseMirrorInitialDoc,
                            proseMirrorBaseVersion: authoritativeProseMirrorBaseVersion,
                            videoSourceForExtension: characterCreatorRouting.isCharacterCreator
                                ? undefined
                                : resolvedVideoSourceForExtension,
                            videoSourceDurationSeconds: characterCreatorRouting.isCharacterCreator
                                ? undefined
                                : resolvedVideoSourceDurationSeconds,
                            mediaGenerationRequest: {
                                ...routedMediaGenerationRequest,
                                ...(!characterCreatorRouting.isCharacterCreator && routedMediaGenerationRequest.videoOptions ? {
                                    videoOptions: {
                                        ...routedMediaGenerationRequest.videoOptions,
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
                if (routedAiImageModel) {
                    const [imageProvider, imageModel] = (routedAiImageModel as string).split(':')
                    imageModelMetaInfo = await AiModel.getAiModel({
                        provider: imageProvider!,
                        model: imageModel!,
                        omitPricing: false,
                    })
                    if (imageModelMetaInfo) {
                        info(`Image model resolved: ${imageProvider}:${imageModel}`)
                    } else {
                        warn(`Image model not found: ${routedAiImageModel}, proceeding without image routing`)
                    }
                }

                let videoModelMetaInfo: any = null
                if (routedAiVideoModel) {
                    const [videoProvider, videoModel] = (routedAiVideoModel as string).split(':')
                    videoModelMetaInfo = await AiModel.getAiModel({
                        provider: videoProvider!,
                        model: videoModel!,
                        omitPricing: false,
                    })
                    if (videoModelMetaInfo) {
                        info(`Video model resolved: ${videoProvider}:${videoModel}`)
                    } else {
                        warn(`Video model not found: ${routedAiVideoModel}, proceeding without video routing`)
                    }
                }

                const normalizedVideoAspectRatio = normalizeModelOption(videoAspectRatio, videoModelMetaInfo?.videoAspectRatios)
                const normalizedVideoResolution = normalizeModelOption(videoResolution, videoModelMetaInfo?.videoResolutions)
                const normalizedVideoDuration = normalizeModelOption(videoDuration, videoModelMetaInfo?.videoDurations)
                if (!await claimConversation()) return
                await recordAcceptedReferences()

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
                            messages: providerMessages,
                            aiModelMetaInfo,
                            imageModelMetaInfo,
                            videoModelMetaInfo,
                            workspaceId,
                            aiChatThreadId,
                            organizationId,
                            assetLeaseId: lease.leaseId,
                            assetLeaseHolderId: leaseHolderId,
                            enableImageGeneration: actionTimelineSelected ? false : enableImageGeneration,
                            imageSize,
                            videoAspectRatio: routedAiVideoModel ? normalizedVideoAspectRatio : undefined,
                            videoResolution: routedAiVideoModel ? normalizedVideoResolution : undefined,
                            videoDurationSeconds: routedAiVideoModel && normalizedVideoDuration
                                ? Number(normalizedVideoDuration)
                                : undefined,
                            videoSourceForExtension: routedAiVideoModel
                                ? resolvedVideoSourceForExtension
                                : undefined,
                            videoSourceDurationSeconds: routedAiVideoModel
                                ? resolvedVideoSourceDurationSeconds
                                : undefined,
                            capabilityReferences: characterCreatorRouting.capabilityReferences,
                            capabilityInputs,
                            promptReferenceAssetIds: authorizedPromptReferences.assetIds,
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
