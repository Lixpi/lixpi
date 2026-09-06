import {
    type CapabilityJsonValue,
    type MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'
import {
    serializeAiModelSelectionAttr,
    serializeCapabilityInputsAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '@lixpi/prosemirror/shared/model-selection-attrs'
import {
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    PROMPT_REFERENCE_NODE_TYPE,
} from '@lixpi/prosemirror/shared/prompt-reference'
import {
    collectProseMirrorPromptReferences,
    parseProseMirrorJsonContent,
    findAiChatThreadContentNode,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'

export type AiPromptComposerSubmitData = {
    contentJSON: any[]
    mediaGenerationMode: 'image' | 'video'
    aiReasoningModels: string[]
    useMultipleReasoningModels: boolean
    useMultipleImageModels: boolean
    useMultipleVideoModels: boolean
    reasoningOptions?: {
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    imageOptions?: {
        aiImageModels: string[]
        imageGenerationSize: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    videoOptions?: {
        aiVideoModels: string[]
        videoAspectRatio?: string
        videoResolution?: string
        videoDuration?: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    capabilityInputs: Record<string, Record<string, CapabilityJsonValue>>
}

export const buildCanvasConversationContent = (
    data: AiPromptComposerSubmitData,
    {
        threadId,
        messageId,
        createdAt,
        referenceNodeIds,
    }: {
        threadId: string
        messageId: string
        createdAt: number
        referenceNodeIds: string[]
    },
): ProseMirrorJsonNode => {
    const useMultipleReasoningModels = Boolean(data.useMultipleReasoningModels)
    const useMultipleImageModels = Boolean(data.useMultipleImageModels)
    const useMultipleVideoModels = Boolean(data.useMultipleVideoModels)
    const collapseForMode = (
        models: string[],
        useMultiple: boolean,
    ): string[] => (useMultiple ? models : models.slice(0, 1))
    const aiReasoningModels = serializeAiModelSelectionAttr(
        collapseForMode(data.aiReasoningModels, useMultipleReasoningModels),
    )
    const aiImageModels = data.imageOptions
        ? serializeAiModelSelectionAttr(
            collapseForMode(data.imageOptions.aiImageModels, useMultipleImageModels),
        )
        : ''
    const aiVideoModels = data.videoOptions
        ? serializeAiModelSelectionAttr(
            collapseForMode(data.videoOptions.aiVideoModels, useMultipleVideoModels),
        )
        : ''
    const imageGenerationConfigGroups = data.imageOptions
        ? serializeMediaGenerationConfigSelectionAttr(data.imageOptions.configGroups ?? [])
        : ''
    const reasoningGenerationConfigGroups = data.reasoningOptions
        ? serializeMediaGenerationConfigSelectionAttr(data.reasoningOptions.configGroups ?? [])
        : ''
    const videoGenerationConfigGroups = data.videoOptions
        ? serializeMediaGenerationConfigSelectionAttr(data.videoOptions.configGroups ?? [])
        : ''

    return {
        type: 'doc',
        content: [
            {
                type: 'aiChatThread',
                attrs: {
                    threadId,
                    mediaGenerationMode: data.mediaGenerationMode,
                    aiReasoningModels,
                    ...(reasoningGenerationConfigGroups ? { reasoningGenerationConfigGroups } : {}),
                    useMultipleReasoningModels,
                    useMultipleImageModels,
                    useMultipleVideoModels,
                    ...(aiImageModels ? { aiImageModels } : {}),
                    ...(data.imageOptions?.imageGenerationSize ? { imageGenerationSize: data.imageOptions.imageGenerationSize } : {}),
                    ...(imageGenerationConfigGroups ? { imageGenerationConfigGroups } : {}),
                    ...(aiVideoModels ? { aiVideoModels } : {}),
                    ...(data.videoOptions?.videoAspectRatio ? { videoAspectRatio: data.videoOptions.videoAspectRatio } : {}),
                    ...(data.videoOptions?.videoResolution ? { videoResolution: data.videoOptions.videoResolution } : {}),
                    ...(data.videoOptions?.videoDuration ? { videoDuration: data.videoOptions.videoDuration } : {}),
                    ...(videoGenerationConfigGroups ? { videoGenerationConfigGroups } : {}),
                    capabilityInputs: serializeCapabilityInputsAttr(data.capabilityInputs),
                },
                content: [{
                    type: 'aiUserMessage',
                    attrs: {
                        id: messageId,
                        createdAt,
                        referenceNodeIds,
                    },
                    content: data.contentJSON.length > 0 ? data.contentJSON : [{ type: 'paragraph' }],
                }],
            },
        ],
    }
}

export const extractPromptTextFromContentJSON = (contentJSON: any): string => {
    const chunks: string[] = []
    const visit = (node: any) => {
        if (!node)
            return

        if (Array.isArray(node)) {
            for (const child of node) visit(child)

            return
        }

        if (typeof node === 'string') {
            chunks.push(node)

            return
        }

        if (
            node.type === PROMPT_REFERENCE_NODE_TYPE
            || node.type === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE
        ) {
            const reference = collectProseMirrorPromptReferences(node as ProseMirrorJsonNode)[0]

            if (reference?.displayName)
                chunks.push(reference.displayName)

            return
        }

        if (
            node.type === 'text'
            && typeof node.text === 'string'
        )
            chunks.push(node.text)

        if (node.type === 'hard_break')
            chunks.push('\n')

        if (Array.isArray(node.content)) {
            for (const child of node.content) visit(child)

            if (node.type === 'paragraph')
                chunks.push('\n')
        }
    }
    visit(contentJSON)

    return chunks
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

export const contentJSONHasPromptReference = (contentJSON: unknown): boolean => {
    if (
        !contentJSON
        || typeof contentJSON !== 'object'
    )
        return false

    if (Array.isArray(contentJSON))
        return contentJSON.some(contentJSONHasPromptReference)

    const node = contentJSON as {
        type?: unknown
        content?: unknown
    }

    return node.type === PROMPT_REFERENCE_NODE_TYPE
        || node.type === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE
        || (Array.isArray(node.content) && node.content.some(contentJSONHasPromptReference))
}

export const getPromptReferenceCanvasNodeIds = (contentJSON: unknown): string[] => {
    const root = Array.isArray(contentJSON)
        ? {
            type: 'doc',
            content: contentJSON as ProseMirrorJsonNode[],
        }
        : parseProseMirrorJsonContent(contentJSON)

    if (!root)
        return []

    return Array.from(
        new Set(
            collectProseMirrorPromptReferences(root).flatMap(
                reference => 'nodeId' in reference
                    && reference.nodeId
                    ? [reference.nodeId]
                    : [],
            ),
        ),
    )
}

export const getLatestUserPromptReferenceCanvasNodeIds = (
    content: unknown,
    threadId: string,
): string[] => {
    const root = parseProseMirrorJsonContent(content)

    if (!root)
        return []

    const threadNode = findAiChatThreadContentNode(root, threadId)
    const latestUserMessage = [...(threadNode?.content ?? [])]
        .reverse().find(child => child.type === 'aiUserMessage')

    return latestUserMessage ? getPromptReferenceCanvasNodeIds(latestUserMessage) : []
}

export const getLatestUserPromptText = (
    content: unknown,
    threadId: string,
): string => {
    const root = parseProseMirrorJsonContent(content)

    if (!root)
        return ''

    const threadNode = findAiChatThreadContentNode(root, threadId)
    const latestUserMessage = [...(threadNode?.content ?? [])]
        .reverse().find(child => child.type === 'aiUserMessage')

    return latestUserMessage ? extractPromptTextFromContentJSON(latestUserMessage) : ''
}
