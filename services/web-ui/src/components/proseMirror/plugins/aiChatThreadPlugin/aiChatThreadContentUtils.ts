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
}

type CollectTextOptions = {
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
