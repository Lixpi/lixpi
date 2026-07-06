'use strict'

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
    if (node.type === 'aiGeneratedImage') {
        return typeof node.attrs?.revisedPrompt === 'string' ? node.attrs.revisedPrompt : ''
    }
    return node.content?.map((child) => collectProseMirrorText(child, options)).join('') ?? ''
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
            continue
        }
        if (child.type === 'aiResponseMessage') {
            responseMessage = child
        }
    }

    return { userMessage, responseMessage }
}
