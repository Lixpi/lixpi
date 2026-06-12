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
// aiUserInput has been removed — the composer is now a separate floating canvas element
// The aiUserInputNodeType is still imported for legacy content migration
import { aiUserInputNodeType } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserInputNode.ts'
import { aiUserMessageNodeType, aiUserMessageNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'
import { aiCollapsibleBlockNodeType, aiCollapsibleBlockNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiCollapsibleBlockNode.ts'
import { aiReasoningSectionNodeType, aiReasoningSectionNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiReasoningSectionNode.ts'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.ts'
import { documentStore } from '$src/stores/documentStore.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { parseAiModelSelectionAttr } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import type {
    AiInteractionChatSendMessagePayload,
    AiInteractionChatStopMessagePayload,
    AiModelId,
    ImageBranchVlmResolution,
    ImageGenerationTrace,
    ImageGenerationSize,
    MarkdownParsedSegment,
    MediaGenerationRunMeta,
    StreamStatus,
    WorkspaceContextResolution,
} from '@lixpi/constants'

import { setAiGeneratedImageCallbacks, getAiGeneratedImageCallbacks, aiGeneratedImageNodeType, type AiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'
import { setAiGeneratedVideoCallbacks, getAiGeneratedVideoCallbacks, aiGeneratedVideoNodeType, aiGeneratedVideoNodeView, type AiGeneratedVideoCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedVideoNode.ts'

// dispatchSendAiChatFromUserInput has been removed — messages are now injected by AiPromptInputController
// findUserInputInThread is no longer needed — aiUserInput has been removed from the schema

const IS_RECEIVING_TEMP_DEBUG_STATE = false    // For debug purposes only

// ========== TYPE DEFINITIONS ==========

type ImageOptions = {
    aiImageModel: string
    aiImageModels?: string[]
    imageGenerationSize: ImageGenerationSize
}

type VideoOptions = {
    aiVideoModel: string
    aiVideoModels?: string[]
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string
    // Set when the user invoked "Extend in new thread" from a generated video
    // node. WorkspaceCanvas resolves the nodeId to a workspace Object Store URI
    // (`nats-obj://workspace-{ws}-files/{fileId}`) before forwarding to the
    // backend as `videoSourceForExtension`.
    sourceVideoNodeId?: string
}

type SendAiRequestHandler = (data: AiInteractionChatSendMessagePayload & { aiModels?: string[]; imageOptions?: ImageOptions; videoOptions?: VideoOptions }) => void
type StopAiRequestHandler = (data: AiInteractionChatStopMessagePayload) => void
type PlaceholderOptions = { titlePlaceholder: string; paragraphPlaceholder: string }
type ImageSegmentType = 'image_partial' | 'image_complete' | 'image_branch_resolved' | 'image_branch_resolution_error' | 'image_generation_trace'
type VideoSegmentType = 'video_pending' | 'video_generating' | 'video_complete' | 'video_error' | 'video_generation_trace'
type CollapsibleSegmentType = 'collapsible_start' | 'collapsible_end'
type WorkspaceContextSegmentType = 'context_relevance_resolved' | 'context_relevance_error'
type SegmentEvent = {
    status?: StreamStatus
    type?: ImageSegmentType | VideoSegmentType | CollapsibleSegmentType | WorkspaceContextSegmentType
    aiProvider?: string
    imageModelProvider?: string
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
} & GeneratedRunAttrs

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
} & GeneratedRunAttrs

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

function getReasoningRunKey(generationRun?: MediaGenerationRunMeta): string {
    return generationRun?.reasoningRunId || 'legacy'
}

function getReasoningOnlyGenerationRun(generationRun?: MediaGenerationRunMeta): MediaGenerationRunMeta | undefined {
    if (!generationRun) return undefined

    return {
        generationRequestId: generationRun.generationRequestId,
        reasoningRunId: generationRun.reasoningRunId,
        reasoningModelId: generationRun.reasoningModelId,
        reasoningIndex: generationRun.reasoningIndex,
    }
}

function getReasoningModelProvider(modelId: string): string | undefined {
    const [provider] = modelId.split(':')
    return provider || undefined
}

function getThreadScopedRunKey(threadId: string, generationRun?: MediaGenerationRunMeta): string {
    return `${threadId}:${getReasoningRunKey(generationRun)}`
}

type ResponseContext = {
    responseNode: ProseMirrorNode
    responseStartPos: number
    responseEndPos: number
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
const AI_GENERATED_IMAGE_THUMBNAIL_WIDTH = '112px'
const AI_GENERATED_IMAGE_THUMBNAIL_ALIGNMENT: AiGeneratedImageAlignment = 'right'
const AI_GENERATED_IMAGE_THUMBNAIL_TEXT_WRAP: AiGeneratedImageTextWrap = 'none'

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

        // Find thread node - prefer explicit position, fallback to selection
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
        if (!generationRun?.reasoningRunId) return true
        return attrs?.reasoningRunId === generationRun.reasoningRunId
    }

    static collapsibleMatchesGenerationRun(attrs: Record<string, any>, generationRun?: MediaGenerationRunMeta): boolean {
        if (!generationRun?.reasoningRunId) return true
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

    // The content target for a run. A multi-model run (with a reasoningRunId)
    // streams into its per-reasoning-run aiReasoningSection inside the single
    // shared response message; a legacy text/single-model run streams into the
    // aiResponseMessage itself. Callers (streaming, collapsible, media placement)
    // insert at endOfNodePos, so this resolves to whichever node owns the content.
    static findResponseNode(state: EditorState, threadId?: string, generationRun?: MediaGenerationRunMeta): {
        found: boolean
        endOfNodePos?: number
        childCount?: number
        nodePos?: number
    } {
        const targetType = generationRun?.reasoningRunId ? aiReasoningSectionNodeType : aiResponseMessageNodeType
        let bestEndPos: number | undefined
        let bestChildCount: number | undefined
        let bestNodePos: number | undefined
        let bestScore = -1 // 2: isReceiving, 1: isInitialRender, 0: any response

        const scoreNode = (attrs: any) =>
            attrs?.isReceivingAnimation ? 2 : (attrs?.isInitialRenderAnimation ? 1 : 0)

        if (threadId) {
            // Search within specific thread only - no fallback
            state.doc.descendants((node: ProseMirrorNode, pos: number) => {
                if (node.type.name !== aiChatThreadNodeType || node.attrs?.threadId !== threadId) return

                node.descendants((child: ProseMirrorNode, relPos: number) => {
                    if (child.type.name !== targetType) return
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
            ? { found: true, endOfNodePos: bestEndPos, childCount: bestChildCount, nodePos: bestNodePos }
            : { found: false }
    }

    // Find the single shared response message for a request group (one user prompt
    // → one aiResponseMessage), used to host one aiReasoningSection per model.
    static findResponseMessage(state: EditorState, threadId?: string, generationRun?: MediaGenerationRunMeta): {
        found: boolean
        nodePos?: number
        contentEndPos?: number
    } {
        let bestNodePos: number | undefined
        let bestContentEnd: number | undefined
        const requestId = generationRun?.generationRequestId

        if (threadId) {
            state.doc.descendants((node: ProseMirrorNode, pos: number) => {
                if (node.type.name !== aiChatThreadNodeType || node.attrs?.threadId !== threadId) return

                node.descendants((child: ProseMirrorNode, relPos: number) => {
                    if (child.type.name !== aiResponseMessageNodeType) return
                    if (requestId && child.attrs?.generationRequestId !== requestId) return

                    const nodePos = pos + relPos + 1
                    // Prefer the latest matching message
                    if (bestNodePos === undefined || nodePos > bestNodePos) {
                        bestNodePos = nodePos
                        bestContentEnd = nodePos + child.nodeSize - 1
                    }
                })
                return false
            })
        }

        return bestNodePos !== undefined
            ? { found: true, nodePos: bestNodePos, contentEndPos: bestContentEnd }
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
    private unsubscribeFromSegments: (() => void) | null = null

    constructor({
        sendAiRequestHandler,
        stopAiRequestHandler,
        placeholders,
        onReceivingStateChange
    }: {
        sendAiRequestHandler: SendAiRequestHandler
        stopAiRequestHandler: StopAiRequestHandler
        placeholders: PlaceholderOptions
        onReceivingStateChange?: (threadId: string, receiving: boolean) => void
    }) {
        this.sendAiRequestHandler = sendAiRequestHandler
        this.stopAiRequestHandler = stopAiRequestHandler
        this.placeholderOptions = placeholders
        this.onReceivingStateChange = onReceivingStateChange ?? null
    }

    // ========== STREAMING MANAGEMENT ==========

    private getCurrentResponseContext(state: EditorState, threadId: string, generationRun?: MediaGenerationRunMeta): ResponseContext | null {
        const responseNodeInfo = PositionFinder.findResponseNode(state, threadId, generationRun)
        if (!responseNodeInfo.found || responseNodeInfo.endOfNodePos === undefined) return null

        const $endPos = state.doc.resolve(responseNodeInfo.endOfNodePos)
        const responseNode = $endPos.nodeBefore
        // The content owner is the per-run section (matrix) or the message (legacy);
        // generated media lands inside it, keeping each run's media to its own section.
        if (!responseNode || (responseNode.type.name !== aiResponseMessageNodeType && responseNode.type.name !== aiReasoningSectionNodeType)) return null

        return {
            responseNode,
            responseStartPos: responseNodeInfo.endOfNodePos - responseNode.nodeSize,
            responseEndPos: responseNodeInfo.endOfNodePos,
        }
    }

    private findGeneratedImageInResponse(
        responseContext: ResponseContext,
        options: {
            partialIndex?: number
            fileId?: string
            responseId?: string
            mediaRunId?: string
            partialOnly?: boolean
            fallbackToLastPartial?: boolean
        }
    ): ResponseImageNodeInfo | null {
        let matchedImage: ResponseImageNodeInfo | null = null
        let latestPartialImage: ResponseImageNodeInfo | null = null

        responseContext.responseNode.forEach((child: ProseMirrorNode, offset: number) => {
            if (child.type.name !== aiGeneratedImageNodeType) return
            if (options.partialOnly && !child.attrs.isPartial) return
            if (options.mediaRunId && child.attrs.mediaRunId !== options.mediaRunId) return

            const nodeInfo = {
                node: child,
                nodePos: responseContext.responseStartPos + 1 + offset,
            }

            if (child.attrs.isPartial) {
                latestPartialImage = nodeInfo
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

        return matchedImage ?? (options.fallbackToLastPartial ? latestPartialImage : null)
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
            : AI_GENERATED_IMAGE_THUMBNAIL_ALIGNMENT
        const previousTextWrap = previousAttrs.textWrap
        const textWrap = previousTextWrap === 'left' || previousTextWrap === 'right' || previousTextWrap === 'none'
            ? previousTextWrap
            : AI_GENERATED_IMAGE_THUMBNAIL_TEXT_WRAP

        return {
            imageData: event.imageUrl || previousAttrs.imageData || '',
            fileId: event.fileId || previousAttrs.fileId || '',
            workspaceId: event.workspaceId || previousAttrs.workspaceId || '',
            revisedPrompt: event.revisedPrompt || previousAttrs.revisedPrompt || '',
            responseId: event.responseId || previousAttrs.responseId || '',
            aiModel: event.aiProvider || previousAttrs.aiModel || '',
            isPartial,
            partialIndex,
            width: previousAttrs.width || AI_GENERATED_IMAGE_THUMBNAIL_WIDTH,
            alignment,
            textWrap,
            ...buildGeneratedRunAttrs(event.generationRun, previousAttrs),
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
            fallbackToLastPartial: true,
        })
        const imageAttrs = this.buildGeneratedImageAttrs(event, true, partialIndex, existingImage?.node.attrs)
        const tr = state.tr

        if (existingImage) {
            tr.setNodeMarkup(existingImage.nodePos, undefined, imageAttrs)
        } else {
            tr.insert(responseContext.responseEndPos - 1, imageNodeType.create(imageAttrs))
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

        const responseMessageId = responseContext.responseNode.attrs.id || ''
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
            fallbackToLastPartial: true,
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
            : AI_GENERATED_IMAGE_THUMBNAIL_ALIGNMENT
        const previousTextWrap = previousAttrs.textWrap
        const textWrap = previousTextWrap === 'left' || previousTextWrap === 'right' || previousTextWrap === 'none'
            ? previousTextWrap
            : AI_GENERATED_IMAGE_THUMBNAIL_TEXT_WRAP

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
            width: previousAttrs.width || AI_GENERATED_IMAGE_THUMBNAIL_WIDTH,
            alignment,
            textWrap,
            ...buildGeneratedRunAttrs(event.generationRun, previousAttrs),
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

        if (existingVideo) {
            tr.setNodeMarkup(existingVideo.nodePos, undefined, videoAttrs)
        } else {
            tr.insert(responseContext.responseEndPos - 1, videoNodeType.create(videoAttrs))
        }

        if (tr.docChanged) {
            tr.setMeta('skipDispatch', true)
            dispatch(tr)
        }

        return responseContext.responseNode.attrs.id || ''
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

        if (existingVideo) {
            tr.setNodeMarkup(existingVideo.nodePos, undefined, videoAttrs)
        } else {
            tr.insert(responseContext.responseEndPos - 1, videoNodeType.create(videoAttrs))
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
                const callbacks = getAiGeneratedImageCallbacks()
                if (effectiveThreadId && event.imageBranchResolution) {
                    callbacks.onImageBranchResolvedToCanvas?.({
                        threadId: effectiveThreadId,
                        resolution: event.imageBranchResolution,
                        generationRun: event.generationRun,
                    })
                }
                return
            }

            if (type === 'context_relevance_resolved') {
                this.ensureReceivingResponseNode(state, dispatch, aiProvider, effectiveThreadId, event.generationRun)
                const callbacks = getAiGeneratedImageCallbacks()
                if (effectiveThreadId && event.workspaceContextResolution) {
                    callbacks.onWorkspaceContextResolvedToCanvas?.({
                        threadId: effectiveThreadId,
                        resolution: event.workspaceContextResolution,
                        generationRun: event.generationRun,
                    })
                }
                return
            }

            if (type === 'context_relevance_error') {
                return
            }

            if (type === 'image_branch_resolution_error') {
                const callbacks = getAiGeneratedImageCallbacks()
                if (effectiveThreadId) {
                    callbacks.onImageBranchResolutionErrorToCanvas?.({
                        threadId: effectiveThreadId,
                        error: event.error || 'Image branch resolution failed',
                        generationRun: event.generationRun,
                    })
                    callbacks.onImageErrorToCanvas?.({
                        threadId: effectiveThreadId,
                        error: event.error || 'Image branch resolution failed',
                        generationRun: event.generationRun,
                    })
                }
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

    private handleImagePartial(view: EditorView, event: SegmentEvent): void {
        try {
            const { imageUrl, fileId, workspaceId, partialIndex, aiChatThreadId, aiProvider } = event
            if (!aiChatThreadId) return

            const { state } = view
            const threadInfo = PositionFinder.findThreadInsertionPoint(state, aiChatThreadId)

            // Only process events for threads that exist in THIS document
            if (!threadInfo) return

            this.upsertImagePartialInChat(view, event)

            // Delegate to canvas-side handler so the same generation appears on the canvas.
            const callbacks = getAiGeneratedImageCallbacks()
            callbacks.onImagePartialToCanvas?.({
                threadId: aiChatThreadId,
                imageUrl: imageUrl || '',
                fileId: fileId || '',
                workspaceId: workspaceId || '',
                partialIndex: partialIndex || 0,
                aiProvider: aiProvider || '',
                generationRun: event.generationRun,
            })
        } catch (error) {
            console.error('[aiChatThreadPlugin] handleImagePartial failed', { event }, error)
        }
    }

    private handleImageComplete(view: EditorView, event: SegmentEvent): void {
        const { imageUrl, fileId, workspaceId, responseId, revisedPrompt, aiChatThreadId, aiProvider, imageModelProvider } = event
        if (!imageUrl || !aiChatThreadId) return

        const { state } = view

        // Only process events for threads that exist in THIS document
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, aiChatThreadId)
        if (!threadInfo) return

        const responseMessageId = this.upsertImageCompleteInChat(view, event)

        // Delegate image placement to the canvas
        const callbacks = getAiGeneratedImageCallbacks()
        callbacks.onImageCompleteToCanvas?.({
            threadId: aiChatThreadId,
            imageUrl,
            fileId: fileId || '',
            workspaceId: workspaceId || '',
            responseId: responseId || '',
            revisedPrompt: revisedPrompt || '',
            aiModel: aiProvider || '',
            imageModelProvider: imageModelProvider || '',
            responseMessageId,
            generationRun: event.generationRun,
        })
    }

    // Video segment handlers. Chat history gets a compact aiGeneratedVideo node
    // keyed by mediaRunId, while the canvas owns the full-size generated output.
    private handleVideoPending(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId, aiProvider } = event
        if (!aiChatThreadId) return
        this.upsertVideoPendingInChat(view, event)
        const callbacks = getAiGeneratedVideoCallbacks()
        callbacks.onVideoPendingToCanvas?.({
            threadId: aiChatThreadId,
            aiProvider: aiProvider || '',
            generationRun: event.generationRun,
        })
    }

    private handleVideoGenerating(_view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId, aiProvider } = event
        if (!aiChatThreadId) return
        const callbacks = getAiGeneratedVideoCallbacks()
        callbacks.onVideoGeneratingToCanvas?.({
            threadId: aiChatThreadId,
            aiProvider: aiProvider || '',
            generationRun: event.generationRun,
        })
    }

    private handleVideoComplete(view: EditorView, event: SegmentEvent): void {
        const {
            aiChatThreadId,
            videoUrl,
            fileId,
            workspaceId,
            posterUrl,
            posterFileId,
            frameUrl,
            frameFileId,
            durationSeconds,
            aspectRatio,
            hasAudio,
            responseId,
            revisedPrompt,
            videoModel,
            videoModelProvider,
        } = event
        if (!aiChatThreadId || !videoUrl) return
        const responseMessageId = this.upsertVideoCompleteInChat(view, event)
        const callbacks = getAiGeneratedVideoCallbacks()
        callbacks.onVideoCompleteToCanvas?.({
            threadId: aiChatThreadId,
            videoUrl,
            fileId: fileId || '',
            workspaceId: workspaceId || '',
            posterUrl: posterUrl || '',
            posterFileId: posterFileId || '',
            frameUrl: frameUrl || '',
            frameFileId: frameFileId || '',
            durationSeconds: durationSeconds || 0,
            aspectRatio: aspectRatio || 1.777,
            hasAudio: hasAudio ?? true,
            responseId: responseId || '',
            revisedPrompt: revisedPrompt || '',
            videoModel: videoModel || '',
            videoModelProvider: videoModelProvider || '',
            responseMessageId,
            generationRun: event.generationRun,
        })
    }

    private handleVideoError(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId, error } = event
        if (!aiChatThreadId) return
        this.upsertVideoErrorInChat(view, event)
        const callbacks = getAiGeneratedVideoCallbacks()
        callbacks.onVideoErrorToCanvas?.({
            threadId: aiChatThreadId,
            error: error || 'Video generation failed',
            generationRun: event.generationRun,
        })
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

        if (collapsibleInfo.found && collapsibleInfo.nodePos !== undefined) {
            const collapsibleNode = state.doc.nodeAt(collapsibleInfo.nodePos)
            if (collapsibleNode?.type.name === aiCollapsibleBlockNodeType) {
                tr.setNodeMarkup(collapsibleInfo.nodePos, undefined, {
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
            tr.insert(responseInfo.endOfNodePos - 1, collapsibleNode)
        }

        if (tr.docChanged) {
            tr.setMeta('skipDispatch', true)
            dispatch(tr)
        }
    }

    private handleVideoGenerationTrace(view: EditorView, event: SegmentEvent): void {
        const { aiChatThreadId: threadId, videoGenerationTrace } = event
        if (!threadId || !videoGenerationTrace) return
        getAiGeneratedVideoCallbacks().onVideoGenerationTraceToCanvas?.({
            threadId,
            generationRun: event.generationRun,
        })
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
        getAiGeneratedImageCallbacks().onImageGenerationTraceToCanvas?.({
            threadId,
            generationRun: event.generationRun,
        })
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
                if (!sectionNode.attrs.isReceivingAnimation) {
                    tr.setNodeMarkup(sectionInfo.nodePos, undefined, { ...sectionNode.attrs, isReceivingAnimation: true })
                }
                if (threadId) tr.setMeta('setReceiving', { threadId, receiving: true, runKey: getReasoningRunKey(generationRun) })
                if (tr.docChanged || threadId) {
                    tr.setMeta('skipDispatch', true)
                    dispatch(tr)
                }
                return
            }
        }

        const sectionNode = state.schema.nodes[aiReasoningSectionNodeType].create({
            generationRequestId: generationRun.generationRequestId || '',
            reasoningRunId: generationRun.reasoningRunId || '',
            reasoningModelId: generationRun.reasoningModelId || '',
            reasoningIndex: generationRun.reasoningIndex ?? null,
            isReceivingAnimation: true,
        })

        const messageInfo = PositionFinder.findResponseMessage(state, threadId, generationRun)
        const tr = state.tr
        if (messageInfo.found && messageInfo.contentEndPos !== undefined) {
            tr.insert(messageInfo.contentEndPos, sectionNode)
        } else {
            const responseMessageId = `resp-${generationRun.generationRequestId || Date.now()}`
            const aiResponseNode = state.schema.nodes[aiResponseMessageNodeType].create({
                id: responseMessageId,
                isInitialRenderAnimation: true,
                isReceivingAnimation: true,
                aiProvider,
                generationRequestId: generationRun.generationRequestId || '',
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
        if (generationRun?.reasoningRunId) {
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
                // Fallback to response node if collapsible not found
                targetInfo = PositionFinder.findResponseNode(state, threadId, reasoningGenerationRun)
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
            if (generationRun?.reasoningRunId) {
                const sectionNode = state.schema.nodes[aiReasoningSectionNodeType].create({
                    generationRequestId: generationRun.generationRequestId || '',
                    reasoningRunId: generationRun.reasoningRunId || '',
                    reasoningModelId: generationRun.reasoningModelId || '',
                    reasoningIndex: generationRun.reasoningIndex ?? null,
                    isReceivingAnimation: true,
                })
                const messageInfo = PositionFinder.findResponseMessage(state, threadId, generationRun)
                if (messageInfo.found && messageInfo.contentEndPos !== undefined) {
                    tr.insert(messageInfo.contentEndPos, sectionNode)
                    targetInfo = { found: true, endOfNodePos: messageInfo.contentEndPos + sectionNode.nodeSize, childCount: 0 }
                } else {
                    const responseNode = state.schema.nodes[aiResponseMessageNodeType].create({
                        id: `resp-${generationRun.generationRequestId || Date.now()}`,
                        isInitialRenderAnimation: true,
                        isReceivingAnimation: true,
                        aiProvider: aiProvider || 'Anthropic',
                        generationRequestId: generationRun.generationRequestId || '',
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
        // the message itself for legacy runs; clear the receiving flag on whichever.
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

    private createResponseFallback(state: EditorState, dispatch: (tr: Transaction) => void, threadId?: string, aiProvider?: string): void {
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) return

        const { insertPos } = threadInfo
        const responseNode = state.schema.nodes[aiResponseMessageNodeType].create({
            isInitialRenderAnimation: true,
            isReceivingAnimation: true,
            aiProvider: aiProvider || 'Anthropic'
        })

        dispatch(state.tr.insert(insertPos, responseNode).setMeta('skipDispatch', true))
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
    ): Transaction | null {
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) return null

        const existingReceiving = PositionFinder.findUnassignedReceivingResponseNode(state, threadId)
        if (existingReceiving.found) return null

        const responseNodeType = state.schema.nodes[aiResponseMessageNodeType]
        if (!responseNodeType) return null

        const placeholderModelIds = reasoningModelIds.length > 0 ? reasoningModelIds : ['']
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

        // Find thread: prefer explicit position from button, fallback to selection
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
            aiVideoModel = '',
            aiVideoModels = '',
            videoAspectRatio = '',
            videoResolution = '',
            videoDuration = '',
            sourceVideoNodeId = ''
        } = threadNode.attrs
        const threadId = threadIdFromMeta || threadIdFromNode

        const legacyUseMultipleModels = useMultipleModels === true || useMultipleModels === 'true'
        const rawReasoningModelsEnabled = useMultipleReasoningModels === true
            || useMultipleReasoningModels === 'true'
        const rawImageModelsEnabled = useMultipleImageModels === true
            || useMultipleImageModels === 'true'
        const rawVideoModelsEnabled = useMultipleVideoModels === true
            || useMultipleVideoModels === 'true'
        const hasSectionModelMode = rawReasoningModelsEnabled || rawImageModelsEnabled || rawVideoModelsEnabled
        const useLegacyModeFallback = legacyUseMultipleModels && !hasSectionModelMode
        const reasoningModelsEnabled = rawReasoningModelsEnabled || useLegacyModeFallback
        const imageModelsEnabled = rawImageModelsEnabled || useLegacyModeFallback
        const videoModelsEnabled = rawVideoModelsEnabled || useLegacyModeFallback
        const rawReasoningModelIds = parseAiModelSelectionAttr(aiModels)
        const rawImageModelIds = parseAiModelSelectionAttr(aiImageModels)
        const rawVideoModelIds = parseAiModelSelectionAttr(aiVideoModels)
        const effectiveAiModel = aiModel || rawReasoningModelIds[0] || ''
        const effectiveImageModel = aiImageModel || rawImageModelIds[0] || ''
        const effectiveVideoModel = aiVideoModel || rawVideoModelIds[0] || ''
        const reasoningModelIds = reasoningModelsEnabled
            ? (rawReasoningModelIds.length > 0 ? rawReasoningModelIds : effectiveAiModel ? [effectiveAiModel] : [])
            : []
        const imageModelIds = imageModelsEnabled
            ? (rawImageModelIds.length > 0 ? rawImageModelIds : effectiveImageModel ? [effectiveImageModel] : [])
            : []
        const videoModelIds = videoModelsEnabled
            ? (rawVideoModelIds.length > 0 ? rawVideoModelIds : effectiveVideoModel ? [effectiveVideoModel] : [])
            : []

        // Validate AI model selected
        if (!effectiveAiModel) {
            alert('Please select an AI model from the dropdown before submitting.')
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
            imageGenerationSize
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
            ...(sourceVideoNodeId ? { sourceVideoNodeId } : {})
        } : undefined

        const requestPayload = {
            messages,
            aiModel: effectiveAiModel,
            aiModels: reasoningModelIds,
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
                        const { threadId, receiving, runKey = 'legacy' } = receivingMeta
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
                        const { threadId, active, runKey = 'legacy' } = collapsibleMeta
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
                // Strip legacy aiUserInput nodes from threads if present (data migration)
                const paragraphType = newState.schema.nodes.paragraph
                if (paragraphType) {
                    let tr: Transaction | null = null
                    newState.doc.descendants((node: ProseMirrorNode, pos: number) => {
                        if (node.type.name !== aiChatThreadNodeType) return

                        // Remove any aiUserInput children (legacy content)
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
                this.startStreaming(view)

                // Note: Dropdown state bridging removed - now handled by dropdown primitive plugin

                return {
                    destroy: () => {
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
                        aiUserMessageNodeView(node, view, getPos),
                    [aiCollapsibleBlockNodeType]: (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) =>
                        aiCollapsibleBlockNodeView(node, view, getPos),
                    [aiReasoningSectionNodeType]: (node: ProseMirrorNode) =>
                        aiReasoningSectionNodeView(node),
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
    onReceivingStateChange
}: {
    sendAiRequestHandler: SendAiRequestHandler
    stopAiRequestHandler: StopAiRequestHandler
    placeholders: PlaceholderOptions
    imageCallbacks?: AiGeneratedImageCallbacks
    videoCallbacks?: AiGeneratedVideoCallbacks
    onReceivingStateChange?: (threadId: string, receiving: boolean) => void
}): Plugin {
    // Set image generation callbacks if provided
    if (imageCallbacks) {
        setAiGeneratedImageCallbacks(imageCallbacks)
    }

    // Set video generation callbacks if provided (mirror image callback wiring).
    if (videoCallbacks) {
        setAiGeneratedVideoCallbacks(videoCallbacks)
    }

    const pluginInstance = new AiChatThreadPluginClass({ sendAiRequestHandler, stopAiRequestHandler, placeholders, onReceivingStateChange })
    return pluginInstance.create()
}
