'use strict'

import { NATS_SUBJECTS, LoadingStatus, type AiChatThread, type AiChatThreadStatus } from '@lixpi/constants'
import type {
    CanvasNode,
    WorkspaceEdge,
    ImageCanvasNode,
    DocumentCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'

const { AI_CHAT_THREAD_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

import AuthService from '$src/services/auth-service.ts'
import RouterService from '$src/services/router-service.ts'
import { WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS } from '$src/services/requestTimeouts.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { aiChatThreadStore } from '$src/stores/aiChatThreadStore.ts'
import { aiChatThreadsStore } from '$src/stores/aiChatThreadsStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { documentsStore } from '$src/stores/documentsStore.ts'
import type { Document } from '$src/stores/documentStore.ts'

// ========== CONTEXT EXTRACTION TYPES ==========

export type ContextItemType = 'document' | 'image' | 'aiChatThread' | 'video'

export type ContextItem = {
    type: ContextItemType
    nodeId: string
    title?: string
    content: string
    parentNodeId?: string
    // For images and video posters stored in NATS object store
    fileId?: string
    workspaceId?: string
    // Links this image/video to a specific aiResponseMessage within the source AI chat thread
    sourceMessageId?: string
    // Video-only fields (used when type === 'video'). The poster lives at
    // workspace-{workspaceId}-files/{posterFileId} and is fed to the LLM in
    // place of the MP4 (text models can't natively consume video).
    posterFileId?: string
    durationSeconds?: number
    aspectRatio?: number
    hasAudio?: boolean
}

export type ExtractedContext = ContextItem[]

export type TextContentBlock = { type: 'input_text'; text: string }
// image_url is a nats-obj:// reference that LLM API fetches from NATS object store
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

type ConnectedNodeWithEdge = {
    node: CanvasNode
    edge: WorkspaceEdge
}

function findConnectedNodes(
    targetNodeId: string,
    edges: WorkspaceEdge[],
    nodes: CanvasNode[],
    visited: Set<string>
): ConnectedNodeWithEdge[] {
    if (visited.has(targetNodeId)) return []
    visited.add(targetNodeId)

    const incomingEdges = edges.filter((e) => e.targetNodeId === targetNodeId)
    const result: ConnectedNodeWithEdge[] = []

    for (const edge of incomingEdges) {
        const sourceNode = nodes.find((n) => n.nodeId === edge.sourceNodeId)
        if (sourceNode) {
            result.push({ node: sourceNode, edge })
            result.push(...findConnectedNodes(edge.sourceNodeId, edges, nodes, visited))
        }
    }

    // Context-region children: any node whose `parentId` is the target node is
    // part of the prompt context. Synthesize a virtual edge so downstream code
    // that expects an edge keeps working.
    const childNodes = nodes.filter((n) => n.parentId === targetNodeId)
    for (const childNode of childNodes) {
        if (visited.has(childNode.nodeId)) continue
        visited.add(childNode.nodeId)
        const virtualEdge: WorkspaceEdge = {
            edgeId: `virtual-parent-${targetNodeId}-${childNode.nodeId}`,
            sourceNodeId: childNode.nodeId,
            targetNodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
        }
        result.push({ node: childNode, edge: virtualEdge })
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

export function extractContentFromProseMirror(content: string | object): ExtractedContent {
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

function getContextDedupeKey(item: ContextItem): string {
    if (item.type === 'image') {
        return [item.type, item.fileId ?? item.content, item.workspaceId ?? ''].join(':')
    }
    if (item.type === 'video') {
        return [item.type, item.fileId ?? item.nodeId, item.workspaceId ?? ''].join(':')
    }

    return [item.type, item.nodeId, item.title ?? '', item.content].join(':')
}

function dedupeContextItems(items: ContextItem[]): ContextItem[] {
    const seen = new Set<string>()
    const deduped: ContextItem[] = []

    for (const item of items) {
        const key = getContextDedupeKey(item)
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(item)
    }

    return deduped
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
            }, WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS)

            if (RouterService.getRouteParams().workspaceId !== workspaceId) return

            aiChatThreadsStore.setThreads(Array.isArray(threads) ? threads : [])
            aiChatThreadsStore.setMetaValues({ loadingStatus: LoadingStatus.success })
        } catch (error) {
            if (RouterService.getRouteParams().workspaceId !== workspaceId) return

            console.error('Failed to load workspace AI chat threads:', error)
            aiChatThreadsStore.setMetaValues({ loadingStatus: LoadingStatus.error })
        }
    }

    public async createAiChatThread({
        workspaceId,
        threadId,
        content,
        aiModel,
        title,
        owner,
    }: {
        workspaceId: string
        threadId: string
        content: any
        aiModel: string
        title?: string
        owner?: AiChatThread['owner']
    }): Promise<AiChatThread | null> {
        try {
            const thread: any = await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.CREATE_AI_CHAT_THREAD, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                threadId,
                content,
                aiModel,
                title,
                owner,
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
        const isContentOnlyUpdate = content !== undefined && aiModel === undefined && status === undefined
        if (isContentOnlyUpdate) {
            aiChatThreadsStore.updateThread(threadId, { content })
            this.sendAiChatThreadUpdateRequest({ workspaceId, threadId, content }).catch((error) => {
                console.error('Failed to update AI chat thread:', error)
            })
            return
        }

        try {
            await this.sendAiChatThreadUpdateRequest({ workspaceId, threadId, content, aiModel, status })

            // Update in store
            aiChatThreadsStore.updateThread(threadId, { content, aiModel, status })
        } catch (error) {
            console.error('Failed to update AI chat thread:', error)
        }
    }

    private async sendAiChatThreadUpdateRequest({
        workspaceId,
        threadId,
        content,
        aiModel,
        status,
    }: {
        workspaceId: string
        threadId: string
        content?: any
        aiModel?: string
        status?: AiChatThreadStatus
    }): Promise<void> {
        const updatePayload: any = {
            token: await AuthService.getTokenSilently(),
            workspaceId,
            threadId
        }

        if (content !== undefined) updatePayload.content = content
        if (aiModel !== undefined) updatePayload.aiModel = aiModel
        if (status !== undefined) updatePayload.status = status

        await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.UPDATE_AI_CHAT_THREAD, updatePayload)
    }

    public async deleteAiChatThread({ workspaceId, threadId }: { workspaceId: string; threadId: string }): Promise<boolean> {
        try {
            const response: any = await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.DELETE_AI_CHAT_THREAD, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                threadId
            })

            if (response?.error) {
                throw new Error(response.error)
            }

            // Remove from store
            aiChatThreadsStore.removeThread(threadId)
            return true
        } catch (error) {
            console.error('Failed to delete AI chat thread:', error)
            return false
        }
    }

    // ========== CONTEXT EXTRACTION ==========

    private extractContextItems(connectedItems: ConnectedNodeWithEdge[]): ExtractedContext {
        const canvasState = workspaceStore.getData('canvasState')
        if (!canvasState) return []

        const documents: Document[] = documentsStore.getData()
        const context: ExtractedContext = []

        for (const { node, edge } of connectedItems) {
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
                        context.push({
                            type: 'image',
                            nodeId: `${node.nodeId}-embedded-${i}`,
                            parentNodeId: node.nodeId,
                            content: imageSrcs[i],
                        })
                    }
                }
            } else if (node.type === 'image') {
                const imgNode = node as ImageCanvasNode
                context.push({
                    type: 'image',
                    nodeId: node.nodeId,
                    content: '',
                    fileId: imgNode.fileId,
                    workspaceId: imgNode.workspaceId,
                    sourceMessageId: edge.sourceMessageId,
                })
            } else if (node.type === 'video') {
                // Video context: feed the ffmpeg-extracted poster frame in
                // place of the MP4 (cross-provider compatibility), plus a JSON
                // text block describing the video's metadata so the text model
                // knows it's looking at a still from a video, not a photo.
                const videoNode = node as VideoCanvasNode
                if (videoNode.fileId) {
                    context.push({
                        type: 'video',
                        nodeId: node.nodeId,
                        content: '',
                        fileId: videoNode.fileId,
                        workspaceId: videoNode.workspaceId,
                        posterFileId: videoNode.posterFileId,
                        durationSeconds: videoNode.durationSeconds,
                        aspectRatio: videoNode.aspectRatio,
                        hasAudio: videoNode.hasAudio,
                        sourceMessageId: edge.sourceMessageId,
                    })
                }
            }
        }

        return dedupeContextItems(context)
    }

    public async extractConnectedContext(aiChatNodeId: string): Promise<ExtractedContext> {
        const canvasState = workspaceStore.getData('canvasState')
        if (!canvasState) return []

        const connectedItems = findConnectedNodes(
            aiChatNodeId,
            canvasState.edges || [],
            canvasState.nodes || [],
            new Set(),
        )
        return this.extractContextItems(connectedItems)
    }

    public async extractSelectedContext({
        nodeIds,
        includeUpstream,
    }: {
        nodeIds: string[]
        includeUpstream: boolean
    }): Promise<ExtractedContext> {
        const canvasState = workspaceStore.getData('canvasState')
        if (!canvasState) return []

        const nodes: CanvasNode[] = canvasState.nodes || []
        const edges: WorkspaceEdge[] = canvasState.edges || []
        const directItems: ConnectedNodeWithEdge[] = []
        const upstreamItems: ConnectedNodeWithEdge[] = []

        for (const nodeId of nodeIds) {
            const node = nodes.find((candidate) => candidate.nodeId === nodeId)
            if (!node) continue
            directItems.push({
                node,
                edge: {
                    edgeId: `selected-context-${nodeId}`,
                    sourceNodeId: nodeId,
                    targetNodeId: nodeId,
                    sourceHandle: 'right',
                    targetHandle: 'left',
                },
            })
            if (includeUpstream) {
                upstreamItems.push(...findConnectedNodes(nodeId, edges, nodes, new Set()))
            }
        }

        return this.extractContextItems([...directItems, ...upstreamItems])
    }

    public buildContextMessage(context: ExtractedContext): ContextMessage {
        if (context.length === 0) return null

        const contentBlocks: MessageContentBlock[] = []
        const standaloneImages: ContextItem[] = []
        const standaloneVideos: ContextItem[] = []
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
            } else if (item.type === 'video') {
                standaloneVideos.push(item)
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
                // Build nats-obj:// reference for images with fileId, otherwise use content directly
                let imageUrl = img.content
                if (img.fileId && img.workspaceId) {
                    imageUrl = `nats-obj://workspace-${img.workspaceId}-files/${img.fileId}`
                }
                contentBlocks.push({
                    type: 'input_image',
                    image_url: imageUrl,
                    detail: 'auto',
                })
            }
        }

        for (const item of standaloneImages) {
            // Build nats-obj:// reference for images with fileId
            let imageUrl = item.content
            if (item.fileId && item.workspaceId) {
                imageUrl = `nats-obj://workspace-${item.workspaceId}-files/${item.fileId}`
            }

            const imageMetadata: Record<string, string> = {
                type: 'standalone_image',
            }
            if (item.sourceMessageId) {
                imageMetadata.sourceMessageId = item.sourceMessageId
            }

            contentBlocks.push({
                type: 'input_text',
                text: JSON.stringify(imageMetadata),
            })
            contentBlocks.push({
                type: 'input_image',
                image_url: imageUrl,
                detail: 'auto',
            })
        }

        for (const item of standaloneVideos) {
            // Cross-provider video context: serialize metadata as JSON text,
            // then attach the poster frame (still image) so vision-capable
            // text models can reason about the video's content. The MP4 itself
            // is only consumable by VEO via the video extension path
            // (sourceVideoNodeId / videoSourceForExtension).
            const videoMetadata: Record<string, unknown> = {
                type: 'standalone_video',
            }
            if (item.fileId && item.workspaceId) {
                videoMetadata.video_url = `nats-obj://workspace-${item.workspaceId}-files/${item.fileId}`
            }
            if (typeof item.durationSeconds === 'number' && item.durationSeconds > 0) {
                videoMetadata.duration_s = item.durationSeconds
            }
            if (typeof item.aspectRatio === 'number' && item.aspectRatio > 0) {
                videoMetadata.aspect_ratio = item.aspectRatio
            }
            if (typeof item.hasAudio === 'boolean') {
                videoMetadata.has_audio = item.hasAudio
            }
            if (item.sourceMessageId) {
                videoMetadata.sourceMessageId = item.sourceMessageId
            }

            contentBlocks.push({
                type: 'input_text',
                text: JSON.stringify(videoMetadata),
            })

            if (item.posterFileId && item.workspaceId) {
                contentBlocks.push({
                    type: 'input_image',
                    image_url: `nats-obj://workspace-${item.workspaceId}-files/${item.posterFileId}`,
                    detail: 'auto',
                })
            }
        }

        if (contentBlocks.length === 0) return null

        return {
            role: 'user',
            content: contentBlocks,
        }
    }
}

export default AiChatThreadService
