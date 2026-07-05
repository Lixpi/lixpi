'use strict'

import * as process from 'process'

import type NatsService from '@lixpi/nats-service'
import { info } from '@lixpi/debug-tools'
import {
    MEDIA_DESCRIPTOR_VERSION as DESCRIPTOR_VERSION,
    type AiChatThread,
    type ContentDescriptor,
    type Document,
    type ImageBranchCandidateImage,
    type ImageBranchCandidateSnapshot,
    type ProviderName,
    type WorkspaceContextNode,
    type WorkspaceContextResolution,
    type WorkspaceContextSelection,
} from '@lixpi/constants'

import WorkspaceModel from '../../models/workspace.ts'
import DocumentModel from '../../models/document.ts'
import AiChatThreadModel from '../../models/ai-chat-thread.ts'
import {
    describeMediaStill as defaultDescribeMediaStill,
    describeTextContent as defaultDescribeTextContent,
    type MediaDescriptorResult,
} from '../media-descriptor.ts'
import { callStructuredVlm, type VlmCallArgs, type VlmCallResult, type VlmJsonSchema } from '../extraction/vlm-client.ts'
import { resolveImageUrls } from '../utils/attachments.ts'
import type { ChatMessage, ProviderState } from './state.ts'
import type { StreamPublisher } from './stream-publisher.ts'

type WorkspaceContextRawSelection = {
    nodeId: string
    rationale: string
    needsBetterDescriptor: boolean
}

type WorkspaceContextRawResolution = {
    selections: WorkspaceContextRawSelection[]
}

type ResolveWorkspaceContextDeps = {
    natsService: NatsService
    publisher: Pick<StreamPublisher, 'contextRelevanceResolved' | 'contextRelevanceError'>
    abortSignal?: AbortSignal
    callLlm?: (args: VlmCallArgs) => Promise<VlmCallResult<WorkspaceContextRawResolution>>
    getDocument?: typeof DocumentModel.getDocument
    getAiChatThread?: typeof AiChatThreadModel.getAiChatThread
    describeMediaStill?: typeof defaultDescribeMediaStill
    describeTextContent?: typeof defaultDescribeTextContent
    patchCanvasNodeDescriptor?: typeof WorkspaceModel.patchCanvasNodeDescriptor
}

type ProseMirrorNode = {
    type: string
    text?: string
    content?: ProseMirrorNode[]
    attrs?: Record<string, any>
}

type ProseMirrorDoc = {
    type: 'doc'
    content?: ProseMirrorNode[]
}

const SUPPORTED_RESOLVER_PROVIDERS = new Set<ProviderName>(['Anthropic', 'OpenAI', 'Google'])
const RESOLVER_VERSION = 'workspace-context-v1'
const RESOLVER_MAX_TOKENS = 4096

const RESOLUTION_SCHEMA: VlmJsonSchema = {
    name: 'resolve_workspace_context',
    description: 'Select the workspace nodes most relevant to the user prompt using compact node descriptors only.',
    schema: {
        type: 'object',
        properties: {
            selections: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        nodeId: {
                            type: 'string',
                            description: 'A nodeId copied exactly from the workspace context snapshot.',
                        },
                        rationale: {
                            type: 'string',
                            description: 'Brief reason this node is relevant to the prompt.',
                        },
                        needsBetterDescriptor: {
                            type: 'boolean',
                            description: 'True when the descriptor is too thin, failed, missing, or ambiguous and should be regenerated before final ranking.',
                        },
                    },
                    required: ['nodeId', 'rationale', 'needsBetterDescriptor'],
                    additionalProperties: false,
                },
            },
        },
        required: ['selections'],
        additionalProperties: false,
    },
}

const SYSTEM_PROMPT = [
    'You are Lixpi\'s workspace context relevance resolver.',
    'Rank workspace nodes for the next AI chat turn using compact text descriptors only. Never assume pixels or full document content beyond the metadata provided.',
    'Explicit chips and edge-forced nodes are sacred force-includes. You may include them in your selections when relevant, but the system will force-include them regardless.',
    'Generated media whose isCurrentThreadGenerated flag is true belongs to this chat turn\'s active thread. For deictic follow-ups like "it", "this", "that", "now make it", or "make this", prefer current-thread generated media over generated media from other threads unless the prompt explicitly names the other content or the node is a forced chip/edge.',
    'Select only nodes that materially help answer or generate the user request. Exclude unrelated distractors aggressively.',
    'Mark needsBetterDescriptor=true when a promising node has a missing, failed, analyzing, one-word, or ambiguous descriptor.',
    'Return strict JSON using the tool schema. Use nodeId values exactly as given.',
].join('\n')

const getResolverModel = (state: ProviderState): { provider: ProviderName; modelVersion: string } => {
    const configuredProvider = process.env.IMAGE_BRANCH_RESOLVER_PROVIDER as ProviderName | undefined
    const configuredModel = process.env.IMAGE_BRANCH_RESOLVER_MODEL_VERSION
    const provider = configuredProvider && configuredModel ? configuredProvider : state.provider
    const modelVersion = configuredProvider && configuredModel ? configuredModel : state.modelVersion

    if (!SUPPORTED_RESOLVER_PROVIDERS.has(provider)) {
        throw new Error(`Workspace context resolver requires a structured-output provider; got ${provider}`)
    }
    if (!modelVersion) {
        throw new Error(`Workspace context resolver model is not configured for provider ${provider}`)
    }

    return { provider, modelVersion }
}

const compactNodeForPrompt = (node: WorkspaceContextNode): Record<string, unknown> => ({
    nodeId: node.nodeId,
    type: node.type,
    title: node.title ?? '',
    descriptorStatus: node.descriptorStatus ?? 'missing',
    descriptorSummary: node.descriptorSummary ?? '',
    entityTags: node.entityTags ?? [],
    styleTags: node.styleTags ?? [],
    branchId: node.branchId ?? '',
    sourceThreadId: node.sourceThreadId ?? '',
    isCurrentThreadGenerated: node.isCurrentThreadGenerated === true,
    hasMediaReference: Boolean(node.imageUrl || node.fileId),
    isExplicitChip: node.isExplicitChip,
    isEdgeForced: node.isEdgeForced,
})

const buildResolverMessages = (state: ProviderState): ChatMessage[] => {
    const snapshot = state.workspaceContextSnapshot
    if (!snapshot) throw new Error('Workspace context snapshot is required')

    return [{
        role: 'user',
        content: [
            `User prompt: ${snapshot.promptText}`,
            `Workspace ID: ${snapshot.workspaceId}`,
            `Thread ID: ${snapshot.threadId}`,
            '',
            'Workspace node descriptor JSON:',
            JSON.stringify(snapshot.nodes.map(compactNodeForPrompt), null, 2),
            '',
            'Return the node ids that should be included automatically for this chat turn.',
        ].join('\n'),
    }]
}

const normalizeOptionalNodeId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

const normalizeRawSelections = (
    selections: unknown,
    nodeById: Map<string, WorkspaceContextNode>
): WorkspaceContextRawSelection[] => {
    if (!Array.isArray(selections)) return []
    const out: WorkspaceContextRawSelection[] = []
    const seen = new Set<string>()
    for (const selection of selections) {
        if (typeof selection !== 'object' || selection === null) continue
        const nodeId = normalizeOptionalNodeId((selection as any).nodeId)
        if (!nodeId || seen.has(nodeId)) continue
        if (!nodeById.has(nodeId)) {
            throw new Error(`Workspace context resolver returned unknown nodeId: ${nodeId}`)
        }
        seen.add(nodeId)
        out.push({
            nodeId,
            rationale: typeof (selection as any).rationale === 'string' ? (selection as any).rationale.trim() : '',
            needsBetterDescriptor: (selection as any).needsBetterDescriptor === true,
        })
    }
    return out
}

const buildResolution = (
    state: ProviderState,
    parsed: WorkspaceContextRawResolution
): WorkspaceContextResolution => {
    const snapshot = state.workspaceContextSnapshot
    if (!snapshot) throw new Error('Workspace context snapshot is required')

    const nodeById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))
    const rawSelections = normalizeRawSelections(parsed.selections, nodeById)
    const rationaleByNodeId = new Map(rawSelections.map((selection) => [selection.nodeId, selection.rationale]))
    const selections: WorkspaceContextSelection[] = []
    const selectedNodeIds = new Set<string>()

    const addSelection = (node: WorkspaceContextNode): void => {
        if (selectedNodeIds.has(node.nodeId)) return
        selectedNodeIds.add(node.nodeId)
        const role = node.isExplicitChip ? 'forced-chip' : node.isEdgeForced ? 'forced-edge' : 'auto'
        const rationale = rationaleByNodeId.get(node.nodeId)
        selections.push({
            nodeId: node.nodeId,
            role,
            ...(rationale ? { rationale } : {}),
        })
    }

    for (const node of snapshot.nodes) {
        if (node.isExplicitChip) addSelection(node)
    }
    for (const node of snapshot.nodes) {
        if (node.isEdgeForced) addSelection(node)
    }
    for (const rawSelection of rawSelections) {
        const node = nodeById.get(rawSelection.nodeId)
        if (node) addSelection(node)
    }

    const narrowedMediaNodeIds = selections
        .map((selection) => nodeById.get(selection.nodeId))
        .filter((node): node is WorkspaceContextNode => Boolean(node && (node.type === 'image' || node.type === 'video')))
        .map((node) => node.nodeId)

    return {
        resolverVersion: snapshot.resolverVersion || RESOLVER_VERSION,
        selections,
        narrowedMediaNodeIds,
    }
}

const isDescriptorWeak = (node: WorkspaceContextNode): boolean => {
    const summary = node.descriptorSummary?.trim() ?? ''
    if (!node.descriptorStatus || node.descriptorStatus === 'analyzing' || node.descriptorStatus === 'failed') return true
    if (!summary) return true
    if (summary.length < 18) return true
    return summary.split(/\s+/).filter(Boolean).length <= 2
}

const getSelfHealCandidates = (
    state: ProviderState,
    resolution: WorkspaceContextResolution,
    rawSelections: WorkspaceContextRawSelection[],
): WorkspaceContextNode[] => {
    const snapshot = state.workspaceContextSnapshot
    if (!snapshot) return []

    const nodeById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))
    const selectedNodeIds = new Set(resolution.selections.map((selection) => selection.nodeId))
    for (const rawSelection of rawSelections) {
        if (rawSelection.needsBetterDescriptor) selectedNodeIds.add(rawSelection.nodeId)
    }

    const flaggedByLlm = new Set(
        rawSelections
            .filter((selection) => selection.needsBetterDescriptor)
            .map((selection) => selection.nodeId)
    )
    const candidates: WorkspaceContextNode[] = []
    for (const nodeId of selectedNodeIds) {
        const node = nodeById.get(nodeId)
        if (!node) continue
        if (flaggedByLlm.has(nodeId) || isDescriptorWeak(node)) {
            candidates.push(node)
        }
    }
    return candidates
}

const toContentDescriptor = (result: MediaDescriptorResult, now: number): ContentDescriptor | undefined => {
    const summary = result.summary.trim()
    if (!summary) return undefined
    return {
        status: 'ready',
        summary,
        entityTags: result.entityTags,
        styleTags: result.styleTags,
        source: 'analysis',
        version: DESCRIPTOR_VERSION,
        updatedAt: now,
    }
}

const applyImprovedDescriptorsToSnapshot = (
    state: ProviderState,
    improvedDescriptors: Record<string, ContentDescriptor>,
): ProviderState => {
    const snapshot = state.workspaceContextSnapshot
    if (!snapshot) return state
    const nodes = snapshot.nodes.map((node) => {
        const descriptor = improvedDescriptors[node.nodeId]
        if (!descriptor) return node
        return {
            ...node,
            descriptorStatus: descriptor.status,
            descriptorSummary: descriptor.summary,
            entityTags: descriptor.entityTags,
            styleTags: descriptor.styleTags,
        }
    })
    return {
        ...state,
        workspaceContextSnapshot: {
            ...snapshot,
            nodes,
        },
    }
}

const extractTextFromNode = (node: ProseMirrorNode): string => {
    if (node.type === 'text' && node.text) return node.text
    if (node.type === 'hard_break') return '\n'
    if (node.type === 'code_block' && node.content) {
        return `\n\`\`\`\n${node.content.map(extractTextFromNode).join('')}\n\`\`\`\n`
    }
    if (!node.content) return ''
    const childText = node.content.map(extractTextFromNode).join('')
    return ['paragraph', 'heading', 'blockquote', 'list_item'].includes(node.type) ? `${childText}\n` : childText
}

const extractTextFromProseMirror = (content: string | object | undefined): string => {
    if (content === undefined) return ''
    if (typeof content === 'string') {
        try {
            const parsed = JSON.parse(content) as ProseMirrorDoc
            if (parsed?.type === 'doc') return extractTextFromProseMirror(parsed)
        } catch {
            return content.trim()
        }
    }
    const doc = content as ProseMirrorDoc
    if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return ''
    return doc.content.map(extractTextFromNode).join('').trim()
}

const hasModelError = (value: unknown): value is { error: string } =>
    typeof value === 'object' && value !== null && typeof (value as any).error === 'string'

const getFallbackText = (node: WorkspaceContextNode): string =>
    [node.title, node.descriptorSummary].filter((part): part is string => Boolean(part?.trim())).join('\n')

const resolveDocumentText = async (
    node: WorkspaceContextNode,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<{ title?: string; text: string } | undefined> => {
    const referenceId = node.referenceId
    if (!referenceId) {
        const text = getFallbackText(node)
        return text ? { title: node.title, text } : undefined
    }

    const document = await (deps.getDocument ?? DocumentModel.getDocument)({
        workspaceId: state.workspaceId,
        documentId: referenceId,
    } as any)
    if (hasModelError(document)) {
        const text = getFallbackText(node)
        return text ? { title: node.title, text } : undefined
    }

    const doc = document as Document
    const text = extractTextFromProseMirror(doc.content) || getFallbackText(node)
    return text ? { title: doc.title || node.title, text } : undefined
}

const resolveThreadText = async (
    node: WorkspaceContextNode,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<{ title?: string; text: string } | undefined> => {
    const referenceId = node.referenceId
    if (!referenceId) {
        const text = getFallbackText(node)
        return text ? { title: node.title, text } : undefined
    }

    const thread = await (deps.getAiChatThread ?? AiChatThreadModel.getAiChatThread)({
        workspaceId: state.workspaceId,
        threadId: referenceId,
    } as any)
    if (hasModelError(thread)) {
        const text = getFallbackText(node)
        return text ? { title: node.title, text } : undefined
    }

    const chatThread = thread as AiChatThread
    const text = extractTextFromProseMirror(chatThread.content) || getFallbackText(node)
    return text ? { title: chatThread.title || node.title, text } : undefined
}

const improveDescriptorForNode = async (
    node: WorkspaceContextNode,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
    resolverModel: { provider: ProviderName; modelVersion: string },
): Promise<ContentDescriptor | undefined> => {
    const now = Date.now()
    if (node.type === 'image' || node.type === 'video') {
        if (!node.imageUrl) return undefined
        const describeMediaStill = deps.describeMediaStill ?? defaultDescribeMediaStill
        const result = await describeMediaStill({
            provider: resolverModel.provider,
            modelVersion: resolverModel.modelVersion,
            imageUrl: node.imageUrl,
            natsService: deps.natsService,
            abortSignal: deps.abortSignal,
        })
        return toContentDescriptor(result, now)
    }

    if (node.type === 'document') {
        const resolved = await resolveDocumentText(node, state, deps)
        if (!resolved?.text) return undefined
        const describeTextContent = deps.describeTextContent ?? defaultDescribeTextContent
        const result = await describeTextContent({
            provider: resolverModel.provider,
            modelVersion: resolverModel.modelVersion,
            text: resolved.text,
            title: resolved.title,
            natsService: deps.natsService,
            abortSignal: deps.abortSignal,
        })
        return toContentDescriptor(result, now)
    }

    if (node.type === 'aiChatThread') {
        const resolved = await resolveThreadText(node, state, deps)
        if (!resolved?.text) return undefined
        const describeTextContent = deps.describeTextContent ?? defaultDescribeTextContent
        const result = await describeTextContent({
            provider: resolverModel.provider,
            modelVersion: resolverModel.modelVersion,
            text: resolved.text,
            title: resolved.title,
            natsService: deps.natsService,
            abortSignal: deps.abortSignal,
        })
        return toContentDescriptor(result, now)
    }

    return undefined
}

const improveDescriptors = async (
    nodes: WorkspaceContextNode[],
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
    resolverModel: { provider: ProviderName; modelVersion: string },
): Promise<Record<string, ContentDescriptor>> => {
    const improvedDescriptors: Record<string, ContentDescriptor> = {}
    for (const node of nodes) {
        try {
            const descriptor = await improveDescriptorForNode(node, state, deps, resolverModel)
            if (!descriptor) continue
            improvedDescriptors[node.nodeId] = descriptor
            await (deps.patchCanvasNodeDescriptor ?? WorkspaceModel.patchCanvasNodeDescriptor)({
                workspaceId: state.workspaceId,
                nodeId: node.nodeId,
                descriptor,
            })
        } catch (error) {
            console.error(`Failed to self-heal descriptor for ${node.nodeId}:`, error)
        }
    }
    return improvedDescriptors
}

const buildSelectedContextMessage = async (
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
    resolution: WorkspaceContextResolution,
): Promise<ChatMessage | undefined> => {
    const snapshot = state.workspaceContextSnapshot
    if (!snapshot || resolution.selections.length === 0) return undefined

    const nodeById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))
    const blocks: Array<Record<string, any>> = [{
        type: 'input_text',
        text: JSON.stringify({
            type: 'workspace_context_resolution',
            selections: resolution.selections,
        }),
    }]

    for (const selection of resolution.selections) {
        const node = nodeById.get(selection.nodeId)
        if (!node) continue

        if (node.type === 'document') {
            const resolved = await resolveDocumentText(node, state, deps)
            if (!resolved) continue
            const payload: Record<string, string> = {
                type: 'workspace_document',
                nodeId: node.nodeId,
                role: selection.role,
                content: resolved.text,
            }
            if (resolved.title) payload.title = resolved.title
            blocks.push({ type: 'input_text', text: JSON.stringify(payload) })
        } else if (node.type === 'aiChatThread') {
            const resolved = await resolveThreadText(node, state, deps)
            if (!resolved) continue
            const payload: Record<string, string> = {
                type: 'workspace_ai_chat_thread',
                nodeId: node.nodeId,
                role: selection.role,
                content: resolved.text,
            }
            if (resolved.title) payload.title = resolved.title
            blocks.push({ type: 'input_text', text: JSON.stringify(payload) })
        } else if (node.type === 'image' || node.type === 'video') {
            blocks.push({
                type: 'input_text',
                text: JSON.stringify({
                    type: node.type === 'video' ? 'workspace_video' : 'workspace_image',
                    nodeId: node.nodeId,
                    role: selection.role,
                    title: node.title ?? '',
                    descriptorSummary: node.descriptorSummary ?? '',
                    entityTags: node.entityTags ?? [],
                    styleTags: node.styleTags ?? [],
                    branchId: node.branchId ?? '',
                    sourceThreadId: node.sourceThreadId ?? '',
                    isCurrentThreadGenerated: node.isCurrentThreadGenerated === true,
                }),
            })
            if (node.imageUrl) {
                blocks.push({ type: 'input_image', image_url: node.imageUrl, detail: 'auto' })
            }
        }
    }

    if (blocks.length <= 1) return undefined
    if (!state.imageModelVersion && !state.videoModelVersion) {
        const resolvedBlocks = await resolveImageUrls(blocks, deps.natsService)
        return { role: 'user', content: Array.isArray(resolvedBlocks) ? resolvedBlocks : blocks }
    }
    return { role: 'user', content: blocks }
}

const isMediaWorkspaceNode = (node: WorkspaceContextNode | undefined): node is WorkspaceContextNode =>
    Boolean(node && (node.type === 'image' || node.type === 'video'))

const mediaNodeIdsFromSelections = (
    selections: WorkspaceContextSelection[],
    nodeById: Map<string, WorkspaceContextNode>,
): string[] => selections
    .map((selection) => nodeById.get(selection.nodeId))
    .filter(isMediaWorkspaceNode)
    .map((node) => node.nodeId)

const filterAutoMediaOutsideExistingBranchSnapshot = (
    state: ProviderState,
    resolution: WorkspaceContextResolution,
): WorkspaceContextResolution => {
    const snapshot = state.workspaceContextSnapshot
    const branchSnapshot = state.imageBranchCandidateSnapshot
    if (!snapshot || !branchSnapshot) return resolution

    const branchCandidateNodeIds = new Set(branchSnapshot.candidates.map((candidate) => candidate.nodeId))
    if (branchCandidateNodeIds.size === 0) return resolution

    const nodeById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))
    let changed = false
    const selections = resolution.selections.filter((selection) => {
        const node = nodeById.get(selection.nodeId)
        if (!isMediaWorkspaceNode(node)) return true
        if (branchCandidateNodeIds.has(selection.nodeId)) return true
        if (selection.role === 'forced-chip' || selection.role === 'forced-edge') return true
        changed = true
        return false
    })

    if (!changed) return resolution
    return {
        ...resolution,
        selections,
        narrowedMediaNodeIds: mediaNodeIdsFromSelections(selections, nodeById),
    }
}

const buildCandidateFromWorkspaceNode = (
    node: WorkspaceContextNode,
    workspaceId: string,
): ImageBranchCandidateImage | undefined => {
    if (node.type !== 'image' && node.type !== 'video') return undefined
    if (!node.imageUrl) return undefined
    const roleHints: ImageBranchCandidateImage['roleHints'] = node.branchId
        ? ['base-context', 'generated-variant', 'branch-leaf']
        : ['base-context']

    return {
        nodeId: node.nodeId,
        fileId: node.fileId,
        workspaceId,
        imageUrl: node.imageUrl,
        mediaKind: node.type === 'video' ? 'video' : 'image',
        roleHints,
        branchId: node.branchId,
        ancestorNodeIds: [node.nodeId],
        sourceContextNodeIds: [node.nodeId],
        visualEntitySummary: node.descriptorSummary,
        visualStyleSummary: node.descriptorSummary,
        entityTags: node.entityTags ?? [],
        styleTags: node.styleTags ?? [],
    }
}

// Rebuild the branch-resolver transcript after workspace relevance has narrowed
// the media set. The browser snapshot's original transcriptContext can mention
// candidates that were just filtered out, and those stale nodeIds make the VLM
// produce decisions for images it can no longer see. This keeps the textual
// labels and attached candidate images aligned.
const buildNarrowedTranscriptContext = (
    candidates: ImageBranchCandidateImage[],
    promptText: string,
    activeTargetNodeId: string | undefined,
): string => {
    const candidateLines = candidates.map((candidate) => [
        `nodeId=${candidate.nodeId}`,
        `kind=${candidate.mediaKind ?? 'image'}`,
        `roles=${candidate.roleHints.join(',')}`,
        candidate.branchId ? `branchId=${candidate.branchId}` : undefined,
        candidate.visualEntitySummary ? `visualEntity=${candidate.visualEntitySummary}` : undefined,
        candidate.visualStyleSummary ? `visualStyle=${candidate.visualStyleSummary}` : undefined,
        candidate.promptText ? `promptText=${candidate.promptText.slice(0, 800)}` : undefined,
    ].filter(Boolean).join(' | '))

    return [
        `Current user prompt: ${promptText}`,
        activeTargetNodeId ? `Active target nodeId: ${activeTargetNodeId}` : undefined,
        'Candidate media labels:',
        ...candidateLines,
    ].filter((line): line is string => typeof line === 'string').join('\n')
}

const buildNarrowedImageBranchSnapshot = (
    state: ProviderState,
    resolution: WorkspaceContextResolution,
): ImageBranchCandidateSnapshot | undefined => {
    const snapshot = state.workspaceContextSnapshot
    if (!snapshot) return state.imageBranchCandidateSnapshot

    const nodeById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))
    const existingSnapshot = state.imageBranchCandidateSnapshot
    const existingByNodeId = new Map((existingSnapshot?.candidates ?? []).map((candidate) => [candidate.nodeId, candidate]))
    const selectedMediaSelections = resolution.selections.filter((selection) => isMediaWorkspaceNode(nodeById.get(selection.nodeId)))
    if (!existingSnapshot && selectedMediaSelections.length === 0) return undefined

    const candidates: ImageBranchCandidateImage[] = []

    for (const selection of selectedMediaSelections) {
        const existing = existingByNodeId.get(selection.nodeId)
        if (existing) {
            candidates.push(existing)
            continue
        }
        // When a browser-built branch snapshot already exists, only explicit
        // chips and edge-forced media are allowed to expand it. Plain automatic
        // workspace-relevance picks are descriptor-selected context, not visual
        // branch candidates, so adding them here would let unrelated workspace
        // media leak into the branch VLM.
        if (existingSnapshot && selection.role !== 'forced-chip' && selection.role !== 'forced-edge') continue
        const node = nodeById.get(selection.nodeId)
        const candidate = node ? buildCandidateFromWorkspaceNode(node, state.workspaceId) : undefined
        if (candidate) candidates.push(candidate)
    }

    if (existingSnapshot && candidates.length === 0) return existingSnapshot

    const activeTargetNodeId = existingSnapshot?.activeTargetNodeId && candidates.some((candidate) => candidate.nodeId === existingSnapshot.activeTargetNodeId)
        ? existingSnapshot.activeTargetNodeId
        : undefined
    const promptText = existingSnapshot?.promptText ?? snapshot.promptText

    return {
        resolverVersion: existingSnapshot?.resolverVersion ?? snapshot.resolverVersion,
        threadId: existingSnapshot?.threadId ?? snapshot.threadId,
        regionNodeId: existingSnapshot?.regionNodeId ?? snapshot.threadId,
        ...(activeTargetNodeId ? { activeTargetNodeId } : {}),
        promptText,
        promptFingerprint: existingSnapshot?.promptFingerprint ?? `workspace-context:${snapshot.threadId}:${snapshot.promptText}:${selectedMediaSelections.map((selection) => selection.nodeId).join(',')}`,
        candidates,
        transcriptContext: buildNarrowedTranscriptContext(candidates, promptText, activeTargetNodeId),
    }
}

export const resolveWorkspaceContext = async (
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<Partial<ProviderState>> => {
    const snapshot = state.workspaceContextSnapshot
    if (!snapshot) return {}

    try {
        const { provider, modelVersion } = getResolverModel(state)
        const callLlm = deps.callLlm ?? ((args: VlmCallArgs) => callStructuredVlm<WorkspaceContextRawResolution>(args))
        const rank = async (rankState: ProviderState): Promise<{
            result: VlmCallResult<WorkspaceContextRawResolution>
            rawSelections: WorkspaceContextRawSelection[]
            resolution: WorkspaceContextResolution
        }> => {
            const result = await callLlm({
                provider,
                modelVersion,
                systemPrompt: SYSTEM_PROMPT,
                userMessages: buildResolverMessages(rankState),
                schema: RESOLUTION_SCHEMA,
                natsService: deps.natsService,
                temperature: 0,
                maxTokens: RESOLVER_MAX_TOKENS,
                abortSignal: deps.abortSignal,
            })
            const rankSnapshot = rankState.workspaceContextSnapshot
            if (!rankSnapshot) throw new Error('Workspace context snapshot is required')
            const nodeById = new Map(rankSnapshot.nodes.map((node) => [node.nodeId, node]))
            const rawSelections = normalizeRawSelections(result.parsed.selections, nodeById)
            const resolution = buildResolution(rankState, { selections: rawSelections })
            return { result, rawSelections, resolution }
        }

        const firstRank = await rank(state)
        let effectiveState = state
        let result = firstRank.result
        let resolution = firstRank.resolution
        let improvedDescriptors: Record<string, ContentDescriptor> = {}

        const selfHealCandidates = getSelfHealCandidates(state, firstRank.resolution, firstRank.rawSelections)
        if (selfHealCandidates.length > 0) {
            improvedDescriptors = await improveDescriptors(selfHealCandidates, state, deps, { provider, modelVersion })
            if (Object.keys(improvedDescriptors).length > 0) {
                effectiveState = applyImprovedDescriptorsToSnapshot(state, improvedDescriptors)
                const secondRank = await rank(effectiveState)
                result = secondRank.result
                resolution = {
                    ...secondRank.resolution,
                    improvedDescriptors,
                }
            }
        }

        resolution = filterAutoMediaOutsideExistingBranchSnapshot(effectiveState, resolution)
        const contextMessage = await buildSelectedContextMessage(effectiveState, deps, resolution)
        const imageBranchCandidateSnapshot = buildNarrowedImageBranchSnapshot(effectiveState, resolution)

        deps.publisher.contextRelevanceResolved(resolution)
        info(`[WorkspaceContextResolver] resolved ${JSON.stringify({
            workspaceId: effectiveState.workspaceId,
            aiChatThreadId: effectiveState.aiChatThreadId,
            provider,
            model: result.modelName || modelVersion,
            selectedNodeIds: resolution.selections.map((selection) => selection.nodeId),
            narrowedMediaNodeIds: resolution.narrowedMediaNodeIds,
            improvedDescriptorNodeIds: Object.keys(improvedDescriptors),
        }, null, 0)}`)

        return {
            workspaceContextResolution: resolution,
            ...(effectiveState.workspaceContextSnapshot !== state.workspaceContextSnapshot ? { workspaceContextSnapshot: effectiveState.workspaceContextSnapshot } : {}),
            ...(contextMessage ? { messages: [contextMessage, ...state.messages] } : {}),
            ...(imageBranchCandidateSnapshot ? { imageBranchCandidateSnapshot } : {}),
        }
    } catch (error: any) {
        const message = error?.message ?? String(error)
        deps.publisher.contextRelevanceError(message)
        throw error
    }
}
