'use strict'

import type {
    Asset,
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
import {
    hasActiveGeneratedOutputLineage,
} from '../branch-tree-layout/branch-lineage-state.ts'

const RESOLVER_VERSION = 'image-branch-vlm-v1'

// Branch lineage spans both media types: a video continuation can have an image
// parent and vice versa. The snapshot grounds every media object by a single
// still — an image's file, or a video's representative frame — never the MP4.
type MediaCanvasNode = ImageCanvasNode | VideoCanvasNode
type WorkspaceContextCanvasNode = MediaCanvasNode | DocumentCanvasNode | CapabilityArtifactCanvasNode

export type BuildMediaBranchCandidateSnapshotParams = {
    regionNodeId: string
    conversationAssetId: string
    activeTargetNodeId?: string
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
    prompt: string
    contextMediaNodeIds?: string[]
    generatedImageTextByNodeId?: Record<string, string>
}

export type ChatMessageLike = {
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

function getContextMediaNodes(nodes: CanvasNode[], sourceContextNodeIds: string[]): MediaCanvasNode[] {
    const sourceContextNodeIdSet = new Set(sourceContextNodeIds)
    return nodes.filter((node): node is MediaCanvasNode => isMediaCanvasNode(node) && sourceContextNodeIdSet.has(node.nodeId))
}

function getGeneratedMediaForConversation(nodes: CanvasNode[], conversationAssetId: string): MediaCanvasNode[] {
    return nodes.filter((node): node is MediaCanvasNode => isGeneratedMediaForConversation(node, conversationAssetId))
}

function hasDirectedCanvasPath(
    sourceNodeId: string,
    targetNodeId: string,
    edges: WorkspaceEdge[],
): boolean {
    const targetsBySource = new Map<string, string[]>()
    for (const edge of edges) {
        const targets = targetsBySource.get(edge.sourceNodeId) ?? []
        targets.push(edge.targetNodeId)
        targetsBySource.set(edge.sourceNodeId, targets)
    }
    const visited = new Set<string>([sourceNodeId])
    const queue = [sourceNodeId]
    while (queue.length > 0) {
        const currentNodeId = queue.shift()
        if (!currentNodeId) continue
        for (const nextNodeId of targetsBySource.get(currentNodeId) ?? []) {
            if (nextNodeId === targetNodeId) return true
            if (visited.has(nextNodeId)) continue
            visited.add(nextNodeId)
            queue.push(nextNodeId)
        }
    }
    return false
}

function inferStructuralActiveTargetNodeId(
    referenceNodeIds: string[],
    nodes: CanvasNode[],
    edges: WorkspaceEdge[],
): string | undefined {
    if (referenceNodeIds.length === 1) return referenceNodeIds[0]

    const referenceNodeIdSet = new Set(referenceNodeIds)
    const referencedMedia = nodes.filter((node): node is MediaCanvasNode => isMediaCanvasNode(node) && referenceNodeIdSet.has(node.nodeId))
    const generatedMedia = referencedMedia.filter(node => Boolean(node.generatedBy))
    if (generatedMedia.length !== 1) return undefined

    const generatedTarget = generatedMedia[0]
    const relatedNodeIds = new Set([
        ...(generatedTarget.generatedBy?.sourceContextNodeIds ?? []),
        ...(generatedTarget.generatedBy?.referenceImageNodeIds ?? []),
        generatedTarget.generatedBy?.parentMediaNodeId ?? '',
        generatedTarget.generatedBy?.parentImageNodeId ?? '',
    ].filter(Boolean))
    const otherReferences = referencedMedia.filter(node => node.nodeId !== generatedTarget.nodeId)
    const allReferencesBelongToGeneratedTarget = otherReferences.every(node =>
        relatedNodeIds.has(node.nodeId)
        || hasDirectedCanvasPath(node.nodeId, generatedTarget.nodeId, edges)
    )
    return allReferencesBelongToGeneratedTarget ? generatedTarget.nodeId : undefined
}

// Resolve the still the resolver sees for a candidate. For videos this is the
// representative mid-frame (falling back to the frame-0 poster); the MP4 itself
// is never sent to the VLM — only the explicit "extend video" action ships it.
function getMediaUrl(node: MediaCanvasNode, ports: WorkspaceGenerationContextPorts): string {
    return ports.renditionPath(node.assetId, node.type === 'video' ? 'representativeFrame' : 'preview')
}

function getMediaPromptText(node: MediaCanvasNode, ports: WorkspaceGenerationContextPorts): string {
    const generatedBy = node.generatedBy
    return [
        generatedBy?.promptText,
        generatedBy?.revisedPrompt,
        generatedBy?.visualEntitySummary,
        generatedBy?.visualStyleSummary,
        generatedBy?.entitySummary,
        // Descriptor summaries come from the media pixels and help distinguish
        // media from prompt/provenance text.
        ports.readAsset(node.assetId)?.descriptor?.summary,
    ].filter((text): text is string => Boolean(text?.trim())).join('\n')
}

export function getGeneratedImageTextByNodeIdFromThreadContent(
    threadContent: unknown,
    nodes: CanvasNode[],
    conversationAssetId: string,
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

function createBaseContextCandidate(
    media: MediaCanvasNode,
    activeTargetNodeId: string | undefined,
    nodes: CanvasNode[],
    edges: WorkspaceEdge[],
    ports: WorkspaceGenerationContextPorts,
): MediaBranchCandidateImage {
    const generatedBy = media.generatedBy
    const hasActiveLineage = hasActiveGeneratedOutputLineage(media, nodes, edges)
    const parentMediaNodeId = hasActiveLineage
        ? generatedBy?.parentMediaNodeId ?? generatedBy?.parentImageNodeId
        : undefined
    const roleHints: MediaBranchCandidateRoleHint[] = ['base-context']
    // Acceptance closes the old marker topology but does not turn generated
    // pixels into an uploaded source. Keeping the generated role lets an
    // explicit edit use this media node as the parent of a new continuation.
    if (generatedBy) roleHints.push('generated-variant')

    return {
        candidateId: `node:${media.nodeId}`,
        nodeId: media.nodeId,
        assetId: media.assetId,
        imageUrl: getMediaUrl(media, ports),
        mediaKind: media.type,
        roleHints: addActiveTargetHint(roleHints, media.nodeId, activeTargetNodeId),
        branchId: hasActiveLineage ? generatedBy?.branchId : undefined,
        parentMediaNodeId,
        parentImageNodeId: parentMediaNodeId,
        ancestorNodeIds: parentMediaNodeId ? [parentMediaNodeId, media.nodeId] : [media.nodeId],
        sourceContextNodeIds: uniqueValues([
            ...(generatedBy?.sourceContextNodeIds ?? []),
            ...(generatedBy?.referenceImageNodeIds ?? []),
            media.nodeId,
        ]),
        sourceMessageId: generatedBy?.responseMessageId,
        promptText: getMediaPromptText(media, ports),
        visualEntitySummary: generatedBy?.visualEntitySummary ?? generatedBy?.entitySummary,
        visualStyleSummary: generatedBy?.visualStyleSummary,
        entityTags: generatedBy?.entityTags ?? ports.readAsset(media.assetId)?.descriptor?.entityTags ?? [],
        styleTags: generatedBy?.styleTags ?? ports.readAsset(media.assetId)?.descriptor?.styleTags ?? [],
        createdAt: generatedBy?.createdAt,
    }
}

function buildTranscriptContext(candidates: MediaBranchCandidateImage[], prompt: string, activeTargetCandidateId: string | undefined): string {
    const candidateLines = candidates.map((candidate) =>
        [
            `candidateId=${candidate.candidateId}`,
            candidate.nodeId ? `nodeId=${candidate.nodeId}` : undefined,
            `assetId=${candidate.assetId}`,
            `kind=${candidate.mediaKind ?? 'image'}`,
            `roles=${candidate.roleHints.join(',')}`,
            candidate.branchId ? `branchId=${candidate.branchId}` : undefined,
            candidate.visualEntitySummary ? `visualEntity=${candidate.visualEntitySummary}` : undefined,
            candidate.visualStyleSummary ? `visualStyle=${candidate.visualStyleSummary}` : undefined,
            candidate.promptText ? `promptText=${candidate.promptText.slice(0, 800)}` : undefined,
        ].filter(Boolean).join(' | ')
    )

    return [
        `Current user prompt: ${prompt}`,
        activeTargetCandidateId ? `Active target candidateId: ${activeTargetCandidateId}` : undefined,
        'Candidate media labels:',
        ...candidateLines,
    ].filter((line): line is string => typeof line === 'string').join('\n')
}

function buildMediaBranchCandidateSnapshot({
    regionNodeId,
    conversationAssetId,
    activeTargetNodeId,
    nodes,
    edges,
    prompt,
    contextMediaNodeIds = [],
}: BuildMediaBranchCandidateSnapshotParams, ports: WorkspaceGenerationContextPorts): MediaBranchCandidateSnapshot {
    const explicitContextNodeIds = uniqueValues(contextMediaNodeIds)
    const resolvedActiveTargetNodeId = activeTargetNodeId
        ?? inferStructuralActiveTargetNodeId(explicitContextNodeIds, nodes, edges)
    const contextMedia = getContextMediaNodes(nodes, explicitContextNodeIds)
    const candidatesById = new Map<string, MediaBranchCandidateImage>()

    for (const media of contextMedia) {
        addCandidate(candidatesById, createBaseContextCandidate(media, resolvedActiveTargetNodeId, nodes, edges, ports))
    }

    const candidates = Array.from(candidatesById.values())
    const activeTargetCandidateId = resolvedActiveTargetNodeId
            && candidates.some(candidate => candidate.nodeId === resolvedActiveTargetNodeId)
        ? `node:${resolvedActiveTargetNodeId}`
        : undefined
    const explicitReferenceCandidateIds = candidates.map(candidate => candidate.candidateId)
    return {
        resolverVersion: RESOLVER_VERSION,
        conversationAssetId,
        regionNodeId,
        ...(activeTargetCandidateId ? { activeTargetCandidateId } : {}),
        ...(explicitReferenceCandidateIds.length
            ? {
                explicitReferenceCandidateIds,
            }
            : {}),
        promptText: prompt,
        promptFingerprint: fingerprintPrompt(prompt),
        candidates,
        transcriptContext: buildTranscriptContext(candidates, prompt, activeTargetCandidateId),
    }
}

export type BuildExplicitMediaCandidateSnapshotParams = {
    // Identity used in place of a thread id to route streaming + placement for a
    // thread-less, canvas-wide generation run.
    generationRunId: string
    nodes: CanvasNode[]
    edges?: WorkspaceEdge[]
    prompt: string
    // Explicit reference chips, if any. A single reference becomes the active
    // target hint; the VLM still owns the final role assignment.
    referenceNodeIds?: string[]
}

// The screen-fixed composer supplies only references explicitly attached to the
// submitted turn. The API authorizes the Assets and owns role assignment.
function buildExplicitMediaCandidateSnapshot({
    generationRunId,
    nodes,
    edges = [],
    prompt,
    referenceNodeIds = [],
}: BuildExplicitMediaCandidateSnapshotParams, ports: WorkspaceGenerationContextPorts): MediaBranchCandidateSnapshot {
    const activeTargetNodeId = inferStructuralActiveTargetNodeId(referenceNodeIds, nodes, edges)
    const referenceNodeIdSet = new Set(referenceNodeIds)
    const candidatesById = new Map<string, MediaBranchCandidateImage>()
    for (const node of nodes) {
        if (!isMediaCanvasNode(node) || !referenceNodeIdSet.has(node.nodeId)) continue
        addCandidate(candidatesById, createBaseContextCandidate(node, activeTargetNodeId, nodes, edges, ports))
    }

    const candidates = Array.from(candidatesById.values())
    const activeTargetCandidateId = activeTargetNodeId && candidates.some(candidate => candidate.nodeId === activeTargetNodeId)
        ? `node:${activeTargetNodeId}`
        : undefined
    const explicitReferenceCandidateIds = candidates.map(candidate => candidate.candidateId)
    return {
        resolverVersion: RESOLVER_VERSION,
        conversationAssetId: generationRunId,
        // `standalone:`-prefixed so the API planner treats this as a rootless
        // generation (no real source node) and plans a branchOrigin marker — a
        // thread-less canvas run has no chat/source node to root on.
        regionNodeId: `standalone:${generationRunId}`,
        ...(activeTargetCandidateId ? { activeTargetCandidateId } : {}),
        ...(explicitReferenceCandidateIds.length
            ? {
                explicitReferenceCandidateIds,
            }
            : {}),
        promptText: prompt,
        promptFingerprint: fingerprintPrompt(prompt),
        candidates,
        transcriptContext: buildTranscriptContext(candidates, prompt, activeTargetCandidateId),
    }
}

const WORKSPACE_CONTEXT_RESOLVER_VERSION = 'workspace-context-v1'

export type BuildWorkspaceContextSnapshotParams = {
    workspaceId: string
    conversationAssetId: string
    prompt: string
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
    rootNodeId?: string
    contextChipNodeIds?: string[]
    titlesByNodeId?: Record<string, string>
}

function toWorkspaceContextNode(
    node: WorkspaceContextCanvasNode,
    conversationAssetId: string,
    chipNodeIds: Set<string>,
    titlesByNodeId: Record<string, string>,
    nodes: CanvasNode[],
    edges: WorkspaceEdge[],
    ports: WorkspaceGenerationContextPorts,
): WorkspaceContextNode {
    const contextNode: WorkspaceContextNode = {
        nodeId: node.nodeId,
        type: node.type,
        assetId: node.assetId,
        isExplicitChip: chipNodeIds.has(node.nodeId),
        isEdgeForced: false,
    }

    if (node.type === 'capabilityArtifact') contextNode.artifactTypeId = node.artifactTypeId

    const title = titlesByNodeId[node.nodeId]?.trim()
    if (title) contextNode.title = title

    const descriptor = ports.readAsset(node.assetId)?.descriptor
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
        const branchId = hasActiveGeneratedOutputLineage(node, nodes, edges)
            ? generatedBy?.branchId
            : undefined
        if (branchId) contextNode.branchId = branchId
        if (generatedBy?.conversationAssetId) {
            contextNode.sourceConversationAssetId = generatedBy.conversationAssetId
            if (generatedBy.conversationAssetId === conversationAssetId) contextNode.isCurrentConversationGenerated = true
        }
    }

    return contextNode
}

// Explicit composer context for one submitted turn. Unselected canvas nodes are
// omitted from the request entirely.
function buildWorkspaceContextSnapshot({
    workspaceId,
    conversationAssetId,
    prompt,
    nodes,
    edges,
    contextChipNodeIds = [],
    titlesByNodeId = {},
}: BuildWorkspaceContextSnapshotParams, ports: WorkspaceGenerationContextPorts): WorkspaceContextSnapshot {
    const chipNodeIds = new Set(contextChipNodeIds)

    return {
        resolverVersion: WORKSPACE_CONTEXT_RESOLVER_VERSION,
        workspaceId,
        conversationAssetId,
        promptText: prompt,
        nodes: nodes
            .filter((node): node is WorkspaceContextCanvasNode => isWorkspaceContextCanvasNode(node) && chipNodeIds.has(node.nodeId))
            .map((node) =>
                toWorkspaceContextNode(
                    node,
                    conversationAssetId,
                    chipNodeIds,
                    titlesByNodeId,
                    nodes,
                    edges,
                    ports,
                )
            ),
    }
}

export type WorkspaceGenerationContextPorts = {
    readAsset: (assetId: string) => Pick<Asset, 'descriptor'> | undefined
    renditionPath: (assetId: string, rendition: 'preview' | 'representativeFrame') => string
}

export class WorkspaceGenerationContext {
    constructor(private readonly ports: WorkspaceGenerationContextPorts) {}

    buildMediaBranchCandidateSnapshot(params: BuildMediaBranchCandidateSnapshotParams): MediaBranchCandidateSnapshot {
        return buildMediaBranchCandidateSnapshot(params, this.ports)
    }

    buildExplicitMediaCandidateSnapshot(params: BuildExplicitMediaCandidateSnapshotParams): MediaBranchCandidateSnapshot {
        return buildExplicitMediaCandidateSnapshot(params, this.ports)
    }

    buildWorkspaceContextSnapshot(params: BuildWorkspaceContextSnapshotParams): WorkspaceContextSnapshot {
        return buildWorkspaceContextSnapshot(params, this.ports)
    }
}
