// AI Chat Thread Plugin - Modular Architecture
// This plugin consolidates AI chat functionality for ProseMirror:
// - Keyboard triggers (Mod+Enter)
// - Content extraction from chat threads
// - AI response streaming and insertion
// - Thread NodeViews with controls
// - Placeholder decorations

import { Plugin, PluginKey, EditorState, Transaction } from 'prosemirror-state'
import { Selection } from 'prosemirror-state'
import { TextSelection } from 'prosemirror-state'
import { Fragment, Slice } from 'prosemirror-model'
import { EditorView, Decoration, DecorationSet, NodeView } from 'prosemirror-view'
import { Node as ProseMirrorNode, Schema as ProseMirrorSchema } from 'prosemirror-model'
import { documentTitleNodeType } from '$src/components/proseMirror/customNodes/documentTitleNode.js'
import { aiChatThreadNodeType, aiChatThreadNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadNode.ts'
import { AI_CHAT_THREAD_PLUGIN_KEY, USE_AI_CHAT_META, STOP_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import { aiResponseMessageNodeType, aiResponseMessageNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiResponseMessageNode.ts'
import { aiUserInputNodeType, aiUserInputNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserInputNode.ts'
import { aiUserMessageNodeType, aiUserMessageNodeView } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.js'
import { documentStore } from '$src/stores/documentStore.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import type { AiModelId } from '@lixpi/constants'

import { setAiGeneratedImageCallbacks, type AiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'

import { dispatchSendAiChatFromUserInput } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadSend.ts'
import { findUserInputInThread } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPositionUtils.ts'

const IS_RECEIVING_TEMP_DEBUG_STATE = false    // For debug purposes only

// ========== TYPE DEFINITIONS ==========

import type { AiInteractionChatSendMessagePayload, AiInteractionChatStopMessagePayload, ImageGenerationSize } from '@lixpi/constants'

type ImageOptions = {
    imageGenerationEnabled: boolean
    imageGenerationSize: ImageGenerationSize
    previousResponseId?: string
}

type SendAiRequestHandler = (data: AiInteractionChatSendMessagePayload & { imageOptions?: ImageOptions }) => void
type StopAiRequestHandler = (data: AiInteractionChatStopMessagePayload) => void
type PlaceholderOptions = { titlePlaceholder: string; paragraphPlaceholder: string }
type StreamStatus = 'START_STREAM' | 'STREAMING' | 'END_STREAM'
type ImageSegmentType = 'image_partial' | 'image_complete'
type SegmentEvent = {
    status?: StreamStatus
    type?: ImageSegmentType
    aiProvider?: string
    threadId?: string
    aiChatThreadId?: string
    segment?: {
        segment: string
        styles: string[]
        type: string
        level?: number
        isBlockDefining: boolean
    }
    imageUrl?: string
    fileId?: string
    partialIndex?: number
    responseId?: string
    revisedPrompt?: string
}
type ThreadContent = { nodeType: string; textContent: string }
type AiChatThreadPluginState = {
    receivingThreadIds: Set<string>
    insideBackticks: boolean
    backtickBuffer: string
    insideCodeBlock: boolean
    codeBuffer: string
    decorations: DecorationSet
    // Note: dropdownStates removed - now handled by dropdown primitive plugin
}

// ========== CONSTANTS ==========

const PLUGIN_KEY = AI_CHAT_THREAD_PLUGIN_KEY as PluginKey<AiChatThreadPluginState>
const INSERT_THREAD_META = `insert:${aiChatThreadNodeType}`

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

        // Extract only conversation messages (ignore the user input composer)
        const content: ThreadContent[] = []
        thread.forEach((block: ProseMirrorNode) => {
            if (block.type.name !== aiUserMessageNodeType && block.type.name !== aiResponseMessageNodeType) {
                return
            }

            const textContent = ContentExtractor.collectFormattedText(block)
            if (!textContent) return

            content.push({ nodeType: block.type.name, textContent })
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

                    const textContent = ContentExtractor.collectFormattedText(block)

                    if (textContent) {
                        allThreadsContent.push({
                            nodeType: block.type.name,
                            textContent
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

                    const textContent = ContentExtractor.collectFormattedText(block)

                    if (textContent) {
                        selectedContent.push({
                            nodeType: block.type.name,
                            textContent
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

    // Transform thread content into AI message format (merges consecutive same-role messages)
    static toMessages(items: ThreadContent[]): Array<{ role: string; content: string }> {
        const messages: Array<{ role: string; content: string }> = []

        items.forEach(item => {
            const role = item.nodeType === aiResponseMessageNodeType ? 'assistant' : 'user'
            const lastMessage = messages[messages.length - 1]

            // Merge consecutive same-role messages
            if (lastMessage?.role === role) {
                lastMessage.content += '\n' + item.textContent
            } else {
                messages.push({ role, content: item.textContent })
            }
        })

        return messages
    }
}

// Document position and insertion utilities
class PositionFinder {
    // Find where to insert aiResponseMessage in the active thread
    static findThreadInsertionPoint(state: EditorState, threadId?: string): {
        insertPos: number
    } | null {
        let result: { insertPos: number } | null = null

        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name !== aiChatThreadNodeType) return

            // If threadId specified, only match that thread
            if (threadId && node.attrs?.threadId !== threadId) return

            const inputInfo = findUserInputInThread(state, pos, node)
            result = { insertPos: inputInfo?.inputPos ?? (pos + node.nodeSize - 1) }
            return false // Stop searching
        })

        return result
    }

    // Find the current aiResponseMessage being streamed into for a specific thread
    static findResponseNode(state: EditorState, threadId?: string): {
        found: boolean
        endOfNodePos?: number
        childCount?: number
    } {
        let bestEndPos: number | undefined
        let bestChildCount: number | undefined
        let bestScore = -1 // 2: isReceiving, 1: isInitialRender, 0: any response

        const scoreNode = (attrs: any) =>
            attrs?.isReceivingAnimation ? 2 : (attrs?.isInitialRenderAnimation ? 1 : 0)

        if (threadId) {
            // Search within specific thread
            state.doc.descendants((node: ProseMirrorNode, pos: number) => {
                if (node.type.name !== aiChatThreadNodeType || node.attrs?.threadId !== threadId) return

                node.descendants((child: ProseMirrorNode, relPos: number) => {
                    if (child.type.name !== aiResponseMessageNodeType) return

                    const endPos = pos + relPos + 1 + child.nodeSize
                    const score = scoreNode(child.attrs)

                    if (score > bestScore || (score === bestScore && endPos > (bestEndPos || 0))) {
                        bestScore = score
                        bestEndPos = endPos
                        bestChildCount = child.childCount
                    }
                })
                return false // Stop after finding thread
            })
        } else {
            // Search globally
            state.doc.descendants((node: ProseMirrorNode, pos: number) => {
                if (node.type.name !== aiResponseMessageNodeType) return

                const endPos = pos + node.nodeSize
                const score = scoreNode(node.attrs)

                if (score > bestScore || (score === bestScore && endPos > (bestEndPos || 0))) {
                    bestScore = score
                    bestEndPos = endPos
                    bestChildCount = node.childCount
                }
            })
        }

        return bestEndPos !== undefined
            ? { found: true, endOfNodePos: bestEndPos, childCount: bestChildCount }
            : { found: false }
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
    private unsubscribeFromSegments: (() => void) | null = null

    constructor({
        sendAiRequestHandler,
        stopAiRequestHandler,
        placeholders
    }: {
        sendAiRequestHandler: SendAiRequestHandler
        stopAiRequestHandler: StopAiRequestHandler
        placeholders: PlaceholderOptions
    }) {
        this.sendAiRequestHandler = sendAiRequestHandler
        this.stopAiRequestHandler = stopAiRequestHandler
        this.placeholderOptions = placeholders
    }

    // ========== STREAMING MANAGEMENT ==========

    private startStreaming(view: EditorView): void {
        this.unsubscribeFromSegments = SegmentsReceiver.subscribeToeceiveSegment((event: SegmentEvent) => {
            const { status, type, aiProvider, segment, threadId, aiChatThreadId } = event
            const effectiveThreadId = threadId || aiChatThreadId
            const { state, dispatch } = view

            // Handle image generation events
            if (type === 'image_partial') {
                this.handleImagePartial(view, event)
                return
            }

            if (type === 'image_complete') {
                this.handleImageComplete(view, event)
                return
            }

            // Handle text streaming events
            switch (status) {
                case 'START_STREAM':
                    console.log('🔴 [PLUGIN] START_STREAM', { effectiveThreadId, aiProvider })
                    this.handleStreamStart(state, dispatch, aiProvider, effectiveThreadId)
                    break
                case 'STREAMING':
                    if (segment) this.handleStreaming(state, dispatch, segment, effectiveThreadId, aiProvider)
                    break
                case 'END_STREAM':
                    console.log('🟢 [PLUGIN] END_STREAM', { effectiveThreadId })
                    this.handleStreamEnd(state, dispatch, effectiveThreadId)
                    break
            }
        })
    }

    private handleImagePartial(view: EditorView, event: SegmentEvent): void {
        const { imageUrl, fileId, partialIndex, aiChatThreadId, aiProvider } = event
        console.log('🖼️ [PLUGIN] handleImagePartial called:', { imageUrl, fileId, partialIndex, aiChatThreadId })
        if (!imageUrl || !aiChatThreadId) {
            console.log('🖼️ [PLUGIN] handleImagePartial: missing imageUrl or aiChatThreadId, returning')
            return
        }

        const { state, dispatch } = view
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, aiChatThreadId)
        if (!threadInfo) {
            console.log('🖼️ [PLUGIN] handleImagePartial: no threadInfo found for', aiChatThreadId)
            return
        }
        console.log('🖼️ [PLUGIN] handleImagePartial: threadInfo found:', threadInfo)

        // Check if we already have a partial image node being updated
        let existingImagePos: number | null = null
        let existingImageNode: ProseMirrorNode | null = null

        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name === 'image' && node.attrs.isPartial) {
                // Check if this image is in the correct thread
                const $pos = state.doc.resolve(pos)
                // If nested, we walk up to find the thread
                for (let depth = $pos.depth; depth > 0; depth--) {
                    const parentNode = $pos.node(depth)
                    if (parentNode.type.name === aiChatThreadNodeType) {
                        if (parentNode.attrs.threadId === aiChatThreadId) {
                            existingImagePos = pos
                            existingImageNode = node
                        }
                        break
                    }
                }
            }
            return existingImagePos === null
        })

        let tr = state.tr

        if (existingImagePos !== null && existingImageNode) {
            console.log('🖼️ [PLUGIN] handleImagePartial: updating existing image node at pos', existingImagePos)
            // Update existing partial image node
            tr.setNodeMarkup(existingImagePos, null, {
                ...existingImageNode.attrs,
                src: imageUrl,
                fileId: fileId || null,
            })
        } else {
            console.log('🖼️ [PLUGIN] handleImagePartial: creating NEW image node')

            // Try to find a target AI response message in the thread
            const responseNodeInfo = PositionFinder.findResponseNode(state, aiChatThreadId)
            // Use standard image node with AI-related attrs
            const imageNode = state.schema.nodes.image.create({
                src: imageUrl,
                fileId: fileId || null,
                isPartial: true,
            })

            if (responseNodeInfo.found && responseNodeInfo.endOfNodePos) {
                 console.log('🖼️ [PLUGIN] handleImagePartial: inserting into existing response node')
                 const insertionPos = responseNodeInfo.endOfNodePos - 1
                 tr.insert(insertionPos, imageNode)
            } else {
                 console.log('🖼️ [PLUGIN] handleImagePartial: creating NEW response node with image')
                 // Create new response node wrapping the image
                 const responseNode = state.schema.nodes[aiResponseMessageNodeType].create(
                     { aiProvider: aiProvider || 'OpenAI' },
                     [imageNode]
                 )
                 tr.insert(threadInfo.insertPos, responseNode)
            }
        }

        if (tr.docChanged) {
            console.log('🖼️ [PLUGIN] handleImagePartial: dispatching transaction')
            dispatch(tr)
        } else {
            console.log('🖼️ [PLUGIN] handleImagePartial: doc NOT changed, skipping dispatch')
        }
    }

    private handleImageComplete(view: EditorView, event: SegmentEvent): void {
        const { imageUrl, fileId, responseId, revisedPrompt, aiChatThreadId, aiProvider } = event
        console.log('🖼️ [PLUGIN] handleImageComplete called:', { imageUrl, fileId, responseId, aiChatThreadId })
        if (!imageUrl || !aiChatThreadId) return

        const { state, dispatch } = view

        // Find existing partial image node in this thread
        let existingImagePos: number | null = null
        let existingImageNode: ProseMirrorNode | null = null

        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name === 'image' && node.attrs.isPartial) {
                const $pos = state.doc.resolve(pos)
                for (let depth = $pos.depth; depth > 0; depth--) {
                    const parentNode = $pos.node(depth)
                    if (parentNode.type.name === aiChatThreadNodeType) {
                        if (parentNode.attrs.threadId === aiChatThreadId) {
                            existingImagePos = pos
                            existingImageNode = node
                        }
                        break
                    }
                }
            }
            return existingImagePos === null
        })

        let tr = state.tr

        if (existingImagePos !== null && existingImageNode) {
            // Update existing node to complete state
            const mappedPos = tr.mapping.map(existingImagePos)
            tr.setNodeMarkup(mappedPos, null, {
                src: imageUrl,
                fileId: fileId || null,
                revisedPrompt: revisedPrompt || null,
                responseId: responseId || null,
                aiModel: aiProvider || null,
                isPartial: false,
            })

            // Handle revised prompt insertion
            if (revisedPrompt) {
                 const $pos = state.doc.resolve(mappedPos)
                 const parent = $pos.parent
                 if (parent.type.name === aiResponseMessageNodeType) {
                      const index = $pos.index()
                      const childBefore = index > 0 ? parent.child(index - 1) : null

                      if (!childBefore || (childBefore.type.name === 'paragraph' && !childBefore.textContent.trim())) {
                           const p = state.schema.nodes.paragraph.create(null, state.schema.text(revisedPrompt))
                           tr.insert(mappedPos, p)
                      }
                 }
            }
        } else {
            console.log('🖼️ [PLUGIN] handleImageComplete: creating NEW complete image node')
            // Use standard image node with AI attrs
            const imageNode = state.schema.nodes.image.create({
                src: imageUrl,
                fileId: fileId || null,
                revisedPrompt: revisedPrompt || null,
                responseId: responseId || null,
                aiModel: aiProvider || null,
                isPartial: false,
            })

            let contentNodes: ProseMirrorNode[] = [imageNode]
            if (revisedPrompt) {
                const p = state.schema.nodes.paragraph.create(null, state.schema.text(revisedPrompt))
                contentNodes = [p, imageNode]
            }

            const responseNodeInfo = PositionFinder.findResponseNode(state, aiChatThreadId)

            if (responseNodeInfo.found && responseNodeInfo.endOfNodePos) {
                 const insertionPos = responseNodeInfo.endOfNodePos - 1
                 tr.insert(insertionPos, Fragment.from(contentNodes))
            } else {
                 const responseNode = state.schema.nodes[aiResponseMessageNodeType].create(
                     { aiProvider: aiProvider || 'OpenAI' },
                     Fragment.from(contentNodes)
                 )
                 const threadInfo = PositionFinder.findThreadInsertionPoint(state, aiChatThreadId)
                 if (threadInfo) {
                    tr.insert(threadInfo.insertPos, responseNode)
                 }
            }
        }

        if (tr.docChanged) {
            dispatch(tr)
        }
    }

    private handleCreateVariantRequest(view: EditorView, node: ProseMirrorNode, pos: number): void {
        const { revisedPrompt, aiModel } = node.attrs
        if (!revisedPrompt) return

        // Find the thread ID
        const $pos = view.state.doc.resolve(pos)
        let threadId: string | undefined

        for (let d = $pos.depth; d > 0; d--) {
            const n = $pos.node(d)
            if (n.type.name === aiChatThreadNodeType) {
                threadId = n.attrs.threadId
                break
            }
        }

        if (!threadId) return

        console.log('🖼️ [PLUGIN] Creating variant for thread:', threadId)

        // Use the handler to trigger new generation
        // Note: we trust the handler to resolve the correct model if omitted,
        // or we use a default appropriate for images (e.g. gpt-4o/dall-e-3)
        this.sendAiRequestHandler({
            message: `Create a variant of this image: ${revisedPrompt}`,
            threadId,
            aiChatThreadId: threadId,
            imageOptions: {
                imageGenerationEnabled: true,
                imageGenerationSize: '1024x1024'
            }
        })
    }

    private handleStreamStart(state: EditorState, dispatch: (tr: Transaction) => void, aiProvider?: string, threadId?: string): void {
        const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
        if (!threadInfo) {
            console.error('🔴 [PLUGIN] handleStreamStart: No thread found!', { threadId })
            return
        }

        const { insertPos } = threadInfo

        const aiResponseNode = state.schema.nodes[aiResponseMessageNodeType].create({
            isInitialRenderAnimation: true,
            isReceivingAnimation: true,
            aiProvider
        })

        try {
            let tr = state.tr
            tr.insert(insertPos, aiResponseNode)

            // Keep cursor in the user input composer.
            // We intentionally do not create trailing paragraphs anymore;
            // the thread always ends with a dedicated aiUserInput node.

            // Set receiving state for this specific thread
            if (threadId) {
                tr.setMeta('setReceiving', { threadId, receiving: true })
                console.log('🔴 [PLUGIN] Response node created', { threadId, pos: insertPos })
            }
            dispatch(tr)
        } catch (error) {
            console.error('Error inserting aiResponseMessage:', error)
        }
    }

    private handleStreaming(
        state: EditorState,
        dispatch: (tr: Transaction) => void,
        segment: SegmentEvent['segment'],
        threadId?: string,
        aiProvider?: string
    ): void {
        if (!segment) return

        let tr = state.tr
        let responseInfo = PositionFinder.findResponseNode(state, threadId)

        // Create response node if missing (fallback) in the correct thread
        if (!responseInfo.found) {
            console.warn('⚠️ [PLUGIN] No response node found, creating fallback', { threadId })
            const threadInfo = PositionFinder.findThreadInsertionPoint(state, threadId)
            if (!threadInfo) return

            const { insertPos } = threadInfo
            const responseNode = state.schema.nodes[aiResponseMessageNodeType].create({
                isInitialRenderAnimation: true,
                isReceivingAnimation: true,
                aiProvider: aiProvider || 'Anthropic'
            })

            // Insert the response node first
            tr.insert(insertPos, responseNode)

            // After inserting, the response node is at insertPos
            // Its content starts at insertPos + 1, ends at insertPos + responseNode.nodeSize - 1
            responseInfo = {
                found: true,
                endOfNodePos: insertPos + responseNode.nodeSize,
                childCount: 0
            }
        }

        const { endOfNodePos, childCount } = responseInfo
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
            dispatch(tr)
        }
    }

    private handleStreamEnd(state: EditorState, dispatch: (tr: Transaction) => void, threadId?: string): void {
        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name === aiResponseMessageNodeType && node.attrs.isInitialRenderAnimation) {
                // If threadId is provided, verify this response is in the correct thread
                if (threadId) {
                    let isInCorrectThread = false
                    state.doc.nodesBetween(0, pos, (n: ProseMirrorNode) => {
                        if (n.type.name === aiChatThreadNodeType && n.attrs?.threadId === threadId) {
                            isInCorrectThread = true
                            return false
                        }
                    })
                    if (!isInCorrectThread) return // Skip this response node
                }

                const tr = state.tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    isInitialRenderAnimation: false,
                    isReceivingAnimation: false
                })

                // Only set receiving to false if debug mode is off
                if (!IS_RECEIVING_TEMP_DEBUG_STATE && threadId) {
                    tr.setMeta('setReceiving', { threadId, receiving: false })
                }

                dispatch(tr)
                return false // Stop after first match
            }
        })
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

        dispatch(state.tr.insert(insertPos, responseNode))
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

            // Input placeholder (composer)
            if (node.type.name === aiUserInputNodeType && node.textContent.trim() === '') {
                decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, {
                        class: 'empty-node-placeholder',
                        'data-placeholder': this.placeholderOptions.paragraphPlaceholder
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

        // Create thread with dedicated user input node
        const nodeType = newState.schema.nodes[aiChatThreadNodeType]
        const inputType = newState.schema.nodes[aiUserInputNodeType]
        const paragraph = newState.schema.nodes.paragraph.createAndFill()
        if (!inputType || !paragraph) return null

        const inputNode = inputType.create({}, paragraph)
        const threadNode = nodeType.create(attrs, inputNode)

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
            const threadNode = $from.node(currentThreadDepth)
            insertPos = threadPos + threadNode.nodeSize
        } else {
            insertPos = $from.after(1)
        }

        let tr = newState.tr.replace(insertPos, insertPos, new Slice(Fragment.from(threadNode), 0, 0))

        // doc -> title + aiChatThread
        // aiChatThread content starts after +1
        // aiUserInput wrapper adds another +1, and paragraph starts after that.
        const cursorPos = insertPos + 3
        tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos))

        return tr
    }

    private handleChatRequest(newState: EditorState, transaction: Transaction): void {
        const meta = transaction.getMeta(USE_AI_CHAT_META)
        const { threadId: threadIdFromMeta, nodePos } = meta || {}

        // Find thread: prefer explicit position from button, fallback to selection
        const threadNode = nodePos !== undefined
            ? ContentExtractor.findThreadByPosition(newState, nodePos)
            : ContentExtractor.findThreadBySelection(newState)

        if (!threadNode) return

        // Extract thread attributes including image generation settings
        const {
            aiModel = '',
            threadContext = 'Thread',
            threadId: threadIdFromNode = '',
            imageGenerationEnabled = false,
            imageGenerationSize = '1024x1024',
            previousResponseId = ''
        } = threadNode.attrs
        const threadId = threadIdFromMeta || threadIdFromNode

        // Validate AI model selected
        if (!aiModel) {
            alert('Please select an AI model from the dropdown before submitting.')
            return
        }

        // Extract and send content
        // Pass threadId for Workspace mode to ensure current thread is always included
        const threadContent = ContentExtractor.getActiveThreadContent(newState, threadContext, nodePos, threadId)
        const messages = ContentExtractor.toMessages(threadContent)

        // Build image generation options if enabled
        const imageOptions = imageGenerationEnabled ? {
            imageGenerationEnabled: true,
            imageGenerationSize,
            previousResponseId: previousResponseId || undefined
        } : undefined

        this.sendAiRequestHandler({ messages, aiModel, threadId, imageOptions })
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

            state: {
                init: (): AiChatThreadPluginState => ({
                    receivingThreadIds: new Set<string>(),
                    insideBackticks: false,
                    backtickBuffer: '',
                    insideCodeBlock: false,
                    codeBuffer: '',
                    decorations: DecorationSet.empty
                }),
                apply: (tr: Transaction, prev: AiChatThreadPluginState): AiChatThreadPluginState => {
                    // Handle receiving state toggle per thread
                    const receivingMeta = tr.getMeta('setReceiving')
                    if (receivingMeta !== undefined) {
                        const { threadId, receiving } = receivingMeta
                        if (threadId) {
                            const newSet = new Set(prev.receivingThreadIds)
                            if (receiving) {
                                newSet.add(threadId)
                            } else {
                                newSet.delete(threadId)
                            }
                            return {
                                ...prev,
                                receivingThreadIds: newSet,
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
                // Ensure every aiChatThread has an aiUserInput at the end
                const inputType = newState.schema.nodes[aiUserInputNodeType]
                const paragraphType = newState.schema.nodes.paragraph
                if (inputType && paragraphType) {
                    let tr: Transaction | null = null
                    newState.doc.descendants((node: ProseMirrorNode, pos: number) => {
                        if (node.type.name !== aiChatThreadNodeType) return
                        // Check if last child is aiUserInput
                        const lastChild = node.lastChild
                        if (lastChild && lastChild.type.name === aiUserInputNodeType) return
                        // Missing aiUserInput - insert one at the end of this thread
                        const emptyParagraph = paragraphType.createAndFill()
                        if (!emptyParagraph) return
                        const inputNode = inputType.create({}, emptyParagraph)
                        const insertPos = pos + node.nodeSize - 1 // before thread closing
                        tr = tr || newState.tr
                        tr.insert(insertPos, inputNode)
                    })
                    if (tr) return tr
                }

                // Handle AI chat requests
                const chatTransaction = transactions.find(tr => tr.getMeta(USE_AI_CHAT_META))
                if (chatTransaction) {
                    this.handleChatRequest(newState, chatTransaction)
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
                // Keyboard handling for mod+enter
                handleDOMEvents: {
                    keydown: (_view: EditorView, event: KeyboardEvent) => {
                        // Handle Mod+Enter for AI chat
                        if (KeyboardHandler.isModEnter(event)) {
                            event.preventDefault()
                            const { $from } = _view.state.selection
                            dispatchSendAiChatFromUserInput(_view, $from.pos)
                            return true
                        }

                        return false
                    }
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
                    [aiUserInputNodeType]: (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) =>
                        aiUserInputNodeView(node, view, getPos),
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
    imageCallbacks
}: {
    sendAiRequestHandler: SendAiRequestHandler
    stopAiRequestHandler: StopAiRequestHandler
    placeholders: PlaceholderOptions
    imageCallbacks?: AiGeneratedImageCallbacks
}): Plugin {
    // Set image generation callbacks if provided
    if (imageCallbacks) {
        setAiGeneratedImageCallbacks(imageCallbacks)
    }

    const pluginInstance = new AiChatThreadPluginClass({ sendAiRequestHandler, stopAiRequestHandler, placeholders })
    return pluginInstance.create()
}
