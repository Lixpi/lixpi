import { v4 as uuidv4 } from 'uuid'
import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Fragment } from 'prosemirror-model'
import type {
    CanvasState,
    CanvasNode,
    AiChatThreadCanvasNode,
    WorkspaceEdge,
    ImageGenerationSize,
} from '@lixpi/constants'

import { USE_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'

type ThreadEditorEntry = {
    editorView: EditorView
    triggerGradientAnimation?: () => void
}

type AiSubmitPayload = {
    messages: any[]
    aiModel: string
    threadId: string
    imageOptions?: {
        imageGenerationEnabled: boolean
        imageGenerationSize: ImageGenerationSize
    }
}

type TargetNode = {
    nodeId: string
    type: CanvasNode['type']
    referenceId: string
}

type PendingMessage = {
    content: any
    aiModel: string
    imageOptions?: {
        imageGenerationEnabled: boolean
        imageGenerationSize: ImageGenerationSize
    }
}

type AiPromptInputControllerOptions = {
    workspaceId: string
    getCanvasState: () => CanvasState | null
    persistCanvasState: (state: CanvasState) => void
    createAiChatThread: (params: {
        workspaceId: string
        threadId: string
        content: any
        aiModel: string
    }) => Promise<any>
    onAiSubmit: (threadId: string, payload: AiSubmitPayload) => void
    onAiStop: (threadId: string) => void
}

export class AiPromptInputController {
    private workspaceId: string
    private target: TargetNode | null = null
    private threadEditors: Map<string, ThreadEditorEntry> = new Map()
    private pendingMessages: Map<string, PendingMessage> = new Map()
    private receivingThreadIds: Set<string> = new Set()

    private getCanvasState: () => CanvasState | null
    private persistCanvasState: (state: CanvasState) => void
    private createAiChatThread: AiPromptInputControllerOptions['createAiChatThread']
    private onAiSubmit: AiPromptInputControllerOptions['onAiSubmit']
    private onAiStop: AiPromptInputControllerOptions['onAiStop']

    constructor(options: AiPromptInputControllerOptions) {
        this.workspaceId = options.workspaceId
        this.getCanvasState = options.getCanvasState
        this.persistCanvasState = options.persistCanvasState
        this.createAiChatThread = options.createAiChatThread
        this.onAiSubmit = options.onAiSubmit
        this.onAiStop = options.onAiStop
    }

    setTarget(target: TargetNode | null): void {
        this.target = target
    }

    getTarget(): TargetNode | null {
        return this.target
    }

    registerThreadEditor(threadId: string, entry: ThreadEditorEntry): void {
        this.threadEditors.set(threadId, entry)

        // Check for pending messages for this newly registered thread
        const pending = this.pendingMessages.get(threadId)
        if (pending) {
            this.pendingMessages.delete(threadId)
            this.injectMessageAndSubmit(threadId, pending)
        }
    }

    unregisterThreadEditor(threadId: string): void {
        this.threadEditors.delete(threadId)
    }

    setReceiving(threadId: string, receiving: boolean): void {
        if (receiving) {
            this.receivingThreadIds.add(threadId)
        } else {
            this.receivingThreadIds.delete(threadId)
        }
    }

    isReceiving(threadId?: string): boolean {
        if (threadId) {
            return this.receivingThreadIds.has(threadId)
        }
        // Check if the current target thread is receiving
        const targetThreadId = this.getTargetThreadId()
        return targetThreadId ? this.receivingThreadIds.has(targetThreadId) : false
    }

    getTargetThreadId(): string | null {
        if (!this.target) return null
        if (this.target.type === 'aiChatThread') {
            return this.target.referenceId
        }
        // For non-thread targets, there's no existing thread until one is auto-created
        return null
    }

    async submitMessage(params: {
        contentJSON: any
        aiModel: string
        imageOptions?: {
            imageGenerationEnabled: boolean
            imageGenerationSize: ImageGenerationSize
        }
    }): Promise<void> {
        const { contentJSON, aiModel, imageOptions } = params

        if (!this.target) {
            console.warn('[AiPromptInputController] No target set, cannot submit')
            return
        }

        if (!aiModel) {
            alert('Please select an AI model from the dropdown before submitting.')
            return
        }

        if (this.target.type === 'aiChatThread') {
            // Target is an existing AI chat thread — inject message directly
            const threadId = this.target.referenceId
            this.injectMessageAndSubmit(threadId, { content: contentJSON, aiModel, imageOptions })
        } else {
            // Target is a document or image — auto-create a new AI chat thread
            await this.createThreadAndSubmit(contentJSON, aiModel, imageOptions)
        }
    }

    stopStreaming(): void {
        const threadId = this.getTargetThreadId()
        if (threadId) {
            this.onAiStop(threadId)
        }
    }

    private injectMessageAndSubmit(threadId: string, pending: PendingMessage): void {
        const entry = this.threadEditors.get(threadId)
        if (!entry) {
            // Thread editor not mounted yet — queue the message
            this.pendingMessages.set(threadId, pending)
            return
        }

        const { editorView } = entry
        const { state } = editorView

        // Find the aiChatThread node in the editor
        let threadPos = -1
        let threadNode: ProseMirrorNode | null = null
        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name === 'aiChatThread') {
                threadPos = pos
                threadNode = node
                return false
            }
        })

        if (threadPos === -1 || !threadNode) {
            console.warn('[AiPromptInputController] Could not find aiChatThread node in editor')
            return
        }

        // Create the aiUserMessage node from the content JSON
        const userMessageType = state.schema.nodes.aiUserMessage
        if (!userMessageType) {
            console.warn('[AiPromptInputController] aiUserMessage node type not found in schema')
            return
        }

        // Convert contentJSON to a Fragment using the target editor's schema
        let messageContent: Fragment
        try {
            // contentJSON is expected to be an array of ProseMirror node JSON objects (paragraphs, etc.)
            const nodes = pending.content.map((nodeJSON: any) => state.schema.nodeFromJSON(nodeJSON))
            messageContent = Fragment.from(nodes)
        } catch (e) {
            console.warn('[AiPromptInputController] Failed to convert content JSON to fragment:', e)
            return
        }

        const messageNode = userMessageType.create(
            { id: createId(), createdAt: Date.now() },
            messageContent
        )

        // Insert the message at the end of the thread (before the closing token)
        const insertPos = threadPos + (threadNode as ProseMirrorNode).nodeSize - 1
        let tr = state.tr.insert(insertPos, messageNode)

        // Update the AI model on the thread if it differs
        if ((threadNode as ProseMirrorNode).attrs.aiModel !== pending.aiModel) {
            const mappedThreadPos = tr.mapping.map(threadPos)
            tr = tr.setNodeMarkup(mappedThreadPos, undefined, {
                ...(threadNode as ProseMirrorNode).attrs,
                aiModel: pending.aiModel,
                ...(pending.imageOptions ? {
                    imageGenerationEnabled: pending.imageOptions.imageGenerationEnabled,
                    imageGenerationSize: pending.imageOptions.imageGenerationSize,
                } : {})
            })
        }

        // Set the USE_AI_CHAT_META to trigger the AI request handler in the thread plugin
        tr = tr.setMeta(USE_AI_CHAT_META, { threadId, nodePos: threadPos })
        editorView.dispatch(tr)

        // Trigger gradient animation
        entry.triggerGradientAnimation?.()
    }

    private async createThreadAndSubmit(
        contentJSON: any,
        aiModel: string,
        imageOptions?: PendingMessage['imageOptions']
    ): Promise<void> {
        if (!this.target) return

        const threadId = uuidv4()
        const targetNodeId = this.target.nodeId

        // Create the initial thread content (without aiUserInput since we removed it)
        const initialContent = {
            type: 'doc',
            content: [
                {
                    type: 'documentTitle',
                    content: [{ type: 'text', text: 'AI Chat' }]
                },
                {
                    type: 'aiChatThread',
                    attrs: { threadId, aiModel },
                    content: [
                        {
                            type: 'aiUserMessage',
                            attrs: { id: createId(), createdAt: Date.now() },
                            content: contentJSON.length > 0 ? contentJSON : [{ type: 'paragraph' }]
                        }
                    ]
                }
            ]
        }

        // Create the thread on the backend
        try {
            const thread = await this.createAiChatThread({
                workspaceId: this.workspaceId,
                threadId,
                content: initialContent,
                aiModel
            })

            if (!thread) {
                console.error('[AiPromptInputController] Failed to create AI chat thread')
                return
            }

            // Add the thread canvas node and edge to canvas state
            const canvasState = this.getCanvasState()
            if (!canvasState) return

            const targetCanvasNode = canvasState.nodes.find((n: CanvasNode) => n.nodeId === targetNodeId)
            if (!targetCanvasNode) return

            // Position the new thread to the right of the target node
            const threadPosition = {
                x: targetCanvasNode.position.x + (targetCanvasNode.dimensions?.width ?? 400) + 50,
                y: targetCanvasNode.position.y
            }

            const threadCanvasNode: AiChatThreadCanvasNode = {
                nodeId: `node-${threadId}`,
                type: 'aiChatThread',
                referenceId: threadId,
                position: threadPosition,
                dimensions: { width: 400, height: 500 }
            }

            const edge: WorkspaceEdge = {
                edgeId: uuidv4(),
                sourceNodeId: targetNodeId,
                targetNodeId: threadCanvasNode.nodeId,
            }

            const newCanvasState: CanvasState = {
                ...canvasState,
                nodes: [...canvasState.nodes, threadCanvasNode],
                edges: [...canvasState.edges, edge]
            }

            // Queue the AI submit for after the thread editor mounts
            // The message is already in the initial content, so we just need to trigger the AI request
            this.pendingMessages.set(threadId, { content: contentJSON, aiModel, imageOptions })

            this.persistCanvasState(newCanvasState)

            // Update target to point to the new thread
            this.target = {
                nodeId: threadCanvasNode.nodeId,
                type: 'aiChatThread',
                referenceId: threadId
            }
        } catch (error) {
            console.error('[AiPromptInputController] Failed to create thread:', error)
        }
    }

    destroy(): void {
        this.target = null
        this.threadEditors.clear()
        this.pendingMessages.clear()
        this.receivingThreadIds.clear()
    }
}

function createId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
