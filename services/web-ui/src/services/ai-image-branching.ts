'use strict'

import type {
    CanvasNode,
    CapabilityArtifactCanvasNode,
    DocumentCanvasNode,
    MediaBranchCandidateImage,
    MediaBranchCandidateRoleHint,
    MediaBranchCandidateSnapshot,
    ImageCanvasNode,
    VideoCanvasNode,
    WorkspaceContextNode,
    WorkspaceContextSnapshot,
    WorkspaceEdge,
} from '@lixpi/constants'
import {
    collectResponseTextById,
} from '@lixpi/prosemirror/shared/generated-media-turn-projection'
import {
    collectProseMirrorText,
    parseProseMirrorJsonContent,
} from '@lixpi/prosemirror/shared/thread-doc'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { buildAssetRenditionPath } from '$src/utils/mediaUrls.ts'

const RESOLVER_VERSION = 'image-branch-vlm-v1'

// Branch lineage spans both media types: a video continuation can have an image
// parent and vice versa. The snapshot grounds every media object by a single
// still — an image's file, or a video's representative frame — never the MP4.
type MediaCanvasNode = ImageCanvasNode | VideoCanvasNode
type WorkspaceContextCanvasNode = MediaCanvasNode | DocumentCanvasNode | CapabilityArtifactCanvasNode

type BuildMediaBranchCandidateSnapshotParams = {
    regionNodeId: string
    conversationAssetId: string
    activeTargetNodeId?: string
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
    prompt: string
    contextMediaNodeIds?: string[]
    generatedImageTextByNodeId?: Record<string, string>
}

type ChatMessageLike = {
    role?: string
    content?: unknown
}

function isMediaCanvasNode(node: CanvasNode): node is MediaCanvasNode {
    return node.type === 'image' || node.type === 'video'
}

function isWorkspaceContextCanvasNode(node: CanvasNode): node is WorkspaceContextCanvasNode {
    return node.type === 'image'
        || node.type === 'video'
        || node.type === 'document'
        || node.type === 'capabilityArtifact'
}

function isGeneratedMediaForConversation(node: CanvasNode, conversationAssetId: string): node is MediaCanvasNode {
    return isMediaCanvasNode(node) && node.generatedBy?.conversationAssetId === conversationAssetId
}

export function getPromptTextFromMessages(messages: ChatMessageLike[]): string {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (!message || message.role !== 'user') continue
        const text = getTextFromContent(message.content).trim()
        if (text) return text
    }
    return ''
}

function getTextFromContent(content: unknown): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''

    const parts: string[] = []
    for (const block of content) {
        if (typeof block === 'string') {
            parts.push(block)
            continue
        }
        if (typeof block !== 'object' || block === null) continue

        const blockType = (block as Record<string, unknown>).type
        if (blockType === 'text' || blockType === 'input_text') {
            const text = (block as Record<string, unknown>).text
            if (typeof text === 'string') parts.push(text)
        }
    }

    return parts.join('\n')
}

function normalizePrompt(prompt: string): string {
    return prompt.toLowerCase().replace(/\s+/g, ' ').trim()
}

function fingerprintPrompt(prompt: string): string {
    let hash = 5381
    for (const character of normalizePrompt(prompt)) {
        hash = ((hash << 5) + hash) ^ character.charCodeAt(0)
    }
    return `prompt-${(hash >>> 0).toString(36)}`
}

function uniqueValues(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)))
}

function uniqueRoleHints(values: MediaBranchCandidateRoleHint[]): MediaBranchCandidateRoleHint[] {
    return Array.from(new Set(values))
}

function getSourceContextNodeIds(nodes: CanvasNode[], edges: WorkspaceEdge[], regionNodeId: string): string[] {
    const nodeIds = new Set<string>()
    const queue: string[] = [regionNodeId]
    const visited = new Set<string>()

    while (queue.length > 0) {
        const targetNodeId = queue.shift()
        if (!targetNodeId || visited.has(targetNodeId)) continue
        visited.add(targetNodeId)

        for (const edge of edges) {
            if (edge.targetNodeId !== targetNodeId || nodeIds.has(edge.sourceNodeId)) continue
            nodeIds.add(edge.sourceNodeId)
            queue.push(edge.sourceNodeId)
        }

        for (const node of nodes) {
            if (node.parentId !== targetNodeId || nodeIds.has(node.nodeId)) continue
            nodeIds.add(node.nodeId)
        }
    }

    return Array.from(nodeIds)
}

function getContextMediaNodes(nodes: CanvasNode[], sourceContextNodeIds: string[]): MediaCanvasNode[] {
    const sourceContextNodeIdSet = new Set(sourceContextNodeIds)
    return nodes.filter((node): node is MediaCanvasNode => isMediaCanvasNode(node) && sourceContextNodeIdSet.has(node.nodeId))
}

function getGeneratedMediaForConversation(nodes: CanvasNode[], conversationAssetId: string): MediaCanvasNode[] {
    return nodes.filter((node): node is MediaCanvasNode => isGeneratedMediaForConversation(node, conversationAssetId))
}

function getLeafGeneratedMedia(media: MediaCanvasNode[], edges: WorkspaceEdge[]): MediaCanvasNode[] {
    const mediaIds = new Set(media.map((node) => node.nodeId))
    const sourceIdsWithGeneratedChildren = new Set(
        edges
            .filter((edge) => mediaIds.has(edge.sourceNodeId) && mediaIds.has(edge.targetNodeId))
            .map((edge) => edge.sourceNodeId)
    )

    for (const node of media) {
        const parentMediaNodeId = node.generatedBy?.parentMediaNodeId ?? node.generatedBy?.parentImageNodeId
        if (parentMediaNodeId && mediaIds.has(parentMediaNodeId)) sourceIdsWithGeneratedChildren.add(parentMediaNodeId)
    }

    const leaves = media.filter((node) => !sourceIdsWithGeneratedChildren.has(node.nodeId))
    return leaves.length > 0 ? leaves : media
}

function collectMediaBranchAncestors(
    selectedMedia: MediaCanvasNode,
    mediaById: Map<string, MediaCanvasNode>,
    edges: WorkspaceEdge[],
    regionNodeId: string
): string[] {
    const branchNodeIds: string[] = []
    const visited = new Set<string>()
    let current: MediaCanvasNode | undefined = selectedMedia

    while (current && !visited.has(current.nodeId)) {
        visited.add(current.nodeId)
        branchNodeIds.unshift(current.nodeId)

        const incomingEdge = edges.find((edge) => edge.targetNodeId === current?.nodeId)
        if (incomingEdge && incomingEdge.sourceNodeId !== regionNodeId) {
            const sourceMedia = mediaById.get(incomingEdge.sourceNodeId)
            if (sourceMedia) {
                current = sourceMedia
                continue
            }
        }

        const parentMediaNodeId = current.generatedBy?.parentMediaNodeId ?? current.generatedBy?.parentImageNodeId
        current = parentMediaNodeId ? mediaById.get(parentMediaNodeId) : undefined
    }

    return branchNodeIds
}

function getBranchIdForMedia(selectedMedia: MediaCanvasNode, ancestorNodeIds: string[], mediaById: Map<string, MediaCanvasNode>): string | undefined {
    const explicitBranchId = selectedMedia.generatedBy?.branchId
    if (explicitBranchId) return explicitBranchId

    for (const ancestorNodeId of ancestorNodeIds) {
        const ancestorBranchId = mediaById.get(ancestorNodeId)?.generatedBy?.branchId
        if (ancestorBranchId) return ancestorBranchId
    }

    return undefined
}

// Resolve the still the resolver sees for a candidate. For videos this is the
// representative mid-frame (falling back to the frame-0 poster); the MP4 itself
// is never sent to the VLM — only the explicit "extend video" action ships it.
function getMediaUrl(node: MediaCanvasNode): string {
    return buildAssetRenditionPath(node.assetId, node.type === 'video' ? 'representativeFrame' : 'preview')
}

function getMediaPromptText(node: MediaCanvasNode, generatedMediaTextByNodeId: Record<string, string> = {}): string {
    const generatedBy = node.generatedBy
    return [
        generatedBy?.promptText,
        generatedBy?.revisedPrompt,
        generatedBy?.visualEntitySummary,
        generatedBy?.visualStyleSummary,
        generatedBy?.entitySummary,
        // Descriptor summaries come from the media pixels and help distinguish
        // media from prompt/provenance text.
        assetsStore.get(node.assetId)?.descriptor?.summary,
        generatedMediaTextByNodeId[node.nodeId],
    ].filter((text): text is string => Boolean(text?.trim())).join('\n')
}

function getBranchPromptText(
    selectedMedia: MediaCanvasNode,
    mediaById: Map<string, MediaCanvasNode>,
    edges: WorkspaceEdge[],
    regionNodeId: string,
    generatedMediaTextByNodeId: Record<string, string> = {}
): string {
    return collectMediaBranchAncestors(selectedMedia, mediaById, edges, regionNodeId)
        .map((nodeId) => mediaById.get(nodeId))
        .filter((node): node is MediaCanvasNode => Boolean(node))
        .map((node) => getMediaPromptText(node, generatedMediaTextByNodeId))
        .filter(Boolean)
        .join('\n---\n')
}

export function getGeneratedImageTextByNodeIdFromThreadContent(
    threadContent: unknown,
    nodes: CanvasNode[],
    conversationAssetId: string
): Record<string, string> {
    const root = parseProseMirrorJsonContent(threadContent)
    if (!root) return {}

    const responseTextById = collectResponseTextById(root)
    const textByNodeId: Record<string, string> = {}
    for (const node of nodes) {
        if (!isGeneratedMediaForConversation(node, conversationAssetId)) continue
        const responseMessageId = node.generatedBy?.responseMessageId
        if (!responseMessageId) continue
        const text = responseTextById[responseMessageId]
        if (text) textByNodeId[node.nodeId] = text
    }
    return textByNodeId
}

function mergeCandidate(existing: MediaBranchCandidateImage, incoming: MediaBranchCandidateImage): MediaBranchCandidateImage {
    return {
        ...existing,
        ...incoming,
        roleHints: uniqueRoleHints([...existing.roleHints, ...incoming.roleHints]),
        ancestorNodeIds: uniqueValues([...existing.ancestorNodeIds, ...incoming.ancestorNodeIds]),
        sourceContextNodeIds: uniqueValues([...existing.sourceContextNodeIds, ...incoming.sourceContextNodeIds]),
        entityTags: uniqueValues([...(existing.entityTags ?? []), ...(incoming.entityTags ?? [])]),
        styleTags: uniqueValues([...(existing.styleTags ?? []), ...(incoming.styleTags ?? [])]),
        promptText: [existing.promptText, incoming.promptText].filter(Boolean).join('\n---\n') || undefined,
    }
}

function addCandidate(candidatesById: Map<string, MediaBranchCandidateImage>, candidate: MediaBranchCandidateImage): void {
    if (!candidate.imageUrl) return
    const existing = candidatesById.get(candidate.candidateId)
    candidatesById.set(candidate.candidateId, existing ? mergeCandidate(existing, candidate) : candidate)
}

function addActiveTargetHint(roleHints: MediaBranchCandidateRoleHint[], imageNodeId: string, activeTargetNodeId: string | undefined): MediaBranchCandidateRoleHint[] {
    return uniqueRoleHints(imageNodeId === activeTargetNodeId ? [...roleHints, 'active-target'] : roleHints)
}

function createBaseContextCandidate(media: MediaCanvasNode, activeTargetNodeId: string | undefined): MediaBranchCandidateImage {
    const generatedBy = media.generatedBy
    const parentMediaNodeId = generatedBy?.parentMediaNodeId ?? generatedBy?.parentImageNodeId
    const roleHints: MediaBranchCandidateRoleHint[] = ['base-context']
    if (generatedBy) roleHints.push('generated-variant')

    return {
        candidateId: `node:${media.nodeId}`,
        nodeId: media.nodeId,
        assetId: media.assetId,
        imageUrl: getMediaUrl(media),
        mediaKind: media.type,
        roleHints: addActiveTargetHint(roleHints, media.nodeId, activeTargetNodeId),
        branchId: generatedBy?.branchId,
        parentMediaNodeId,
        parentImageNodeId: parentMediaNodeId,
        ancestorNodeIds: parentMediaNodeId ? [parentMediaNodeId, media.nodeId] : [media.nodeId],
        sourceContextNodeIds: [media.nodeId],
        sourceMessageId: generatedBy?.responseMessageId,
        promptText: getMediaPromptText(media),
        visualEntitySummary: generatedBy?.visualEntitySummary ?? generatedBy?.entitySummary,
        visualStyleSummary: generatedBy?.visualStyleSummary,
        entityTags: generatedBy?.entityTags ?? assetsStore.get(media.assetId)?.descriptor?.entityTags ?? [],
        styleTags: generatedBy?.styleTags ?? assetsStore.get(media.assetId)?.descriptor?.styleTags ?? [],
        createdAt: generatedBy?.createdAt,
    }
}

function createGeneratedCandidate(args: {
    media: MediaCanvasNode
    mediaById: Map<string, MediaCanvasNode>
    edges: WorkspaceEdge[]
    regionNodeId: string
    sourceContextNodeIds: string[]
    leafNodeIds: Set<string>
    generatedMediaTextByNodeId: Record<string, string>
    activeTargetNodeId?: string
}): MediaBranchCandidateImage {
    const ancestorNodeIds = collectMediaBranchAncestors(args.media, args.mediaById, args.edges, args.regionNodeId)
    const generatedBy = args.media.generatedBy
    const parentMediaNodeId = generatedBy?.parentMediaNodeId ?? generatedBy?.parentImageNodeId
    const roleHints: MediaBranchCandidateRoleHint[] = ['generated-variant']
    roleHints.push(args.leafNodeIds.has(args.media.nodeId) ? 'branch-leaf' : 'branch-ancestor')

    return {
        candidateId: `node:${args.media.nodeId}`,
        nodeId: args.media.nodeId,
        assetId: args.media.assetId,
        imageUrl: getMediaUrl(args.media),
        mediaKind: args.media.type,
        roleHints: addActiveTargetHint(roleHints, args.media.nodeId, args.activeTargetNodeId),
        branchId: getBranchIdForMedia(args.media, ancestorNodeIds, args.mediaById),
        parentMediaNodeId,
        parentImageNodeId: parentMediaNodeId,
        ancestorNodeIds,
        sourceContextNodeIds: uniqueValues([...(generatedBy?.sourceContextNodeIds ?? []), ...args.sourceContextNodeIds]),
        sourceMessageId: generatedBy?.responseMessageId,
        promptText: getBranchPromptText(args.media, args.mediaById, args.edges, args.regionNodeId, args.generatedMediaTextByNodeId),
        visualEntitySummary: generatedBy?.visualEntitySummary ?? generatedBy?.entitySummary,
        visualStyleSummary: generatedBy?.visualStyleSummary,
        entityTags: generatedBy?.entityTags ?? assetsStore.get(args.media.assetId)?.descriptor?.entityTags ?? [],
        styleTags: generatedBy?.styleTags ?? assetsStore.get(args.media.assetId)?.descriptor?.styleTags ?? [],
        createdAt: generatedBy?.createdAt,
    }
}

function buildTranscriptContext(candidates: MediaBranchCandidateImage[], prompt: string, activeTargetCandidateId: string | undefined): string {
    const candidateLines = candidates.map((candidate) => [
        `candidateId=${candidate.candidateId}`,
        candidate.nodeId ? `nodeId=${candidate.nodeId}` : undefined,
        `assetId=${candidate.assetId}`,
        `kind=${candidate.mediaKind ?? 'image'}`,
        `roles=${candidate.roleHints.join(',')}`,
        candidate.branchId ? `branchId=${candidate.branchId}` : undefined,
        candidate.visualEntitySummary ? `visualEntity=${candidate.visualEntitySummary}` : undefined,
        candidate.visualStyleSummary ? `visualStyle=${candidate.visualStyleSummary}` : undefined,
        candidate.promptText ? `promptText=${candidate.promptText.slice(0, 800)}` : undefined,
    ].filter(Boolean).join(' | '))

    return [
        `Current user prompt: ${prompt}`,
        activeTargetCandidateId ? `Active target candidateId: ${activeTargetCandidateId}` : undefined,
        'Candidate media labels:',
        ...candidateLines,
    ].filter((line): line is string => typeof line === 'string').join('\n')
}

export function buildMediaBranchCandidateSnapshot({
    regionNodeId,
    conversationAssetId,
    activeTargetNodeId,
    nodes,
    edges,
    prompt,
    contextMediaNodeIds = [],
    generatedImageTextByNodeId = {},
}: BuildMediaBranchCandidateSnapshotParams): MediaBranchCandidateSnapshot {
    const sourceContextNodeIds = uniqueValues([
        ...getSourceContextNodeIds(nodes, edges, regionNodeId),
        ...contextMediaNodeIds,
    ])
    const contextMedia = getContextMediaNodes(nodes, sourceContextNodeIds)
    const generatedMedia = getGeneratedMediaForConversation(nodes, conversationAssetId)
    const generatedMediaById = new Map(generatedMedia.map((node) => [node.nodeId, node]))
    const leafNodeIds = new Set(getLeafGeneratedMedia(generatedMedia, edges).map((node) => node.nodeId))
    const candidatesById = new Map<string, MediaBranchCandidateImage>()

    for (const media of contextMedia) {
        addCandidate(candidatesById, createBaseContextCandidate(media, activeTargetNodeId))
    }

    for (const media of generatedMedia) {
        addCandidate(candidatesById, createGeneratedCandidate({
            media,
            mediaById: generatedMediaById,
            edges,
            regionNodeId,
            sourceContextNodeIds,
            leafNodeIds,
            generatedMediaTextByNodeId: generatedImageTextByNodeId,
            activeTargetNodeId,
        }))
    }

    const candidates = Array.from(candidatesById.values())
    const activeTargetCandidateId = activeTargetNodeId ? `node:${activeTargetNodeId}` : undefined
    return {
        resolverVersion: RESOLVER_VERSION,
        conversationAssetId,
        regionNodeId,
        ...(activeTargetCandidateId ? { activeTargetCandidateId } : {}),
        // Explicit refs are carried as data only — the candidate list stays
        // unfiltered and the API enforces explicit-context exclusivity.
        ...(contextMediaNodeIds.length ? {
            explicitReferenceCandidateIds: contextMediaNodeIds.map(nodeId => `node:${nodeId}`),
        } : {}),
        promptText: prompt,
        promptFingerprint: fingerprintPrompt(prompt),
        candidates,
        transcriptContext: buildTranscriptContext(candidates, prompt, activeTargetCandidateId),
    }
}

type BuildCanvasWideCandidateSnapshotParams = {
    // Identity used in place of a thread id to route streaming + placement for a
    // thread-less, canvas-wide generation run.
    generationRunId: string
    nodes: CanvasNode[]
    prompt: string
    // Explicit reference chips, if any. A single reference becomes the active
    // target hint; the VLM still owns the final role assignment.
    referenceNodeIds?: string[]
}

// Candidate snapshot scoped to the WHOLE canvas (every media node), used by the
// screen-fixed center-bottom composer. Unlike buildMediaBranchCandidateSnapshot
// — which narrows to one thread's lineage + edge-connected context — this offers
// the VLM every still on the canvas as a candidate. Branch topology and role
// assignment remain API-owned; this only collects non-authoritative candidates.
export function buildCanvasWideCandidateSnapshot({
    generationRunId,
    nodes,
    prompt,
    referenceNodeIds = [],
}: BuildCanvasWideCandidateSnapshotParams): MediaBranchCandidateSnapshot {
    const activeTargetNodeId = referenceNodeIds.length === 1 ? referenceNodeIds[0] : undefined
    const candidatesById = new Map<string, MediaBranchCandidateImage>()
    for (const node of nodes) {
        if (!isMediaCanvasNode(node)) continue
        addCandidate(candidatesById, createBaseContextCandidate(node, activeTargetNodeId))
    }

    const candidates = Array.from(candidatesById.values())
    const activeTargetCandidateId = activeTargetNodeId ? `node:${activeTargetNodeId}` : undefined
    return {
        resolverVersion: RESOLVER_VERSION,
        conversationAssetId: generationRunId,
        // `standalone:`-prefixed so the API planner treats this as a rootless
        // generation (no real source node) and plans a branchOrigin marker — a
        // thread-less canvas run has no chat/source node to root on.
        regionNodeId: `standalone:${generationRunId}`,
        ...(activeTargetCandidateId ? { activeTargetCandidateId } : {}),
        // Explicit refs are carried as data only — the candidate list stays
        // unfiltered and the API enforces explicit-context exclusivity.
        ...(referenceNodeIds.length ? {
            explicitReferenceCandidateIds: referenceNodeIds.map(nodeId => `node:${nodeId}`),
        } : {}),
        promptText: prompt,
        promptFingerprint: fingerprintPrompt(prompt),
        candidates,
        transcriptContext: buildTranscriptContext(candidates, prompt, activeTargetCandidateId),
    }
}

const WORKSPACE_CONTEXT_RESOLVER_VERSION = 'workspace-context-v1'

type BuildWorkspaceContextSnapshotParams = {
    workspaceId: string
    conversationAssetId: string
    prompt: string
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
    // The active canvas thread node, when the chat is rooted on the canvas. Its
    // edge-connected nodes are flagged `isEdgeForced`; a standalone panel chat
    // (no root) simply has no edge-forced nodes.
    rootNodeId?: string
    contextChipNodeIds?: string[]
    titlesByNodeId?: Record<string, string>
}

function toWorkspaceContextNode(
    node: WorkspaceContextCanvasNode,
    conversationAssetId: string,
    chipNodeIds: Set<string>,
    edgeForcedNodeIds: Set<string>,
    titlesByNodeId: Record<string, string>
): WorkspaceContextNode {
    const contextNode: WorkspaceContextNode = {
        nodeId: node.nodeId,
        type: node.type,
        assetId: node.assetId,
        isExplicitChip: chipNodeIds.has(node.nodeId),
        isEdgeForced: edgeForcedNodeIds.has(node.nodeId),
    }

    if (node.type === 'capabilityArtifact') contextNode.artifactTypeId = node.artifactTypeId

    const title = titlesByNodeId[node.nodeId]?.trim()
    if (title) contextNode.title = title

    const descriptor = assetsStore.get(node.assetId)?.descriptor
    if (descriptor) {
        contextNode.descriptorStatus = descriptor.status
        const summary = descriptor.summary?.trim()
        if (summary) contextNode.descriptorSummary = summary
        if (descriptor.entityTags?.length) contextNode.entityTags = descriptor.entityTags
        if (descriptor.styleTags?.length) contextNode.styleTags = descriptor.styleTags
    }

    // The snapshot carries Asset identity only. The API authorizes the Asset and
    // resolves its canonical/representative-frame Blob.
    if (isMediaCanvasNode(node)) {
        const generatedBy = node.generatedBy
        const branchId = generatedBy?.branchId
        if (branchId) contextNode.branchId = branchId
        if (generatedBy?.conversationAssetId) {
            contextNode.sourceConversationAssetId = generatedBy.conversationAssetId
            if (generatedBy.conversationAssetId === conversationAssetId) contextNode.isCurrentConversationGenerated = true
        }
    }

    return contextNode
}

// Whole-workspace, descriptors-only index built each chat turn. Generalizes
// buildMediaBranchCandidateSnapshot from "media candidates for one thread" to
// "every context-bearing node in the workspace", tagging explicit chips and
// edge-forced nodes so the API relevance stage can force-include them.
export function buildWorkspaceContextSnapshot({
    workspaceId,
    conversationAssetId,
    prompt,
    nodes,
    edges,
    rootNodeId,
    contextChipNodeIds = [],
    titlesByNodeId = {},
}: BuildWorkspaceContextSnapshotParams): WorkspaceContextSnapshot {
    const chipNodeIds = new Set(contextChipNodeIds)
    const edgeForcedNodeIds = rootNodeId
        ? new Set(getSourceContextNodeIds(nodes, edges, rootNodeId))
        : new Set<string>()

    return {
        resolverVersion: WORKSPACE_CONTEXT_RESOLVER_VERSION,
        workspaceId,
        conversationAssetId,
        promptText: prompt,
        nodes: nodes
            .filter(isWorkspaceContextCanvasNode)
            .map((node) => toWorkspaceContextNode(node, conversationAssetId, chipNodeIds, edgeForcedNodeIds, titlesByNodeId)),
    }
}
