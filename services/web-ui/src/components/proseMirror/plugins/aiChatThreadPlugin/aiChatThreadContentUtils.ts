import type { ImageGenerationTrace, VideoGenerationTrace } from '@lixpi/constants'

export type ProseMirrorJsonNode = {
    type?: string
    text?: string
    attrs?: Record<string, any>
    content?: ProseMirrorJsonNode[]
}

// One turn's generated-media context, read back from the thread doc to populate
// the canvas info panel. Carries whichever generation trace the response holds —
// image and video write the same collapsible block, differing only in trace attr.
export type GeneratedImageTurnInfo = {
    userPromptText: string
    responseText: string
    responseMessageId: string
    responseProvider: string
    imageGenerationTrace: ImageGenerationTrace | null
    videoGenerationTrace: VideoGenerationTrace | null
    imageGenerationPromptText: string
}

export type GeneratedMediaTurnLocator = {
    responseMessageId?: string
    reasoningRunId?: string
    reasoningModelId?: string
    mediaRunId?: string
    mediaType?: string
    fileId?: string
    variantIndex?: number | null
}

export type GeneratedMediaTurnFallback = {
    threadId: string
    promptText?: string
    responseText?: string
    responseProvider?: string
    generatedAt?: string | number
    missingReason: string
}

export type GeneratedMediaTurnProjectionSource =
    | 'thread-content'
    | 'generated-by-fallback'
    | 'branch-origin-fallback'

export type GeneratedMediaTurnProjection = {
    threadId: string
    locator: GeneratedMediaTurnLocator
    content: ProseMirrorJsonNode
    source: GeneratedMediaTurnProjectionSource
    missingReason?: string
}

type BuildGeneratedMediaTurnProjectionOptions = {
    threadId?: string
    forceGenerationDetailsOpen?: boolean
    limitToLocatorMedia?: boolean
    fallback?: GeneratedMediaTurnFallback
}

type BuildBranchOriginPromptProjectionOptions = {
    threadId?: string
    generatedAt?: string | number
}

type GeneratedMediaTurnMatch = {
    userMessage: ProseMirrorJsonNode | null
    responseMessage: ProseMirrorJsonNode
    threadAttrs?: Record<string, any>
}

type CollectTextOptions = {
    excludedNodeTypes?: string[]
}

type ProjectionNodeFilter = (node: ProseMirrorJsonNode) => boolean

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

export function collectProseMirrorText(node: ProseMirrorJsonNode | undefined, options: CollectTextOptions = {}): string {
    if (!node) return ''
    if (options.excludedNodeTypes?.includes(node.type ?? '')) return ''
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hard_break') return '\n'
    if (node.type === 'aiGeneratedImage') {
        return typeof node.attrs?.revisedPrompt === 'string' ? node.attrs.revisedPrompt : ''
    }
    return node.content?.map((child) => collectProseMirrorText(child, options)).join('') ?? ''
}

export function collectResponseTextById(root: ProseMirrorJsonNode): Record<string, string> {
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

// A multi-model response holds one aiReasoningSection per reasoning model; the
// content owner for a given image/video is the section whose model produced it
// (so each image's history shows ONLY its own model, never the other models').
// Legacy single-model responses have no sections, so the message itself is used.
function sectionContainsMediaRun(section: ProseMirrorJsonNode, mediaRunId: string): boolean {
    for (const child of section.content ?? []) {
        if ((child.type === 'aiGeneratedImage' || child.type === 'aiGeneratedVideo') && child.attrs?.mediaRunId === mediaRunId) {
            return true
        }
    }
    return false
}

function getReasoningContainer(responseNode: ProseMirrorJsonNode, locator: GeneratedMediaTurnLocator): ProseMirrorJsonNode {
    const sections = (responseNode.content ?? []).filter((child) => child.type === 'aiReasoningSection')
    if (sections.length === 0) return responseNode

    if (locator.reasoningRunId) {
        const matched = sections.find((section) => section.attrs?.reasoningRunId === locator.reasoningRunId)
        if (matched) return matched
    }

    if (locator.mediaRunId) {
        const matched = sections.find((section) => sectionContainsMediaRun(section, locator.mediaRunId!))
        if (matched) return matched
    }

    if (locator.reasoningModelId) {
        const matched = sections.find((section) => section.attrs?.reasoningModelId === locator.reasoningModelId)
        if (matched) return matched
    }

    return sections[0]
}

function cloneProseMirrorJsonNode(node: ProseMirrorJsonNode): ProseMirrorJsonNode {
    return {
        ...node,
        attrs: node.attrs ? structuredClone(node.attrs) : undefined,
        content: node.content?.map(cloneProseMirrorJsonNode),
    }
}

function isGeneratedMediaProjectionNode(node: ProseMirrorJsonNode): boolean {
    return node.type === 'aiGeneratedImage' || node.type === 'aiGeneratedVideo'
}

function parseNullableNumber(value: unknown): number | null {
    if (value == null || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function generatedMediaNodeMatchesLocator(node: ProseMirrorJsonNode, locator: GeneratedMediaTurnLocator): boolean {
    if (!isGeneratedMediaProjectionNode(node)) return true

    const attrs = node.attrs ?? {}
    if (locator.mediaType && attrs.mediaType && attrs.mediaType !== locator.mediaType) return false
    if (locator.fileId && attrs.fileId && attrs.fileId !== locator.fileId) return false
    if (locator.mediaRunId && attrs.mediaRunId !== locator.mediaRunId) return false

    const locatorVariantIndex = parseNullableNumber(locator.variantIndex)
    const nodeVariantIndex = parseNullableNumber(attrs.variantIndex)
    if (locatorVariantIndex != null && nodeVariantIndex != null && nodeVariantIndex !== locatorVariantIndex) return false

    if (locator.mediaRunId && attrs.mediaRunId === locator.mediaRunId) return true
    if (locator.fileId && attrs.fileId === locator.fileId) return true
    return false
}

function createSingleGeneratedMediaFilter(locator: GeneratedMediaTurnLocator): ProjectionNodeFilter | undefined {
    if (!locator.mediaRunId && !locator.fileId) return undefined
    return (node) => generatedMediaNodeMatchesLocator(node, locator)
}

function cloneProjectionNodeTree(
    node: ProseMirrorJsonNode,
    forceGenerationDetailsOpen: boolean,
    shouldKeepNode?: ProjectionNodeFilter,
): ProseMirrorJsonNode | null {
    if (shouldKeepNode && !shouldKeepNode(node)) return null

    const cloned = cloneProseMirrorJsonNode(node)
    if (forceGenerationDetailsOpen && cloned.type === 'aiCollapsibleBlock') {
        cloned.attrs = {
            ...(cloned.attrs ?? {}),
            isOpen: true,
        }
    }
    if (cloned.content) {
        cloned.content = cloned.content
            .map((child) => cloneProjectionNodeTree(child, forceGenerationDetailsOpen, shouldKeepNode))
            .filter((child): child is ProseMirrorJsonNode => Boolean(child))
    }
    return cloned
}

function cloneProjectionNode(
    node: ProseMirrorJsonNode,
    forceGenerationDetailsOpen: boolean,
    shouldKeepNode?: ProjectionNodeFilter,
): ProseMirrorJsonNode {
    return cloneProjectionNodeTree(node, forceGenerationDetailsOpen, shouldKeepNode) ?? cloneProseMirrorJsonNode(node)
}

function createDocumentTitleNode(text: string): ProseMirrorJsonNode {
    return {
        type: 'documentTitle',
        content: [{ type: 'text', text }],
    }
}

function createParagraphNodesFromText(text: string): ProseMirrorJsonNode[] {
    const blocks = text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)

    if (blocks.length === 0) {
        return [{ type: 'paragraph' }]
    }

    return blocks.map((block) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: block }],
    }))
}

function parseTimestamp(value?: string | number): number {
    if (!value) return 0
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function createUserMessageNode(text: string, createdAt = 0): ProseMirrorJsonNode {
    return {
        type: 'aiUserMessage',
        attrs: {
            id: 'generated-media-provenance-user',
            createdAt,
        },
        content: createParagraphNodesFromText(text),
    }
}

function createResponseMessageNode(text: string, provider = ''): ProseMirrorJsonNode {
    return {
        type: 'aiResponseMessage',
        attrs: {
            id: 'generated-media-provenance-response',
            style: '',
            isInitialRenderAnimation: false,
            isReceivingAnimation: false,
            aiProvider: provider,
            generationRequestId: '',
            reasoningRunId: '',
            mediaRunId: '',
            reasoningModelId: '',
            mediaModelId: '',
            mediaType: '',
            variantIndex: null,
        },
        content: createParagraphNodesFromText(text),
    }
}

function createProjectionDocument(threadId: string, threadAttrs: Record<string, any> | undefined, messages: ProseMirrorJsonNode[]): ProseMirrorJsonNode {
    return {
        type: 'doc',
        content: [
            createDocumentTitleNode('Generated media provenance'),
            {
                type: 'aiChatThread',
                attrs: {
                    ...(threadAttrs ?? {}),
                    threadId,
                },
                content: messages,
            },
        ],
    }
}

function buildFallbackProjection(
    locator: GeneratedMediaTurnLocator,
    fallback: GeneratedMediaTurnFallback,
    source: GeneratedMediaTurnProjectionSource,
): GeneratedMediaTurnProjection {
    const messages: ProseMirrorJsonNode[] = []
    const createdAt = parseTimestamp(fallback.generatedAt)

    if (fallback.promptText?.trim()) {
        messages.push(createUserMessageNode(fallback.promptText.trim(), createdAt))
    }

    if (fallback.responseText?.trim() || fallback.responseProvider) {
        messages.push(createResponseMessageNode(fallback.responseText?.trim() ?? '', fallback.responseProvider ?? ''))
    }

    return {
        threadId: fallback.threadId,
        locator,
        content: createProjectionDocument(fallback.threadId, undefined, messages),
        source,
        missingReason: fallback.missingReason,
    }
}

function cloneResponseForProjection(
    responseNode: ProseMirrorJsonNode,
    locator: GeneratedMediaTurnLocator,
    forceGenerationDetailsOpen: boolean,
    limitToLocatorMedia: boolean,
): ProseMirrorJsonNode {
    const shouldKeepNode = limitToLocatorMedia
        ? createSingleGeneratedMediaFilter(locator)
        : undefined
    const sections = (responseNode.content ?? []).filter((child) => child.type === 'aiReasoningSection')
    if (sections.length === 0) {
        return cloneProjectionNode(responseNode, forceGenerationDetailsOpen, shouldKeepNode)
    }

    const selectedSection = getReasoningContainer(responseNode, locator)
    return {
        ...cloneProseMirrorJsonNode(responseNode),
        content: selectedSection.type === 'aiReasoningSection'
            ? [cloneProjectionNode(selectedSection, forceGenerationDetailsOpen, shouldKeepNode)]
            : [],
    }
}

export function buildGeneratedMediaTurnProjectionFromThreadContent(
    threadContent: unknown,
    locator: GeneratedMediaTurnLocator,
    options: BuildGeneratedMediaTurnProjectionOptions = {},
): GeneratedMediaTurnProjection | null {
    const root = parseProseMirrorJsonContent(threadContent)
    if (!root) {
        return options.fallback
            ? buildFallbackProjection(locator, options.fallback, 'generated-by-fallback')
            : null
    }

    let fallbackMatch: GeneratedMediaTurnMatch | null = null

    function visitContainer(
        node: ProseMirrorJsonNode,
        threadAttrs?: Record<string, any>,
        latestUserMessage: ProseMirrorJsonNode | null = null,
    ): GeneratedMediaTurnMatch | null {
        const scopedThreadAttrs = node.type === 'aiChatThread'
            ? node.attrs
            : threadAttrs
        let scopedLatestUserMessage = node.type === 'aiChatThread'
            ? null
            : latestUserMessage

        for (const child of node.content ?? []) {
            if (child.type === 'aiUserMessage') {
                scopedLatestUserMessage = child
                continue
            }

            if (child.type === 'aiResponseMessage') {
                const responseId = typeof child.attrs?.id === 'string' ? child.attrs.id : ''
                const match = {
                    userMessage: scopedLatestUserMessage,
                    responseMessage: child,
                    threadAttrs: scopedThreadAttrs,
                }

                fallbackMatch = match
                if (locator.responseMessageId && responseId === locator.responseMessageId) return match
                continue
            }

            const nestedMatch = visitContainer(child, scopedThreadAttrs, scopedLatestUserMessage)
            if (nestedMatch) return nestedMatch
        }

        return null
    }

    const exactMatch = visitContainer(root)
    const match = exactMatch ?? (!locator.responseMessageId ? fallbackMatch : null)
    if (!match) {
        return options.fallback
            ? buildFallbackProjection(locator, options.fallback, 'generated-by-fallback')
            : null
    }

    const matchedThreadId = typeof match.threadAttrs?.threadId === 'string' && match.threadAttrs.threadId
        ? match.threadAttrs.threadId
        : undefined
    const threadId = options.threadId
        ?? matchedThreadId
        ?? options.fallback?.threadId
        ?? 'generated-media-provenance'
    const messages = [
        match.userMessage ? cloneProjectionNode(match.userMessage, options.forceGenerationDetailsOpen ?? false) : null,
        cloneResponseForProjection(
            match.responseMessage,
            locator,
            options.forceGenerationDetailsOpen ?? false,
            options.limitToLocatorMedia ?? false,
        ),
    ].filter((message): message is ProseMirrorJsonNode => Boolean(message))

    return {
        threadId,
        locator,
        content: createProjectionDocument(threadId, match.threadAttrs, messages),
        source: 'thread-content',
    }
}

export function buildBranchOriginPromptProjection(
    promptText: string,
    options: BuildBranchOriginPromptProjectionOptions = {},
): GeneratedMediaTurnProjection | null {
    const text = promptText.trim()
    if (!text) return null

    const threadId = options.threadId ?? 'branch-origin-provenance'
    const fallback: GeneratedMediaTurnFallback = {
        threadId,
        promptText: text,
        generatedAt: options.generatedAt,
        missingReason: 'Branch origin provenance is stored outside durable chat history.',
    }
    return buildFallbackProjection({}, fallback, 'branch-origin-fallback')
}

function getFirstGenerationTrace(container: ProseMirrorJsonNode): {
    imageTrace: ImageGenerationTrace | null
    videoTrace: VideoGenerationTrace | null
    promptText: string
} {
    for (const child of container.content ?? []) {
        if (child.type !== 'aiCollapsibleBlock') continue
        return {
            imageTrace: (child.attrs?.imageGenerationTrace as ImageGenerationTrace | undefined) ?? null,
            videoTrace: (child.attrs?.videoGenerationTrace as VideoGenerationTrace | undefined) ?? null,
            promptText: collectProseMirrorText(child).trim(),
        }
    }

    return { imageTrace: null, videoTrace: null, promptText: '' }
}

export function getGeneratedImageTurnInfoFromThreadContent(
    threadContent: unknown,
    responseMessageIdOrLocator: string | GeneratedMediaTurnLocator | undefined,
    reasoningModelId?: string
): GeneratedImageTurnInfo | null {
    const root = parseProseMirrorJsonContent(threadContent)
    if (!root) return null
    const locator: GeneratedMediaTurnLocator = typeof responseMessageIdOrLocator === 'object'
        ? responseMessageIdOrLocator
        : { responseMessageId: responseMessageIdOrLocator, reasoningModelId }

    let latestUserMessage: ProseMirrorJsonNode | null = null
    let fallbackResponse: GeneratedImageTurnInfo | null = null

    function visitContainer(node: ProseMirrorJsonNode): GeneratedImageTurnInfo | null {
        for (const child of node.content ?? []) {
            if (child.type === 'aiUserMessage') {
                latestUserMessage = child
                continue
            }

            if (child.type === 'aiResponseMessage') {
                const responseId = typeof child.attrs?.id === 'string' ? child.attrs.id : ''
                const container = getReasoningContainer(child, locator)
                const { imageTrace, videoTrace, promptText } = getFirstGenerationTrace(container)
                const info: GeneratedImageTurnInfo = {
                    userPromptText: collectProseMirrorText(latestUserMessage ?? undefined).trim(),
                    responseText: collectProseMirrorText(container, {
                        excludedNodeTypes: ['aiCollapsibleBlock', 'aiGeneratedImage'],
                    }).trim(),
                    responseMessageId: responseId,
                    responseProvider: typeof child.attrs?.aiProvider === 'string' ? child.attrs.aiProvider : '',
                    imageGenerationTrace: imageTrace,
                    videoGenerationTrace: videoTrace,
                    imageGenerationPromptText: promptText,
                }

                fallbackResponse = info
                if (locator.responseMessageId && responseId === locator.responseMessageId) return info
                continue
            }

            const nestedMatch = visitContainer(child)
            if (nestedMatch) return nestedMatch
        }

        return null
    }

    const exactMatch = visitContainer(root)
    return exactMatch ?? (!locator.responseMessageId ? fallbackResponse : null)
}
