// AI Chat Thread Plugin - Modular Architecture
// This plugin consolidates AI chat functionality for ProseMirror:
// - Keyboard triggers (Mod+Enter)
// - Content extraction from chat threads
// - AI response streaming and insertion
// - Thread NodeViews with controls
// - Placeholder decorations

import { Plugin, PluginKey, EditorState, Transaction } from 'prosemirror-state'
import { Fragment, Slice } from 'prosemirror-model'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'
import { Node as ProseMirrorNode, Schema as ProseMirrorSchema } from 'prosemirror-model'
import { documentTitleNodeType } from '$src/components/proseMirror/customNodes/documentTitleNode.ts'
import { aiChatThreadNodeType, aiChatThreadNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadNode.ts'
import { AI_CHAT_THREAD_PLUGIN_KEY, USE_AI_CHAT_META, STOP_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import { aiResponseMessageNodeType, aiResponseMessageNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiResponseMessageNode.ts'
// aiUserInput has been removed; imported content is normalized in appendTransaction().
import { aiUserInputNodeType } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserInputNode.ts'
import { aiUserMessageNodeType, aiUserMessageNodeView, type AiUserMessageContextPreviewRenderer } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'
import { aiCollapsibleBlockNodeType, aiCollapsibleBlockNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiCollapsibleBlockNode.ts'
import { aiReasoningSectionNodeType, aiReasoningSectionNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiReasoningSectionNode.ts'
import { aiLineageEventNodeType, aiLineageEventNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEventNode.ts'
import {
    getAiLineageEventsForProjection,
    type AiLineageEventDescriptor,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.ts'
import { documentStore } from '$src/stores/documentStore.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    parseAiModelSelectionAttr,
    parseMediaGenerationConfigSelectionAttr,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import type {
    AiInteractionChatSendMessagePayload,
    AiInteractionChatStopMessagePayload,
    AiModelId,
    ImageBranchVlmResolution,
    ImageGenerationTrace,
    ImageGenerationSize,
    MarkdownParsedSegment,
    MediaBranchLineagePlan,
    MediaGenerationConfigSelectionGroup,
    MediaGenerationRunMeta,
    StreamStatus,
    WorkspaceContextResolution,
} from '@lixpi/constants'

import { setAiGeneratedImageCallbacks, getAiGeneratedImageCallbacks, aiGeneratedImageNodeType, type AiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'
import { setAiGeneratedVideoCallbacks, aiGeneratedVideoNodeType, aiGeneratedVideoNodeView, type AiGeneratedVideoCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedVideoNode.ts'
import type { ImageGenerationTraceDetailsOptions } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'
import { routeSegmentEventToCanvas } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedMediaCanvasRouter.ts'

// dispatchSendAiChatFromUserInput has been removed — messages are now injected by AiPromptInputController
// findUserInputInThread is no longer needed — aiUserInput has been removed from the schema

const IS_RECEIVING_TEMP_DEBUG_STATE = false    // For debug purposes only

// ========== TYPE DEFINITIONS ==========

type ImageOptions = {
    aiImageModel: string
    aiImageModels?: string[]
    imageGenerationSize: ImageGenerationSize
    configGroups?: MediaGenerationConfigSelectionGroup[]
}

type VideoOptions = {
    aiVideoModel: string
    aiVideoModels?: string[]
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string
    configGroups?: MediaGenerationConfigSelectionGroup[]
    // Set when the user invoked "Extend in new thread" from a generated video
    // node. WorkspaceCanvas resolves the nodeId to a workspace Object Store URI
    // (`nats-obj://workspace-{ws}-files/{fileId}`) before forwarding to the
    // backend as `videoSourceForExtension`.
    sourceVideoNodeId?: string
}

type SendAiRequestHandler = (data: AiInteractionChatSendMessagePayload & {
    aiModels?: string[]
    useMultipleModels?: boolean
    useMultipleReasoningModels?: boolean
    useMultipleImageModels?: boolean
    useMultipleVideoModels?: boolean
    imageOptions?: ImageOptions
    videoOptions?: VideoOptions
}) => void
type StopAiRequestHandler = (data: AiInteractionChatStopMessagePayload) => void
type PlaceholderOptions = { titlePlaceholder: string; paragraphPlaceholder: string }
export type AiChatThreadRenderContext = {
    readOnly?: boolean
    traceDetailsOptions?: ImageGenerationTraceDetailsOptions
    contextPreview?: AiUserMessageContextPreviewRenderer
}
type ImageSegmentType = 'image_partial' | 'image_complete' | 'image_error' | 'image_branch_resolved' | 'image_branch_resolution_error' | 'image_generation_trace'
type VideoSegmentType = 'video_pending' | 'video_generating' | 'video_complete' | 'video_error' | 'video_generation_trace'
type CollapsibleSegmentType = 'collapsible_start' | 'collapsible_end'
type WorkspaceContextSegmentType = 'context_relevance_resolved' | 'context_relevance_error'
type MediaLineageSegmentType = 'media_lineage_planned'
export type SegmentEvent = {
    status?: StreamStatus
    type?: ImageSegmentType | VideoSegmentType | CollapsibleSegmentType | WorkspaceContextSegmentType | MediaLineageSegmentType
    aiProvider?: string
    imageModelProvider?: string
    imageModelId?: string
    videoModelProvider?: string
    threadId?: string
    aiChatThreadId?: string
    generationRun?: MediaGenerationRunMeta
    collapsibleTitle?: string
    // Markdown segment shape from @lixpi/constants (mirrors what @lixpi/markdown-stream-parser
    // emits). TODO: import from @lixpi/markdown-stream-parser once its in-development version
    // exports proper segment types.
    segment?: MarkdownParsedSegment
    imageUrl?: string
    fileId?: string
    workspaceId?: string
    partialIndex?: number
    responseId?: string
    revisedPrompt?: string
    imageBranchResolution?: ImageBranchVlmResolution
    mediaBranchLineagePlan?: MediaBranchLineagePlan
    workspaceContextResolution?: WorkspaceContextResolution
    imageGenerationTrace?: ImageGenerationTrace
    // Video segment fields (mirror VideoPublisher payloads)
    videoUrl?: string
    posterUrl?: string
    posterFileId?: string
    frameUrl?: string
    frameFileId?: string
    durationSeconds?: number
    aspectRatio?: number
    hasAudio?: boolean
    videoModel?: string
    videoGenerationTrace?: import('@lixpi/constants').VideoGenerationTrace
    error?: string
}
type GeneratedRunAttrs = {
    generationRequestId: string
    reasoningRunId: string
    mediaRunId: string
    reasoningModelId: string
    mediaModelId: string
    mediaType: string
    variantIndex: number | null
}

type GeneratedMediaRunAttrs = GeneratedRunAttrs & {
    branchId: string
    parentMediaNodeId: string
    branchOriginNodeId: string
    branchForkNodeId: string
    branchLineNodeId: string
    lineageParentNodeId: string
}
type ImageReference = { fileId: string; workspaceId: string }
type ThreadContent = {
    nodeType: string
    textContent: string
    images?: ImageReference[]
    featureIds?: string[]
}
type AiGeneratedImageAlignment = 'left' | 'center' | 'right'
type AiGeneratedImageTextWrap = 'none' | 'left' | 'right'
type AiGeneratedImageAttrs = {
    imageData: string
    fileId: string
    workspaceId: string
    revisedPrompt: string
    responseId: string
    aiModel: string
    isPartial: boolean
    partialIndex: number
    width: string
    alignment: AiGeneratedImageAlignment
    textWrap: AiGeneratedImageTextWrap
} & GeneratedMediaRunAttrs

type AiGeneratedVideoAttrs = {
    videoUrl: string
    fileId: string
    workspaceId: string
    posterUrl: string
    posterFileId: string
    durationSeconds: number
    aspectRatio: number
    hasAudio: boolean
    revisedPrompt: string
    responseId: string
    videoModel: string
    isPending: boolean
    errorMessage: string
    width: string
    alignment: AiGeneratedImageAlignment
    textWrap: AiGeneratedImageTextWrap
} & GeneratedMediaRunAttrs

function buildGeneratedRunAttrs(generationRun?: MediaGenerationRunMeta, previousAttrs: Partial<GeneratedRunAttrs> = {}): GeneratedRunAttrs {
    return {
        generationRequestId: generationRun?.generationRequestId || previousAttrs.generationRequestId || '',
        reasoningRunId: generationRun?.reasoningRunId || previousAttrs.reasoningRunId || '',
        mediaRunId: generationRun?.mediaRunId || previousAttrs.mediaRunId || '',
        reasoningModelId: generationRun?.reasoningModelId || previousAttrs.reasoningModelId || '',
        mediaModelId: generationRun?.mediaModelId || previousAttrs.mediaModelId || '',
        mediaType: generationRun?.mediaType || previousAttrs.mediaType || '',
        variantIndex: generationRun?.variantIndex ?? previousAttrs.variantIndex ?? null,
    }
}

function buildGeneratedMediaRunAttrs(
    generationRun?: MediaGenerationRunMeta,
    previousAttrs: Partial<GeneratedMediaRunAttrs> = {}
): GeneratedMediaRunAttrs {
    const lineageAssignment = generationRun?.lineageAssignment
    return {
        ...buildGeneratedRunAttrs(generationRun, previousAttrs),
        branchId: lineageAssignment?.branchId || '',
        parentMediaNodeId: lineageAssignment?.parentMediaNodeId || '',
        branchOriginNodeId: lineageAssignment?.branchOriginNodeId || '',
        branchForkNodeId: lineageAssignment?.branchForkNodeId || '',
        branchLineNodeId: lineageAssignment?.branchLineNodeId || '',
        lineageParentNodeId: lineageAssignment?.lineageParentNodeId || '',
    }
}

function buildAiLineageEventNode(
    schema: ProseMirrorSchema,
    event: AiLineageEventDescriptor,
    reasoningModelId = '',
): ProseMirrorNode | null {
    const nodeType = schema.nodes[aiLineageEventNodeType]
    if (!nodeType) return null

    return nodeType.create({
        kind: event.kind,
        branchOriginNodeId: event.branchOriginNodeId ?? '',
        branchForkNodeId: event.branchForkNodeId ?? '',
        branchLineNodeId: event.branchLineNodeId ?? '',
        reasoningModelId,
    })
}

function getLineageEventIdentity(event: AiLineageEventDescriptor): string {
    const id = event.kind === 'branch-origin'
        ? event.branchOriginNodeId
        : event.kind === 'branch-line'
            ? event.branchLineNodeId
            : event.branchForkNodeId
    return `${event.kind}:${id ?? ''}`
}

function getLineageEventNodeIdentity(node: ProseMirrorNode): string {
    return getLineageEventIdentity({
        kind: node.attrs.kind,
        branchOriginNodeId: node.attrs.branchOriginNodeId || '',
        branchForkNodeId: node.attrs.branchForkNodeId || '',
        branchLineNodeId: node.attrs.branchLineNodeId || '',
    })
}

function buildMediaModelId(provider?: string, model?: string): string {
    if (!model) return ''
    return model.includes(':') || !provider ? model : `${provider}:${model}`
}

function usesReasoningSection(
    generationRun?: MediaGenerationRunMeta
): generationRun is MediaGenerationRunMeta & { requestKind: 'media-generation-matrix' } {
    return generationRun?.requestKind === 'media-generation-matrix'
}

function getReasoningRunKey(generationRun?: MediaGenerationRunMeta): string {
    return usesReasoningSection(generationRun) ? generationRun?.reasoningRunId || 'unsectioned' : 'unsectioned'
}

function getReasoningOnlyGenerationRun(generationRun?: MediaGenerationRunMeta): MediaGenerationRunMeta | undefined {
    if (!generationRun || !usesReasoningSection(generationRun)) return undefined

    return {
        requestKind: generationRun.requestKind,
        generationRequestId: generationRun.generationRequestId,
        reasoningRunId: generationRun.reasoningRunId,
        reasoningModelId: generationRun.reasoningModelId,
        reasoningIndex: generationRun.reasoningIndex,
        lineageAssignment: generationRun.lineageAssignment,
    }
}

function getReasoningModelProvider(modelId: string): string | undefined {
    const [provider] = modelId.split(':')
    return provider || undefined
}

function parseRunIndex(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function reasoningTemplateMatchesGenerationRun(attrs: Record<string, any>, generationRun: MediaGenerationRunMeta): boolean {
    if (attrs?.reasoningRunId) return attrs.reasoningRunId === generationRun.reasoningRunId

    const attrModelId = typeof attrs?.reasoningModelId === 'string' ? attrs.reasoningModelId : ''
    const runModelId = generationRun.reasoningModelId || ''
    if (attrModelId && runModelId && attrModelId !== runModelId) return false

    const attrIndex = parseRunIndex(attrs?.reasoningIndex)
    const runIndex = parseRunIndex(generationRun.reasoningIndex)
    return attrIndex === null || runIndex === null || attrIndex === runIndex
}

function buildReasoningSectionAttrs(
    generationRun: MediaGenerationRunMeta,
    previousAttrs: Record<string, any> = {},
    isReceivingAnimation = true,
): Record<string, any> {
    return {
        ...previousAttrs,
        generationRequestId: generationRun.generationRequestId || previousAttrs.generationRequestId || '',
        reasoningRunId: generationRun.reasoningRunId || previousAttrs.reasoningRunId || '',
        reasoningModelId: generationRun.reasoningModelId || previousAttrs.reasoningModelId || '',
        reasoningIndex: generationRun.reasoningIndex ?? previousAttrs.reasoningIndex ?? null,
        branchOriginNodeId: generationRun.lineageAssignment?.branchOriginNodeId || previousAttrs.branchOriginNodeId || '',
        branchForkNodeId: generationRun.lineageAssignment?.branchForkNodeId || previousAttrs.branchForkNodeId || '',
        branchLineNodeId: generationRun.lineageAssignment?.branchLineNodeId || previousAttrs.branchLineNodeId || '',
        isReceivingAnimation,
    }
}

function buildResponseMessageAttrsForGenerationRun(
    generationRun: MediaGenerationRunMeta,
    previousAttrs: Record<string, any> = {},
    aiProvider?: string,
): Record<string, any> {
    return {
        ...previousAttrs,
        id: previousAttrs.id || `resp-${generationRun.generationRequestId || Date.now()}`,
        isInitialRenderAnimation: previousAttrs.isInitialRenderAnimation ?? true,
        isReceivingAnimation: true,
        aiProvider: previousAttrs.aiProvider || aiProvider || getReasoningModelProvider(generationRun.reasoningModelId || '') || '',
        generationRequestId: generationRun.generationRequestId || previousAttrs.generationRequestId || '',
    }
}

function getThreadScopedRunKey(threadId: string, generationRun?: MediaGenerationRunMeta): string {
    return `${threadId}:${getReasoningRunKey(generationRun)}`
}

type ResponseContext = {
    responseNode: ProseMirrorNode
    responseStartPos: number
    responseEndPos: number
    responseMessageNode: ProseMirrorNode
    responseMessagePos: number
    responseMessageId: string
}
type ResponseImageNodeInfo = {
    node: ProseMirrorNode
    nodePos: number
}
type ResponseVideoNodeInfo = {
    node: ProseMirrorNode
    nodePos: number
}
type MessageContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
type Message = { role: string; content: string | MessageContentPart[] }
type AiChatThreadPluginState = {
    receivingThreadIds: Set<string>
    receivingRunKeysByThread: Map<string, Set<string>>
    insideBackticks: boolean
    backtickBuffer: string
    insideCodeBlock: boolean
    codeBuffer: string
    decorations: DecorationSet
    collapsibleThreadIds: Set<string>
    collapsibleRunKeys: Set<string>
    // Note: dropdownStates removed - now handled by dropdown primitive plugin
}

// ========== CONSTANTS ==========

const PLUGIN_KEY = AI_CHAT_THREAD_PLUGIN_KEY as PluginKey<AiChatThreadPluginState>
const INSERT_THREAD_META = `insert:${aiChatThreadNodeType}`
const AI_GENERATED_MEDIA_WIDTH = '100%'
const AI_GENERATED_MEDIA_ALIGNMENT: AiGeneratedImageAlignment = 'right'
const AI_GENERATED_MEDIA_TEXT_WRAP: AiGeneratedImageTextWrap = 'none'

// ========== UTILITY MODULES ==========

// Keyboard interaction handling
class KeyboardHandler {
    static isModEnter(event: KeyboardEvent): boolean {
        const isMac = navigator.platform.toUpperCase().includes('MAC')
        const mod = isMac ? event.metaKey : event.ctrlKey
        return event.key === 'Enter' && mod
    }
}

// Content extraction and transformation utilities
class ContentExtractor {
    // Find thread node by explicit position
    static findThreadByPosition(state: EditorState, nodePos: number): ProseMirrorNode | null {
        // Try direct lookup first
        let thread = state.doc.nodeAt(nodePos)
        if (thread?.type.name === aiChatThreadNodeType) return thread

        // Try resolving and walking up tree
        const $pos = state.doc.resolve(nodePos + 1)
        for (let depth = $pos.depth; depth >= 0; depth--) {
            const node = $pos.node(depth)
            if (node.type.name === aiChatThreadNodeType) return node
        }
        return null
    }

    // Find thread node by current selection
    static findThreadBySelection(state: EditorState): ProseMirrorNode | null {
        const { $from } = state.selection
        for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth)
            if (node.type.name === aiChatThreadNodeType) return node
        }
        return null
    }

    // Extract and format text recursively, preserving code block structure
    static collectFormattedText(node: ProseMirrorNode): string {
        let text = ''
        node.forEach((child: ProseMirrorNode) => {
            if (child.type.name === 'text') {
                text += child.text
            } else if (child.type.name === 'hard_break') {
                text += '\n'
            } else if (child.type.name === 'code_block') {
                // Format code blocks with triple backticks and proper spacing
                const codeContent = ContentExtractor.collectFormattedText(child)
                text += `\n\`\`\`\n${codeContent}\n\`\`\`\n`
            } else {
                text += ContentExtractor.collectFormattedText(child)
            }
        })
        return text
    }

    // Extract text and images from a message block
    static collectContentWithImages(node: ProseMirrorNode): { text: string; images: ImageReference[]; featureIds: string[] } {
        let text = ''
        const images: ImageReference[] = []
        const featureIds: string[] = []

        node.forEach((child: ProseMirrorNode) => {
            if (child.type.name === 'text') {
                text += child.text
            } else if (child.type.name === 'hard_break') {
                text += '\n'
            } else if (child.type.name === 'code_block') {
                const codeContent = ContentExtractor.collectFormattedText(child)
                text += `\n\`\`\`\n${codeContent}\n\`\`\`\n`
            } else if (child.type.name === aiGeneratedImageNodeType) {
                // Collect AI-generated image reference
                const { fileId, workspaceId } = child.attrs
                if (fileId && workspaceId) {
                    images.push({ fileId, workspaceId })
                }
            } else if (child.type.name === aiGeneratedVideoNodeType) {
                // Reuse the video poster as still-image context in chat history.
                const { posterFileId, workspaceId } = child.attrs
                if (posterFileId && workspaceId) {
                    images.push({ fileId: posterFileId, workspaceId })
                }
            } else if (child.type.name === 'feature_reference') {
                const { featureId, featureName } = child.attrs
                // Cosmetic label only; resolution is driven by featureIds (see resolveFeatures).
                // Kept in sync with the chip's visual `feature:<name>` format.
                if (featureName) text += `feature:${featureName}`
                if (featureId) featureIds.push(featureId)
            } else {
                // Recurse into other nodes
                const nested = ContentExtractor.collectContentWithImages(child)
                text += nested.text
                images.push(...nested.images)
                featureIds.push(...nested.featureIds)
            }
        })

        return { text, images, featureIds }
    }

    // Simple text extraction without formatting (for backwards compatibility)
    static collectText(node: ProseMirrorNode): string {
        let text = ''
        node.forEach((child: ProseMirrorNode) => {
            if (child.type.name === 'text') {
                text += child.text
            } else if (child.type.name === 'hard_break') {
                text += '\n'
            } else {
                text += ContentExtractor.collectText(child)
            }
        })
        return text
    }

    // Find the active aiChatThread containing the cursor and extract content
    // threadContext determines scope: 'Thread' (single), 'Document' (all), or 'Workspace' (selected)
    // currentThreadId is required for Workspace mode to ensure triggering thread is always included
    static getActiveThreadContent(
        state: EditorState,
        threadContext: string = 'Thread',
        nodePos?: number,
        currentThreadId?: string
    ): ThreadContent[] {
        if (threadContext === 'Document') {
            return ContentExtractor.getAllThreadsContent(state)
        }

        if (threadContext === 'Workspace') {
            return ContentExtractor.getSelectedThreadsContent(state, currentThreadId)
        }

        // Find thread node from explicit position when provided, otherwise from selection.
        const thread = nodePos !== undefined
            ? ContentExtractor.findThreadByPosition(state, nodePos)
            : ContentExtractor.findThreadBySelection(state)

        if (!thread) return []

        // Extract conversation messages with text and images (ignore the user input composer)
        const content: ThreadContent[] = []
        thread.forEach((block: ProseMirrorNode) => {
            if (block.type.name !== aiUserMessageNodeType && block.type.name !== aiResponseMessageNodeType) {
                return
            }

            const { text: textContent, images, featureIds } = ContentExtractor.collectContentWithImages(block)
            if (!textContent && images.length === 0 && featureIds.length === 0) return

            content.push({ nodeType: block.type.name, textContent, images: images.length > 0 ? images : undefined, featureIds: featureIds.length > 0 ? featureIds : undefined })
        })

        return content
    }

    // Extract content from ALL aiChatThread nodes in the document
    // Uses XML tags to clearly separate threads: <thread id="...">content</thread>
    static getAllThreadsContent(state: EditorState): ThreadContent[] {
        const allThreadsContent: ThreadContent[] = []

        state.doc.descendants((node: ProseMirrorNode) => {
            if (node.type.name === aiChatThreadNodeType) {
                const threadId = node.attrs.threadId || 'unknown'

                // Add opening XML tag for thread
                allThreadsContent.push({
                    nodeType: 'thread_start',
                    textContent: `<thread id="${threadId}">`
                })

                // Extract content from this thread
                node.forEach((block: ProseMirrorNode) => {
                    if (block.type.name !== aiUserMessageNodeType && block.type.name !== aiResponseMessageNodeType) {
                        return
                    }

                    const { text: textContent, images, featureIds } = ContentExtractor.collectContentWithImages(block)

                    if (textContent || images.length > 0 || featureIds.length > 0) {
                        allThreadsContent.push({
                            nodeType: block.type.name,
                            textContent,
                            images: images.length > 0 ? images : undefined,
                            featureIds: featureIds.length > 0 ? featureIds : undefined,
                        })
                    }
                })

                // Add closing XML tag for thread
                allThreadsContent.push({
                    nodeType: 'thread_end',
                    textContent: '</thread>'
                })
            }
        })

        return allThreadsContent
    }

    // Extract content from SELECTED aiChatThread nodes (workspaceSelected: true OR currentThreadId match)
    // Uses XML tags to clearly separate threads: <thread id="...">content</thread>
    // currentThreadId is always included regardless of workspaceSelected state
    static getSelectedThreadsContent(state: EditorState, currentThreadId?: string): ThreadContent[] {
        const selectedContent: ThreadContent[] = []

        state.doc.descendants((node: ProseMirrorNode) => {
            if (node.type.name === aiChatThreadNodeType) {
                const threadId = node.attrs.threadId || 'unknown'
                const isSelected = node.attrs.workspaceSelected ?? false
                const isCurrentThread = currentThreadId && threadId === currentThreadId

                // Include thread if it's selected OR if it's the current triggering thread
                if (!isSelected && !isCurrentThread) {
                    return // Skip this thread
                }

                // Add opening XML tag for thread
                selectedContent.push({
                    nodeType: 'thread_start',
                    textContent: `<thread id="${threadId}">`
                })

                // Extract content from this thread
                node.forEach((block: ProseMirrorNode) => {
                    if (block.type.name !== aiUserMessageNodeType && block.type.name !== aiResponseMessageNodeType) {
                        return
                    }

                    const { text: textContent, images, featureIds } = ContentExtractor.collectContentWithImages(block)

                    if (textContent || images.length > 0 || featureIds.length > 0) {
                        selectedContent.push({
                            nodeType: block.type.name,
                            textContent,
                            images: images.length > 0 ? images : undefined,
                            featureIds: featureIds.length > 0 ? featureIds : undefined,
                        })
                    }
                })

                // Add closing XML tag for thread
                selectedContent.push({
                    nodeType: 'thread_end',
                    textContent: '</thread>'
                })
            }
        })

        return selectedContent
    }

    // Build NATS object store URL for an image reference
    static buildImageUrl(ref: ImageReference): string {
        return `nats-obj://workspace-${ref.workspaceId}-files/${ref.fileId}`
    }

    // Transform thread content into AI message format (merges consecutive same-role messages)
    // Returns multi-modal content format when images are present
    static toMessages(items: ThreadContent[]): Message[] {
        const messages: Message[] = []

        items.forEach(item => {
            const role = item.nodeType === aiResponseMessageNodeType ? 'assistant' : 'user'
            const hasImages = item.images && item.images.length > 0
            const lastMessage = messages[messages.length - 1]

            if (hasImages) {
                // Build multi-modal content parts
                const contentParts: MessageContentPart[] = []

                // Add text part if present
                if (item.textContent) {
                    contentParts.push({ type: 'text', text: item.textContent })
                }

                // Add image parts
                for (const imgRef of item.images!) {
                    contentParts.push({
                        type: 'image_url',
                        image_url: { url: ContentExtractor.buildImageUrl(imgRef) }
                    })
                }

                // Cannot merge multi-modal content, always create new message
                messages.push({ role, content: contentParts })
            } else {
                // Text-only content - can merge consecutive same-role messages
                if (lastMessage?.role === role && typeof lastMessage.content === 'string') {
                    lastMessage.content += '\n' + item.textContent
                } else {
                    messages.push({ role, content: item.textContent })
                }
            }
        })

        return messages
    }

    static collectReferencedFeatureIds(items: ThreadContent[]): string[] {
        return Array.from(new Set(items.flatMap((item) => item.featureIds ?? [])))
    }
}

// Document position and insertion utilities
class PositionFinder {
    static responseMatchesGenerationRun(attrs: Record<string, any>, generationRun?: MediaGenerationRunMeta): boolean {
        if (!usesReasoningSection(generationRun)) return true
        return attrs?.reasoningRunId === generationRun.reasoningRunId
    }

    static collapsibleMatchesGenerationRun(attrs: Record<string, any>, generationRun?: MediaGenerationRunMeta): boolean {
        if (!usesReasoningSection(generationRun)) return true
        return attrs?.reasoningRunId === generationRun.reasoningRunId && !attrs?.mediaRunId
    }

    // Find where to insert aiResponseMessage in the active thread
    // Returns null if the specified threadId is not found in this document
    static findThreadInsertionPoint(state: EditorState, threadId?: string): {
        insertPos: number
        threadId?: string
    } | null {
        let result: { insertPos: number; threadId?: string } | null = null

        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name !== aiChatThreadNodeType) return

            const nodeThreadId = node.attrs?.threadId || 'no-id'

            // If threadId specified, only match that exact thread
            if (threadId && nodeThreadId !== threadId) return

            // Insert at end of thread content (before closing token)
            result = {
                insertPos: pos + node.nodeSize - 1,
                threadId: nodeThreadId
            }
            return false // Stop searching
        })

        return result
    }

    // The content target for a run. A matrix run (with a reasoningRunId)
    // streams into its per-reasoning-run aiReasoningSection inside the single
    // shared response message; an unsectioned single-model run streams into the
    // aiResponseMessage itself. Callers (streaming, collapsible, media placement)
    // insert at endOfNodePos, so this resolves to whichever node owns the content.
    static findResponseNode(state: EditorState, threadId?: string, generationRun?: MediaGenerationRunMeta): {
        found: boolean
        endOfNodePos?: number
        childCount?: number
        nodePos?: number
        responseMessagePos?: number
    } {
        if (usesReasoningSection(generationRun)) {
            return PositionFinder.findReasoningSection(state, threadId, generationRun)
        }

        let bestEndPos: number | undefined
        let bestChildCount: number | undefined
        let bestNodePos: number | undefined
        let bestScore = -1 // 2: isReceiving, 1: isInitialRender, 0: any response

        const scoreNode = (attrs: any) =>
            attrs?.isReceivingAnimation ? 2 : (attrs?.isInitialRenderAnimation ? 1 : 0)

        if (threadId) {
            // Search within the specific thread only.
            state.doc.descendants((node: ProseMirrorNode, pos: number) => {
                if (node.type.name !== aiChatThreadNodeType || node.attrs?.threadId !== threadId) return

                node.descendants((child: ProseMirrorNode, relPos: number) => {
                    if (child.type.name !== aiResponseMessageNodeType) return
                    if (!PositionFinder.responseMatchesGenerationRun(child.attrs, generationRun)) return

                    const nodePos = pos + relPos + 1
                    const endPos = pos + relPos + 1 + child.nodeSize
                    const score = scoreNode(child.attrs)

                    if (score > bestScore || (score === bestScore && endPos > (bestEndPos || 0))) {
                        bestScore = score
                        bestEndPos = endPos
                        bestChildCount = child.childCount
                        bestNodePos = nodePos
                    }
                })
                return false // Stop after finding thread
            })
        }

        return bestEndPos !== undefined
            ? { found: true, endOfNodePos: bestEndPos, childCount: bestChildCount, nodePos: bestNodePos, responseMessagePos: bestNodePos }
            : { found: false }
    }

    private static findReasoningSection(state: EditorState, threadId: string | undefined, generationRun: MediaGenerationRunMeta): {
        found: boolean
        endOfNodePos?: number
        childCount?: number
        nodePos?: number
        responseMessagePos?: number
    } {
        const requestId = generationRun.generationRequestId || ''
        let bestEndPos: number | undefined
        let bestChildCount: number | undefined
        let bestNodePos: number | undefined
        let bestResponseMessagePos: number | undefined
        let bestScore = -1

        const scoreReceivingState = (attrs: any): number =>
            attrs?.isReceivingAnimation ? 2 : (attrs?.isInitialRenderAnimation ? 1 : 0)

        state.doc.descendants((threadNode: ProseMirrorNode, threadPos: number) => {
            if (threadNode.type.name !== aiChatThreadNodeType || (threadId && threadNode.attrs?.threadId !== threadId)) return

            threadNode.forEach((responseNode: ProseMirrorNode, responseOffset: number) => {
                if (responseNode.type.name !== aiResponseMessageNodeType) return

                const responseRequestId = responseNode.attrs?.generationRequestId || ''
                const requestMatches = requestId ? responseRequestId === requestId : true
                const isProvisionalTemplate = Boolean(requestId && !responseRequestId)
                if (!requestMatches && !isProvisionalTemplate) return

                const responseMessagePos = threadPos + 1 + responseOffset
                responseNode.forEach((sectionNode: ProseMirrorNode, sectionOffset: number) => {
                    if (sectionNode.type.name !== aiReasoningSectionNodeType) return

                    let score = -1
                    if (sectionNode.attrs?.reasoningRunId === generationRun.reasoningRunId) {
                        score = 100
                    } else if (isProvisionalTemplate && reasoningTemplateMatchesGenerationRun(sectionNode.attrs, generationRun)) {
                        score = 50
                    } else if (requestMatches && reasoningTemplateMatchesGenerationRun(sectionNode.attrs, generationRun)) {
                        score = 40
                    }
                    if (score < 0) return

                    const nodePos = responseMessagePos + 1 + sectionOffset
                    const endPos = nodePos + sectionNode.nodeSize
                    score += scoreReceivingState(sectionNode.attrs)

                    if (score > bestScore || (score === bestScore && endPos > (bestEndPos || 0))) {
                        bestScore = score
                        bestEndPos = endPos
                        bestChildCount = sectionNode.childCount
                        bestNodePos = nodePos
                        bestResponseMessagePos = responseMessagePos
                    }
                })
            })
            return false
        })

        return bestEndPos !== undefined
            ? {
                found: true,
                endOfNodePos: bestEndPos,
                childCount: bestChildCount,
                nodePos: bestNodePos,
                responseMessagePos: bestResponseMessagePos,
            }
            : { found: false }
    }

    // Find the single shared response message for a request group (one user prompt
    // → one aiResponseMessage), used to host one aiReasoningSection per model.
    static findResponseMessage(state: EditorState, threadId?: string, generationRun?: MediaGenerationRunMeta): {
        found: boolean
        nodePos?: number
        contentEndPos?: number
    } {
        let exactNodePos: number | undefined
        let exactContentEnd: number | undefined
        let templateNodePos: number | undefined
        let templateContentEnd: number | undefined
        const requestId = generationRun?.generationRequestId

        if (threadId) {
            state.doc.descendants((threadNode: ProseMirrorNode, threadPos: number) => {
                if (threadNode.type.name !== aiChatThreadNodeType || threadNode.attrs?.threadId !== threadId) return

                threadNode.forEach((child: ProseMirrorNode, offset: number) => {
                    if (child.type.name !== aiResponseMessageNodeType) return

                    const nodePos = threadPos + 1 + offset
                    const contentEnd = nodePos + child.nodeSize - 1
                    const responseRequestId = child.attrs?.generationRequestId || ''

                    if (requestId && responseRequestId === requestId) {
                        if (exactNodePos === undefined || nodePos > exactNodePos) {
                            exactNodePos = nodePos
                            exactContentEnd = contentEnd
                        }
                        return
                    }

                    if (!requestId || responseRequestId) return

                    let matchingSectionFound = false
                    child.forEach((sectionNode: ProseMirrorNode) => {
                        if (matchingSectionFound) return
                        if (sectionNode.type.name !== aiReasoningSectionNodeType) return
                        if (usesReasoningSection(generationRun) && !reasoningTemplateMatchesGenerationRun(sectionNode.attrs, generationRun)) return
                        matchingSectionFound = true
                    })

                    if (matchingSectionFound && (templateNodePos === undefined || nodePos > templateNodePos)) {
                        templateNodePos = nodePos
                        templateContentEnd = contentEnd
                    }
                })
                return false
            })
        }

        const nodePos = exactNodePos ?? templateNodePos
        const contentEndPos = exactContentEnd ?? templateContentEnd

        return nodePos !== undefined
            ? { found: true, nodePos, contentEndPos }
            : { found: false }
    }

    static findUnassignedReceivingResponseNode(
        state: EditorState,
        threadId?: string,
        reasoningModelId?: string
    ): {
        found: boolean
        endOfNodePos?: number
        childCount?: number
        nodePos?: number
    } {
        let bestEndPos: number | undefined
        let bestChildCount: number | undefined
        let bestNodePos: number | undefined

        if (threadId) {
            state.doc.descendants((node: ProseMirrorNode, pos: number) => {
                if (node.type.name !== aiChatThreadNodeType || node.attrs?.threadId !== threadId) return

                node.descendants((child: ProseMirrorNode, relPos: number) => {
                    if (child.type.name !== aiResponseMessageNodeType) return
                    if (child.attrs?.reasoningRunId) return
                    if (!child.attrs?.isReceivingAnimation && !child.attrs?.isInitialRenderAnimation) return
                    let hasReasoningSections = false
                    child.forEach((grandchild: ProseMirrorNode) => {
                        if (grandchild.type.name === aiReasoningSectionNodeType) hasReasoningSections = true
                    })
                    if (hasReasoningSections) return
                    if (reasoningModelId && child.attrs?.reasoningModelId && child.attrs.reasoningModelId !== reasoningModelId) return

                    bestNodePos = pos + relPos + 1
                    bestEndPos = bestNodePos + child.nodeSize
                    bestChildCount = child.childCount
                    return false
                })
                return false
            })
        }

        return bestEndPos !== undefined
            ? { found: true, endOfNodePos: bestEndPos, childCount: bestChildCount, nodePos: bestNodePos }
            : { found: false }
    }

    // Find the last aiCollapsibleBlock node inside the current response message for a thread
    static findCollapsibleNode(state: EditorState, threadId?: string, generationRun?: MediaGenerationRunMeta): {
        found: boolean
        endOfNodePos?: number
        childCount?: number
        nodePos?: number
    } {
        let result: { found: boolean; endOfNodePos?: number; childCount?: number; nodePos?: number } = { found: false }

        if (!threadId) return result

        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name !== aiChatThreadNodeType || node.attrs?.threadId !== threadId) return

            // Search within this thread for the last collapsible block in the last response
            let lastCollapsiblePos: number | undefined
            let lastCollapsibleEnd: number | undefined
            let lastCollapsibleChildCount: number | undefined

            node.descendants((child: ProseMirrorNode, relPos: number) => {
                if (child.type.name === aiCollapsibleBlockNodeType) {
                    if (!PositionFinder.collapsibleMatchesGenerationRun(child.attrs, generationRun)) return
                    const absPos = pos + relPos + 1
                    lastCollapsiblePos = absPos
                    lastCollapsibleEnd = absPos + child.nodeSize
                    lastCollapsibleChildCount = child.childCount
                }
            })

            if (lastCollapsiblePos !== undefined) {
                result = {
                    found: true,
                    endOfNodePos: lastCollapsibleEnd,
                    childCount: lastCollapsibleChildCount,
                    nodePos: lastCollapsiblePos
                }
            }

            return false
        })

        return result
    }
}

// Content insertion during AI streaming
class StreamingInserter {
    // Insert block-level content (headers, paragraphs, code blocks)
    static insertBlockContent(
        tr: Transaction,
        type: string,
        content: string,
        level: number | undefined,
        marks: any[] | null,
        endOfNodePos: number,
        childCount: number
    ): void {
        try {
            const insertPos = endOfNodePos - 1
            tr.doc.resolve(insertPos) // Validate position

            switch (type) {
                case 'header': {
                    const textNode = tr.doc.type.schema.text(content)
                    const headingNode = tr.doc.type.schema.nodes.heading.createAndFill({ level }, textNode)!

                    if (childCount === 0) {
                        tr.insert(insertPos, headingNode)
                    } else {
                        // Insert separator paragraph first
                        const para = tr.doc.type.schema.nodes.paragraph.createAndFill()!
                        tr.insert(insertPos, para)
                        tr.insert(endOfNodePos, headingNode)
                    }
                    break
                }

                case 'paragraph': {
                    if (content) {
                        const textNode = marks
                            ? tr.doc.type.schema.text(content, marks)
                            : tr.doc.type.schema.text(content)
                        const paragraphNode = tr.doc.type.schema.nodes.paragraph.createAndFill(null, textNode)!
                        tr.insert(insertPos, paragraphNode)
                    } else {
                        const emptyParagraph = tr.doc.type.schema.nodes.paragraph.create()
                        tr.insert(insertPos, emptyParagraph)
                    }
                    break
                }

                case 'codeBlock': {
                    const codeText = tr.doc.type.schema.text(content)
                    const codeBlock = tr.doc.type.schema.nodes.code_block.createAndFill(null, codeText)!
                    tr.insert(insertPos, codeBlock)
                    break
                }
            }
        } catch (error) {
            console.warn(`Block content insertion failed at ${endOfNodePos - 1}:`, error)
        }
    }

    // Insert inline content (text, marks, line breaks)
    static insertInlineContent(
        tr: Transaction,
        type: string,
        content: string,
        marks: any[] | null,
        endOfNodePos: number
    ): void {
        try {
            const insertPos = endOfNodePos - 2
            tr.doc.resolve(insertPos) // Validate position

            if (type === 'codeBlock') {
                const codeText = tr.doc.type.schema.text(content)
                tr.insert(insertPos, codeText)
            } else if (content === '\n') {
                const newParagraph = tr.doc.type.schema.nodes.paragraph.create()
                tr.insert(endOfNodePos - 1, newParagraph)
            } else if (content) {
                const textNode = marks
                    ? tr.doc.type.schema.text(content, marks)
                    : tr.doc.type.schema.text(content)
                tr.insert(insertPos, textNode)
            }
        } catch (error) {
            console.warn(`Inline content insertion failed at ${endOfNodePos - 2}:`, error)
        }
    }
}

// ========== MAIN PLUGIN CLASS ==========

// Main plugin class coordinating all AI chat functionality
class AiChatThreadPluginClass {
    private sendAiRequestHandler: SendAiRequestHandler
    private stopAiRequestHandler: StopAiRequestHandler
    private placeholderOptions: PlaceholderOptions
    private onReceivingStateChange: ((threadId: string, receiving: boolean) => void) | null
    private renderContext: AiChatThreadRenderContext
    private unsubscribeFromSegments: (() => void) | null = null

    constructor({
        sendAiRequestHandler,
        stopAiRequestHandler,
        placeholders,
        onReceivingStateChange,
        renderContext
    }: {
        sendAiRequestHandler: SendAiRequestHandler
        stopAiRequestHandler: StopAiRequestHandler
        placeholders: PlaceholderOptions
        onReceivingStateChange?: (threadId: string, receiving: boolean) => void
        renderContext?: AiChatThreadRenderContext
    }) {
        this.sendAiRequestHandler = sendAiRequestHandler
        this.stopAiRequestHandler = stopAiRequestHandler
        this.placeholderOptions = placeholders
        this.onReceivingStateChange = onReceivingStateChange ?? null
        this.renderContext = renderContext ?? {}
    }

    // ========== STREAMING MANAGEMENT ==========

    private getCurrentResponseContext(state: EditorState, threadId: string, generationRun?: MediaGenerationRunMeta): ResponseContext | null {
        const responseNodeInfo = PositionFinder.findResponseNode(state, threadId, generationRun)
        if (!responseNodeInfo.found || responseNodeInfo.endOfNodePos === undefined) return null

        const $endPos = state.doc.resolve(responseNodeInfo.endOfNodePos)
        const responseNode = $endPos.nodeBefore
        // The content owner is the per-run section (matrix) or the message (unsectioned);
        // generated media lands inside it, keeping each run's media to its own section.
        if (!responseNode || (responseNode.type.name !== aiResponseMessageNodeType && responseNode.type.name !== aiReasoningSectionNodeType)) return null

        const responseStartPos = responseNodeInfo.endOfNodePos - responseNode.nodeSize
        const responseMessagePos = responseNode.type.name === aiResponseMessageNodeType
            ? responseStartPos
            : responseNodeInfo.responseMessagePos
        if (responseMessagePos === undefined) return null

        const responseMessageNode = state.doc.nodeAt(responseMessagePos)
        if (!responseMessageNode || responseMessageNode.type.name !== aiResponseMessageNodeType) return null

        return {
            responseNode,
            responseStartPos,
            responseEndPos: responseNodeInfo.endOfNodePos,
            responseMessageNode,
            responseMessagePos,
            responseMessageId: responseMessageNode.attrs.id || '',
        }
    }

    private applyGenerationRunLineageToResponseSection(
        tr: Transaction,
        responseContext: ResponseContext,
        generationRun?: MediaGenerationRunMeta
    ): void {
        if (!generationRun?.lineageAssignment) return
        if (responseContext.responseNode.type.name !== aiReasoningSectionNodeType) return

        const currentAttrs = responseContext.responseNode.attrs
        const nextAttrs = buildReasoningSectionAttrs(
            generationRun,
            currentAttrs,
            currentAttrs.isReceivingAnimation,
        )
        const hasLineageAttrChange = currentAttrs.branchOriginNodeId !== nextAttrs.branchOriginNodeId
            || currentAttrs.branchForkNodeId !== nextAttrs.branchForkNodeId
            || currentAttrs.branchLineNodeId !== nextAttrs.branchLineNodeId
            || currentAttrs.generationRequestId !== nextAttrs.generationRequestId
            || currentAttrs.reasoningRunId !== nextAttrs.reasoningRunId
            || currentAttrs.reasoningModelId !== nextAttrs.reasoningModelId
            || currentAttrs.reasoningIndex !== nextAttrs.reasoningIndex

        if (!hasLineageAttrChange) return

        tr.setNodeMarkup(responseContext.responseStartPos, undefined, nextAttrs)
    }

    private applyGenerationRunLineageToResponseMessage(
        tr: Transaction,
        responseContext: ResponseContext,
        generationRun?: MediaGenerationRunMeta
    ): void {
        if (!generationRun?.lineageAssignment) return
        if (responseContext.responseNode.type.name !== aiResponseMessageNodeType) return

        const events = getAiLineageEventsForProjection({
            branchOriginNodeId: generationRun.lineageAssignment.branchOriginNodeId,
            branchForkNodeId: generationRun.lineageAssignment.branchForkNodeId,
            branchLineNodeId: generationRun.lineageAssignment.branchLineNodeId,
            reasoningIndex: generationRun.reasoningIndex,
        }, 'conversation')
        if (events.length === 0) return

        const responseMessagePos = tr.mapping.map(responseContext.responseMessagePos, 1)
        const responseMessageNode = tr.doc.nodeAt(responseMessagePos)
        if (!responseMessageNode || responseMessageNode.type.name !== aiResponseMessageNodeType) return
        const existingEventIds = new Set<string>()
        let insertAfterLeadingLineageEventsPos = responseMessagePos + 1
        let hasSeenNonLineageEventNode = false

        responseMessageNode.forEach((child: ProseMirrorNode, offset: number) => {
            if (child.type.name === aiLineageEventNodeType) {
                existingEventIds.add(getLineageEventNodeIdentity(child))
                if (!hasSeenNonLineageEventNode) {
                    insertAfterLeadingLineageEventsPos = responseMessagePos + 1 + offset + child.nodeSize
                }
                return
            }

            hasSeenNonLineageEventNode = true
        })

        let insertPos = insertAfterLeadingLineageEventsPos
        for (const event of events) {
            const eventId = getLineageEventIdentity(event)
            if (existingEventIds.has(eventId)) continue

            const eventNode = buildAiLineageEventNode(tr.doc.type.schema, event, generationRun.reasoningModelId || '')
            if (!eventNode) continue

            tr.insert(insertPos, eventNode)
            insertPos += eventNode.nodeSize
            existingEventIds.add(eventId)
        }
    }

    private createDuplicateLineageEventCleanupTransaction(state: EditorState): Transaction | null {
        const rangesToDelete: Array<{ from: number; to: number }> = []

        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name !== aiResponseMessageNodeType) return

            const seenLineageEventIds = new Set<string>()
            node.forEach((child: ProseMirrorNode, offset: number) => {
                if (child.type.name !== aiLineageEventNodeType) return

                const eventId = getLineageEventNodeIdentity(child)
                if (!seenLineageEventIds.has(eventId)) {
                    seenLineageEventIds.add(eventId)
                    return
                }

                const from = pos + 1 + offset
                rangesToDelete.push({ from, to: from + child.nodeSize })
            })
        })

        if (rangesToDelete.length === 0) return null

        const tr = state.tr
        for (const range of rangesToDelete.reverse()) {
            tr.delete(range.from, range.to)
        }
        return tr
    }

    private applyGenerationRunLineageToChat(
        tr: Transaction,
        responseContext: ResponseContext,
        generationRun?: MediaGenerationRunMeta
    ): void {
        this.applyGenerationRunLineageToResponseSection(tr, responseContext, generationRun)
        this.applyGenerationRunLineageToResponseMessage(tr, responseContext, generationRun)
    }

    private findGeneratedImageInResponse(
        responseContext: ResponseContext,
        options: {
            partialIndex?: number
            fileId?: string
            responseId?: string
            mediaRunId?: string
            partialOnly?: boolean
        }
    ): ResponseImageNodeInfo | null {
        let matchedImage: ResponseImageNodeInfo | null = null

        responseContext.responseNode.forEach((child: ProseMirrorNode, offset: number) => {
            if (child.type.name !== aiGeneratedImageNodeType) return
            if (options.partialOnly && !child.attrs.isPartial) return
            if (options.mediaRunId && child.attrs.mediaRunId !== options.mediaRunId) return

            const nodeInfo = {
                node: child,
                nodePos: responseContext.responseStartPos + 1 + offset,
            }

            if (options.fileId && child.attrs.fileId === options.fileId) {
                matchedImage = nodeInfo
                return
            }

            if (options.responseId && child.attrs.responseId === options.responseId) {
                matchedImage = nodeInfo
                return
            }

            if (options.partialIndex !== undefined && child.attrs.partialIndex === options.partialIndex) {
                matchedImage = nodeInfo
                return
            }

            if (options.mediaRunId) {
                matchedImage = nodeInfo
            }
        })

        if (options.mediaRunId) return matchedImage

        return matchedImage
    }

    private buildGeneratedImageAttrs(
        event: SegmentEvent,
        isPartial: boolean,
        partialIndex: number,
        previousAttrs: Partial<AiGeneratedImageAttrs> = {}
    ): AiGeneratedImageAttrs {
        const previousAlignment = previousAttrs.alignment
        const alignment = previousAlignment === 'left' || previousAlignment === 'center' || previousAlignment === 'right'
            ? previousAlignment
            : AI_GENERATED_MEDIA_ALIGNMENT
        const previousTextWrap = previousAttrs.textWrap
        const textWrap = previousTextWrap === 'left' || previousTextWrap === 'right' || previousTextWrap === 'none'
            ? previousTextWrap
            : AI_GENERATED_MEDIA_TEXT_WRAP
        const runAttrs = buildGeneratedMediaRunAttrs(event.generationRun, previousAttrs)
        const mediaModelId = runAttrs.mediaModelId || buildMediaModelId(event.imageModelProvider, event.imageModelId)

        return {
            imageData: event.imageUrl || previousAttrs.imageData || '',
            fileId: event.fileId || previousAttrs.fileId || '',
            workspaceId: event.workspaceId || previousAttrs.workspaceId || '',
            revisedPrompt: event.revisedPrompt || previousAttrs.revisedPrompt || '',
            responseId: event.responseId || previousAttrs.responseId || '',
            aiModel: event.aiProvider || previousAttrs.aiModel || '',
            isPartial,
            partialIndex,
            width: previousAttrs.width || AI_GENERATED_MEDIA_WIDTH,
            alignment,
            textWrap,
            ...runAttrs,
            mediaModelId,
        }
    }

    private upsertImagePartialInChat(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId } = event
        if (!aiChatThreadId) return

        const { state, dispatch } = view
        const imageNodeType = state.schema.nodes[aiGeneratedImageNodeType]
        if (!imageNodeType) return

        const responseContext = this.getCurrentResponseContext(state, aiChatThreadId, event.generationRun)
        if (!responseContext) return

        const partialIndex = event.partialIndex ?? 0
        const existingImage = this.findGeneratedImageInResponse(responseContext, {
            mediaRunId: event.generationRun?.mediaRunId,
            partialIndex,
            partialOnly: true,
        })
        const imageAttrs = this.buildGeneratedImageAttrs(event, true, partialIndex, existingImage?.node.attrs)
        const tr = state.tr
        this.applyGenerationRunLineageToChat(tr, responseContext, event.generationRun)
        const imageNodePos = existingImage ? tr.mapping.map(existingImage.nodePos, 1) : undefined
        const insertionPos = tr.mapping.map(responseContext.responseEndPos - 1, -1)

        if (imageNodePos !== undefined) {
            tr.setNodeMarkup(imageNodePos, undefined, imageAttrs)
        } else {
            tr.insert(insertionPos, imageNodeType.create(imageAttrs))
        }

        if (tr.docChanged) {
            tr.setMeta('skipDispatch', true)
            dispatch(tr)
        }
    }

    private removePartialImagesInChat(view: EditorView, threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const responseContext = this.getCurrentResponseContext(view.state, threadId, generationRun)
        if (!responseContext) return

        const ranges: Array<{ from: number; to: number }> = []
        responseContext.responseNode.forEach((child: ProseMirrorNode, offset: number) => {
            if (child.type.name !== aiGeneratedImageNodeType || !child.attrs.isPartial) return
            if (generationRun?.mediaRunId && child.attrs.mediaRunId !== generationRun.mediaRunId) return
            const from = responseContext.responseStartPos + 1 + offset
            ranges.push({ from, to: from + child.nodeSize })
        })

        if (ranges.length === 0) return

        const tr = view.state.tr
        for (const range of ranges.reverse()) {
            tr.delete(range.from, range.to)
        }

        if (tr.docChanged) {
            view.dispatch(tr)
        }
    }

    private upsertImageCompleteInChat(view: EditorView, event: SegmentEvent): string {
        const { aiChatThreadId } = event
        if (!aiChatThreadId) return ''

        const { state, dispatch } = view
        const responseContext = this.getCurrentResponseContext(state, aiChatThreadId, event.generationRun)
        if (!responseContext) return ''

        const responseMessageId = responseContext.responseMessageId
        const imageNodeType = state.schema.nodes[aiGeneratedImageNodeType]
        const existingImage = this.findGeneratedImageInResponse(responseContext, {
            mediaRunId: event.generationRun?.mediaRunId,
            fileId: event.fileId,
            responseId: event.responseId,
        }) ?? this.findGeneratedImageInResponse(responseContext, {
            mediaRunId: event.generationRun?.mediaRunId,
            fileId: event.fileId,
            responseId: event.responseId,
            partialOnly: true,
        })
        const partialIndex = existingImage?.node.attrs.partialIndex ?? 0
        const tr = state.tr
        const stalePartialRanges: Array<{ from: number; to: number }> = []

        responseContext.responseNode.forEach((child: ProseMirrorNode, offset: number) => {
            if (child.type.name !== aiGeneratedImageNodeType || !child.attrs.isPartial) return
            if (event.generationRun?.mediaRunId && child.attrs.mediaRunId !== event.generationRun.mediaRunId) return

            const from = responseContext.responseStartPos + 1 + offset
            if (existingImage?.nodePos === from) return

            stalePartialRanges.push({ from, to: from + child.nodeSize })
        })

        for (const range of stalePartialRanges.reverse()) {
            tr.delete(range.from, range.to)
        }

        this.applyGenerationRunLineageToChat(tr, responseContext, event.generationRun)
        const imageNodePos = existingImage ? tr.mapping.map(existingImage.nodePos, 1) : undefined
        const insertionPos = tr.mapping.map(responseContext.responseEndPos - 1, -1)

        if (imageNodeType) {
            const imageAttrs = this.buildGeneratedImageAttrs(event, false, partialIndex, existingImage?.node.attrs)
            if (imageNodePos !== undefined) {
                tr.setNodeMarkup(imageNodePos, undefined, imageAttrs)
            } else {
                tr.insert(insertionPos, imageNodeType.create(imageAttrs))
            }
        }

        if (tr.docChanged) {
            dispatch(tr)
        }

        return responseMessageId
    }

    private findGeneratedVideoInResponse(
        responseContext: ResponseContext,
        options: {
            mediaRunId?: string
            fileId?: string
            responseId?: string
        }
    ): ResponseVideoNodeInfo | null {
        let matchedVideo: ResponseVideoNodeInfo | null = null

        responseContext.responseNode.forEach((child: ProseMirrorNode, offset: number) => {
            if (child.type.name !== aiGeneratedVideoNodeType) return
            if (options.mediaRunId && child.attrs.mediaRunId !== options.mediaRunId) return

            const nodeInfo = {
                node: child,
                nodePos: responseContext.responseStartPos + 1 + offset,
            }

            if (options.fileId && child.attrs.fileId === options.fileId) {
                matchedVideo = nodeInfo
                return
            }

            if (options.responseId && child.attrs.responseId === options.responseId) {
                matchedVideo = nodeInfo
                return
            }

            if (options.mediaRunId) {
                matchedVideo = nodeInfo
            }
        })

        return matchedVideo
    }

    private buildGeneratedVideoAttrs(
        event: SegmentEvent,
        isPending: boolean,
        errorMessage = '',
        previousAttrs: Partial<AiGeneratedVideoAttrs> = {}
    ): AiGeneratedVideoAttrs {
        const previousAlignment = previousAttrs.alignment
        const alignment = previousAlignment === 'left' || previousAlignment === 'center' || previousAlignment === 'right'
            ? previousAlignment
            : AI_GENERATED_MEDIA_ALIGNMENT
        const previousTextWrap = previousAttrs.textWrap
        const textWrap = previousTextWrap === 'left' || previousTextWrap === 'right' || previousTextWrap === 'none'
            ? previousTextWrap
            : AI_GENERATED_MEDIA_TEXT_WRAP

        return {
            videoUrl: event.videoUrl || previousAttrs.videoUrl || '',
            fileId: event.fileId || previousAttrs.fileId || '',
            workspaceId: event.workspaceId || previousAttrs.workspaceId || '',
            posterUrl: event.posterUrl || previousAttrs.posterUrl || '',
            posterFileId: event.posterFileId || previousAttrs.posterFileId || '',
            durationSeconds: event.durationSeconds ?? previousAttrs.durationSeconds ?? 0,
            aspectRatio: event.aspectRatio ?? previousAttrs.aspectRatio ?? 1.777,
            hasAudio: event.hasAudio ?? previousAttrs.hasAudio ?? true,
            revisedPrompt: event.revisedPrompt || previousAttrs.revisedPrompt || '',
            responseId: event.responseId || previousAttrs.responseId || '',
            videoModel: event.videoModel || event.generationRun?.mediaModelId || previousAttrs.videoModel || '',
            isPending,
            errorMessage,
            width: previousAttrs.width || AI_GENERATED_MEDIA_WIDTH,
            alignment,
            textWrap,
            ...buildGeneratedMediaRunAttrs(event.generationRun, previousAttrs),
        }
    }

    private upsertVideoPendingInChat(view: EditorView, event: SegmentEvent): string {
        const { aiChatThreadId } = event
        if (!aiChatThreadId) return ''

        const { state, dispatch } = view
        const videoNodeType = state.schema.nodes[aiGeneratedVideoNodeType]
        if (!videoNodeType) return ''

        const responseContext = this.getCurrentResponseContext(state, aiChatThreadId, event.generationRun)
        if (!responseContext) return ''

        const existingVideo = this.findGeneratedVideoInResponse(responseContext, {
            mediaRunId: event.generationRun?.mediaRunId,
        })
        const videoAttrs = this.buildGeneratedVideoAttrs(event, true, '', existingVideo?.node.attrs)
        const tr = state.tr
        this.applyGenerationRunLineageToChat(tr, responseContext, event.generationRun)
        const videoNodePos = existingVideo ? tr.mapping.map(existingVideo.nodePos, 1) : undefined
        const insertionPos = tr.mapping.map(responseContext.responseEndPos - 1, -1)

        if (videoNodePos !== undefined) {
            tr.setNodeMarkup(videoNodePos, undefined, videoAttrs)
        } else {
            tr.insert(insertionPos, videoNodeType.create(videoAttrs))
        }

        if (tr.docChanged) {
            tr.setMeta('skipDispatch', true)
            dispatch(tr)
        }

        return responseContext.responseMessageId
    }

    private upsertVideoCompleteInChat(view: EditorView, event: SegmentEvent): string {
        const { aiChatThreadId } = event
        if (!aiChatThreadId) return ''

        const { state, dispatch } = view
        const videoNodeType = state.schema.nodes[aiGeneratedVideoNodeType]
        if (!videoNodeType) return ''

        const responseContext = this.getCurrentResponseContext(state, aiChatThreadId, event.generationRun)
        if (!responseContext) return ''

        const existingVideo = this.findGeneratedVideoInResponse(responseContext, {
            mediaRunId: event.generationRun?.mediaRunId,
            fileId: event.fileId,
            responseId: event.responseId,
        })
        const tr = state.tr
        this.applyGenerationRunLineageToChat(tr, responseContext, event.generationRun)
        const videoNodePos = existingVideo ? tr.mapping.map(existingVideo.nodePos, 1) : undefined
        const insertionPos = tr.mapping.map(responseContext.responseEndPos - 1, -1)

        const videoAttrs = this.buildGeneratedVideoAttrs(event, false, '', existingVideo?.node.attrs)
        if (videoNodePos !== undefined) {
            tr.setNodeMarkup(videoNodePos, undefined, videoAttrs)
        } else {
            tr.insert(insertionPos, videoNodeType.create(videoAttrs))
        }

        if (tr.docChanged) {
            dispatch(tr)
        }

        return responseContext.responseNode.attrs.id || ''
    }

    private upsertVideoErrorInChat(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId } = event
        if (!aiChatThreadId) return

        const { state, dispatch } = view
        const videoNodeType = state.schema.nodes[aiGeneratedVideoNodeType]
        if (!videoNodeType) return

        const responseContext = this.getCurrentResponseContext(state, aiChatThreadId, event.generationRun)
        if (!responseContext) return

        const existingVideo = this.findGeneratedVideoInResponse(responseContext, {
            mediaRunId: event.generationRun?.mediaRunId,
        })
        const videoAttrs = this.buildGeneratedVideoAttrs(
            event,
            false,
            event.error || 'Video generation failed',
            existingVideo?.node.attrs
        )
        const tr = state.tr
        this.applyGenerationRunLineageToChat(tr, responseContext, event.generationRun)
        const videoNodePos = existingVideo ? tr.mapping.map(existingVideo.nodePos, 1) : undefined
        const insertionPos = tr.mapping.map(responseContext.responseEndPos - 1, -1)

        if (videoNodePos !== undefined) {
            tr.setNodeMarkup(videoNodePos, undefined, videoAttrs)
        } else {
            tr.insert(insertionPos, videoNodeType.create(videoAttrs))
        }

        if (tr.docChanged) {
            tr.setMeta('skipDispatch', true)
            dispatch(tr)
        }
    }

    private startStreaming(view: EditorView): void {
        // Read this editor's threadId from the document — each editor owns exactly one thread
        const threadInfo = PositionFinder.findThreadInsertionPoint(view.state)
        const ownerThreadId = threadInfo?.threadId

        if (!ownerThreadId) {
            console.warn('[aiChatThreadPlugin] startStreaming: no thread found in document')
            return
        }

        // Subscribe to segments for THIS thread only — events for other threads never reach this callback
        this.unsubscribeFromSegments = SegmentsReceiver.subscribeForThread(ownerThreadId, (event: SegmentEvent) => {
            const { status, type, aiProvider, segment, threadId, aiChatThreadId } = event
            const effectiveThreadId = threadId || aiChatThreadId
            const { state, dispatch } = view

            // Handle image generation events
            if (type === 'image_generation_trace') {
                this.ensureGenerationTraceResponseNode(view.state, (tr) => view.dispatch(tr), aiProvider, effectiveThreadId, event.generationRun)
                this.handleImageGenerationTrace(view, event)
                return
            }

            if (type === 'image_partial') {
                this.handleImagePartial(view, event)
                return
            }

            if (type === 'image_complete') {
                this.handleImageComplete(view, event)
                return
            }

            if (type === 'image_error') {
                this.handleImageError(view, event)
                return
            }

            // Video generation events — VEO is async (submit/poll), no partial
            // frames. PENDING creates the placeholder, GENERATING is a keepalive
            // heartbeat, COMPLETE finalizes the same canvas node, ERROR cleans up.
            if (type === 'video_pending') {
                this.handleVideoPending(view, event)
                return
            }

            if (type === 'video_generating') {
                this.handleVideoGenerating(view, event)
                return
            }

            if (type === 'video_complete') {
                this.handleVideoComplete(view, event)
                return
            }

            if (type === 'video_error') {
                this.handleVideoError(view, event)
                return
            }

            if (type === 'video_generation_trace') {
                this.ensureGenerationTraceResponseNode(view.state, (tr) => view.dispatch(tr), aiProvider, effectiveThreadId, event.generationRun)
                this.handleVideoGenerationTrace(view, event)
                return
            }

            if (type === 'image_branch_resolved') {
                this.ensureReceivingResponseNode(state, dispatch, aiProvider, effectiveThreadId, event.generationRun)
                routeSegmentEventToCanvas(event)
                return
            }

            if (type === 'media_lineage_planned') {
                if (event.generationRun && effectiveThreadId) {
                    this.ensureReceivingResponseNode(state, dispatch, aiProvider, effectiveThreadId, event.generationRun)

                    const lineageState = view.state
                    const responseContext = this.getCurrentResponseContext(lineageState, effectiveThreadId, event.generationRun)
                    if (responseContext) {
                        const tr = lineageState.tr
                        this.applyGenerationRunLineageToChat(tr, responseContext, event.generationRun)
                        if (tr.docChanged) {
                            view.dispatch(tr)
                        }
                    }
                }
                routeSegmentEventToCanvas(event)
                return
            }

            if (type === 'context_relevance_resolved') {
                this.ensureReceivingResponseNode(state, dispatch, aiProvider, effectiveThreadId, event.generationRun)
                routeSegmentEventToCanvas(event)
                return
            }

            if (type === 'context_relevance_error') {
                return
            }

            if (type === 'image_branch_resolution_error') {
                routeSegmentEventToCanvas(event)
                this.handleStreamError(view, effectiveThreadId, event.generationRun)
                return
            }

            // Handle collapsible block events
            if (type === 'collapsible_start') {
                this.ensureReceivingResponseNode(state, dispatch, aiProvider, effectiveThreadId, getReasoningOnlyGenerationRun(event.generationRun))
                this.handleCollapsibleStart(view, event)
                return
            }

            if (type === 'collapsible_end') {
                this.handleCollapsibleEnd(view, event)
                return
            }

            if (status === 'ERROR') {
                const callbacks = getAiGeneratedImageCallbacks()
                if (effectiveThreadId) {
                    callbacks.onImageErrorToCanvas?.({
                        threadId: effectiveThreadId,
                        error: event.error || 'AI generation failed',
                        generationRun: event.generationRun,
                    })
                }
                this.handleStreamError(view, effectiveThreadId, event.generationRun)
                return
            }

            // Handle text streaming events
            switch (status) {
                case 'START_STREAM':
                    this.handleStreamStart(state, dispatch, aiProvider, effectiveThreadId, event.generationRun)
                    break
                case 'STREAMING':
                    if (segment) this.handleStreaming(state, dispatch, segment, effectiveThreadId, aiProvider, event.generationRun)
                    break
                case 'END_STREAM':
                    this.handleStreamEnd(state, dispatch, effectiveThreadId, event.generationRun)
                    break
            }
        })
    }

    private handleStreamError(view: EditorView, threadId?: string, generationRun?: MediaGenerationRunMeta): void {
        if (threadId) {
            this.removePartialImagesInChat(view, threadId, generationRun)
        }
        this.handleStreamEnd(view.state, (tr) => view.dispatch(tr), threadId, generationRun)
    }

    private handleImageError(view: EditorView, event: SegmentEvent): void {
        const threadId = event.threadId || event.aiChatThreadId
        if (!threadId) return

        this.removePartialImagesInChat(view, threadId, event.generationRun)
        routeSegmentEventToCanvas(event)
        this.handleStreamEnd(view.state, (tr) => view.dispatch(tr), threadId, event.generationRun)
    }

    private handleImagePartial(view: EditorView, event: SegmentEvent): void {
        try {
            const { aiChatThreadId } = event
            if (!aiChatThreadId) return

            const { state } = view
            const threadInfo = PositionFinder.findThreadInsertionPoint(state, aiChatThreadId)

            // Only process events for threads that exist in THIS document
            if (!threadInfo) return

            this.upsertImagePartialInChat(view, event)

            // Delegate to canvas-side handler so the same generation appears on the canvas.
            routeSegmentEventToCanvas(event)
        } catch (error) {
            console.error('[aiChatThreadPlugin] handleImagePartial failed', { event }, error)
        }
    }

    private handleImageComplete(view: EditorView, event: SegmentEvent): void {
        const { imageUrl, aiChatThreadId } = event
        if (!imageUrl || !aiChatThreadId) return

        const { state } = view

        // Only process events for threads that exist in THIS document
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, aiChatThreadId)
        if (!threadInfo) return

        const responseMessageId = this.upsertImageCompleteInChat(view, event)

        // Delegate image placement to the canvas (chat-doc message id is passed
        // through so the canvas node can cross-reference the chat message).
        routeSegmentEventToCanvas(event, { responseMessageId })
    }

    // Video segment handlers. Chat history gets a compact aiGeneratedVideo node
    // keyed by mediaRunId, while the canvas owns the full-size generated output.
    private handleVideoPending(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId } = event
        if (!aiChatThreadId) return
        this.upsertVideoPendingInChat(view, event)
        routeSegmentEventToCanvas(event)
    }

    private handleVideoGenerating(_view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId } = event
        if (!aiChatThreadId) return
        routeSegmentEventToCanvas(event)
    }

    private handleVideoComplete(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId, videoUrl } = event
        if (!aiChatThreadId || !videoUrl) return
        const responseMessageId = this.upsertVideoCompleteInChat(view, event)
        routeSegmentEventToCanvas(event, { responseMessageId })
    }

    private handleVideoError(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId } = event
        if (!aiChatThreadId) return
        this.upsertVideoErrorInChat(view, event)
        routeSegmentEventToCanvas(event)
    }

    // Enrich (or insert) the response's collapsible block with a generation
    // trace. Shared by the image and video trace handlers — the only difference
    // between them is which trace attr + title they pass in. The generalized
    // aiCollapsibleBlock renderer picks image vs video by which trace is set.
    private ensureGenerationTraceResponseNode(
        state: EditorState,
        dispatch: (tr: Transaction) => void,
        aiProvider?: string,
        threadId?: string,
        generationRun?: MediaGenerationRunMeta
    ): void {
        const reasoningGenerationRun = getReasoningOnlyGenerationRun(generationRun)
        const existingInfo = PositionFinder.findResponseNode(state, threadId, reasoningGenerationRun)
        if (existingInfo.found) return

        this.ensureReceivingResponseNode(state, dispatch, aiProvider, threadId, reasoningGenerationRun)
    }

    private applyGenerationTraceCollapsible(
        view: EditorView,
        threadId: string,
        attrs: Record<string, unknown>,
        generationRun?: MediaGenerationRunMeta
    ): void {
        const { state, dispatch } = view
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) return

        const tr = state.tr
        const reasoningGenerationRun = getReasoningOnlyGenerationRun(generationRun)
        const runAttrs = buildGeneratedRunAttrs(reasoningGenerationRun)
        const collapsibleInfo = PositionFinder.findCollapsibleNode(state, threadId, reasoningGenerationRun)
        const responseContext = this.getCurrentResponseContext(state, threadId, generationRun)
        if (responseContext) {
            this.applyGenerationRunLineageToChat(tr, responseContext, generationRun)
        }

        if (collapsibleInfo.found && collapsibleInfo.nodePos !== undefined) {
            const collapsibleNodePos = tr.mapping.map(collapsibleInfo.nodePos, 1)
            const collapsibleNode = tr.doc.nodeAt(collapsibleNodePos)
            if (collapsibleNode?.type.name === aiCollapsibleBlockNodeType) {
                tr.setNodeMarkup(collapsibleNodePos, undefined, {
                    ...collapsibleNode.attrs,
                    ...attrs,
                    ...runAttrs,
                })
            }
        } else {
            const responseInfo = PositionFinder.findResponseNode(state, threadId, reasoningGenerationRun)
            if (!responseInfo.found || !responseInfo.endOfNodePos) return
            const collapsibleNode = state.schema.nodes[aiCollapsibleBlockNodeType].create({
                ...attrs,
                ...runAttrs,
            })
            tr.insert(tr.mapping.map(responseInfo.endOfNodePos - 1, -1), collapsibleNode)
        }

        if (tr.docChanged) {
            tr.setMeta('skipDispatch', true)
            dispatch(tr)
        }
    }

    private handleVideoGenerationTrace(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId: threadId, videoGenerationTrace } = event
        if (!threadId || !videoGenerationTrace) return
        routeSegmentEventToCanvas(event)
        this.applyGenerationTraceCollapsible(view, threadId, {
            title: 'Video generation details',
            isOpen: false,
            isStreaming: false,
            videoGenerationTrace,
        }, event.generationRun)
    }

    private handleImageGenerationTrace(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId: threadId, imageGenerationTrace } = event
        if (!threadId || !imageGenerationTrace) return
        routeSegmentEventToCanvas(event)
        this.applyGenerationTraceCollapsible(view, threadId, {
            title: 'Image generation details',
            isOpen: false,
            isStreaming: false,
            imageGenerationTrace,
            imageGenerationTraceId: null,
        }, event.generationRun)
    }

    private handleCreateVariantRequest(view: EditorView, node: ProseMirrorNode, pos: number): void {
        const { revisedPrompt, aiModel } = node.attrs
        if (!revisedPrompt) return

        // Find the thread node
        const $pos = view.state.doc.resolve(pos)
        let threadId: string | undefined
        let aiImageModel: string | undefined

        for (let d = $pos.depth; d > 0; d--) {
            const n = $pos.node(d)
            if (n.type.name === aiChatThreadNodeType) {
                threadId = n.attrs.threadId
                aiImageModel = n.attrs.aiImageModel
                break
            }
        }

        if (!threadId || !aiImageModel) return

        // Use the handler to trigger new generation
        this.sendAiRequestHandler({
            message: `Create a variant of this image: ${revisedPrompt}`,
            threadId,
            aiChatThreadId: threadId,
            imageOptions: {
                aiImageModel,
                imageGenerationSize: '1024x1024'
            }
        })
    }

    // One user prompt → one aiResponseMessage. Each reasoning model's run gets its
    // own aiReasoningSection inside that shared message; the first run of a request
    // creates the message, later runs append another section to it.
    private ensureReceivingResponseSection(
        state: EditorState,
        dispatch: (tr: Transaction) => void,
        aiProvider: string | undefined,
        threadId: string | undefined,
        generationRun: MediaGenerationRunMeta
    ): void {
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) return

        const sectionInfo = PositionFinder.findResponseNode(state, threadId, generationRun)
        if (sectionInfo.found && sectionInfo.nodePos !== undefined) {
            const sectionNode = state.doc.nodeAt(sectionInfo.nodePos)
            if (sectionNode?.type.name === aiReasoningSectionNodeType) {
                const tr = state.tr
                if (sectionInfo.responseMessagePos !== undefined) {
                    const responseNode = state.doc.nodeAt(sectionInfo.responseMessagePos)
                    if (responseNode?.type.name === aiResponseMessageNodeType) {
                        tr.setNodeMarkup(sectionInfo.responseMessagePos, undefined, buildResponseMessageAttrsForGenerationRun(
                            generationRun,
                            responseNode.attrs,
                            aiProvider,
                        ))
                    }
                }
                tr.setNodeMarkup(sectionInfo.nodePos, undefined, buildReasoningSectionAttrs(generationRun, sectionNode.attrs, true))
                if (threadId) tr.setMeta('setReceiving', { threadId, receiving: true, runKey: getReasoningRunKey(generationRun) })
                if (tr.docChanged || threadId) {
                    tr.setMeta('skipDispatch', true)
                    dispatch(tr)
                }
                return
            }
        }

        const sectionNode = state.schema.nodes[aiReasoningSectionNodeType].create(buildReasoningSectionAttrs(generationRun))

        const messageInfo = PositionFinder.findResponseMessage(state, threadId, generationRun)
        const tr = state.tr
        if (messageInfo.found && messageInfo.nodePos !== undefined && messageInfo.contentEndPos !== undefined) {
            const responseNode = state.doc.nodeAt(messageInfo.nodePos)
            if (responseNode?.type.name === aiResponseMessageNodeType) {
                tr.setNodeMarkup(messageInfo.nodePos, undefined, buildResponseMessageAttrsForGenerationRun(
                    generationRun,
                    responseNode.attrs,
                    aiProvider,
                ))
            }
            tr.insert(messageInfo.contentEndPos, sectionNode)
        } else {
            const aiResponseNode = state.schema.nodes[aiResponseMessageNodeType].create({
                ...buildResponseMessageAttrsForGenerationRun(generationRun, {}, aiProvider),
            }, sectionNode)
            tr.insert(threadInfo.insertPos, aiResponseNode)
        }
        if (threadId) tr.setMeta('setReceiving', { threadId, receiving: true, runKey: getReasoningRunKey(generationRun) })
        tr.setMeta('skipDispatch', true)
        dispatch(tr)
    }

    private ensureReceivingResponseNode(
        state: EditorState,
        dispatch: (tr: Transaction) => void,
        aiProvider?: string,
        threadId?: string,
        generationRun?: MediaGenerationRunMeta
    ): void {
        if (usesReasoningSection(generationRun)) {
            this.ensureReceivingResponseSection(state, dispatch, aiProvider, threadId, generationRun)
            return
        }

        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) return

        const existingInfo = PositionFinder.findResponseNode(state, threadId, generationRun)
        if (existingInfo.found && existingInfo.nodePos !== undefined) {
            const existingNode = state.doc.nodeAt(existingInfo.nodePos)
            const isActivePlaceholder = Boolean(
                existingNode?.attrs?.isReceivingAnimation
                || existingNode?.attrs?.isInitialRenderAnimation
            )

            if (existingNode?.type.name === aiResponseMessageNodeType && isActivePlaceholder) {
                let tr = state.tr
                if (!existingNode.attrs.isReceivingAnimation || !existingNode.attrs.isInitialRenderAnimation) {
                    tr = tr.setNodeMarkup(existingInfo.nodePos, undefined, {
                        ...existingNode.attrs,
                        isInitialRenderAnimation: true,
                        isReceivingAnimation: true,
                        aiProvider: existingNode.attrs.aiProvider || aiProvider,
                    })
                }
                if (threadId) {
                    tr.setMeta('setReceiving', { threadId, receiving: true, runKey: getReasoningRunKey(generationRun) })
                }
                if (tr.docChanged || threadId) {
                    tr.setMeta('skipDispatch', true)
                    dispatch(tr)
                }
                return
            }
        }

        const pendingInfo = PositionFinder.findUnassignedReceivingResponseNode(state, threadId, generationRun?.reasoningModelId)
        if (pendingInfo.found && pendingInfo.nodePos !== undefined) {
            const pendingNode = state.doc.nodeAt(pendingInfo.nodePos)
            if (pendingNode?.type.name === aiResponseMessageNodeType) {
                const tr = state.tr.setNodeMarkup(pendingInfo.nodePos, undefined, {
                    ...pendingNode.attrs,
                    isInitialRenderAnimation: true,
                    isReceivingAnimation: true,
                    aiProvider: pendingNode.attrs.aiProvider || aiProvider,
                    ...buildGeneratedRunAttrs(generationRun, pendingNode.attrs),
                })
                if (threadId) {
                    tr.setMeta('setReceiving', { threadId, receiving: true, runKey: getReasoningRunKey(generationRun) })
                }
                tr.setMeta('skipDispatch', true)
                dispatch(tr)
                return
            }
        }

        const responseMessageId = `resp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
        const aiResponseNode = state.schema.nodes[aiResponseMessageNodeType].create({
            id: responseMessageId,
            isInitialRenderAnimation: true,
            isReceivingAnimation: true,
            aiProvider,
            ...buildGeneratedRunAttrs(generationRun),
        })

        let tr = state.tr.insert(threadInfo.insertPos, aiResponseNode)
        if (threadId) {
            tr.setMeta('setReceiving', { threadId, receiving: true, runKey: getReasoningRunKey(generationRun) })
        }
        tr.setMeta('skipDispatch', true)
        dispatch(tr)
    }

    private handleStreamStart(
        state: EditorState,
        dispatch: (tr: Transaction) => void,
        aiProvider?: string,
        threadId?: string,
        generationRun?: MediaGenerationRunMeta
    ): void {
        try {
            this.ensureReceivingResponseNode(state, dispatch, aiProvider, threadId, generationRun)
        } catch (error) {
            console.error('Error inserting aiResponseMessage:', error)
        }
    }

    private handleStreaming(
        state: EditorState,
        dispatch: (tr: Transaction) => void,
        segment: SegmentEvent['segment'],
        threadId?: string,
        aiProvider?: string,
        generationRun?: MediaGenerationRunMeta
    ): void {
        if (!segment) return

        // Only process events for threads that exist in THIS document
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) return

        let tr = state.tr

        // Check if we're inside a collapsible block for this thread
        const pluginState = PLUGIN_KEY.getState(state)
        const reasoningGenerationRun = getReasoningOnlyGenerationRun(generationRun)
        const isInsideCollapsible = threadId && (
            pluginState?.collapsibleRunKeys.has(getThreadScopedRunKey(threadId, reasoningGenerationRun))
            || pluginState?.collapsibleThreadIds.has(threadId)
        )

        let targetInfo: { found: boolean; endOfNodePos?: number; childCount?: number }

        if (isInsideCollapsible) {
            // Insert into the collapsible node
            targetInfo = PositionFinder.findCollapsibleNode(state, threadId, reasoningGenerationRun)
            if (!targetInfo.found) {
                console.warn('[aiChatThreadPlugin] active collapsible stream has no target', { threadId })
                return
            }
        } else {
            targetInfo = PositionFinder.findResponseNode(state, threadId, generationRun)
        }

        // Create the target if missing (rare: a stream chunk arrived before
        // START_STREAM set up the node). Matrix runs must land in this request's
        // shared message as a per-run section, never a second bare message.
        if (!targetInfo.found) {
            console.warn('[aiChatThreadPlugin] no response node found; creating one', { threadId })

            const { insertPos } = threadInfo
            if (usesReasoningSection(generationRun)) {
                const sectionNode = state.schema.nodes[aiReasoningSectionNodeType].create(buildReasoningSectionAttrs(generationRun))
                const messageInfo = PositionFinder.findResponseMessage(state, threadId, generationRun)
                if (messageInfo.found && messageInfo.nodePos !== undefined && messageInfo.contentEndPos !== undefined) {
                    const responseMessage = state.doc.nodeAt(messageInfo.nodePos)
                    if (responseMessage?.type.name === aiResponseMessageNodeType) {
                        tr.setNodeMarkup(messageInfo.nodePos, undefined, buildResponseMessageAttrsForGenerationRun(
                            generationRun,
                            responseMessage.attrs,
                            aiProvider,
                        ))
                    }
                    tr.insert(messageInfo.contentEndPos, sectionNode)
                    targetInfo = { found: true, endOfNodePos: messageInfo.contentEndPos + sectionNode.nodeSize, childCount: 0 }
                } else {
                    const responseNode = state.schema.nodes[aiResponseMessageNodeType].create({
                        ...buildResponseMessageAttrsForGenerationRun(generationRun, {}, aiProvider || 'Anthropic'),
                    }, sectionNode)
                    tr.insert(insertPos, responseNode)
                    targetInfo = { found: true, endOfNodePos: insertPos + responseNode.nodeSize - 1, childCount: 0 }
                }
            } else {
                const responseNode = state.schema.nodes[aiResponseMessageNodeType].create({
                    id: `resp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    isInitialRenderAnimation: true,
                    isReceivingAnimation: true,
                    aiProvider: aiProvider || 'Anthropic',
                    ...buildGeneratedRunAttrs(generationRun),
                })
                tr.insert(insertPos, responseNode)
                targetInfo = { found: true, endOfNodePos: insertPos + responseNode.nodeSize, childCount: 0 }
            }
        }

        const { endOfNodePos, childCount } = targetInfo
        const { segment: content, styles, type, level, isBlockDefining } = segment

        // Create text marks from styles
        const marks = styles.length > 0
            ? styles.map(style => this.createMark(state.schema, style)).filter(Boolean)
            : null

        // Insert content based on type
        if (isBlockDefining) {
            StreamingInserter.insertBlockContent(tr, type, content, level, marks, endOfNodePos!, childCount!)
        } else {
            StreamingInserter.insertInlineContent(tr, type, content, marks, endOfNodePos!)
        }

        if (tr.docChanged) {
            tr.setMeta('skipDispatch', true)
            dispatch(tr)
        }
    }

    private handleStreamEnd(
        state: EditorState,
        dispatch: (tr: Transaction) => void,
        threadId?: string,
        generationRun?: MediaGenerationRunMeta
    ): void {
        // Only process events for threads that exist in THIS document
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) {
            // Thread not in this document - event is for a different editor
            return
        }

        const responseInfo = PositionFinder.findResponseNode(state, threadId, generationRun)
        if (!responseInfo.found || responseInfo.nodePos === undefined) {
            if (!IS_RECEIVING_TEMP_DEBUG_STATE && threadId) {
                dispatch(state.tr.setMeta('setReceiving', { threadId, receiving: false, runKey: getReasoningRunKey(generationRun) }))
            }
            return
        }

        const node = state.doc.nodeAt(responseInfo.nodePos)
        // findResponseNode resolves to the per-run section for matrix runs and to
        // the message itself for unsectioned runs; clear the receiving flag on whichever.
        if (!node || (node.type.name !== aiResponseMessageNodeType && node.type.name !== aiReasoningSectionNodeType)) {
            if (!IS_RECEIVING_TEMP_DEBUG_STATE && threadId) {
                dispatch(state.tr.setMeta('setReceiving', { threadId, receiving: false, runKey: getReasoningRunKey(generationRun) }))
            }
            return
        }

        const tr = state.tr.setNodeMarkup(responseInfo.nodePos, undefined, {
            ...node.attrs,
            isInitialRenderAnimation: false,
            isReceivingAnimation: false
        })

        if (node.type.name === aiReasoningSectionNodeType && responseInfo.responseMessagePos !== undefined) {
            const responseMessageNode = tr.doc.nodeAt(responseInfo.responseMessagePos)
            if (responseMessageNode?.type.name === aiResponseMessageNodeType) {
                let hasReceivingSection = false
                responseMessageNode.forEach((child: ProseMirrorNode) => {
                    if (child.type.name === aiReasoningSectionNodeType && child.attrs.isReceivingAnimation) {
                        hasReceivingSection = true
                    }
                })
                if (!hasReceivingSection) {
                    tr.setNodeMarkup(responseInfo.responseMessagePos, undefined, {
                        ...responseMessageNode.attrs,
                        isInitialRenderAnimation: false,
                        isReceivingAnimation: false,
                    })
                }
            }
        }

        // Clear receiving state
        if (!IS_RECEIVING_TEMP_DEBUG_STATE && threadId) {
            tr.setMeta('setReceiving', { threadId, receiving: false, runKey: getReasoningRunKey(generationRun) })
        }

        dispatch(tr)
    }

    private handleCollapsibleStart(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId: threadId, collapsibleTitle } = event
        if (!threadId) return

        const { state, dispatch } = view
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) return

        const reasoningGenerationRun = getReasoningOnlyGenerationRun(event.generationRun)
        const responseInfo = PositionFinder.findResponseNode(state, threadId, reasoningGenerationRun)
        if (!responseInfo.found || !responseInfo.endOfNodePos) return

        const tr = state.tr
        const collapsibleNode = state.schema.nodes[aiCollapsibleBlockNodeType].create({
            title: collapsibleTitle || 'Image generation prompt',
            isOpen: false,
            isStreaming: true,
            ...buildGeneratedRunAttrs(reasoningGenerationRun),
        })

        // Insert collapsible block at end of response message content
        const insertPos = responseInfo.endOfNodePos - 1
        tr.insert(insertPos, collapsibleNode)

        // Track that this thread is now inside a collapsible block
        tr.setMeta('setCollapsible', { threadId, active: true, runKey: getReasoningRunKey(reasoningGenerationRun) })

        if (tr.docChanged) {
            tr.setMeta('skipDispatch', true)
            dispatch(tr)
        }
    }

    private handleCollapsibleEnd(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId: threadId } = event
        if (!threadId) return

        const { state, dispatch } = view
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) return

        // Mark collapsible as no longer streaming
        const reasoningGenerationRun = getReasoningOnlyGenerationRun(event.generationRun)
        const collapsibleInfo = PositionFinder.findCollapsibleNode(state, threadId, reasoningGenerationRun)
        if (!collapsibleInfo.found || collapsibleInfo.nodePos === undefined) return

        const tr = state.tr
        const collapsibleNode = state.doc.nodeAt(collapsibleInfo.nodePos)
        if (collapsibleNode && collapsibleNode.type.name === aiCollapsibleBlockNodeType) {
            tr.setNodeMarkup(collapsibleInfo.nodePos, undefined, {
                ...collapsibleNode.attrs,
                isStreaming: false,
            })
        }

        // Clear collapsible tracking for this thread
        tr.setMeta('setCollapsible', { threadId, active: false, runKey: getReasoningRunKey(reasoningGenerationRun) })

        if (tr.docChanged) {
            tr.setMeta('skipDispatch', true)
            dispatch(tr)
        }
    }

    private createMark(schema: ProseMirrorSchema, style: string): any {
        switch (style) {
            case 'bold': return schema.marks.strong.create()
            case 'italic': return schema.marks.em.create()
            case 'strikethrough': return schema.marks.strikethrough.create()
            case 'code': return schema.marks.code.create()
            default: return null
        }
    }

    // ========== RECEIVING STATE DECORATIONS ==========

    private createReceivingStateDecorations(state: EditorState, pluginState: AiChatThreadPluginState): Decoration[] {
        const decorations: Decoration[] = []

        // Find all ai-chat-thread nodes and add receiving state styling ONLY
        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name === 'aiChatThread') {
                let cssClass = 'ai-chat-thread'
                const threadId = node.attrs?.threadId
                if (threadId && pluginState.receivingThreadIds.has(threadId)) {
                    cssClass += ' receiving'
                }

                // Create a decoration that applies the receiving state class to the entire node
                decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, {
                        class: cssClass
                    })
                )
            }
        })

        return decorations
    }

    // ========== DROPDOWN STATE HANDLING ==========
    // Note: Dropdown decorations and state are now handled by the dropdown primitive plugin

    // ========== PLACEHOLDERS ==========

    private createPlaceholders(state: EditorState): DecorationSet {
        const decorations: Decoration[] = []

        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            // Title placeholder
            if (node.type.name === documentTitleNodeType && node.content.size === 0) {
                decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, {
                        class: 'empty-node-placeholder',
                        'data-placeholder': this.placeholderOptions.titlePlaceholder
                    })
                )
            }
        })

        return DecorationSet.create(state.doc, decorations)
    }

    // ========== TRANSACTION HANDLING ==========

    private handleInsertThread(transaction: Transaction, newState: EditorState): Transaction | null {
        const attrs = transaction.getMeta(INSERT_THREAD_META)
        if (!attrs) return null

        // Create an empty thread node — messages will be injected by AiPromptInputController
        const nodeType = newState.schema.nodes[aiChatThreadNodeType]
        if (!nodeType) return null

        // Thread content expression is (aiUserMessage | aiResponseMessage)*
        // Empty thread is valid — the first message will be injected when the
        // user submits from the floating input.
        const threadNode = nodeType.create(attrs)

        const { $from } = newState.selection

        // Find if cursor is inside an existing aiChatThread
        let currentThreadDepth = -1
        for (let depth = $from.depth; depth >= 0; depth--) {
            if ($from.node(depth).type.name === aiChatThreadNodeType) {
                currentThreadDepth = depth
                break
            }
        }

        // Insert after current thread or after current top-level block
        let insertPos: number
        if (currentThreadDepth !== -1) {
            const threadPos = $from.before(currentThreadDepth)
            const existingThread = $from.node(currentThreadDepth)
            insertPos = threadPos + existingThread.nodeSize
        } else {
            insertPos = $from.after(1)
        }

        const tr = newState.tr.replace(insertPos, insertPos, new Slice(Fragment.from(threadNode), 0, 0))

        return tr
    }

    private createLocalReceivingResponseTransaction(
        state: EditorState,
        threadId: string,
        aiProvider: string | undefined,
        reasoningModelIds: string[],
        useReasoningSections = false,
    ): Transaction | null {
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) return null

        const responseNodeType = state.schema.nodes[aiResponseMessageNodeType]
        if (!responseNodeType) return null

        const rawPlaceholderModelIds = reasoningModelIds.length > 0 ? reasoningModelIds : ['']
        const placeholderModelIds = Array.from(new Set(rawPlaceholderModelIds.filter(Boolean)))
        if (placeholderModelIds.length === 0) placeholderModelIds.push('')
        if (useReasoningSections) {
            const sectionNodeType = state.schema.nodes[aiReasoningSectionNodeType]
            if (!sectionNodeType) return null

            let hasPendingSectionedResponse = false
            state.doc.descendants((node: ProseMirrorNode) => {
                if (hasPendingSectionedResponse) return false
                if (node.type.name !== aiChatThreadNodeType || node.attrs?.threadId !== threadId) return
                node.forEach((responseNode: ProseMirrorNode) => {
                    if (hasPendingSectionedResponse) return
                    if (responseNode.type.name !== aiResponseMessageNodeType) return
                    if (responseNode.attrs?.generationRequestId) return
                    if (!responseNode.attrs?.isReceivingAnimation && !responseNode.attrs?.isInitialRenderAnimation) return
                    responseNode.forEach((child: ProseMirrorNode) => {
                        if (child.type.name === aiReasoningSectionNodeType) hasPendingSectionedResponse = true
                    })
                })
                return !hasPendingSectionedResponse
            })
            if (hasPendingSectionedResponse) return null

            const responseMessageId = `resp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
            const sections = placeholderModelIds.map((modelId, reasoningIndex) => sectionNodeType.create({
                generationRequestId: '',
                reasoningRunId: '',
                reasoningModelId: modelId,
                reasoningIndex,
                isReceivingAnimation: true,
            }))
            const responseNode = responseNodeType.create({
                id: responseMessageId,
                isInitialRenderAnimation: true,
                isReceivingAnimation: true,
                aiProvider: getReasoningModelProvider(placeholderModelIds[0] || '') || aiProvider,
            }, Fragment.fromArray(sections))
            const tr = state.tr.insert(threadInfo.insertPos, responseNode)
            tr.setMeta('skipDispatch', true)
            return tr
        }

        const existingReceiving = PositionFinder.findUnassignedReceivingResponseNode(state, threadId)
        if (existingReceiving.found) return null

        let tr = state.tr
        let insertPos = threadInfo.insertPos

        for (const modelId of placeholderModelIds) {
            const responseMessageId = `resp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
            const responseNode = responseNodeType.create({
                id: responseMessageId,
                isInitialRenderAnimation: true,
                isReceivingAnimation: true,
                aiProvider: getReasoningModelProvider(modelId) || aiProvider,
                reasoningModelId: modelId,
            })
            tr = tr.insert(insertPos, responseNode)
            insertPos += responseNode.nodeSize
        }

        tr.setMeta('skipDispatch', true)
        return tr
    }

    private handleChatRequest(newState: EditorState, transaction: Transaction): Transaction | null {
        const meta = transaction.getMeta(USE_AI_CHAT_META)
        const { threadId: threadIdFromMeta, nodePos } = meta || {}

        // Find thread from the button's explicit position when provided, otherwise from selection.
        const threadNode = nodePos !== undefined
            ? ContentExtractor.findThreadByPosition(newState, nodePos)
            : ContentExtractor.findThreadBySelection(newState)

        if (!threadNode) {
            console.warn('[aiChatThreadPlugin] handleChatRequest: thread node not found')
            return null
        }

        // Extract thread attributes including image + video generation settings
        const {
            aiModel = '',
            aiModels = '',
            useMultipleModels = false,
            useMultipleReasoningModels = false,
            useMultipleImageModels = false,
            useMultipleVideoModels = false,
            aiImageModel = '',
            aiImageModels = '',
            threadContext = 'Thread',
            threadId: threadIdFromNode = '',
            imageGenerationSize = 'auto',
            imageGenerationConfigGroups = '',
            aiVideoModel = '',
            aiVideoModels = '',
            videoAspectRatio = '',
            videoResolution = '',
            videoDuration = '',
            videoGenerationConfigGroups = '',
            sourceVideoNodeId = ''
        } = threadNode.attrs
        const threadId = threadIdFromMeta || threadIdFromNode

        const combinedMultiModelFlag = useMultipleModels === true || useMultipleModels === 'true'
        const rawReasoningModelsEnabled = useMultipleReasoningModels === true
            || useMultipleReasoningModels === 'true'
        const rawImageModelsEnabled = useMultipleImageModels === true
            || useMultipleImageModels === 'true'
        const rawVideoModelsEnabled = useMultipleVideoModels === true
            || useMultipleVideoModels === 'true'
        const hasSectionModelMode = rawReasoningModelsEnabled || rawImageModelsEnabled || rawVideoModelsEnabled
        const shouldExpandCombinedModelFlag = combinedMultiModelFlag && !hasSectionModelMode
        const reasoningModelsEnabled = rawReasoningModelsEnabled || shouldExpandCombinedModelFlag
        const imageModelsEnabled = rawImageModelsEnabled || shouldExpandCombinedModelFlag
        const videoModelsEnabled = rawVideoModelsEnabled || shouldExpandCombinedModelFlag
        const rawReasoningModelIds = parseAiModelSelectionAttr(aiModels)
        const rawImageModelIds = parseAiModelSelectionAttr(aiImageModels)
        const rawVideoModelIds = parseAiModelSelectionAttr(aiVideoModels)
        const imageConfigGroups = parseMediaGenerationConfigSelectionAttr(imageGenerationConfigGroups)
        const videoConfigGroups = parseMediaGenerationConfigSelectionAttr(videoGenerationConfigGroups)
        const reasoningModelIds = reasoningModelsEnabled
            ? rawReasoningModelIds
            : []
        const imageModelIds = imageModelsEnabled
            ? rawImageModelIds
            : []
        const videoModelIds = videoModelsEnabled
            ? rawVideoModelIds
            : []
        const effectiveAiModel = reasoningModelsEnabled
            ? reasoningModelIds[0] || ''
            : aiModel || rawReasoningModelIds[0] || ''
        const effectiveImageModel = imageModelsEnabled
            ? imageModelIds[0] || ''
            : aiImageModel || rawImageModelIds[0] || ''
        const effectiveVideoModel = videoModelsEnabled
            ? videoModelIds[0] || ''
            : aiVideoModel || rawVideoModelIds[0] || ''

        if (reasoningModelsEnabled && reasoningModelIds.length === 0) {
            alert('Please select at least 1 reasoning model.')
            return null
        }

        // Validate AI model selected
        if (!effectiveAiModel) {
            alert('Please select an AI model from the dropdown before submitting.')
            return null
        }
        if (imageModelsEnabled && imageModelIds.length === 0) {
            alert('Please select at least 1 image model.')
            return null
        }
        if (videoModelsEnabled && videoModelIds.length === 0) {
            alert('Please select at least 1 video model.')
            return null
        }

        // Extract and send content
        // Pass threadId for Workspace mode to ensure current thread is always included
        const threadContent = ContentExtractor.getActiveThreadContent(newState, threadContext, nodePos, threadId)
        const messages = ContentExtractor.toMessages(threadContent)
        const referencedFeatureIds = ContentExtractor.collectReferencedFeatureIds(threadContent)

        // Build image generation options if an image model is selected
        const imageOptions = effectiveImageModel ? {
            aiImageModel: effectiveImageModel,
            aiImageModels: imageModelIds,
            imageGenerationSize,
            ...(imageModelsEnabled && imageConfigGroups.length > 0 ? { configGroups: imageConfigGroups } : {}),
        } : undefined

        // Build video generation options if a video model is selected. The
        // sourceVideoNodeId is preserved through the thread node attrs and only
        // forwarded when present (set by the "Extend in new thread" action).
        const videoOptions = effectiveVideoModel ? {
            aiVideoModel: effectiveVideoModel,
            aiVideoModels: videoModelIds,
            videoAspectRatio,
            videoResolution,
            videoDuration,
            ...(videoModelsEnabled && videoConfigGroups.length > 0 ? { configGroups: videoConfigGroups } : {}),
            ...(sourceVideoNodeId ? { sourceVideoNodeId } : {})
        } : undefined

        const selectedReasoningModelCount = reasoningModelIds.length > 0 ? reasoningModelIds.length : effectiveAiModel ? 1 : 0
        const selectedImageModelCount = imageModelIds.length > 0 ? imageModelIds.length : effectiveImageModel ? 1 : 0
        const selectedVideoModelCount = videoModelIds.length > 0 ? videoModelIds.length : effectiveVideoModel ? 1 : 0
        const selectedModelCount = selectedReasoningModelCount + selectedImageModelCount + selectedVideoModelCount
        const scalarModelCount = (effectiveAiModel ? 1 : 0) + (effectiveImageModel ? 1 : 0) + (effectiveVideoModel ? 1 : 0)
        const usesMediaGenerationMatrix = selectedModelCount > scalarModelCount

        const requestPayload = {
            messages,
            aiModel: effectiveAiModel,
            aiModels: reasoningModelIds,
            useMultipleModels: reasoningModelsEnabled || imageModelsEnabled || videoModelsEnabled,
            useMultipleReasoningModels: reasoningModelsEnabled,
            useMultipleImageModels: imageModelsEnabled,
            useMultipleVideoModels: videoModelsEnabled,
            threadId,
            imageOptions,
            videoOptions,
            referencedFeatureIds,
        }

        const responseTransaction = this.createLocalReceivingResponseTransaction(
            newState,
            threadId,
            getReasoningModelProvider(effectiveAiModel),
            reasoningModelIds.length > 0 ? reasoningModelIds : [effectiveAiModel],
            usesMediaGenerationMatrix,
        )

        queueMicrotask(() => {
            void Promise.resolve(this.sendAiRequestHandler(requestPayload)).catch((error) => {
                console.error('[aiChatThreadPlugin] AI chat request failed:', error)
            })
        })

        return responseTransaction
    }

    private handleStopRequest(transaction: Transaction): void {
        const meta = transaction.getMeta(STOP_AI_CHAT_META)
        const { threadId } = meta || {}
        this.stopAiRequestHandler({ threadId })
    }

    // ========== PLUGIN CREATION ==========

    create(): Plugin {
        return new Plugin({
            key: PLUGIN_KEY,

            // Prevent transactions that would corrupt thread structure
            filterTransaction: (tr: Transaction, state: EditorState) => {
                if (!tr.docChanged) return true
                if (this.renderContext.readOnly) return false

                let valid = true
                tr.doc.descendants((node: ProseMirrorNode) => {
                    if (node.type.name !== aiChatThreadNodeType) return

                    // Thread must have at least one child (a message)
                    if (node.childCount === 0) {
                        console.warn('[aiChatThreadPlugin] filterTransaction: blocking deletion that would empty thread')
                        valid = false
                        return false
                    }
                })
                return valid
            },

            state: {
                init: (): AiChatThreadPluginState => ({
                    receivingThreadIds: new Set<string>(),
                    receivingRunKeysByThread: new Map<string, Set<string>>(),
                    insideBackticks: false,
                    backtickBuffer: '',
                    insideCodeBlock: false,
                    codeBuffer: '',
                    decorations: DecorationSet.empty,
                    collapsibleThreadIds: new Set<string>(),
                    collapsibleRunKeys: new Set<string>()
                }),
                apply: (tr: Transaction, prev: AiChatThreadPluginState): AiChatThreadPluginState => {
                    // Handle receiving state toggle per thread
                    const receivingMeta = tr.getMeta('setReceiving')
                    if (receivingMeta !== undefined) {
                        const { threadId, receiving, runKey = 'unsectioned' } = receivingMeta
                        if (threadId) {
                            const previousThreadReceiving = prev.receivingThreadIds.has(threadId)
                            const nextRunKeysByThread = new Map(prev.receivingRunKeysByThread)
                            const nextThreadRunKeys = new Set(nextRunKeysByThread.get(threadId) ?? [])

                            if (receiving) {
                                nextThreadRunKeys.add(runKey)
                            } else {
                                nextThreadRunKeys.delete(runKey)
                            }

                            if (nextThreadRunKeys.size > 0) {
                                nextRunKeysByThread.set(threadId, nextThreadRunKeys)
                            } else {
                                nextRunKeysByThread.delete(threadId)
                            }

                            const newSet = new Set(prev.receivingThreadIds)
                            if (nextThreadRunKeys.size > 0) {
                                newSet.add(threadId)
                            } else {
                                newSet.delete(threadId)
                            }

                            const nextThreadReceiving = newSet.has(threadId)
                            if (previousThreadReceiving !== nextThreadReceiving) {
                                this.onReceivingStateChange?.(threadId, nextThreadReceiving)
                            }
                            return {
                                ...prev,
                                receivingThreadIds: newSet,
                                receivingRunKeysByThread: nextRunKeysByThread,
                                decorations: prev.decorations.map(tr.mapping, tr.doc)
                            }
                        }
                    }

                    // Handle collapsible state toggle per thread
                    const collapsibleMeta = tr.getMeta('setCollapsible')
                    if (collapsibleMeta !== undefined) {
                        const { threadId, active, runKey = 'unsectioned' } = collapsibleMeta
                        if (threadId) {
                            const scopedRunKey = `${threadId}:${runKey}`
                            const nextRunKeys = new Set(prev.collapsibleRunKeys)
                            if (active) {
                                nextRunKeys.add(scopedRunKey)
                            } else {
                                nextRunKeys.delete(scopedRunKey)
                            }

                            const newSet = new Set(prev.collapsibleThreadIds)
                            const hasThreadActiveRun = Array.from(nextRunKeys).some((key) => key.startsWith(`${threadId}:`))
                            if (hasThreadActiveRun) {
                                newSet.add(threadId)
                            } else {
                                newSet.delete(threadId)
                            }
                            return {
                                ...prev,
                                collapsibleThreadIds: newSet,
                                collapsibleRunKeys: nextRunKeys,
                                decorations: prev.decorations.map(tr.mapping, tr.doc)
                            }
                        }
                    }

                    // Note: Dropdown selections are handled in appendTransaction

                    // Note: dropdown state toggle is now handled by dropdown primitive plugin
                    // aiChatThreadNode converts threadId-based meta to dropdownId-based meta for the primitive

                    // Map existing decorations to new document
                    return {
                        ...prev,
                        decorations: prev.decorations.map(tr.mapping, tr.doc)
                    }
                }
            },

            appendTransaction: (transactions: Transaction[], _oldState: EditorState, newState: EditorState) => {
                // Strip imported aiUserInput nodes from threads if present.
                const paragraphType = newState.schema.nodes.paragraph
                if (paragraphType) {
                    let tr: Transaction | null = null
                    newState.doc.descendants((node: ProseMirrorNode, pos: number) => {
                        if (node.type.name !== aiChatThreadNodeType) return

                        // Remove any aiUserInput children.
                        node.forEach((child: ProseMirrorNode, offset: number) => {
                            if (child.type.name === aiUserInputNodeType) {
                                const childPos = pos + 1 + offset
                                tr = tr || newState.tr
                                tr.delete(childPos, childPos + child.nodeSize)
                            }
                        })
                    })
                    if (tr) return tr
                }

                // Handle AI chat requests
                const chatTransaction = transactions.find(tr => tr.getMeta(USE_AI_CHAT_META))
                if (chatTransaction) {
                    const responseTransaction = this.handleChatRequest(newState, chatTransaction)
                    if (responseTransaction) return responseTransaction
                }

                // Handle AI chat stop requests
                const stopTransaction = transactions.find(tr => tr.getMeta(STOP_AI_CHAT_META))
                if (stopTransaction) {
                    this.handleStopRequest(stopTransaction)
                }

                // Handle thread insertions
                const insertTransaction = transactions.find(tr => tr.getMeta(INSERT_THREAD_META))
                if (insertTransaction) {
                    return this.handleInsertThread(insertTransaction, newState)
                }

                // Handle deferred dropdown attr updates after dropdown selection
                const dropdownTx = transactions.find(tr => tr.getMeta('dropdownOptionSelected'))
                if (dropdownTx) {
                    const dropdownSelection = dropdownTx.getMeta('dropdownOptionSelected')
                    const { option, nodePos, dropdownId } = dropdownSelection || {}

                    // Handle AI model dropdown selection
                    if (dropdownId?.startsWith('ai-model-dropdown-')) {
                        let provider = option?.provider
                        let model = option?.model
                        if ((!provider || !model) && option?.title) {
                            const allModels = aiModelsStore.getData()
                            const found = allModels.find((m: any) => m.title === option.title)
                            if (found) {
                                provider = provider || found.provider
                                model = model || found.model
                            }
                        }
                        if (provider && model && typeof nodePos === 'number') {
                            const newModel = `${provider}:${model}`
                            let threadPos = -1
                            let threadNode: ProseMirrorNode | null = null
                            newState.doc.nodesBetween(0, newState.doc.content.size, (node: ProseMirrorNode, pos: number) => {
                                if (node.type.name === 'aiChatThread') {
                                    const threadStart = pos
                                    const threadEnd = pos + node.nodeSize
                                    if (nodePos >= threadStart && nodePos < threadEnd) {
                                        threadPos = pos
                                        threadNode = node
                                        return false
                                    }
                                }
                            })
                            if (threadPos !== -1 && threadNode && threadNode.attrs.aiModel !== newModel) {
                                const tr = newState.tr
                                const newAttrs = { ...threadNode.attrs, aiModel: newModel }
                                tr.setNodeMarkup(threadPos, undefined, newAttrs)
                                documentStore.setMetaValues({ requiresSave: true })
                                return tr
                            }
                        }
                    }

                    // Handle thread context dropdown selection
                    if (dropdownId?.startsWith('thread-context-dropdown-')) {
                        const newContext = option?.value || option?.title
                        if (newContext && typeof nodePos === 'number') {
                            let threadPos = -1
                            let threadNode: ProseMirrorNode | null = null
                            newState.doc.nodesBetween(0, newState.doc.content.size, (node: ProseMirrorNode, pos: number) => {
                                if (node.type.name === 'aiChatThread') {
                                    const threadStart = pos
                                    const threadEnd = pos + node.nodeSize
                                    if (nodePos >= threadStart && nodePos < threadEnd) {
                                        threadPos = pos
                                        threadNode = node
                                        return false
                                    }
                                }
                            })
                            if (threadPos !== -1 && threadNode && threadNode.attrs.threadContext !== newContext) {
                                const tr = newState.tr
                                const newAttrs = { ...threadNode.attrs, threadContext: newContext }
                                tr.setNodeMarkup(threadPos, undefined, newAttrs)
                                documentStore.setMetaValues({ requiresSave: true })
                                return tr
                            }
                        }
                    }
                }

                return null
            },

            view: (view: EditorView) => {
                if (!this.renderContext.readOnly) {
                    this.startStreaming(view)
                }

                let destroyed = false
                if (!this.renderContext.readOnly) {
                    queueMicrotask(() => {
                        if (destroyed) return
                        const cleanupTransaction = this.createDuplicateLineageEventCleanupTransaction(view.state)
                        if (cleanupTransaction) view.dispatch(cleanupTransaction)
                    })
                }

                // Note: Dropdown state bridging removed - now handled by dropdown primitive plugin

                return {
                    destroy: () => {
                        destroyed = true
                        if (this.unsubscribeFromSegments) {
                            this.unsubscribeFromSegments()
                        }
                    }
                }
            },

            props: {
                // Paste handling: thread content is read-only (conversation log),
                // so we block pastes inside thread nodes. Users paste into the
                // separate floating aiPromptInput instead.
                handlePaste: (view: EditorView, _event: ClipboardEvent, _slice: Slice) => {
                    const { $from } = view.state.selection

                    for (let depth = $from.depth; depth > 0; depth--) {
                        if ($from.node(depth).type.name === aiChatThreadNodeType) {
                            // Inside a thread — consume the event to prevent invalid edits
                            return true
                        }
                    }

                    return false // Outside thread, let default handling proceed
                },

                // Decorations: combine all independent decoration systems
                decorations: (state: EditorState) => {
                    const pluginState = PLUGIN_KEY.getState(state)
                    const placeholders = this.createPlaceholders(state)
                    const allDecorations = [...placeholders.find()]

                    // Independent receiving state system - show receiving state for threads that are receiving
                    if (pluginState && pluginState.receivingThreadIds.size > 0) {
                        const receivingDecorations = this.createReceivingStateDecorations(state, pluginState)
                        allDecorations.push(...receivingDecorations)
                    }

                    // Note: Dropdown decorations are now handled by the dropdown primitive plugin

                    return DecorationSet.create(state.doc, allDecorations)
                },

                // Node views
                nodeViews: {
                    [aiChatThreadNodeType]: (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) =>
                        aiChatThreadNodeView(node, view, getPos),
                    [aiResponseMessageNodeType]: (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) =>
                        aiResponseMessageNodeView(node, view, getPos),
                    [aiUserMessageNodeType]: (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) =>
                        aiUserMessageNodeView(node, view, getPos, {
                            contextPreview: this.renderContext.contextPreview,
                        }),
                    [aiCollapsibleBlockNodeType]: (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) =>
                        aiCollapsibleBlockNodeView(node, view, getPos, {
                            traceDetailsOptions: this.renderContext.traceDetailsOptions,
                        }),
                    [aiReasoningSectionNodeType]: (node: ProseMirrorNode) =>
                        aiReasoningSectionNodeView(node),
                    [aiLineageEventNodeType]: (node: ProseMirrorNode) =>
                        aiLineageEventNodeView(node),
                    [aiGeneratedVideoNodeType]: (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) =>
                        aiGeneratedVideoNodeView(node, view, getPos),
                    // Note: aiGeneratedImage is handled by imageSelectionPlugin for bubble menu integration
                },
                view: (editorView: EditorView) => {
                    const handleCreateVariant = (e: Event) => {
                        const customEvent = e as CustomEvent
                        const { node, pos } = customEvent.detail
                        this.handleCreateVariantRequest(editorView, node, pos)
                    }

                    editorView.dom.addEventListener('create-ai-image-variant', handleCreateVariant)

                    return {
                        update: () => {},
                        destroy: () => {
                            editorView.dom.removeEventListener('create-ai-image-variant', handleCreateVariant)
                        }
                    }
                }
            }
        })
    }
}

// ========== FACTORY FUNCTION ==========

// Factory function to create the AI Chat Thread plugin
export function createAiChatThreadPlugin({
    sendAiRequestHandler,
    stopAiRequestHandler,
    placeholders,
    imageCallbacks,
    videoCallbacks,
    onReceivingStateChange,
    renderContext
}: {
    sendAiRequestHandler: SendAiRequestHandler
    stopAiRequestHandler: StopAiRequestHandler
    placeholders: PlaceholderOptions
    imageCallbacks?: AiGeneratedImageCallbacks
    videoCallbacks?: AiGeneratedVideoCallbacks
    onReceivingStateChange?: (threadId: string, receiving: boolean) => void
    renderContext?: AiChatThreadRenderContext
}): Plugin {
    // Set image generation callbacks if provided
    if (imageCallbacks) {
        setAiGeneratedImageCallbacks(imageCallbacks)
    }

    // Set video generation callbacks if provided (mirror image callback wiring).
    if (videoCallbacks) {
        setAiGeneratedVideoCallbacks(videoCallbacks)
    }

    const pluginInstance = new AiChatThreadPluginClass({
        sendAiRequestHandler,
        stopAiRequestHandler,
        placeholders,
        onReceivingStateChange,
        renderContext,
    })
    return pluginInstance.create()
}
