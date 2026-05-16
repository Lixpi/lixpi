'use strict'

import type {
    AiChatThreadCanvasNode,
    CanvasNode,
    ContextRegionCanvasNode,
    ImageBranchCandidateImage,
    ImageBranchCandidateRoleHint,
    ImageBranchCandidateSnapshot,
    ImageCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'

const RESOLVER_VERSION = 'image-branch-vlm-v1'

type ContextRegionNode = ContextRegionCanvasNode | AiChatThreadCanvasNode

type BuildImageBranchCandidateSnapshotParams = {
    regionNodeId: string
    threadId: string
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
    prompt: string
    generatedImageTextByNodeId?: Record<string, string>
}

type ChatMessageLike = {
    role?: string
    content?: unknown
}

type ProseMirrorJsonNode = {
    type?: string
    text?: string
    attrs?: Record<string, unknown>
    content?: ProseMirrorJsonNode[]
}

function isGeneratedImageForThread(node: CanvasNode, threadId: string): node is ImageCanvasNode {
    return node.type === 'image' && (node as ImageCanvasNode).generatedBy?.aiChatThreadId === threadId
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

function uniqueRoleHints(values: ImageBranchCandidateRoleHint[]): ImageBranchCandidateRoleHint[] {
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

function getContextImageNodes(nodes: CanvasNode[], sourceContextNodeIds: string[]): ImageCanvasNode[] {
    const sourceContextNodeIdSet = new Set(sourceContextNodeIds)
    return nodes.filter((node): node is ImageCanvasNode => node.type === 'image' && sourceContextNodeIdSet.has(node.nodeId))
}

function getGeneratedImagesForThread(nodes: CanvasNode[], threadId: string): ImageCanvasNode[] {
    return nodes.filter((node): node is ImageCanvasNode => isGeneratedImageForThread(node, threadId))
}

function getLeafGeneratedImages(images: ImageCanvasNode[], edges: WorkspaceEdge[]): ImageCanvasNode[] {
    const imageIds = new Set(images.map((image) => image.nodeId))
    const sourceIdsWithGeneratedChildren = new Set(
        edges
            .filter((edge) => imageIds.has(edge.sourceNodeId) && imageIds.has(edge.targetNodeId))
            .map((edge) => edge.sourceNodeId)
    )

    for (const image of images) {
        const parentImageNodeId = image.generatedBy?.parentImageNodeId
        if (parentImageNodeId && imageIds.has(parentImageNodeId)) sourceIdsWithGeneratedChildren.add(parentImageNodeId)
    }

    const leaves = images.filter((image) => !sourceIdsWithGeneratedChildren.has(image.nodeId))
    return leaves.length > 0 ? leaves : images
}

function collectImageBranchAncestors(
    selectedImage: ImageCanvasNode,
    imagesById: Map<string, ImageCanvasNode>,
    edges: WorkspaceEdge[],
    regionNodeId: string
): string[] {
    const branchNodeIds: string[] = []
    const visited = new Set<string>()
    let current: ImageCanvasNode | undefined = selectedImage

    while (current && !visited.has(current.nodeId)) {
        visited.add(current.nodeId)
        branchNodeIds.unshift(current.nodeId)

        const incomingEdge = edges.find((edge) => edge.targetNodeId === current?.nodeId)
        if (incomingEdge && incomingEdge.sourceNodeId !== regionNodeId) {
            current = imagesById.get(incomingEdge.sourceNodeId)
            if (current) continue
        }

        const parentImageNodeId = current.generatedBy?.parentImageNodeId
        current = parentImageNodeId ? imagesById.get(parentImageNodeId) : undefined
    }

    return branchNodeIds
}

function getBranchIdForImage(selectedImage: ImageCanvasNode, ancestorNodeIds: string[], imagesById: Map<string, ImageCanvasNode>): string | undefined {
    const explicitBranchId = selectedImage.generatedBy?.branchId
    if (explicitBranchId) return explicitBranchId

    for (const ancestorNodeId of ancestorNodeIds) {
        const ancestorBranchId = imagesById.get(ancestorNodeId)?.generatedBy?.branchId
        if (ancestorBranchId) return ancestorBranchId
    }

    return undefined
}

function getImageUrl(image: ImageCanvasNode): string {
    if (image.fileId && image.workspaceId) {
        return `nats-obj://workspace-${image.workspaceId}-files/${image.fileId}`
    }
    return image.src
}

function getImagePromptText(image: ImageCanvasNode, generatedImageTextByNodeId: Record<string, string> = {}): string {
    return [
        image.generatedBy?.promptText,
        image.generatedBy?.revisedPrompt,
        image.generatedBy?.visualEntitySummary,
        image.generatedBy?.visualStyleSummary,
        image.generatedBy?.entitySummary,
        generatedImageTextByNodeId[image.nodeId],
    ].filter((text): text is string => Boolean(text?.trim())).join('\n')
}

function getBranchPromptText(
    selectedImage: ImageCanvasNode,
    imagesById: Map<string, ImageCanvasNode>,
    edges: WorkspaceEdge[],
    regionNodeId: string,
    generatedImageTextByNodeId: Record<string, string> = {}
): string {
    return collectImageBranchAncestors(selectedImage, imagesById, edges, regionNodeId)
        .map((nodeId) => imagesById.get(nodeId))
        .filter((image): image is ImageCanvasNode => Boolean(image))
        .map((image) => getImagePromptText(image, generatedImageTextByNodeId))
        .filter(Boolean)
        .join('\n---\n')
}

function parseThreadContent(content: unknown): ProseMirrorJsonNode | null {
    if (!content) return null
    if (typeof content === 'string') {
        try {
            return JSON.parse(content) as ProseMirrorJsonNode
        } catch {
            return null
        }
    }
    if (typeof content === 'object') return content as ProseMirrorJsonNode
    return null
}

function collectProseMirrorText(node: ProseMirrorJsonNode | undefined): string {
    if (!node) return ''
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hard_break') return '\n'
    if (node.type === 'aiGeneratedImage') {
        return typeof node.attrs?.revisedPrompt === 'string' ? node.attrs.revisedPrompt : ''
    }
    return node.content?.map(collectProseMirrorText).join('') ?? ''
}

function collectResponseTextById(root: ProseMirrorJsonNode): Record<string, string> {
    const responseTextById: Record<string, string> = {}

    function visitContainer(node: ProseMirrorJsonNode): void {
        const children = node.content ?? []
        let previousUserText = ''

        for (const child of children) {
            if (child.type === 'aiUserMessage') {
                previousUserText = collectProseMirrorText(child).trim()
                continue
            }

            if (child.type === 'aiResponseMessage') {
                const responseId = typeof child.attrs?.id === 'string' ? child.attrs.id : ''
                if (responseId) {
                    responseTextById[responseId] = [previousUserText, collectProseMirrorText(child).trim()]
                        .filter(Boolean)
                        .join('\n')
                }
                continue
            }

            visitContainer(child)
        }
    }

    visitContainer(root)
    return responseTextById
}

export function getGeneratedImageTextByNodeIdFromThreadContent(
    threadContent: unknown,
    nodes: CanvasNode[],
    threadId: string
): Record<string, string> {
    const root = parseThreadContent(threadContent)
    if (!root) return {}

    const responseTextById = collectResponseTextById(root)
    const textByNodeId: Record<string, string> = {}
    for (const node of nodes) {
        if (!isGeneratedImageForThread(node, threadId)) continue
        const responseMessageId = node.generatedBy?.responseMessageId
        if (!responseMessageId) continue
        const text = responseTextById[responseMessageId]
        if (text) textByNodeId[node.nodeId] = text
    }
    return textByNodeId
}

function mergeCandidate(existing: ImageBranchCandidateImage, incoming: ImageBranchCandidateImage): ImageBranchCandidateImage {
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

function addCandidate(candidatesById: Map<string, ImageBranchCandidateImage>, candidate: ImageBranchCandidateImage): void {
    if (!candidate.imageUrl) return
    const existing = candidatesById.get(candidate.nodeId)
    candidatesById.set(candidate.nodeId, existing ? mergeCandidate(existing, candidate) : candidate)
}

function createBaseContextCandidate(image: ImageCanvasNode): ImageBranchCandidateImage {
    const generatedBy = image.generatedBy
    const roleHints: ImageBranchCandidateRoleHint[] = ['base-context']
    if (generatedBy) roleHints.push('generated-variant')

    return {
        nodeId: image.nodeId,
        fileId: image.fileId,
        workspaceId: image.workspaceId,
        imageUrl: getImageUrl(image),
        roleHints,
        branchId: generatedBy?.branchId,
        parentImageNodeId: generatedBy?.parentImageNodeId,
        ancestorNodeIds: generatedBy?.parentImageNodeId ? [generatedBy.parentImageNodeId, image.nodeId] : [image.nodeId],
        sourceContextNodeIds: [image.nodeId],
        sourceMessageId: generatedBy?.responseMessageId,
        promptText: getImagePromptText(image),
        visualEntitySummary: generatedBy?.visualEntitySummary ?? generatedBy?.entitySummary,
        visualStyleSummary: generatedBy?.visualStyleSummary,
        entityTags: generatedBy?.entityTags ?? [],
        styleTags: generatedBy?.styleTags ?? [],
        createdAt: generatedBy?.createdAt,
    }
}

function createGeneratedCandidate(args: {
    image: ImageCanvasNode
    imagesById: Map<string, ImageCanvasNode>
    edges: WorkspaceEdge[]
    regionNodeId: string
    sourceContextNodeIds: string[]
    leafNodeIds: Set<string>
    generatedImageTextByNodeId: Record<string, string>
}): ImageBranchCandidateImage {
    const ancestorNodeIds = collectImageBranchAncestors(args.image, args.imagesById, args.edges, args.regionNodeId)
    const generatedBy = args.image.generatedBy
    const roleHints: ImageBranchCandidateRoleHint[] = ['generated-variant']
    roleHints.push(args.leafNodeIds.has(args.image.nodeId) ? 'branch-leaf' : 'branch-ancestor')

    return {
        nodeId: args.image.nodeId,
        fileId: args.image.fileId,
        workspaceId: args.image.workspaceId,
        imageUrl: getImageUrl(args.image),
        roleHints,
        branchId: getBranchIdForImage(args.image, ancestorNodeIds, args.imagesById),
        parentImageNodeId: generatedBy?.parentImageNodeId,
        ancestorNodeIds,
        sourceContextNodeIds: uniqueValues([...(generatedBy?.sourceContextNodeIds ?? []), ...args.sourceContextNodeIds]),
        sourceMessageId: generatedBy?.responseMessageId,
        promptText: getBranchPromptText(args.image, args.imagesById, args.edges, args.regionNodeId, args.generatedImageTextByNodeId),
        visualEntitySummary: generatedBy?.visualEntitySummary ?? generatedBy?.entitySummary,
        visualStyleSummary: generatedBy?.visualStyleSummary,
        entityTags: generatedBy?.entityTags ?? [],
        styleTags: generatedBy?.styleTags ?? [],
        createdAt: generatedBy?.createdAt,
    }
}

function buildTranscriptContext(candidates: ImageBranchCandidateImage[], prompt: string): string {
    const candidateLines = candidates.map((candidate) => [
        `nodeId=${candidate.nodeId}`,
        `roles=${candidate.roleHints.join(',')}`,
        candidate.branchId ? `branchId=${candidate.branchId}` : undefined,
        candidate.visualEntitySummary ? `visualEntity=${candidate.visualEntitySummary}` : undefined,
        candidate.visualStyleSummary ? `visualStyle=${candidate.visualStyleSummary}` : undefined,
        candidate.promptText ? `promptText=${candidate.promptText.slice(0, 800)}` : undefined,
    ].filter(Boolean).join(' | '))

    return [
        `Current user prompt: ${prompt}`,
        'Candidate image labels:',
        ...candidateLines,
    ].join('\n')
}

export function buildImageBranchCandidateSnapshot({
    regionNodeId,
    threadId,
    nodes,
    edges,
    prompt,
    generatedImageTextByNodeId = {},
}: BuildImageBranchCandidateSnapshotParams): ImageBranchCandidateSnapshot {
    const sourceContextNodeIds = getSourceContextNodeIds(nodes, edges, regionNodeId)
    const contextImages = getContextImageNodes(nodes, sourceContextNodeIds)
    const generatedImages = getGeneratedImagesForThread(nodes, threadId)
    const generatedImagesById = new Map(generatedImages.map((image) => [image.nodeId, image]))
    const leafNodeIds = new Set(getLeafGeneratedImages(generatedImages, edges).map((image) => image.nodeId))
    const candidatesById = new Map<string, ImageBranchCandidateImage>()

    for (const image of contextImages) {
        addCandidate(candidatesById, createBaseContextCandidate(image))
    }

    for (const image of generatedImages) {
        addCandidate(candidatesById, createGeneratedCandidate({
            image,
            imagesById: generatedImagesById,
            edges,
            regionNodeId,
            sourceContextNodeIds,
            leafNodeIds,
            generatedImageTextByNodeId,
        }))
    }

    const candidates = Array.from(candidatesById.values())
    return {
        resolverVersion: RESOLVER_VERSION,
        threadId,
        regionNodeId,
        promptText: prompt,
        promptFingerprint: fingerprintPrompt(prompt),
        candidates,
        transcriptContext: buildTranscriptContext(candidates, prompt),
    }
}

export function isContextRegionNode(node: CanvasNode): node is ContextRegionNode {
    return node.type === 'contextRegion' || node.type === 'aiChatThread'
}