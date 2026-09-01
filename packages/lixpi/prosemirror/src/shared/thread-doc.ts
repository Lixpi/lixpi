'use strict'

import type { PromptReferenceAtomAttrs } from '@lixpi/constants'

import {
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    normalizeLegacyCapabilityReferenceAttrs,
    normalizePromptReferenceAttrs,
    PROMPT_REFERENCE_NODE_TYPE,
} from './prompt-reference.ts'

// Pure ProseMirror-JSON document math shared by web-ui and the API: parsing,
// text collection, thread lookup, and branch-marker turn pairing. No schema,
// no rendering — plain JSON traversal only, safe in Node and the browser.

export type ProseMirrorJsonNode = {
    type?: string
    text?: string
    attrs?: Record<string, any>
    content?: ProseMirrorJsonNode[]
}

export type CollectProseMirrorTextOptions = {
    excludedNodeTypes?: string[]
}

export function parseProseMirrorJsonContent(content: unknown): ProseMirrorJsonNode | null {
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

export function collectProseMirrorText(node: ProseMirrorJsonNode | undefined, options: CollectProseMirrorTextOptions = {}): string {
    if (!node) return ''
    if (options.excludedNodeTypes?.includes(node.type ?? '')) return ''
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hard_break') return '\n'
    if (node.type === PROMPT_REFERENCE_NODE_TYPE) {
        return normalizePromptReferenceAttrs(node.attrs)?.displayName ?? ''
    }
    if (node.type === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE) {
        return normalizeLegacyCapabilityReferenceAttrs(node.attrs)?.displayName ?? ''
    }
    if (node.type === 'aiGeneratedImage') {
        return typeof node.attrs?.revisedPrompt === 'string' ? node.attrs.revisedPrompt : ''
    }
    return node.content?.map((child) => collectProseMirrorText(child, options)).join('') ?? ''
}

export function collectProseMirrorPromptReferences(
    node: ProseMirrorJsonNode | null | undefined,
): PromptReferenceAtomAttrs[] {
    if (!node) return []
    const references: PromptReferenceAtomAttrs[] = []
    const visit = (candidate: ProseMirrorJsonNode): void => {
        const attrs = candidate.type === PROMPT_REFERENCE_NODE_TYPE
            ? normalizePromptReferenceAttrs(candidate.attrs)
            : candidate.type === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE
            ? normalizeLegacyCapabilityReferenceAttrs(candidate.attrs)
            : null
        if (attrs) references.push(attrs)
        for (const child of candidate.content ?? []) visit(child)
    }
    visit(node)
    return references
}

export function findAiChatThreadContentNode(root: ProseMirrorJsonNode, threadId: string): ProseMirrorJsonNode | null {
    if (root.type === 'aiChatThread' && root.attrs?.threadId === threadId) return root
    for (const child of root.content ?? []) {
        const result = findAiChatThreadContentNode(child, threadId)
        if (result) return result
    }
    return null
}

// Identity of one branch marker's generation turn, decoupled from the canvas
// node shape so both web-ui and the API can pair markers with their own turn.
export type BranchMarkerTurnDescriptor = {
    generationRequestId?: string
    reasoningRunId?: string
    reasoningModelId?: string
    reasoningIndex?: number | null
    // The marker canvas-node id, matched against the aiReasoningSection attr
    // named by markerNodeAttr (branchOriginNodeId / branchForkNodeId / branchLineNodeId).
    markerNodeId?: string
    markerNodeAttr?: 'branchOriginNodeId' | 'branchForkNodeId' | 'branchLineNodeId'
}

export type BranchMarkerTurnMessages = {
    userMessage: ProseMirrorJsonNode | null
    responseMessage: ProseMirrorJsonNode
}

export type BranchMarkerPreviewPhase = 'preamble' | 'enhancement' | 'done'

export type BranchMarkerConversationPreview = {
    userMessage: ProseMirrorJsonNode
    userText: string
    promptReferences: PromptReferenceAtomAttrs[]
    responseText: string
    phase: BranchMarkerPreviewPhase
    isReceiving: boolean
    streamIsReceiving: boolean
}

function parseReasoningIndex(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function normalizeModelValue(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase()
}

function reasoningIndexMatches(section: ProseMirrorJsonNode, descriptor: BranchMarkerTurnDescriptor): boolean {
    const descriptorIndex = parseReasoningIndex(descriptor.reasoningIndex)
    const sectionIndex = parseReasoningIndex(section.attrs?.reasoningIndex)
    return descriptorIndex === null || sectionIndex === null || descriptorIndex === sectionIndex
}

// Exact-match-only section lookup. Unlike a container fallback that returns the
// whole response when it has no sections, a null here reliably means "this
// response does not belong to that marker's turn".
export function findBranchMarkerResponseSection(
    responseMessage: ProseMirrorJsonNode,
    descriptor: BranchMarkerTurnDescriptor,
): ProseMirrorJsonNode | null {
    const sections = (responseMessage.content ?? []).filter((child) => child.type === 'aiReasoningSection')
    if (sections.length === 0) return null

    if (descriptor.reasoningRunId) {
        const section = sections.find((candidate) => candidate.attrs?.reasoningRunId === descriptor.reasoningRunId)
        if (section) return section
    }

    if (descriptor.markerNodeId && descriptor.markerNodeAttr) {
        const section = sections.find((candidate) => candidate.attrs?.[descriptor.markerNodeAttr!] === descriptor.markerNodeId)
        if (section) return section
    }

    if (descriptor.generationRequestId) {
        const section = sections.find((candidate) => candidate.attrs?.generationRequestId === descriptor.generationRequestId)
        if (section) return section
    }

    if (descriptor.reasoningModelId) {
        const normalizedModelId = normalizeModelValue(descriptor.reasoningModelId)
        const section = sections.find((candidate) =>
            normalizeModelValue(candidate.attrs?.reasoningModelId) === normalizedModelId
            && reasoningIndexMatches(candidate, descriptor)
        )
        if (section) return section
    }

    return null
}

function findBranchMarkerFallbackResponseSection(
    sections: ProseMirrorJsonNode[],
    descriptor: BranchMarkerTurnDescriptor,
): ProseMirrorJsonNode | null {
    if (sections.length !== 1) return null

    const section = sections[0]
    if (!section) return null
    const markerGenerationRequestId = descriptor.generationRequestId
    const sectionGenerationRequestId = section.attrs?.generationRequestId
    if (
        !markerGenerationRequestId
        || !sectionGenerationRequestId
        || markerGenerationRequestId === sectionGenerationRequestId
    ) {
        return section
    }

    return null
}

export function getBranchMarkerResponseContainer(
    responseMessage: ProseMirrorJsonNode,
    descriptor: BranchMarkerTurnDescriptor,
): ProseMirrorJsonNode | null {
    const sections = (responseMessage.content ?? []).filter((child) => child.type === 'aiReasoningSection')
    if (sections.length === 0) return responseMessage

    return findBranchMarkerResponseSection(responseMessage, descriptor)
        ?? findBranchMarkerFallbackResponseSection(sections, descriptor)
}

function hasStreamingCollapsibleBlock(node: ProseMirrorJsonNode): boolean {
    if (node.type === 'aiCollapsibleBlock' && node.attrs?.isStreaming) return true
    return Boolean(node.content?.some(hasStreamingCollapsibleBlock))
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

function readNonEmptyString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function getCapabilityTraceResponseText(trace: Record<string, unknown>): string {
    const steps = Array.isArray(trace.steps) ? trace.steps : []
    for (let index = steps.length - 1; index >= 0; index--) {
        const outputSummary = readNonEmptyString(asRecord(steps[index])?.outputSummary)
        if (outputSummary) return outputSummary
    }

    const capabilityName = readNonEmptyString(trace.capabilityName)
    const outputAssetIds = Array.isArray(trace.outputAssetIds) ? trace.outputAssetIds : []
    return capabilityName && outputAssetIds.length > 0 ? `${capabilityName} completed.` : ''
}

// Some providers return the media Tool call without also emitting the required
// conversational preamble/XML prompt. The generated prompt still belongs to the
// reasoning run and is persisted in its trace, so it is the durable response
// fallback instead of leaving the branch marker blank.
function getTraceBackedReasoningResponseText(node: ProseMirrorJsonNode): string {
    if (node.type === 'aiCollapsibleBlock') {
        const imageTrace = asRecord(node.attrs?.imageGenerationTrace)
        const imagePrompt = readNonEmptyString(imageTrace?.toolPrompt)
            || readNonEmptyString(imageTrace?.finalPrompt)
        if (imagePrompt) return imagePrompt

        const videoTrace = asRecord(node.attrs?.videoGenerationTrace)
        const videoPrompt = readNonEmptyString(videoTrace?.toolPrompt)
            || readNonEmptyString(videoTrace?.finalPrompt)
        if (videoPrompt) return videoPrompt

        const capabilityTrace = asRecord(node.attrs?.capabilityGenerationTrace)
        const capabilityResponse = capabilityTrace ? getCapabilityTraceResponseText(capabilityTrace) : ''
        if (capabilityResponse) return capabilityResponse
    }

    for (const child of node.content ?? []) {
        const responseText = getTraceBackedReasoningResponseText(child)
        if (responseText) return responseText
    }
    return ''
}

export function inferBranchMarkerPreviewPhase(
    responseMessage: ProseMirrorJsonNode,
    responseContainer: ProseMirrorJsonNode,
): { phase: BranchMarkerPreviewPhase; isReceiving: boolean } {
    const responseReceiving = Boolean(responseMessage.attrs?.isReceivingAnimation)
    const sectionReceiving = Boolean(responseContainer.attrs?.isReceivingAnimation)
    if (hasStreamingCollapsibleBlock(responseContainer)) {
        return { phase: 'enhancement', isReceiving: true }
    }
    const isReceiving = responseReceiving || sectionReceiving
    return {
        phase: isReceiving ? 'preamble' : 'done',
        isReceiving,
    }
}

function responseMessageMatchesTurn(responseMessage: ProseMirrorJsonNode, descriptor: BranchMarkerTurnDescriptor): boolean {
    if (descriptor.generationRequestId) {
        const responseRequestId = responseMessage.attrs?.generationRequestId
        if (responseRequestId && responseRequestId === descriptor.generationRequestId) return true
    }
    return Boolean(findBranchMarkerResponseSection(responseMessage, descriptor))
}

// Pairs a branch marker with ITS OWN turn: the response message that exactly
// matches the descriptor (newest first) and the user message immediately
// preceding it in document order. Returns null when no response matches yet —
// callers treat that as the preflight state and may fall back to the latest
// turn so the in-flight marker keeps live-updating.
export function getBranchMarkerTurnMessages(
    threadNode: ProseMirrorJsonNode,
    descriptor: BranchMarkerTurnDescriptor,
): BranchMarkerTurnMessages | null {
    const children = threadNode.content ?? []
    const turns: BranchMarkerTurnMessages[] = []
    let precedingUserMessage: ProseMirrorJsonNode | null = null

    for (const child of children) {
        if (child.type === 'aiUserMessage') {
            precedingUserMessage = child
            continue
        }
        if (child.type === 'aiResponseMessage') {
            turns.push({ userMessage: precedingUserMessage, responseMessage: child })
        }
    }

    for (let index = turns.length - 1; index >= 0; index--) {
        const turn = turns[index]!
        if (responseMessageMatchesTurn(turn.responseMessage, descriptor)) return turn
    }

    return null
}

// Latest-turn selection (the previous thread-wide behavior), used for preflight
// markers whose own response does not exist in the document yet.
export function getLatestThreadTurnMessages(threadNode: ProseMirrorJsonNode): {
    userMessage: ProseMirrorJsonNode | null
    responseMessage: ProseMirrorJsonNode | null
} {
    let userMessage: ProseMirrorJsonNode | null = null
    let responseMessage: ProseMirrorJsonNode | null = null

    for (const child of threadNode.content ?? []) {
        if (child.type === 'aiUserMessage') {
            userMessage = child
            responseMessage = null
            continue
        }
        if (child.type === 'aiResponseMessage') {
            responseMessage = child
        }
    }

    return { userMessage, responseMessage }
}

export function getBranchMarkerConversationPreviewFromThreadContent(
    content: unknown,
    threadId: string,
    descriptor: BranchMarkerTurnDescriptor,
    options: { generationActive?: boolean; allowLatestTurnFallback?: boolean } = {},
): BranchMarkerConversationPreview | null {
    const root = parseProseMirrorJsonContent(content)
    if (!root) return null

    const threadNode = findAiChatThreadContentNode(root, threadId)
    if (!threadNode) return null

    const ownTurn = getBranchMarkerTurnMessages(threadNode, descriptor)
    const allowsLatestTurnFallback = options.allowLatestTurnFallback !== false
    const usesLatestTurnFallback = !ownTurn && allowsLatestTurnFallback
    const latestTurn = usesLatestTurnFallback
        ? getLatestThreadTurnMessages(threadNode)
        : { userMessage: null, responseMessage: null }
    const userMessage = ownTurn?.userMessage ?? latestTurn.userMessage
    const responseMessage = ownTurn?.responseMessage ?? latestTurn.responseMessage

    if (!userMessage) return null
    const userText = collectProseMirrorText(userMessage, {
        excludedNodeTypes: [PROMPT_REFERENCE_NODE_TYPE, LEGACY_CAPABILITY_REFERENCE_NODE_TYPE],
    }).trim()
    const promptReferences = collectProseMirrorPromptReferences(userMessage)
    if (!responseMessage) {
        return {
            userMessage,
            userText,
            promptReferences,
            responseText: '',
            phase: 'preamble',
            isReceiving: Boolean(options.generationActive),
            streamIsReceiving: false,
        }
    }

    const fallbackReasoningSections = allowsLatestTurnFallback
        ? (responseMessage.content ?? []).filter(child => child.type === 'aiReasoningSection')
        : []
    const responseContainer = getBranchMarkerResponseContainer(responseMessage, descriptor)
        ?? (fallbackReasoningSections.length === 1 ? fallbackReasoningSections[0]! : null)
    if (!responseContainer) {
        return {
            userMessage,
            userText,
            promptReferences,
            responseText: '',
            phase: 'preamble',
            isReceiving: Boolean(options.generationActive),
            streamIsReceiving: false,
        }
    }

    const conversationalResponseText = collectProseMirrorText(responseContainer, {
        excludedNodeTypes: ['aiGeneratedImage', 'aiGeneratedVideo', 'aiLineageEvent', 'aiCollapsibleBlock'],
    }).trim()
    const collapsibleResponseText = collectProseMirrorText(responseContainer, {
        excludedNodeTypes: ['aiGeneratedImage', 'aiGeneratedVideo', 'aiLineageEvent'],
    }).trim()
    const responseText = conversationalResponseText
        || collapsibleResponseText
        || getTraceBackedReasoningResponseText(responseContainer)
    const { phase, isReceiving: streamIsReceiving } = inferBranchMarkerPreviewPhase(responseMessage, responseContainer)
    return {
        userMessage,
        userText,
        promptReferences,
        responseText,
        phase,
        isReceiving: streamIsReceiving || Boolean(options.generationActive),
        streamIsReceiving,
    }
}

export function shouldShowBranchMarkerConversationResponseLine(
    preview: BranchMarkerConversationPreview | null | undefined,
): boolean {
    return Boolean(preview?.responseText)
}
