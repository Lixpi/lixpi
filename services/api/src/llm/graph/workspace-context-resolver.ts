'use strict'

import type NatsService from '@lixpi/nats-service'
import { info } from '@lixpi/debug-tools'
import {
    type Asset,
    type MediaBranchCandidateImage,
    type MediaBranchCandidateSnapshot,
    type WorkspaceContextNode,
    type WorkspaceContextResolution,
    type WorkspaceContextSelection,
} from '@lixpi/constants'

import { capabilityArtifactBackendRegistry } from '../../capability-system/capability-artifacts.ts'
import AssetModel from '../../models/asset.ts'
import BlobModel from '../../models/blob.ts'
import Organization from '../../models/organization.ts'
import Workspace from '../../models/workspace.ts'
import AssetDocumentService from '../../services/asset-document-service.ts'
import {
    createAssetRequesterForWorkspaceUser,
    isAssetAvailableInWorkspaceScope,
} from '../../services/workspace-reference-scope.ts'
import { resolveImageUrls } from '../utils/attachments.ts'
import { buildCandidateTranscriptContext, restrictSnapshotToExplicitRefs } from './media-branch-snapshot.ts'
import type { ChatMessage, ProviderState } from './state.ts'
import type { StreamPublisher } from './stream-publisher.ts'

type ResolveWorkspaceContextDeps = {
    [key: string]: unknown
    natsService: NatsService
    publisher: Pick<StreamPublisher, 'contextRelevanceResolved' | 'contextRelevanceError'>
    abortSignal?: AbortSignal
    getAsset?: (assetId: string) => Promise<Asset | { error: string }>
    loadAssetDocumentSnapshot?: typeof AssetDocumentService.loadCurrentSnapshot
}

type ProseMirrorNode = {
    type: string
    text?: string
    content?: ProseMirrorNode[]
}

type ProseMirrorDoc = {
    type: 'doc'
    content?: ProseMirrorNode[]
}

const RESOLVER_VERSION = 'workspace-context-v1'

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

const resolveContextAsset = async (
    assetId: string,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<Asset | { error: string }> => {
    const organizationId = state.eventMeta?.organizationId
    const workspaceScope = organizationId
        ? { workspaceId: state.workspaceId, organizationId }
        : null
    const asset = deps.getAsset
        ? await deps.getAsset(assetId)
        : { error: 'WORKSPACE_CONTEXT_REQUESTER_REQUIRED' }
    if ('error' in asset) return asset
    if (!workspaceScope || !isAssetAvailableInWorkspaceScope(asset, workspaceScope)) {
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

const resolveAssetMediaUrl = async (asset: Asset): Promise<string | undefined> => {
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

const getFallbackText = (node: WorkspaceContextNode): string =>
    [node.title, node.descriptorSummary].filter((part): part is string => Boolean(part?.trim())).join('\n')

const resolveDocumentText = async (
    node: WorkspaceContextNode,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<{ title?: string; text: string } | undefined> => {
    if (!node.assetId) {
        const text = getFallbackText(node)
        return text ? { title: node.title, text } : undefined
    }

    const asset = await resolveContextAsset(node.assetId, state, deps)
    if (hasModelError(asset)) {
        const text = getFallbackText(node)
        return text ? { title: node.title, text } : undefined
    }

    const text = await loadAssetDocumentText(asset, 'content', deps) || getFallbackText(node)
    return text ? { title: asset.title || node.title, text } : undefined
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
        if (hasModelError(citedAsset) || citedAsset.states.lifecycle !== 'active') {
            throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_REFERENCE_UNAVAILABLE:${assetId}`)
        }
        if (citedAsset.artifact || citedAsset.primaryCategory === 'capabilityArtifact') {
            throw new Error(`WORKSPACE_CONTEXT_ARTIFACT_NESTED_REFERENCE_FORBIDDEN:${assetId}`)
        }
        citedAssets.push(citedAsset)
    }

    const labels = new Map(citedAssets.map((asset) => [asset.assetId, asset.title]))
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

const isMediaWorkspaceNode = (node: WorkspaceContextNode | undefined): node is WorkspaceContextNode =>
    Boolean(node && (node.type === 'image' || node.type === 'video'))

const buildExplicitResolution = (state: ProviderState): WorkspaceContextResolution => {
    const snapshot = state.workspaceContextSnapshot
    if (!snapshot) throw new Error('Workspace context snapshot is required')
    const explicitNodes = snapshot.nodes.filter((node) => node.isExplicitChip)
    return {
        resolverVersion: snapshot.resolverVersion || RESOLVER_VERSION,
        selections: explicitNodes.map((node) => ({
            nodeId: node.nodeId,
            role: 'forced-chip',
        })),
        narrowedMediaNodeIds: explicitNodes.filter(isMediaWorkspaceNode).map((node) => node.nodeId),
    }
}

const buildCandidateFromWorkspaceNode = async (
    node: WorkspaceContextNode,
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<MediaBranchCandidateImage | undefined> => {
    if (!isMediaWorkspaceNode(node) || !node.assetId) return undefined
    const asset = await resolveContextAsset(node.assetId, state, deps)
    if (hasModelError(asset)) return undefined
    const imageUrl = await resolveAssetMediaUrl(asset)
    if (!imageUrl) return undefined
    const roleHints: MediaBranchCandidateImage['roleHints'] = node.branchId
        ? ['base-context', 'generated-variant']
        : ['base-context']

    return {
        candidateId: node.nodeId,
        nodeId: node.nodeId,
        assetId: node.assetId,
        imageUrl,
        mediaKind: node.type,
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

const buildExplicitMediaBranchSnapshot = async (
    state: ProviderState,
    resolution: WorkspaceContextResolution,
    deps: ResolveWorkspaceContextDeps,
): Promise<MediaBranchCandidateSnapshot | undefined> => {
    const contextSnapshot = state.workspaceContextSnapshot
    const existingSnapshot = restrictSnapshotToExplicitRefs(state.mediaBranchCandidateSnapshot)
    if (!contextSnapshot) return existingSnapshot

    const nodeById = new Map(contextSnapshot.nodes.map((node) => [node.nodeId, node]))
    const candidatesById = new Map(
        (existingSnapshot?.candidates ?? []).map((candidate) => [candidate.candidateId, candidate]),
    )
    for (const selection of resolution.selections) {
        const node = nodeById.get(selection.nodeId)
        if (!isMediaWorkspaceNode(node)) continue
        const candidate = await buildCandidateFromWorkspaceNode(node, state, deps)
        if (candidate) candidatesById.set(candidate.candidateId, candidate)
    }

    if (!existingSnapshot && candidatesById.size === 0) return undefined
    const candidates = [...candidatesById.values()]
    const explicitReferenceCandidateIds = candidates.map((candidate) => candidate.candidateId)
    const activeTargetCandidateId = existingSnapshot?.activeTargetCandidateId
        && explicitReferenceCandidateIds.includes(existingSnapshot.activeTargetCandidateId)
        ? existingSnapshot.activeTargetCandidateId
        : undefined
    const promptText = existingSnapshot?.promptText ?? contextSnapshot.promptText

    return {
        resolverVersion: existingSnapshot?.resolverVersion ?? contextSnapshot.resolverVersion,
        conversationAssetId: existingSnapshot?.conversationAssetId ?? contextSnapshot.conversationAssetId,
        regionNodeId: existingSnapshot?.regionNodeId ?? contextSnapshot.conversationAssetId,
        ...(activeTargetCandidateId ? { activeTargetCandidateId } : {}),
        ...(explicitReferenceCandidateIds.length > 0 ? { explicitReferenceCandidateIds } : {}),
        promptText,
        promptFingerprint: existingSnapshot?.promptFingerprint
            ?? `explicit-context:${contextSnapshot.conversationAssetId}:${contextSnapshot.promptText}:${explicitReferenceCandidateIds.join(',')}`,
        candidates,
        transcriptContext: buildCandidateTranscriptContext(candidates, promptText, activeTargetCandidateId),
    }
}

export const resolveWorkspaceContext = async (
    state: ProviderState,
    deps: ResolveWorkspaceContextDeps,
): Promise<Partial<ProviderState>> => {
    if (!state.workspaceContextSnapshot) return {}

    try {
        let scopedDeps = deps
        if (!deps.getAsset) {
            const userId = state.eventMeta?.userId
            const organizationId = state.eventMeta?.organizationId
            if (!userId || !organizationId) throw new Error('WORKSPACE_CONTEXT_USER_REQUIRED')
            const workspace = await Workspace.getWorkspace({ workspaceId: state.workspaceId, userId })
            if ('error' in workspace || workspace.deletingAt || workspace.organizationId !== organizationId) {
                throw new Error('WORKSPACE_CONTEXT_WORKSPACE_ACCESS_DENIED')
            }
            const organization = await Organization.getOrganization({ organizationId, userId })
            if ('error' in organization) throw new Error('WORKSPACE_CONTEXT_ORGANIZATION_ACCESS_DENIED')
            const requester = createAssetRequesterForWorkspaceUser(workspace, userId, true)
            scopedDeps = {
                ...deps,
                getAsset: async (assetId) => await AssetModel.get({ assetId, requester }),
            }
        }
        const resolution = buildExplicitResolution(state)
        const contextMessage = await buildSelectedContextMessage(state, scopedDeps, resolution)
        const mediaBranchCandidateSnapshot = await buildExplicitMediaBranchSnapshot(state, resolution, scopedDeps)

        deps.publisher.contextRelevanceResolved(resolution)
        info(`[WorkspaceContextResolver] resolved explicit context ${JSON.stringify({
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
    } catch (error: any) {
        const message = error?.message ?? String(error)
        deps.publisher.contextRelevanceError(message)
        throw error
    }
}
