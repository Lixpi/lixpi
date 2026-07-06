import type { ImageGenerationTrace, VideoGenerationTrace } from '@lixpi/constants'
import {
    getAiLineageEventsForProjection,
    type AiLineageEventDescriptor,
    type AiLineageProjectionScope,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'

// Doc-math primitives live in the shared package (also used by the API);
// re-exported here so existing plugin-local imports keep working.
export {
    parseProseMirrorJsonContent,
    collectProseMirrorText,
    findAiChatThreadContentNode,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror'
import {
    parseProseMirrorJsonContent,
    collectProseMirrorText,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror'

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

export type GeneratedMediaTurnProjectionSource = 'thread-content'

export type GeneratedMediaTurnProjection = {
    threadId: string
    locator: GeneratedMediaTurnLocator
    content: ProseMirrorJsonNode
    source: GeneratedMediaTurnProjectionSource
}

type BuildGeneratedMediaTurnProjectionOptions = {
    threadId?: string
    forceGenerationDetailsOpen?: boolean
    limitToLocatorMedia?: boolean
    lineageProjectionScope?: AiLineageProjectionScope
}

type GeneratedMediaTurnMatch = {
    userMessage: ProseMirrorJsonNode | null
    responseMessage: ProseMirrorJsonNode
    threadAttrs?: Record<string, any>
}

type ProjectionNodeFilter = (node: ProseMirrorJsonNode) => boolean

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
    if (!isGeneratedMediaProjectionNode(node)) return false

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

function projectionNodeMatchesLocator(node: ProseMirrorJsonNode, locator: GeneratedMediaTurnLocator): boolean {
    if (!isGeneratedMediaProjectionNode(node)) return true
    return generatedMediaNodeMatchesLocator(node, locator)
}

function containerContainsGeneratedMedia(container: ProseMirrorJsonNode, locator: GeneratedMediaTurnLocator): boolean {
    if (generatedMediaNodeMatchesLocator(container, locator)) return true
    return Boolean(container.content?.some((child) => containerContainsGeneratedMedia(child, locator)))
}

function nodeRunAttrsMatchLocator(node: ProseMirrorJsonNode, locator: GeneratedMediaTurnLocator): boolean {
    const attrs = node.attrs ?? {}
    if (locator.mediaRunId && attrs.mediaRunId === locator.mediaRunId) return true
    if (locator.reasoningRunId && attrs.reasoningRunId === locator.reasoningRunId) return true
    if (locator.mediaRunId || locator.reasoningRunId) return false
    if (locator.reasoningModelId && attrs.reasoningModelId === locator.reasoningModelId) return true
    return false
}

// A multi-model response holds one aiReasoningSection per reasoning model; the
// content owner for a given image/video is the section whose model produced it
// so each generated-media projection shows only its matching model branch.
function getReasoningContainer(responseNode: ProseMirrorJsonNode, locator: GeneratedMediaTurnLocator): ProseMirrorJsonNode | null {
    const sections = (responseNode.content ?? []).filter((child) => child.type === 'aiReasoningSection')
    if (sections.length === 0) {
        if (locator.responseMessageId && !locator.reasoningRunId && !locator.mediaRunId && !locator.fileId && !locator.reasoningModelId) {
            return responseNode
        }
        if (nodeRunAttrsMatchLocator(responseNode, locator)) return responseNode
        return containerContainsGeneratedMedia(responseNode, locator) ? responseNode : null
    }

    if (locator.reasoningRunId) {
        const matched = sections.find((section) => section.attrs?.reasoningRunId === locator.reasoningRunId)
        if (matched) return matched
    }

    if (locator.mediaRunId || locator.fileId) {
        const matched = sections.find((section) => containerContainsGeneratedMedia(section, locator))
        if (matched) return matched
    }

    if (locator.reasoningModelId) {
        const matched = sections.find((section) => section.attrs?.reasoningModelId === locator.reasoningModelId)
        if (matched) return matched
    }

    if (locator.responseMessageId && !locator.reasoningRunId && !locator.mediaRunId && !locator.fileId && !locator.reasoningModelId) {
        return responseNode
    }

    return null
}

function responseMessageMatchesLocator(responseNode: ProseMirrorJsonNode, locator: GeneratedMediaTurnLocator): boolean {
    const responseId = typeof responseNode.attrs?.id === 'string' ? responseNode.attrs.id : ''
    if (locator.responseMessageId && responseId !== locator.responseMessageId) return false
    if (!locator.responseMessageId && !locator.reasoningRunId && !locator.mediaRunId && !locator.fileId && !locator.reasoningModelId) return false
    if (locator.responseMessageId && !locator.reasoningRunId && !locator.mediaRunId && !locator.fileId && !locator.reasoningModelId) return true
    return Boolean(getReasoningContainer(responseNode, locator))
}

function createSingleGeneratedMediaFilter(locator: GeneratedMediaTurnLocator): ProjectionNodeFilter | undefined {
    if (!locator.mediaRunId && !locator.fileId) return undefined
    return (node) => projectionNodeMatchesLocator(node, locator)
}

type LineageIds = {
    branchOriginNodeIds: Set<string>
    branchForkNodeIds: Set<string>
    branchLineNodeIds: Set<string>
}

function addLineageId(set: Set<string>, value: unknown): void {
    if (typeof value === 'string' && value) set.add(value)
}

function collectMatchingGeneratedMediaLineageIds(container: ProseMirrorJsonNode, locator: GeneratedMediaTurnLocator): LineageIds {
    const lineageIds: LineageIds = {
        branchOriginNodeIds: new Set(),
        branchForkNodeIds: new Set(),
        branchLineNodeIds: new Set(),
    }

    function visit(node: ProseMirrorJsonNode): void {
        if (generatedMediaNodeMatchesLocator(node, locator)) {
            addLineageId(lineageIds.branchOriginNodeIds, node.attrs?.branchOriginNodeId)
            addLineageId(lineageIds.branchForkNodeIds, node.attrs?.branchForkNodeId)
            addLineageId(lineageIds.branchLineNodeIds, node.attrs?.branchLineNodeId)
        }

        for (const child of node.content ?? []) visit(child)
    }

    visit(container)
    return lineageIds
}

function hasAnyLineageIds(lineageIds: LineageIds): boolean {
    return lineageIds.branchOriginNodeIds.size > 0
        || lineageIds.branchForkNodeIds.size > 0
        || lineageIds.branchLineNodeIds.size > 0
}

function getLineageEventIdentity(node: ProseMirrorJsonNode): string {
    const attrs = node.attrs ?? {}
    const kind = typeof attrs.kind === 'string' ? attrs.kind : ''
    const id = kind === 'branch-origin'
        ? attrs.branchOriginNodeId
        : kind === 'branch-line'
            ? attrs.branchLineNodeId
            : attrs.branchForkNodeId
    return `${kind}:${typeof id === 'string' ? id : ''}`
}

function lineageEventMatchesIds(node: ProseMirrorJsonNode, lineageIds: LineageIds): boolean {
    const attrs = node.attrs ?? {}
    if (attrs.kind === 'branch-origin') return lineageIds.branchOriginNodeIds.has(String(attrs.branchOriginNodeId ?? ''))
    if (attrs.kind === 'branch-line') return lineageIds.branchLineNodeIds.has(String(attrs.branchLineNodeId ?? ''))
    return lineageIds.branchForkNodeIds.has(String(attrs.branchForkNodeId ?? ''))
}

function createLineageEventProjectionNode(
    event: AiLineageEventDescriptor,
    reasoningModelId: string,
): ProseMirrorJsonNode {
    return {
        type: 'aiLineageEvent',
        attrs: {
            kind: event.kind,
            branchOriginNodeId: event.branchOriginNodeId ?? '',
            branchForkNodeId: event.branchForkNodeId ?? '',
            branchLineNodeId: event.branchLineNodeId ?? '',
            reasoningModelId,
        },
    }
}

function createProjectionNodeFilter(
    container: ProseMirrorJsonNode,
    locator: GeneratedMediaTurnLocator,
    limitToLocatorMedia: boolean,
): ProjectionNodeFilter {
    const mediaFilter = limitToLocatorMedia
        ? createSingleGeneratedMediaFilter(locator)
        : undefined
    const lineageIds = limitToLocatorMedia
        ? collectMatchingGeneratedMediaLineageIds(container, locator)
        : null
    const shouldFilterLineageEvents = Boolean(lineageIds && hasAnyLineageIds(lineageIds))
    const seenLineageEventIds = new Set<string>()

    return (node) => {
        if (isGeneratedMediaProjectionNode(node)) return mediaFilter ? mediaFilter(node) : true
        if (node.type !== 'aiLineageEvent') return true

        if (shouldFilterLineageEvents && lineageIds && !lineageEventMatchesIds(node, lineageIds)) return false

        const eventId = getLineageEventIdentity(node)
        if (seenLineageEventIds.has(eventId)) return false
        seenLineageEventIds.add(eventId)
        return true
    }
}

function cloneProjectionNodeTree(
    node: ProseMirrorJsonNode,
    forceGenerationDetailsOpen: boolean,
    shouldKeepNode?: ProjectionNodeFilter,
    reasoningModelId?: string,
): ProseMirrorJsonNode | null {
    if (shouldKeepNode && !shouldKeepNode(node)) return null

    const cloned = cloneProseMirrorJsonNode(node)
    if (forceGenerationDetailsOpen && cloned.type === 'aiCollapsibleBlock') {
        cloned.attrs = {
            ...(cloned.attrs ?? {}),
            isOpen: true,
        }
    }
    // Single-run streams materialize lineage as standalone aiLineageEvent nodes that
    // predate the reasoningModelId attr. Backfill it from the projection locator so the
    // marker can name the reasoning model even for already-persisted branches.
    if (reasoningModelId && cloned.type === 'aiLineageEvent' && !cloned.attrs?.reasoningModelId) {
        cloned.attrs = {
            ...(cloned.attrs ?? {}),
            reasoningModelId,
        }
    }
    if (cloned.content) {
        cloned.content = cloned.content
            .map((child) => cloneProjectionNodeTree(child, forceGenerationDetailsOpen, shouldKeepNode, reasoningModelId))
            .filter((child): child is ProseMirrorJsonNode => Boolean(child))
    }
    return cloned
}

function cloneProjectionNode(
    node: ProseMirrorJsonNode,
    forceGenerationDetailsOpen: boolean,
    shouldKeepNode?: ProjectionNodeFilter,
    reasoningModelId?: string,
): ProseMirrorJsonNode {
    return cloneProjectionNodeTree(node, forceGenerationDetailsOpen, shouldKeepNode, reasoningModelId) ?? cloneProseMirrorJsonNode(node)
}

function createDocumentTitleNode(text: string): ProseMirrorJsonNode {
    return {
        type: 'documentTitle',
        content: [{ type: 'text', text }],
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

function materializeReasoningSectionLineageEventsForProjection(
    node: ProseMirrorJsonNode,
    lineageProjectionScope: AiLineageProjectionScope,
): void {
    if (node.type !== 'aiReasoningSection') return

    const events = getAiLineageEventsForProjection(node.attrs ?? {}, lineageProjectionScope)
    if (events.length === 0) return

    const existingEventIds = new Set(
        (node.content ?? [])
            .filter((child) => child.type === 'aiLineageEvent')
            .map(getLineageEventIdentity),
    )
    const reasoningModelId = String(node.attrs?.reasoningModelId ?? '')
    const eventNodes = events
        .map((event) => createLineageEventProjectionNode(event, reasoningModelId))
        .filter((eventNode) => {
            const eventId = getLineageEventIdentity(eventNode)
            if (existingEventIds.has(eventId)) return false
            existingEventIds.add(eventId)
            return true
        })

    if (eventNodes.length > 0) node.content = [...eventNodes, ...(node.content ?? [])]

    node.attrs = {
        ...(node.attrs ?? {}),
        branchOriginNodeId: '',
        branchForkNodeId: '',
        branchLineNodeId: '',
    }
}

function isGenerationTraceProjectionNode(node: ProseMirrorJsonNode): boolean {
    const attrs = node.attrs ?? {}
    return node.type === 'aiCollapsibleBlock'
        && Boolean(attrs.imageGenerationTrace || attrs.videoGenerationTrace || attrs.imageGenerationTraceId)
}

// In detail panels, lineage outcomes read best as conclusions of the resolver
// audit, not as headings above the response text. So within each container we
// relocate standalone aiLineageEvent nodes to sit directly after the generation
// trace block that renders resolver audit details. If an older projection lacks
// that trace block, the generated media node remains the fallback anchor.
function relocateLineageEventsToResolverAudit(node: ProseMirrorJsonNode): void {
    if (!node.content) return

    const lineageEvents = node.content.filter((child) => child.type === 'aiLineageEvent')
    if (lineageEvents.length > 0) {
        const rest = node.content.filter((child) => child.type !== 'aiLineageEvent')
        const firstTraceIndex = rest.findIndex(isGenerationTraceProjectionNode)
        const firstMediaIndex = rest.findIndex(isGeneratedMediaProjectionNode)
        const insertAt = firstTraceIndex >= 0
            ? firstTraceIndex + 1
            : firstMediaIndex === -1
                ? rest.length
                : firstMediaIndex
        node.content = [...rest.slice(0, insertAt), ...lineageEvents, ...rest.slice(insertAt)]
    }

    for (const child of node.content) relocateLineageEventsToResolverAudit(child)
}

function cloneResponseForProjection(
    responseNode: ProseMirrorJsonNode,
    locator: GeneratedMediaTurnLocator,
    forceGenerationDetailsOpen: boolean,
    limitToLocatorMedia: boolean,
    lineageProjectionScope: AiLineageProjectionScope,
): ProseMirrorJsonNode | null {
    const sections = (responseNode.content ?? []).filter((child) => child.type === 'aiReasoningSection')
    if (sections.length === 0) {
        const shouldKeepNode = createProjectionNodeFilter(responseNode, locator, limitToLocatorMedia)
        const cloned = cloneProjectionNode(responseNode, forceGenerationDetailsOpen, shouldKeepNode, locator.reasoningModelId)
        relocateLineageEventsToResolverAudit(cloned)
        return cloned
    }

    const selectedSection = getReasoningContainer(responseNode, locator)
    if (!selectedSection) return null
    if (selectedSection === responseNode) {
        const shouldKeepNode = createProjectionNodeFilter(responseNode, locator, limitToLocatorMedia)
        const cloned = cloneProjectionNode(responseNode, forceGenerationDetailsOpen, shouldKeepNode, locator.reasoningModelId)
        relocateLineageEventsToResolverAudit(cloned)
        return cloned
    }

    const shouldKeepNode = createProjectionNodeFilter(selectedSection, locator, limitToLocatorMedia)
    const clonedSection = cloneProjectionNode(selectedSection, forceGenerationDetailsOpen, shouldKeepNode, locator.reasoningModelId)
    clonedSection.attrs = {
        ...(clonedSection.attrs ?? {}),
        lineageProjectionScope,
    }
    materializeReasoningSectionLineageEventsForProjection(clonedSection, lineageProjectionScope)
    relocateLineageEventsToResolverAudit(clonedSection)
    return {
        ...cloneProseMirrorJsonNode(responseNode),
        content: selectedSection.type === 'aiReasoningSection'
            ? [clonedSection]
            : [],
    }
}

export function buildGeneratedMediaTurnProjectionFromThreadContent(
    threadContent: unknown,
    locator: GeneratedMediaTurnLocator,
    options: BuildGeneratedMediaTurnProjectionOptions = {},
): GeneratedMediaTurnProjection | null {
    const root = parseProseMirrorJsonContent(threadContent)
    if (!root) return null

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
                const match = {
                    userMessage: scopedLatestUserMessage,
                    responseMessage: child,
                    threadAttrs: scopedThreadAttrs,
                }

                if (responseMessageMatchesLocator(child, locator)) return match
                continue
            }

            const nestedMatch = visitContainer(child, scopedThreadAttrs, scopedLatestUserMessage)
            if (nestedMatch) return nestedMatch
        }

        return null
    }

    const match = visitContainer(root)
    if (!match) return null

    const matchedThreadId = typeof match.threadAttrs?.threadId === 'string' && match.threadAttrs.threadId
        ? match.threadAttrs.threadId
        : undefined
    const threadId = options.threadId
        ?? matchedThreadId
    if (!threadId) return null
    const responseProjection = cloneResponseForProjection(
        match.responseMessage,
        locator,
        options.forceGenerationDetailsOpen ?? false,
        options.limitToLocatorMedia ?? false,
        options.lineageProjectionScope ?? 'media-run',
    )
    if (!responseProjection) return null

    const messages = [
        match.userMessage ? cloneProjectionNode(match.userMessage, options.forceGenerationDetailsOpen ?? false) : null,
        responseProjection,
    ].filter((message): message is ProseMirrorJsonNode => Boolean(message))

    return {
        threadId,
        locator,
        content: createProjectionDocument(threadId, match.threadAttrs, messages),
        source: 'thread-content',
    }
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

    function visitContainer(node: ProseMirrorJsonNode): GeneratedImageTurnInfo | null {
        for (const child of node.content ?? []) {
            if (child.type === 'aiUserMessage') {
                latestUserMessage = child
                continue
            }

            if (child.type === 'aiResponseMessage') {
                if (!responseMessageMatchesLocator(child, locator)) continue
                const responseId = typeof child.attrs?.id === 'string' ? child.attrs.id : ''
                const container = getReasoningContainer(child, locator)
                if (!container) continue
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
                return info
            }

            const nestedMatch = visitContainer(child)
            if (nestedMatch) return nestedMatch
        }

        return null
    }

    return visitContainer(root)
}
