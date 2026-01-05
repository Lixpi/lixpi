'use strict'

import { NATS_SUBJECTS, LoadingStatus, type AiChatThread, type AiChatThreadStatus } from '@lixpi/constants'
import type {
    CanvasNode,
    WorkspaceEdge,
    ImageCanvasNode,
    DocumentCanvasNode,
    AiChatThreadCanvasNode,
} from '@lixpi/constants'

const { AI_CHAT_THREAD_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

import AuthService from '$src/services/auth-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { aiChatThreadStore } from '$src/stores/aiChatThreadStore.ts'
import { aiChatThreadsStore } from '$src/stores/aiChatThreadsStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { documentsStore } from '$src/stores/documentsStore.ts'
import type { Document } from '$src/stores/documentStore.ts'

// ========== CONTEXT EXTRACTION TYPES ==========

export type ContextItemType = 'document' | 'image' | 'aiChatThread'

export type ContextItem = {
    type: ContextItemType
    nodeId: string
    title?: string
    content: string
    parentNodeId?: string
}

export type ExtractedContext = ContextItem[]

export type TextContentBlock = { type: 'input_text'; text: string }
export type ImageContentBlock = { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' }
export type MessageContentBlock = TextContentBlock | ImageContentBlock

export type ContextMessage = {
    role: 'user'
    content: MessageContentBlock[]
} | null

// ========== PROSEMIRROR TYPES ==========

type ProseMirrorNode = {
    type: string
    text?: string
    content?: ProseMirrorNode[]
    attrs?: Record<string, any>
}

type ProseMirrorDoc = {
    type: 'doc'
    content?: ProseMirrorNode[]
}

type ExtractedContent = {
    text: string
    imageSrcs: string[]
}

// ========== HELPER FUNCTIONS ==========

function findConnectedNodes(
    targetNodeId: string,
    edges: WorkspaceEdge[],
    nodes: CanvasNode[],
    visited: Set<string>
): CanvasNode[] {
    if (visited.has(targetNodeId)) return []
    visited.add(targetNodeId)

    const incomingEdges = edges.filter((e) => e.targetNodeId === targetNodeId)
    const result: CanvasNode[] = []

    for (const edge of incomingEdges) {
        const sourceNode = nodes.find((n) => n.nodeId === edge.sourceNodeId)
        if (sourceNode) {
            result.push(sourceNode)
            result.push(...findConnectedNodes(edge.sourceNodeId, edges, nodes, visited))
        }
    }

    return result
}

function extractContentFromNode(node: ProseMirrorNode, imageSrcs: string[]): string {
    if (node.type === 'image' && node.attrs?.src) {
        imageSrcs.push(node.attrs.src)
        return '[image]'
    }

    if (node.type === 'text' && node.text) {
        return node.text
    }

    if (node.type === 'hard_break') {
        return '\n'
    }

    if (node.type === 'code_block' && node.content) {
        const codeText = node.content.map((n) => extractContentFromNode(n, imageSrcs)).join('')
        return `\n\`\`\`\n${codeText}\n\`\`\`\n`
    }

    if (node.content) {
        const childTexts = node.content.map((n) => extractContentFromNode(n, imageSrcs))
        if (['paragraph', 'heading', 'blockquote', 'list_item'].includes(node.type)) {
            return childTexts.join('') + '\n'
        }
        return childTexts.join('')
    }

    return ''
}

function extractContentFromProseMirror(content: string | object): ExtractedContent {
    try {
        const doc: ProseMirrorDoc = typeof content === 'string' ? JSON.parse(content) : content
        if (!doc || doc.type !== 'doc' || !doc.content) {
            return { text: '', imageSrcs: [] }
        }
        const imageSrcs: string[] = []
        const text = doc.content.map((n) => extractContentFromNode(n, imageSrcs)).join('').trim()
        return { text, imageSrcs }
    } catch {
        return { text: '', imageSrcs: [] }
    }
}

async function fetchImageAsBase64(src: string): Promise<string> {
    const response = await fetch(src)
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
    }
    const blob = await response.blob()
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Failed to convert image to base64'))
        reader.readAsDataURL(blob)
    })
}

class AiChatThreadService {
    constructor() {}

    public async getAiChatThread({ workspaceId, threadId }: { workspaceId: string; threadId: string }): Promise<AiChatThread | null> {
        aiChatThreadStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

        try {
            const thread: any = await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.GET_AI_CHAT_THREAD, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                threadId
            })

            if (thread.error) {
                aiChatThreadStore.setMetaValues({ loadingStatus: LoadingStatus.error })
                return null
            }

            aiChatThreadStore.setThread(thread)
            aiChatThreadStore.setMetaValues({ loadingStatus: LoadingStatus.success })

            return thread
        } catch (error) {
            console.error('Failed to load AI chat thread:', error)
            aiChatThreadStore.setMetaValues({ loadingStatus: LoadingStatus.error })
            return null
        }
    }

    public async getWorkspaceAiChatThreads({ workspaceId }: { workspaceId: string }): Promise<void> {
        try {
            aiChatThreadsStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

            const threads: any = await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.GET_WORKSPACE_AI_CHAT_THREADS, {
                token: await AuthService.getTokenSilently(),
                workspaceId
            })

            aiChatThreadsStore.setThreads(Array.isArray(threads) ? threads : [])
            aiChatThreadsStore.setMetaValues({ loadingStatus: LoadingStatus.success })
        } catch (error) {
            console.error('Failed to load workspace AI chat threads:', error)
            aiChatThreadsStore.setMetaValues({ loadingStatus: LoadingStatus.error })
        }
    }

    public async createAiChatThread({ workspaceId, content, aiModel }: { workspaceId: string; content: any; aiModel: string }): Promise<AiChatThread | null> {
        try {
            const thread: any = await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.CREATE_AI_CHAT_THREAD, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                content,
                aiModel
            })

            if (thread.error) {
                console.error('AI chat thread creation error:', thread.error)
                return null
            }

            // Add thread to the threads store
            aiChatThreadsStore.addThread(thread)

            return thread
        } catch (error) {
            console.error('Failed to create AI chat thread:', error)
            return null
        }
    }

    public async updateAiChatThread({
        workspaceId,
        threadId,
        content,
        aiModel,
        status
    }: {
        workspaceId: string
        threadId: string
        content?: any
        aiModel?: string
        status?: AiChatThreadStatus
    }): Promise<void> {
        try {
            const updatePayload: any = {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                threadId
            }

            if (content !== undefined) updatePayload.content = content
            if (aiModel !== undefined) updatePayload.aiModel = aiModel
            if (status !== undefined) updatePayload.status = status

            await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.UPDATE_AI_CHAT_THREAD, updatePayload)

            // Update in store
            aiChatThreadsStore.updateThread(threadId, { content, aiModel, status })
        } catch (error) {
            console.error('Failed to update AI chat thread:', error)
        }
    }

    public async deleteAiChatThread({ workspaceId, threadId }: { workspaceId: string; threadId: string }): Promise<void> {
        try {
            await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.DELETE_AI_CHAT_THREAD, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                threadId
            })

            // Remove from store
            aiChatThreadsStore.removeThread(threadId)
        } catch (error) {
            console.error('Failed to delete AI chat thread:', error)
        }
    }

    // ========== CONTEXT EXTRACTION ==========

    public async extractConnectedContext(aiChatNodeId: string): Promise<ExtractedContext> {
        const canvasState = workspaceStore.getData('canvasState')
        if (!canvasState) return []

        const edges: WorkspaceEdge[] = canvasState.edges || []
        const nodes: CanvasNode[] = canvasState.nodes || []
        const documents: Document[] = documentsStore.getData()
        const threadsMap: Map<string, AiChatThread> = aiChatThreadsStore.getData()

        const connectedNodes = findConnectedNodes(aiChatNodeId, edges, nodes, new Set())
        if (connectedNodes.length === 0) return []

        const context: GatheredContext = []

        for (const node of connectedNodes) {
            if (node.type === 'document') {
                const docNode = node as DocumentCanvasNode
                const doc = documents.find((d) => d.documentId === docNode.referenceId)

                if (doc && doc.content) {
                    const { text, imageSrcs } = extractContentFromProseMirror(doc.content)

                    if (text) {
                        context.push({
                            type: 'document',
                            nodeId: node.nodeId,
                            title: doc.title || undefined,
                            content: text,
                        })
                    }

                    for (let i = 0; i < imageSrcs.length; i++) {
                        const base64DataUrl = await fetchImageAsBase64(imageSrcs[i])
                        context.push({
                            type: 'image',
                            nodeId: `${node.nodeId}-embedded-${i}`,
                            parentNodeId: node.nodeId,
                            content: base64DataUrl,
                        })
                    }
                }
            } else if (node.type === 'image') {
                const imgNode = node as ImageCanvasNode
                const base64DataUrl = await fetchImageAsBase64(imgNode.src)
                context.push({
                    type: 'image',
                    nodeId: node.nodeId,
                    content: base64DataUrl,
                })
            } else if (node.type === 'aiChatThread') {
                const threadNode = node as AiChatThreadCanvasNode
                const thread = threadsMap.get(threadNode.referenceId)

                if (thread && thread.content) {
                    const { text, imageSrcs } = extractContentFromProseMirror(thread.content)

                    if (text) {
                        context.push({
                            type: 'aiChatThread',
                            nodeId: node.nodeId,
                            content: text,
                        })
                    }

                    for (let i = 0; i < imageSrcs.length; i++) {
                        const base64DataUrl = await fetchImageAsBase64(imageSrcs[i])
                        context.push({
                            type: 'image',
                            nodeId: `${node.nodeId}-embedded-${i}`,
                            parentNodeId: node.nodeId,
                            content: base64DataUrl,
                        })
                    }
                }
            }
        }

        return context
    }

    public buildContextMessage(context: ExtractedContext): ContextMessage {
        if (context.length === 0) return null

        const contentBlocks: MessageContentBlock[] = []
        const standaloneImages: ContextItem[] = []
        const textItems: ContextItem[] = []
        const embeddedImagesByParent = new Map<string, ContextItem[]>()

        for (const item of context) {
            if (item.type === 'image') {
                if (item.parentNodeId) {
                    const existing = embeddedImagesByParent.get(item.parentNodeId) || []
                    existing.push(item)
                    embeddedImagesByParent.set(item.parentNodeId, existing)
                } else {
                    standaloneImages.push(item)
                }
            } else {
                textItems.push(item)
            }
        }

        for (const item of textItems) {
            const contextObj: Record<string, string> = { type: item.type }
            if (item.title) contextObj.title = item.title
            contextObj.content = item.content

            contentBlocks.push({
                type: 'input_text',
                text: JSON.stringify(contextObj),
            })

            const embeddedImages = embeddedImagesByParent.get(item.nodeId) || []
            for (const img of embeddedImages) {
                contentBlocks.push({
                    type: 'input_image',
                    image_url: img.content,
                    detail: 'auto',
                })
            }
        }

        for (const item of standaloneImages) {
            contentBlocks.push({
                type: 'input_text',
                text: JSON.stringify({ type: 'standalone_image' }),
            })
            contentBlocks.push({
                type: 'input_image',
                image_url: item.content,
                detail: 'auto',
            })
        }

        if (contentBlocks.length === 0) return null

        return {
            role: 'user',
            content: contentBlocks,
        }
    }
}

export default AiChatThreadService
