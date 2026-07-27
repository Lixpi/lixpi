'use strict'

import * as process from 'process'

import type NatsService from '@lixpi/nats-service'
import { info } from '@lixpi/debug-tools'
import {
    MEDIA_DESCRIPTOR_VERSION as DESCRIPTOR_VERSION,
    type Asset,
    type ContentDescriptor,
    type MediaBranchCandidateImage,
    type MediaBranchCandidateSnapshot,
    type ProviderName,
    type WorkspaceContextNode,
    type WorkspaceContextResolution,
    type WorkspaceContextSelection,
    type WorkspaceContextSnapshot,
} from '@lixpi/constants'

import AssetModel from '../../models/asset.ts'
import BlobModel from '../../models/blob.ts'
import AssetDocumentService from '../../services/asset-document-service.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'
import {
    describeMediaStill as defaultDescribeMediaStill,
    describeTextContent as defaultDescribeTextContent,
    type MediaDescriptorResult,
} from '../media-descriptor.ts'
import { callStructuredVlm, type VlmCallArgs, type VlmCallResult, type VlmJsonSchema } from '../structured-vlm/structured-vlm-client.ts'
import { resolveImageUrls } from '../utils/attachments.ts'
import { buildCandidateTranscriptContext, restrictSnapshotToExplicitRefs } from './media-branch-snapshot.ts'
import type { ChatMessage, ProviderState } from './state.ts'
import type { StreamPublisher } from './stream-publisher.ts'
import { capabilityArtifactBackendRegistry } from '../../capability-system/capability-artifacts.ts'

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
    getAsset?: (assetId: string) => Promise<Asset | { error: string }>
    describeMediaStill?: typeof defaultDescribeMediaStill
    describeTextContent?: typeof defaultDescribeTextContent
    loadAssetDocumentSnapshot?: typeof AssetDocumentService.loadCurrentSnapshot
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
    'Edge-forced nodes are sacred force-includes. You may include them in your selections when relevant, but the system will force-include them regardless.',
    'Generated media whose isCurrentConversationGenerated flag is true belongs to this chat turn\'s active conversation Asset. For deictic follow-ups like "it", "this", "that", "now make it", or "make this", prefer media from the current conversation over media from other conversations unless the prompt explicitly names the other content or the node is a forced chip/edge.',
    'Select only nodes that materially help answer or generate the user request. Exclude unrelated distractors aggressively.',
    'Mark needsBetterDescriptor=true when a promising node has a missing, failed, analyzing, one-word, or ambiguous descriptor.',
    'Return strict JSON using the tool schema. Use nodeId values exactly as given.',
].join('\n')

const getResolverModel = (state: ProviderState): { provider: ProviderName; modelVersion: string } => {
    const configuredProvider = process.env.MEDIA_BRANCH_RESOLVER_PROVIDER as ProviderName | undefined
    const configuredModel = process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION
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
    artifactTypeId: node.artifactTypeId ?? '',
    title: node.title ?? '',
    descriptorStatus: node.descriptorStatus ?? 'missing',
    descriptorSummary: node.descriptorSummary ?? '',
    entityTags: node.entityTags ?? [],
    styleTags: node.styleTags ?? [],
    branchId: node.branchId ?? '',
    sourceConversationAssetId: node.sourceConversationAssetId ?? '',
    isCurrentConversationGenerated: node.isCurrentConversationGenerated === true,
    hasMediaReference: Boolean(node.assetId),
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
            `Conversation Asset ID: ${snapshot.conversationAssetId}`,
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

    // Explicit chips make the context exclusive: when the user attached chips,
    // nothing else — edge-forced or LLM-picked — may enter the selection.
    const hasExplicitChips = snapshot.nodes.some((node) => node.isExplicitChip)
    for (const node of snapshot.nodes) {
        if (node.isExplicitChip) addSelection(node)
    }
    if (!hasExplicitChips) {
        for (const node of snapshot.nodes) {
            if (node.isEdgeForced) addSelection(node)
        }
        for (const rawSelection of rawSelections) {
            const node = nodeById.get(rawSelection.nodeId)
            if (node) addSelection(node)
        }
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

const resolveContextAsset = async (
    assetId: string,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<Asset | { error: string }> => {
    const asset = deps.getAsset
        ? await deps.getAsset(assetId)
        : state.eventMeta?.userId
            ? await AssetModel.get({
                assetId,
                requester: await getAssetRequesterContext(state.eventMeta.userId),
            })
            : { error: 'USER_ID_REQUIRED' }
    if ('error' in asset) return asset
    const organizationId = state.eventMeta?.organizationId
    if (!organizationId || asset.organizationId !== organizationId) {
        return { error: 'ORGANIZATION_BOUNDARY_VIOLATION' }
    }
    return asset
}

const loadAssetDocumentText = async (
    asset: Asset,
    role: 'content',
    deps: ResolveWorkspaceContextDeps,
): Promise<string> => {
    if (!asset.documents[role]) return ''
    const loadSnapshot = deps.loadAssetDocumentSnapshot ?? AssetDocumentService.loadCurrentSnapshot
    const snapshot = await loadSnapshot(asset, role)
    return extractTextFromProseMirror(snapshot?.doc)
}

const resolveAssetMediaUrl = async (
    asset: Asset,
): Promise<string | undefined> => {
    if (!asset.media) return undefined
    const names = asset.media.kind === 'image'
        ? ['preview', 'original'] as const
        : asset.media.kind === 'video'
            ? ['representativeFrame', 'poster', 'thumbnail'] as const
            : asset.media.kind === 'document'
                ? ['poster', 'thumbnail'] as const
                : [] as const
    const rendition = names
        .map((name) => asset.media!.renditions[name])
        .find((candidate) => candidate?.status === 'ready' && candidate.blobHash)
    if (rendition?.status !== 'ready' || !rendition.blobHash) return undefined
    const blob = await BlobModel.get({ organizationId: asset.organizationId, blobHash: rendition.blobHash })
    return blob ? `nats-obj://${blob.bucketName}/${blob.objectKey}` : undefined
}

const resolveDocumentText = async (
    node: WorkspaceContextNode,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<{ title?: string; text: string } | undefined> => {
    const assetId = node.assetId
    if (!assetId) {
        const text = getFallbackText(node)
        return text ? { title: node.title, text } : undefined
    }

    const asset = await resolveContextAsset(assetId, state, deps)
    if (hasModelError(asset)) {
        const text = getFallbackText(node)
        return text ? { title: node.title, text } : undefined
    }

    const text = await loadAssetDocumentText(asset, 'content', deps) || getFallbackText(node)
    return text ? { title: asset.title || node.title, text } : undefined
}

const improveDescriptorForNode = async (
    node: WorkspaceContextNode,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
    resolverModel: { provider: ProviderName; modelVersion: string },
): Promise<ContentDescriptor | undefined> => {
    const now = Date.now()
    if (node.type === 'image' || node.type === 'video') {
        if (!node.assetId) return undefined
        const asset = await resolveContextAsset(node.assetId, state, deps)
        if (hasModelError(asset)) return undefined
        const imageUrl = await resolveAssetMediaUrl(asset)
        if (!imageUrl) return undefined
        const describeMediaStill = deps.describeMediaStill ?? defaultDescribeMediaStill
        const result = await describeMediaStill({
            provider: resolverModel.provider,
            modelVersion: resolverModel.modelVersion,
            imageUrl,
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
            if (node.assetId) {
                const asset = await resolveContextAsset(node.assetId, state, deps)
                if (!hasModelError(asset)) {
                    const userId = state.eventMeta?.userId
                    if (userId) {
                        const requester = await getAssetRequesterContext(userId)
                        for (let attempt = 0; attempt < 5; attempt += 1) {
                            const current = attempt === 0 ? asset : await AssetModel.get({ assetId: asset.assetId, requester })
                            if ('error' in current) break
                            const persisted = await AssetModel.updateMetadata({
                                assetId: current.assetId,
                                requester,
                                expectedRevision: current.revision,
                                descriptor,
                            })
                            if (!('error' in persisted) || persisted.error !== 'REVISION_CONFLICT') break
                        }
                    }
                }
            }
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
    let expandedCapabilityArtifact = false

    for (const selection of resolution.selections) {
        const node = nodeById.get(selection.nodeId)
        if (!node) continue

        if (node.type === 'capabilityArtifact') {
            const artifactBlocks = await resolveCapabilityArtifactContextBlocks(node, selection.role, state, deps)
            if (artifactBlocks.length > 0) {
                expandedCapabilityArtifact = true
                blocks.push(...artifactBlocks)
            }
        } else if (node.type === 'document') {
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
                    sourceConversationAssetId: node.sourceConversationAssetId ?? '',
                    isCurrentConversationGenerated: node.isCurrentConversationGenerated === true,
                }),
            })
            if (node.assetId) {
                const asset = await resolveContextAsset(node.assetId, state, deps)
                if (!hasModelError(asset)) {
                    const imageUrl = await resolveAssetMediaUrl(asset)
                    if (imageUrl) blocks.push({ type: 'input_image', image_url: imageUrl, detail: 'auto' })
                }
            }
        }
    }

    if (blocks.length <= 1) return undefined
    if (expandedCapabilityArtifact || (!state.imageModelVersion && !state.videoModelVersion)) {
        const resolvedBlocks = await resolveImageUrls(blocks, deps.natsService)
        return { role: 'user', content: Array.isArray(resolvedBlocks) ? resolvedBlocks : blocks }
    }
    return { role: 'user', content: blocks }
}

const resolveCapabilityArtifactContextBlocks = async (
    node: WorkspaceContextNode,
    role: WorkspaceContextSelection['role'],
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<Array<Record<string, any>>> => {
    if (!node.assetId) throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_ASSET_REQUIRED:${node.nodeId}`)
    const artifactAsset = await resolveContextAsset(node.assetId, state, deps)
    if (hasModelError(artifactAsset)
        || artifactAsset.states.lifecycle !== 'active'
        || !artifactAsset.artifact
        || !artifactAsset.documents.capabilityArtifact) {
        throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_UNAVAILABLE:${node.assetId}`)
    }
    if (node.artifactTypeId && node.artifactTypeId !== artifactAsset.artifact.artifactTypeId) {
        throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_TYPE_MISMATCH:${node.nodeId}`)
    }

    const definition = capabilityArtifactBackendRegistry.require(artifactAsset.artifact.artifactTypeId).shared
    const loadSnapshot = deps.loadAssetDocumentSnapshot ?? AssetDocumentService.loadCurrentSnapshot
    const snapshot = await loadSnapshot(artifactAsset, 'capabilityArtifact')
    if (!snapshot) throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_NOT_READY:${node.nodeId}`)
    definition.assertInitialDocument(snapshot.doc)

    const citedAssets: Asset[] = []
    for (const assetId of definition.collectReferencedAssetIds(snapshot.doc)) {
        const citedAsset = await resolveContextAsset(assetId, state, deps)
        if (hasModelError(citedAsset)) {
            throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_REFERENCE_UNAVAILABLE:${assetId}`)
        }
        if (citedAsset.states.lifecycle !== 'active') {
            throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_REFERENCE_UNAVAILABLE:${assetId}`)
        }
        if (citedAsset.artifact || citedAsset.primaryCategory === 'capabilityArtifact') {
            throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_NESTED_REFERENCE_FORBIDDEN:${assetId}`)
        }
        citedAssets.push(citedAsset)
    }

    const labels = new Map(citedAssets.map(asset => [asset.assetId, asset.title]))
    const serialized = definition.serializeForModel(snapshot.doc, labels)
    const blocks: Array<Record<string, any>> = [{
        type: 'input_text',
        text: JSON.stringify({
            type: 'workspace_capability_artifact',
            nodeId: node.nodeId,
            role,
            artifactType: definition.displayName,
            title: artifactAsset.title,
            content: serialized.text,
        }),
    }]

    for (const citedAsset of citedAssets) {
        blocks.push(...await resolveCapabilityArtifactCitedAssetBlocks(citedAsset, deps))
    }
    return blocks
}

const resolveCapabilityArtifactCitedAssetBlocks = async (
    asset: Asset,
    deps: ResolveWorkspaceContextDeps,
): Promise<Array<Record<string, any>>> => {
    if (asset.media?.kind === 'image' || asset.media?.kind === 'video') {
        const imageUrl = await resolveAssetMediaUrl(asset)
        if (!imageUrl) throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_MEDIA_NOT_READY:${asset.title}`)
        return [{
            type: 'input_text',
            text: JSON.stringify({
                type: asset.media.kind === 'video'
                    ? 'workspace_artifact_video_reference'
                    : 'workspace_artifact_image_reference',
                title: asset.title,
            }),
        }, { type: 'input_image', image_url: imageUrl, detail: 'high' }]
    }

    if (asset.media?.kind === 'audio') {
        const dataUrl = await resolveAssetAudioDataUrl(asset, deps)
        return [{
            type: 'input_text',
            text: JSON.stringify({ type: 'workspace_artifact_audio_reference', title: asset.title }),
        }, {
            type: 'input_audio',
            input_audio: {
                data: dataUrl,
                format: asset.media.sourceMimeType.split('/')[1]?.split(';')[0] ?? 'wav',
            },
        }]
    }

    if (asset.media?.kind === 'document' || asset.documents.content) {
        const text = await loadAssetDocumentText(asset, 'content', deps)
        if (!text) throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_DOCUMENT_NOT_READY:${asset.title}`)
        return [{
            type: 'input_text',
            text: JSON.stringify({
                type: 'workspace_artifact_document_reference',
                title: asset.title,
                content: text,
            }),
        }]
    }

    throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_REFERENCE_UNSUPPORTED:${asset.title}`)
}

const resolveAssetAudioDataUrl = async (
    asset: Asset,
    deps: ResolveWorkspaceContextDeps,
): Promise<string> => {
    const rendition = asset.media?.renditions.original
    if (!rendition || rendition.status !== 'ready' || !rendition.blobHash) {
        throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_AUDIO_NOT_READY:${asset.title}`)
    }
    const blob = await BlobModel.get({ organizationId: asset.organizationId, blobHash: rendition.blobHash })
    if (!blob) throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_AUDIO_BLOB_MISSING:${asset.title}`)
    const bytes = await deps.natsService.getObject(blob.bucketName, blob.objectKey)
    if (!bytes) throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_AUDIO_OBJECT_MISSING:${asset.title}`)
    const mimeType = rendition.mimeType || asset.media.sourceMimeType
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
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
    const branchSnapshot = restrictSnapshotToExplicitRefs(state.mediaBranchCandidateSnapshot)
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

const buildCandidateFromWorkspaceNode = async (
    node: WorkspaceContextNode,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<MediaBranchCandidateImage | undefined> => {
    if (node.type !== 'image' && node.type !== 'video') return undefined
    if (!node.assetId) return undefined
    const asset = await resolveContextAsset(node.assetId, state, deps)
    if (hasModelError(asset)) return undefined
    const imageUrl = await resolveAssetMediaUrl(asset)
    if (!imageUrl) return undefined
    const roleHints: MediaBranchCandidateImage['roleHints'] = node.branchId
        ? ['base-context', 'generated-variant', 'branch-leaf']
        : ['base-context']

    return {
        candidateId: `node:${node.nodeId}`,
        nodeId: node.nodeId,
        assetId: node.assetId,
        imageUrl,
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

const buildNarrowedMediaBranchSnapshot = async (
    state: ProviderState,
    resolution: WorkspaceContextResolution,
    deps: ResolveWorkspaceContextDeps,
): Promise<MediaBranchCandidateSnapshot | undefined> => {
    const snapshot = state.workspaceContextSnapshot
    const existingSnapshot = restrictSnapshotToExplicitRefs(state.mediaBranchCandidateSnapshot)
    if (!snapshot) return existingSnapshot
    if (existingSnapshot?.explicitReferenceCandidateIds?.length) return existingSnapshot

    const nodeById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))
    const existingByNodeId = new Map((existingSnapshot?.candidates ?? []).map((candidate) => [candidate.nodeId, candidate]))
    const selectedMediaSelections = resolution.selections.filter((selection) => isMediaWorkspaceNode(nodeById.get(selection.nodeId)))
    if (!existingSnapshot && selectedMediaSelections.length === 0) return undefined

    const candidates: MediaBranchCandidateImage[] = []

    for (const selection of selectedMediaSelections) {
        const existing = existingByNodeId.get(selection.nodeId)
        // When a browser-built branch snapshot already exists, only explicit
        // chips and edge-forced media are allowed to expand it. Plain automatic
        // workspace-relevance picks are descriptor-selected context, not visual
        // branch candidates, so adding them here would let unrelated workspace
        // media leak into the branch VLM.
        if (existingSnapshot && selection.role !== 'forced-chip' && selection.role !== 'forced-edge') continue
        const node = nodeById.get(selection.nodeId)
        const candidate = node ? await buildCandidateFromWorkspaceNode(node, state, deps) : undefined
        if (candidate) candidates.push({ ...existing, ...candidate })
    }

    // With explicit chips the context is exclusive: never fall back to the full
    // browser snapshot — an empty candidate list means the generation proceeds
    // with no media context (fresh branch) rather than leaking non-explicit media.
    const hasExplicitChips = snapshot.nodes.some((node) => node.isExplicitChip)
    if (existingSnapshot && candidates.length === 0 && !hasExplicitChips) return existingSnapshot

    const activeTargetCandidateId = existingSnapshot?.activeTargetCandidateId && candidates.some((candidate) => candidate.candidateId === existingSnapshot.activeTargetCandidateId)
        ? existingSnapshot.activeTargetCandidateId
        : undefined
    const promptText = existingSnapshot?.promptText ?? snapshot.promptText

    return {
        resolverVersion: existingSnapshot?.resolverVersion ?? snapshot.resolverVersion,
        conversationAssetId: existingSnapshot?.conversationAssetId ?? snapshot.conversationAssetId,
        regionNodeId: existingSnapshot?.regionNodeId ?? snapshot.conversationAssetId,
        ...(activeTargetCandidateId ? { activeTargetCandidateId } : {}),
        promptText,
        promptFingerprint: existingSnapshot?.promptFingerprint ?? `workspace-context:${snapshot.conversationAssetId}:${snapshot.promptText}:${selectedMediaSelections.map((selection) => selection.nodeId).join(',')}`,
        candidates,
        transcriptContext: buildCandidateTranscriptContext(candidates, promptText, activeTargetCandidateId),
    }
}

// Explicit chips are the exclusive context: selections are exactly the chip
// nodes and nothing else is evaluated — no edge-forced nodes, no LLM ranking.
const buildChipsOnlyResolution = (snapshot: WorkspaceContextSnapshot): WorkspaceContextResolution => {
    const chipNodes = snapshot.nodes.filter((node) => node.isExplicitChip)
    const selections: WorkspaceContextSelection[] = chipNodes.map((node) => ({
        nodeId: node.nodeId,
        role: 'forced-chip',
    }))

    return {
        resolverVersion: snapshot.resolverVersion || RESOLVER_VERSION,
        selections,
        narrowedMediaNodeIds: chipNodes.filter(isMediaWorkspaceNode).map((node) => node.nodeId),
    }
}

export const resolveWorkspaceContext = async (
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<Partial<ProviderState>> => {
    const snapshot = state.workspaceContextSnapshot
    if (!snapshot) return {}

    try {
        // Explicit chips make the context exclusive and fully deterministic:
        // skip the relevance LLM call, descriptor self-healing, and auto-media
        // filtering entirely. The API remains the single source of truth — the
        // browser snapshots arrive unfiltered and are narrowed only here.
        if (snapshot.nodes.some((node) => node.isExplicitChip)) {
            const resolution = buildChipsOnlyResolution(snapshot)
            const contextMessage = await buildSelectedContextMessage(state, deps, resolution)
            const mediaBranchCandidateSnapshot = await buildNarrowedMediaBranchSnapshot(state, resolution, deps)

            deps.publisher.contextRelevanceResolved(resolution)
            info(`[WorkspaceContextResolver] resolved (explicit chips, no LLM) ${JSON.stringify({
                workspaceId: state.workspaceId,
                aiChatThreadId: state.aiChatThreadId,
                selectedNodeIds: resolution.selections.map((selection) => selection.nodeId),
                narrowedMediaNodeIds: resolution.narrowedMediaNodeIds,
            }, null, 0)}`)

            return {
                workspaceContextResolution: resolution,
                ...(contextMessage ? { messages: [contextMessage, ...state.messages] } : {}),
                ...(mediaBranchCandidateSnapshot ? { mediaBranchCandidateSnapshot } : {}),
            }
        }

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
        const mediaBranchCandidateSnapshot = await buildNarrowedMediaBranchSnapshot(effectiveState, resolution, deps)

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
            ...(mediaBranchCandidateSnapshot ? { mediaBranchCandidateSnapshot } : {}),
        }
    } catch (error: any) {
        const message = error?.message ?? String(error)
        deps.publisher.contextRelevanceError(message)
        throw error
    }
}
