'use strict'

import type {
    AiChatThreadCanvasNode,
    CanvasNode,
    ContextRegionCanvasNode,
    ImageGenerationOperationKind,
    ImageCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'

export type ImageBranchSelectionMode = 'context-only' | 'edit-active-branch' | 'all-branches' | 'fresh-branch' | 'ambiguous'

export type ImageBranchCandidateScore = {
    nodeId: string
    branchId: string
    score: number
    reasons: string[]
}

export type ImageBranchSelection = {
    mode: ImageBranchSelectionMode
    sourceNodeId: string | null
    branchId: string | null
    includeGeneratedNodeIds: string[]
    referenceImageNodeIds: string[]
    sourceContextNodeIds: string[]
    operationKind: ImageGenerationOperationKind
    promptText: string
    promptFingerprint: string
    entitySummary?: string
    entityTags: string[]
    styleTags: string[]
    resolverVersion: string
    confidence: number
    reason: string
    candidates: ImageBranchCandidateScore[]
}

type ContextRegionNode = ContextRegionCanvasNode | AiChatThreadCanvasNode

type SelectImageBranchParams = {
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

type SubjectHint = {
    primary: string
    aliases: string[]
}

type StyleHint = {
    tag: string
    aliases: string[]
}

type ImageBranchCandidate = {
    node: ImageCanvasNode
    branchId: string
    ancestorNodeIds: string[]
    promptText: string
    entityTags: string[]
    orderIndex: number
}

type PromptIntent = {
    normalizedPrompt: string
    wantsAllBranches: boolean
    wantsFreshBranch: boolean
    wantsImageEdit: boolean
    wantsPreviousBranch: boolean
    wantsLatestBranch: boolean
    requestedOrdinal: number | null
    targetSubjectHints: SubjectHint[]
    entityTags: string[]
    styleTags: string[]
}

type ProseMirrorJsonNode = {
    type?: string
    text?: string
    attrs?: Record<string, unknown>
    content?: ProseMirrorJsonNode[]
}

const SUBJECT_HINTS: SubjectHint[] = [
    { primary: 'person', aliases: ['guy', 'man', 'person', 'human', 'male', 'gentleman', 'portrait', 'face', 'headshot', 'selfie', 'him', 'he', 'his'] },
    { primary: 'woman', aliases: ['woman', 'girl', 'female', 'lady', 'portrait', 'face', 'headshot', 'selfie', 'her', 'she'] },
    { primary: 'goat', aliases: ['goat', 'ram', 'ibex', 'horned animal'] },
    { primary: 'landscape', aliases: ['landscape', 'scene', 'mountain', 'mountains', 'field', 'terrain', 'gaugain', 'gauguin', 'tahitian'] },
]

const STYLE_HINTS: StyleHint[] = [
    { tag: 'cubist', aliases: ['cubist', 'cubism'] },
    { tag: 'oil-painting', aliases: ['oil painting', 'oil paint', 'oils'] },
    { tag: 'watercolor', aliases: ['watercolor', 'watercolour'] },
    { tag: 'noir', aliases: ['noir'] },
    { tag: 'sketch', aliases: ['sketch', 'pencil drawing', 'charcoal'] },
    { tag: 'photo', aliases: ['photo', 'photographic', 'photorealistic'] },
    { tag: 'painting', aliases: ['painting', 'painted', 'painterly'] },
]

const RESOLVER_VERSION = 'image-branch-lineage-v1'
const TARGET_ACTION_VERBS = 'edit|modify|change|adjust|refine|iterate|improve|make|turn|convert|replace|remove|add|rework|redo|draw|create|generate|render|paint|depict|illustrate|produce'

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

function wantsAllBranches(prompt: string): boolean {
    return /\b(all|every|both|compare|combine|merge)\b.*\b(images?|variants?|versions?|edits?|results?)\b/.test(prompt)
        || /\b(images?|variants?|versions?|edits?|results?)\b.*\b(all|every|both|together)\b/.test(prompt)
        || /\b(other|previous|prior)\s+(edits?|variants?|versions?|results?)\b/.test(prompt)
}

function wantsFreshBranch(prompt: string): boolean {
    return /\b(unrelated|from scratch|fresh|separate|standalone)\b/.test(prompt)
        || /\b(new|another|different)\s+(image|picture|scene|concept|idea)\b/.test(prompt)
}

function hasReferentialSubject(prompt: string): boolean {
    for (const hint of SUBJECT_HINTS) {
        for (const alias of hint.aliases) {
            if (new RegExp(`\\b(the|that|this|same|previous|prior|last|latest|current|existing)\\s+${escapeRegExp(alias)}\\b`).test(prompt)) {
                return true
            }
        }
    }
    return false
}

function hasTargetReference(text: string): boolean {
    return /\b(it|this|that|same|previous|prior|last|latest|current|existing)\b/.test(text)
        || hasReferentialSubject(text)
}

function hasStyleTransferSignal(prompt: string): boolean {
    return /\b(look like|in the style of|style of|cubist|cubism|oil painting|watercolor|watercolour|sketch|noir)\b/.test(prompt)
}

function wantsImageEdit(prompt: string): boolean {
    const targetSpan = getPromptTargetSpan(prompt)
    const targetHasReference = targetSpan ? hasTargetReference(targetSpan) : hasReferentialSubject(prompt)

    return /\b(edit|modify|change|adjust|refine|iterate|improve|variation|variant|version)\b/.test(prompt)
        || /\b(previous|last|latest|same|that|this)\s+(image|picture|result|variant|version)\b/.test(prompt)
        || /\b(make|turn|convert|replace|remove|add|keep|preserve)\s+(it|this|that|the image)\b/.test(prompt)
        || /\b(make|turn|change|adjust|replace|remove|add|keep|preserve)\s+(the|its|his|her|their)\s+(background|foreground|palette|colors?|colours?|lighting|style|face|hair|shirt|composition)\b/.test(prompt)
        || targetHasReference
        || (targetHasReference && hasStyleTransferSignal(prompt))
}

function wantsPreviousBranch(prompt: string): boolean {
    return /\b(go back|return)\b.*\b(previous|prior|earlier)\b/.test(prompt)
        || /\b(previous|prior|earlier)\s+(image|picture|result|variant|version)\b/.test(prompt)
}

function wantsLatestBranch(prompt: string): boolean {
    return /\b(last|latest|newest|current|this|that|same)\s+(image|picture|result|variant|version)\b/.test(prompt)
}

function getPromptTargetSpan(prompt: string): string {
    const match = new RegExp(`\\b(${TARGET_ACTION_VERBS})\\b(?<target>[^.!?;,]*)`).exec(prompt)
    const target = match?.groups?.target?.trim()
    if (!target) return ''
    return target.split(/\b(to|into|with|using|use|while|but|and|as|from|based\s+on|inspired\s+by|look(?:s|ing)?\s+like|in\s+the\s+style(?:\s+of)?|style\s+of)\b/)[0]?.trim() ?? ''
}

function getSubjectHintsFromText(text: string): SubjectHint[] {
    return SUBJECT_HINTS.filter((hint) => hint.aliases.some((alias) => containsWord(text, alias)))
}

function getTargetSubjectHints(prompt: string): SubjectHint[] {
    const targetSpan = getPromptTargetSpan(prompt)
    if (targetSpan) return getSubjectHintsFromText(targetSpan)
    return getSubjectHintsFromText(prompt)
}

function getStyleTagsFromText(text: string): string[] {
    return STYLE_HINTS
        .filter((styleHint) => styleHint.aliases.some((alias) => containsWord(text, alias)))
        .map((styleHint) => styleHint.tag)
}

function summarizeEntityTags(entityTags: string[]): string | undefined {
    return entityTags.length > 0 ? entityTags.join(', ') : undefined
}

function getPromptIntent(prompt: string): PromptIntent {
    const normalizedPrompt = normalizePrompt(prompt)
    const targetSubjectHints = getTargetSubjectHints(normalizedPrompt)
    const entityTags = Array.from(new Set(targetSubjectHints.map((hint) => hint.primary)))
    return {
        normalizedPrompt,
        wantsAllBranches: wantsAllBranches(normalizedPrompt),
        wantsFreshBranch: wantsFreshBranch(normalizedPrompt),
        wantsImageEdit: wantsImageEdit(normalizedPrompt),
        wantsPreviousBranch: wantsPreviousBranch(normalizedPrompt),
        wantsLatestBranch: wantsLatestBranch(normalizedPrompt),
        requestedOrdinal: getRequestedOrdinal(normalizedPrompt),
        targetSubjectHints,
        entityTags,
        styleTags: getStyleTagsFromText(normalizedPrompt),
    }
}

function containsWord(text: string, word: string): boolean {
    return new RegExp(`\\b${escapeRegExp(word)}\\b`).test(text)
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function uniqueValues(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)))
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

function getContextImageNodeIds(nodes: CanvasNode[], sourceContextNodeIds: string[]): string[] {
    const sourceContextNodeIdSet = new Set(sourceContextNodeIds)
    return nodes
        .filter((node): node is ImageCanvasNode => node.type === 'image' && sourceContextNodeIdSet.has(node.nodeId))
        .map((node) => node.nodeId)
}

function getImagePromptText(image: ImageCanvasNode, generatedImageTextByNodeId: Record<string, string> = {}): string {
    return normalizePrompt([
        image.generatedBy?.promptText,
        image.generatedBy?.revisedPrompt,
        generatedImageTextByNodeId[image.nodeId],
    ].filter((text): text is string => Boolean(text)).join('\n'))
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
        .join(' ')
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

function getRequestedOrdinal(prompt: string): number | null {
    const ordinalMatchers: Array<{ ordinal: number; pattern: RegExp }> = [
        { ordinal: 0, pattern: /\b(first|1st|image\s*#?\s*1|variant\s*#?\s*1|version\s*#?\s*1)\b/ },
        { ordinal: 1, pattern: /\b(second|2nd|image\s*#?\s*2|variant\s*#?\s*2|version\s*#?\s*2)\b/ },
        { ordinal: 2, pattern: /\b(third|3rd|image\s*#?\s*3|variant\s*#?\s*3|version\s*#?\s*3)\b/ },
        { ordinal: 3, pattern: /\b(fourth|4th|image\s*#?\s*4|variant\s*#?\s*4|version\s*#?\s*4)\b/ },
    ]

    return ordinalMatchers.find(({ pattern }) => pattern.test(prompt))?.ordinal ?? null
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

function getBranchIdForImage(selectedImage: ImageCanvasNode, ancestorNodeIds: string[], imagesById: Map<string, ImageCanvasNode>): string {
    const explicitBranchId = selectedImage.generatedBy?.branchId
    if (explicitBranchId) return explicitBranchId

    for (const ancestorNodeId of ancestorNodeIds) {
        const ancestorBranchId = imagesById.get(ancestorNodeId)?.generatedBy?.branchId
        if (ancestorBranchId) return ancestorBranchId
    }

    return `branch-${ancestorNodeIds[0] ?? selectedImage.nodeId}`
}

function getCandidateEntityTags(candidateNodeIds: string[], promptText: string, imagesById: Map<string, ImageCanvasNode>): string[] {
    const metadataTags = candidateNodeIds.flatMap((nodeId) => imagesById.get(nodeId)?.generatedBy?.entityTags ?? [])
    const promptTags = getSubjectHintsFromText(promptText).map((hint) => hint.primary)
    return uniqueValues([...metadataTags, ...promptTags])
}

function getImageBranchCandidates(
    leaves: ImageCanvasNode[],
    generatedImages: ImageCanvasNode[],
    imagesById: Map<string, ImageCanvasNode>,
    edges: WorkspaceEdge[],
    regionNodeId: string,
    generatedImageTextByNodeId: Record<string, string>
): ImageBranchCandidate[] {
    return leaves.map((leaf) => {
        const ancestorNodeIds = collectImageBranchAncestors(leaf, imagesById, edges, regionNodeId)
        const promptText = getBranchPromptText(leaf, imagesById, edges, regionNodeId, generatedImageTextByNodeId)
        return {
            node: leaf,
            branchId: getBranchIdForImage(leaf, ancestorNodeIds, imagesById),
            ancestorNodeIds,
            promptText,
            entityTags: getCandidateEntityTags(ancestorNodeIds, promptText, imagesById),
            orderIndex: generatedImages.findIndex((image) => image.nodeId === leaf.nodeId),
        }
    })
}

function scoreCandidate(
    candidate: ImageBranchCandidate,
    intent: PromptIntent,
    latestLeafNodeId: string | undefined,
    previousLeafNodeId: string | undefined
): ImageBranchCandidateScore {
    let score = 0
    const reasons: string[] = []

    if (intent.entityTags.length > 0) {
        const matchingEntityTags = intent.entityTags.filter((tag) => candidate.entityTags.includes(tag))
        const conflictingEntityTags = candidate.entityTags.filter((tag) => !intent.entityTags.includes(tag))
        if (matchingEntityTags.length > 0) {
            score += 60 + matchingEntityTags.length * 10
            reasons.push(`entity:${matchingEntityTags.join(',')}`)
        } else if (conflictingEntityTags.length > 0) {
            score -= 45
            reasons.push(`entity-conflict:${conflictingEntityTags.join(',')}`)
        } else {
            score -= 10
            reasons.push('entity-unknown')
        }
    }

    if (intent.wantsPreviousBranch) {
        if (candidate.node.nodeId === previousLeafNodeId) {
            score += 35
            reasons.push('previous-branch')
        } else {
            score -= 8
        }
    }

    if (intent.wantsLatestBranch || (!intent.wantsPreviousBranch && intent.entityTags.length === 0)) {
        if (candidate.node.nodeId === latestLeafNodeId) {
            score += 25
            reasons.push('latest-branch')
        }
    }

    if (intent.wantsImageEdit) {
        score += 12
        reasons.push('edit-intent')
    }

    if (intent.styleTags.length > 0) {
        score += 8
        reasons.push(`style:${intent.styleTags.join(',')}`)
    }

    if (candidate.orderIndex >= 0) {
        score += Math.min(candidate.orderIndex + 1, 12)
    }

    return {
        nodeId: candidate.node.nodeId,
        branchId: candidate.branchId,
        score,
        reasons,
    }
}

function scoreCandidates(candidates: ImageBranchCandidate[], intent: PromptIntent): ImageBranchCandidateScore[] {
    const latestLeafNodeId = candidates[candidates.length - 1]?.node.nodeId
    const previousLeafNodeId = candidates.length > 1 ? candidates[candidates.length - 2]?.node.nodeId : undefined
    return candidates
        .map((candidate) => scoreCandidate(candidate, intent, latestLeafNodeId, previousLeafNodeId))
        .sort((left, right) => right.score - left.score)
}

function getConfidence(bestScore: number, secondBestScore: number | undefined): number {
    if (bestScore <= 0) return 0.1
    const gap = secondBestScore === undefined ? bestScore : Math.max(0, bestScore - secondBestScore)
    return Math.min(0.99, Math.max(0.2, (bestScore + gap) / 120))
}

function shouldSelectBestCandidate(bestCandidate: ImageBranchCandidate, bestScore: ImageBranchCandidateScore, intent: PromptIntent): boolean {
    if (intent.entityTags.length > 0) {
        const hasEntityMatch = intent.entityTags.some((tag) => bestCandidate.entityTags.includes(tag))
        return hasEntityMatch && bestScore.score >= 45
    }
    return intent.wantsImageEdit && bestScore.score >= 15
}

function createSelection(params: {
    mode: ImageBranchSelectionMode
    sourceNodeId: string | null
    branchId: string | null
    includeGeneratedNodeIds: string[]
    sourceContextNodeIds: string[]
    contextImageNodeIds: string[]
    intent: PromptIntent
    operationKind: ImageGenerationOperationKind
    reason: string
    confidence?: number
    candidates?: ImageBranchCandidateScore[]
}): ImageBranchSelection {
    return {
        mode: params.mode,
        sourceNodeId: params.sourceNodeId,
        branchId: params.branchId,
        includeGeneratedNodeIds: uniqueValues(params.includeGeneratedNodeIds),
        referenceImageNodeIds: uniqueValues([...params.contextImageNodeIds, ...params.includeGeneratedNodeIds]),
        sourceContextNodeIds: uniqueValues(params.sourceContextNodeIds),
        operationKind: params.operationKind,
        promptText: params.intent.normalizedPrompt,
        promptFingerprint: fingerprintPrompt(params.intent.normalizedPrompt),
        entitySummary: summarizeEntityTags(params.intent.entityTags),
        entityTags: params.intent.entityTags,
        styleTags: params.intent.styleTags,
        resolverVersion: RESOLVER_VERSION,
        confidence: params.confidence ?? 1,
        reason: params.reason,
        candidates: params.candidates ?? [],
    }
}

export function resolveImageBranchForPrompt({
    regionNodeId,
    threadId,
    nodes,
    edges,
    prompt,
    generatedImageTextByNodeId = {},
}: SelectImageBranchParams): ImageBranchSelection {
    const intent = getPromptIntent(prompt)
    const sourceContextNodeIds = getSourceContextNodeIds(nodes, edges, regionNodeId)
    const contextImageNodeIds = getContextImageNodeIds(nodes, sourceContextNodeIds)
    const generatedImages = getGeneratedImagesForThread(nodes, threadId)
    if (generatedImages.length === 0) {
        return createSelection({
            mode: 'context-only',
            sourceNodeId: null,
            branchId: null,
            includeGeneratedNodeIds: [],
            sourceContextNodeIds,
            contextImageNodeIds,
            intent,
            operationKind: 'new_image',
            reason: 'no generated images exist for this thread',
        })
    }

    const imagesById = new Map(generatedImages.map((image) => [image.nodeId, image]))
    const leaves = getLeafGeneratedImages(generatedImages, edges)
    const candidates = getImageBranchCandidates(leaves, generatedImages, imagesById, edges, regionNodeId, generatedImageTextByNodeId)
    const scoredCandidates = scoreCandidates(candidates, intent)

    if (intent.wantsAllBranches) {
        return createSelection({
            mode: 'all-branches',
            sourceNodeId: null,
            branchId: null,
            includeGeneratedNodeIds: generatedImages.map((image) => image.nodeId),
            sourceContextNodeIds,
            contextImageNodeIds,
            intent,
            operationKind: 'compare_branches',
            reason: 'prompt explicitly requested multiple branches',
            confidence: 0.95,
            candidates: scoredCandidates,
        })
    }

    if (intent.wantsFreshBranch) {
        return createSelection({
            mode: 'fresh-branch',
            sourceNodeId: null,
            branchId: null,
            includeGeneratedNodeIds: [],
            sourceContextNodeIds,
            contextImageNodeIds,
            intent,
            operationKind: 'fresh_branch',
            reason: 'prompt explicitly requested a fresh branch',
            confidence: 0.95,
            candidates: scoredCandidates,
        })
    }

    if (!intent.wantsImageEdit) {
        return createSelection({
            mode: 'context-only',
            sourceNodeId: null,
            branchId: null,
            includeGeneratedNodeIds: [],
            sourceContextNodeIds,
            contextImageNodeIds,
            intent,
            operationKind: 'new_image',
            reason: 'prompt did not indicate an edit of an existing generated image',
            confidence: 0.9,
            candidates: scoredCandidates,
        })
    }

    const ordinalImage = intent.requestedOrdinal !== null
        ? generatedImages[Math.min(intent.requestedOrdinal, generatedImages.length - 1)]
        : undefined
    if (ordinalImage) {
        const includeGeneratedNodeIds = collectImageBranchAncestors(ordinalImage, imagesById, edges, regionNodeId)
        return createSelection({
            mode: 'edit-active-branch',
            sourceNodeId: ordinalImage.nodeId,
            branchId: getBranchIdForImage(ordinalImage, includeGeneratedNodeIds, imagesById),
            includeGeneratedNodeIds,
            sourceContextNodeIds,
            contextImageNodeIds,
            intent,
            operationKind: intent.styleTags.length > 0 ? 'style_transfer' : 'edit_existing',
            reason: 'prompt selected a generated image by ordinal',
            confidence: 0.96,
            candidates: scoredCandidates,
        })
    }

    const bestScore = scoredCandidates[0]
    const bestCandidate = bestScore ? candidates.find((candidate) => candidate.node.nodeId === bestScore.nodeId) : undefined
    if (!bestScore || !bestCandidate || !shouldSelectBestCandidate(bestCandidate, bestScore, intent)) {
        return createSelection({
            mode: intent.entityTags.length > 0 ? 'ambiguous' : 'context-only',
            sourceNodeId: null,
            branchId: null,
            includeGeneratedNodeIds: [],
            sourceContextNodeIds,
            contextImageNodeIds,
            intent,
            operationKind: 'new_image',
            reason: intent.entityTags.length > 0
                ? 'prompt named a subject, but no generated branch matched it with enough confidence'
                : 'no generated branch matched the prompt with enough confidence',
            confidence: bestScore ? getConfidence(bestScore.score, scoredCandidates[1]?.score) : 0.1,
            candidates: scoredCandidates,
        })
    }

    return createSelection({
        mode: 'edit-active-branch',
        sourceNodeId: bestCandidate.node.nodeId,
        branchId: bestCandidate.branchId,
        includeGeneratedNodeIds: bestCandidate.ancestorNodeIds,
        sourceContextNodeIds,
        contextImageNodeIds,
        intent,
        operationKind: intent.styleTags.length > 0 ? 'style_transfer' : 'edit_existing',
        reason: bestScore.reasons.join('; ') || 'best generated branch matched prompt intent',
        confidence: getConfidence(bestScore.score, scoredCandidates[1]?.score),
        candidates: scoredCandidates,
    })
}

export function selectImageBranchForPrompt(params: SelectImageBranchParams): ImageBranchSelection {
    return resolveImageBranchForPrompt(params)
}

export function isContextRegionNode(node: CanvasNode): node is ContextRegionNode {
    return node.type === 'contextRegion' || node.type === 'aiChatThread'
}