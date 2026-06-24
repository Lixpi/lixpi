import { v4 as uuidv4 } from 'uuid'
import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Fragment } from 'prosemirror-model'
import type {
    CanvasState,
    CanvasNode,
    ImageGenerationSize,
    MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'

import { USE_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import {
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'

type ThreadEditorEntry = {
    editorView: EditorView
    triggerGradientAnimation?: () => void
}

type VideoOptions = {
    aiVideoModel?: string
    aiVideoModels?: string[]
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string
    configGroups?: MediaGenerationConfigSelectionGroup[]
}

type AiSubmitPayload = {
    messages: any[]
    aiModel: string
    aiModels?: string[]
    useMultipleModels?: boolean
    useMultipleReasoningModels?: boolean
    useMultipleImageModels?: boolean
    useMultipleVideoModels?: boolean
    threadId: string
    imageOptions?: {
        aiImageModel?: string
        aiImageModels?: string[]
        imageGenerationSize: ImageGenerationSize
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    videoOptions?: VideoOptions
    referenceNodeIds?: string[]
}

type TargetNode = {
    nodeId: string
    // 'aiChatThread' is a panel-only thread target (no canvas node of that type exists).
    type: CanvasNode['type'] | 'aiChatThread'
    referenceId: string
}

type PendingMessage = {
    content: any
    aiModel: string
    aiModels?: string[]
    useMultipleModels?: boolean
    useMultipleReasoningModels?: boolean
    useMultipleImageModels?: boolean
    useMultipleVideoModels?: boolean
    imageOptions?: {
        aiImageModel?: string
        aiImageModels?: string[]
        imageGenerationSize: ImageGenerationSize
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    videoOptions?: VideoOptions
    referenceNodeIds?: string[]
}

type AiPromptInputControllerOptions = {
    workspaceId: string
    getCanvasState: () => CanvasState | null
    persistCanvasState: (state: CanvasState) => void
    onAiChatThreadCreated?: (params: { threadId: string }) => void
    createAiChatThread: (params: {
        workspaceId: string
        threadId: string
        content: any
        aiModel: string
        owner?: { type: 'standalone' }
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
    private onAiChatThreadCreated?: AiPromptInputControllerOptions['onAiChatThreadCreated']

    constructor(options: AiPromptInputControllerOptions) {
        this.workspaceId = options.workspaceId
        this.getCanvasState = options.getCanvasState
        this.persistCanvasState = options.persistCanvasState
        this.createAiChatThread = options.createAiChatThread
        this.onAiSubmit = options.onAiSubmit
        this.onAiStop = options.onAiStop
        this.onAiChatThreadCreated = options.onAiChatThreadCreated
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
        aiModels?: string[]
        useMultipleModels?: boolean
        useMultipleReasoningModels?: boolean
        useMultipleImageModels?: boolean
        useMultipleVideoModels?: boolean
        imageOptions?: {
            aiImageModel?: string
            aiImageModels?: string[]
            imageGenerationSize: ImageGenerationSize
            configGroups?: MediaGenerationConfigSelectionGroup[]
        }
        videoOptions?: VideoOptions
        referenceNodeIds?: string[]
    }): Promise<void> {
        const {
            contentJSON,
            aiModel,
            aiModels,
            useMultipleModels,
            useMultipleReasoningModels,
            useMultipleImageModels,
            useMultipleVideoModels,
            imageOptions,
            videoOptions,
            referenceNodeIds,
        } = params

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
            this.injectMessageAndSubmit(threadId, {
                content: contentJSON,
                aiModel,
                aiModels,
                useMultipleModels,
                useMultipleReasoningModels,
                useMultipleImageModels,
                useMultipleVideoModels,
                imageOptions,
                videoOptions,
                referenceNodeIds,
            })
        } else {
            // Target is a document or image — auto-create a new AI chat thread
            await this.createThreadAndSubmit({
                contentJSON,
                aiModel,
                aiModels,
                useMultipleModels,
                useMultipleReasoningModels,
                useMultipleImageModels,
                useMultipleVideoModels,
                imageOptions,
                videoOptions,
                referenceNodeIds,
            })
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
            { id: createId(), createdAt: Date.now(), referenceNodeIds: pending.referenceNodeIds ?? [] },
            messageContent
        )

        // Insert the message at the end of the thread (before the closing token)
        const insertPos = threadPos + (threadNode as ProseMirrorNode).nodeSize - 1
        let tr = state.tr.insert(insertPos, messageNode)

        // Update the AI model, image options, and video options on the thread node
        const currentAttrs = (threadNode as ProseMirrorNode).attrs
        const legacyPendingUseMultipleModels = Boolean(pending.useMultipleModels)
        const pendingUseMultipleReasoningModels = pending.useMultipleReasoningModels ?? legacyPendingUseMultipleModels
        const pendingUseMultipleImageModels = pending.useMultipleImageModels ?? legacyPendingUseMultipleModels
        const pendingUseMultipleVideoModels = pending.useMultipleVideoModels ?? legacyPendingUseMultipleModels
        const pendingUseMultipleModels = pendingUseMultipleReasoningModels
            || pendingUseMultipleImageModels
            || pendingUseMultipleVideoModels
        const pendingAiModels = serializeAiModelSelectionAttr(
            pendingUseMultipleReasoningModels
                ? pending.aiModels ?? []
                : pending.aiModel ? [pending.aiModel] : []
        )
        const pendingImageModels = pending.imageOptions
            ? serializeAiModelSelectionAttr(
                pendingUseMultipleImageModels
                    ? pending.imageOptions.aiImageModels ?? []
                    : pending.imageOptions.aiImageModel ? [pending.imageOptions.aiImageModel] : []
            )
            : undefined
        const pendingVideoModels = pending.videoOptions
            ? serializeAiModelSelectionAttr(
                pendingUseMultipleVideoModels
                    ? pending.videoOptions.aiVideoModels ?? []
                    : pending.videoOptions.aiVideoModel ? [pending.videoOptions.aiVideoModel] : []
            )
            : undefined
        const pendingImageConfigGroups = pending.imageOptions
            ? serializeMediaGenerationConfigSelectionAttr(
                pendingUseMultipleImageModels ? pending.imageOptions.configGroups ?? [] : []
            )
            : undefined
        const pendingVideoConfigGroups = pending.videoOptions
            ? serializeMediaGenerationConfigSelectionAttr(
                pendingUseMultipleVideoModels ? pending.videoOptions.configGroups ?? [] : []
            )
            : undefined
        const legacyCurrentUseMultipleModels = currentAttrs.useMultipleModels === true || currentAttrs.useMultipleModels === 'true'
        const rawCurrentUseMultipleReasoningModels = currentAttrs.useMultipleReasoningModels === true
            || currentAttrs.useMultipleReasoningModels === 'true'
        const rawCurrentUseMultipleImageModels = currentAttrs.useMultipleImageModels === true
            || currentAttrs.useMultipleImageModels === 'true'
        const rawCurrentUseMultipleVideoModels = currentAttrs.useMultipleVideoModels === true
            || currentAttrs.useMultipleVideoModels === 'true'
        const hasCurrentSectionModelMode = rawCurrentUseMultipleReasoningModels
            || rawCurrentUseMultipleImageModels
            || rawCurrentUseMultipleVideoModels
        const useCurrentLegacyModeFallback = legacyCurrentUseMultipleModels && !hasCurrentSectionModelMode
        const currentUseMultipleReasoningModels = rawCurrentUseMultipleReasoningModels || useCurrentLegacyModeFallback
        const currentUseMultipleImageModels = rawCurrentUseMultipleImageModels || useCurrentLegacyModeFallback
        const currentUseMultipleVideoModels = rawCurrentUseMultipleVideoModels || useCurrentLegacyModeFallback
        const needsUpdate = currentAttrs.aiModel !== pending.aiModel
            || currentUseMultipleReasoningModels !== pendingUseMultipleReasoningModels
            || currentUseMultipleImageModels !== pendingUseMultipleImageModels
            || currentUseMultipleVideoModels !== pendingUseMultipleVideoModels
            || (pendingAiModels !== undefined && currentAttrs.aiModels !== pendingAiModels)
            || (pending.imageOptions?.aiImageModel && currentAttrs.aiImageModel !== pending.imageOptions.aiImageModel)
            || (pendingImageModels !== undefined && currentAttrs.aiImageModels !== pendingImageModels)
            || (pending.imageOptions?.imageGenerationSize && currentAttrs.imageGenerationSize !== pending.imageOptions.imageGenerationSize)
            || (pendingImageConfigGroups !== undefined && currentAttrs.imageGenerationConfigGroups !== pendingImageConfigGroups)
            || (pending.videoOptions?.aiVideoModel && currentAttrs.aiVideoModel !== pending.videoOptions.aiVideoModel)
            || (pendingVideoModels !== undefined && currentAttrs.aiVideoModels !== pendingVideoModels)
            || (pending.videoOptions?.videoAspectRatio && currentAttrs.videoAspectRatio !== pending.videoOptions.videoAspectRatio)
            || (pending.videoOptions?.videoResolution && currentAttrs.videoResolution !== pending.videoOptions.videoResolution)
            || (pending.videoOptions?.videoDuration && currentAttrs.videoDuration !== pending.videoOptions.videoDuration)
            || (pendingVideoConfigGroups !== undefined && currentAttrs.videoGenerationConfigGroups !== pendingVideoConfigGroups)

        if (needsUpdate) {
            const mappedThreadPos = tr.mapping.map(threadPos)
            tr = tr.setNodeMarkup(mappedThreadPos, undefined, {
                ...currentAttrs,
                aiModel: pending.aiModel,
                useMultipleModels: pendingUseMultipleModels,
                useMultipleReasoningModels: pendingUseMultipleReasoningModels,
                useMultipleImageModels: pendingUseMultipleImageModels,
                useMultipleVideoModels: pendingUseMultipleVideoModels,
                aiModels: pendingAiModels,
                ...(pending.imageOptions ? {
                    aiImageModel: pending.imageOptions.aiImageModel || '',
                    ...(pendingImageModels !== undefined ? { aiImageModels: pendingImageModels } : {}),
                    imageGenerationSize: pending.imageOptions.imageGenerationSize,
                    ...(pendingImageConfigGroups !== undefined ? { imageGenerationConfigGroups: pendingImageConfigGroups } : {}),
                } : {}),
                ...(pending.videoOptions ? {
                    aiVideoModel: pending.videoOptions.aiVideoModel || '',
                    ...(pendingVideoModels !== undefined ? { aiVideoModels: pendingVideoModels } : {}),
                    videoAspectRatio: pending.videoOptions.videoAspectRatio || '',
                    videoResolution: pending.videoOptions.videoResolution || '',
                    videoDuration: pending.videoOptions.videoDuration || '',
                    ...(pendingVideoConfigGroups !== undefined ? { videoGenerationConfigGroups: pendingVideoConfigGroups } : {}),
                } : {})
            })
        }

        // Set the USE_AI_CHAT_META to trigger the AI request handler in the thread plugin
        tr = tr.setMeta(USE_AI_CHAT_META, { threadId, nodePos: threadPos })
        editorView.dispatch(tr)

        // Trigger gradient animation
        entry.triggerGradientAnimation?.()
    }

    private async createThreadAndSubmit(params: {
        contentJSON: any
        aiModel: string
        aiModels?: string[]
        useMultipleModels?: boolean
        useMultipleReasoningModels?: boolean
        useMultipleImageModels?: boolean
        useMultipleVideoModels?: boolean
        imageOptions?: PendingMessage['imageOptions']
        videoOptions?: PendingMessage['videoOptions']
        referenceNodeIds?: string[]
    }): Promise<void> {
        const {
            contentJSON,
            aiModel,
            aiModels,
            useMultipleModels,
            useMultipleReasoningModels,
            useMultipleImageModels,
            useMultipleVideoModels,
            imageOptions,
            videoOptions,
            referenceNodeIds,
        } = params
        if (!this.target) return

        const threadId = uuidv4()
        const legacyUseMultipleModels = Boolean(useMultipleModels)
        const threadUseMultipleReasoningModels = useMultipleReasoningModels ?? legacyUseMultipleModels
        const threadUseMultipleImageModels = useMultipleImageModels ?? legacyUseMultipleModels
        const threadUseMultipleVideoModels = useMultipleVideoModels ?? legacyUseMultipleModels
        const threadUseMultipleModels = threadUseMultipleReasoningModels
            || threadUseMultipleImageModels
            || threadUseMultipleVideoModels
        const threadImageModels = imageOptions
            ? serializeAiModelSelectionAttr(
                threadUseMultipleImageModels
                    ? imageOptions.aiImageModels ?? []
                    : imageOptions.aiImageModel ? [imageOptions.aiImageModel] : []
            )
            : ''
        const threadVideoModels = videoOptions
            ? serializeAiModelSelectionAttr(
                threadUseMultipleVideoModels
                    ? videoOptions.aiVideoModels ?? []
                    : videoOptions.aiVideoModel ? [videoOptions.aiVideoModel] : []
            )
            : ''
        const threadImageConfigGroups = threadUseMultipleImageModels
            ? serializeMediaGenerationConfigSelectionAttr(imageOptions?.configGroups ?? [])
            : ''
        const threadVideoConfigGroups = threadUseMultipleVideoModels
            ? serializeMediaGenerationConfigSelectionAttr(videoOptions?.configGroups ?? [])
            : ''

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
                    attrs: {
                        threadId,
                        aiModel,
                        useMultipleModels: threadUseMultipleModels,
                        useMultipleReasoningModels: threadUseMultipleReasoningModels,
                        useMultipleImageModels: threadUseMultipleImageModels,
                        useMultipleVideoModels: threadUseMultipleVideoModels,
                        aiModels: serializeAiModelSelectionAttr(
                            threadUseMultipleReasoningModels
                                ? aiModels ?? []
                                : aiModel ? [aiModel] : []
                        ),
                        ...(imageOptions?.aiImageModel ? { aiImageModel: imageOptions.aiImageModel } : {}),
                        ...(threadImageModels ? { aiImageModels: threadImageModels } : {}),
                        ...(imageOptions?.imageGenerationSize ? { imageGenerationSize: imageOptions.imageGenerationSize } : {}),
                        ...(threadImageConfigGroups ? { imageGenerationConfigGroups: threadImageConfigGroups } : {}),
                        ...(videoOptions?.aiVideoModel ? { aiVideoModel: videoOptions.aiVideoModel } : {}),
                        ...(threadVideoModels ? { aiVideoModels: threadVideoModels } : {}),
                        ...(videoOptions?.videoAspectRatio ? { videoAspectRatio: videoOptions.videoAspectRatio } : {}),
                        ...(videoOptions?.videoResolution ? { videoResolution: videoOptions.videoResolution } : {}),
                        ...(videoOptions?.videoDuration ? { videoDuration: videoOptions.videoDuration } : {}),
                        ...(threadVideoConfigGroups ? { videoGenerationConfigGroups: threadVideoConfigGroups } : {}),
                    },
                    content: [
                        {
                            type: 'aiUserMessage',
                            attrs: { id: createId(), createdAt: Date.now(), referenceNodeIds: referenceNodeIds ?? [] },
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
                aiModel,
                owner: { type: 'standalone' }
            })

            if (!thread) {
                console.error('[AiPromptInputController] Failed to create AI chat thread')
                return
            }

            // The thread is a read-only transcript hosted in the right side panel;
            // it has no on-canvas node. Queue the AI submit for after the panel
            // thread editor mounts — the message is already in the initial content,
            // so we just need to trigger the AI request.
            this.pendingMessages.set(threadId, {
                content: contentJSON,
                aiModel,
                aiModels,
                useMultipleModels: threadUseMultipleModels,
                useMultipleReasoningModels: threadUseMultipleReasoningModels,
                useMultipleImageModels: threadUseMultipleImageModels,
                useMultipleVideoModels: threadUseMultipleVideoModels,
                imageOptions,
                videoOptions,
                referenceNodeIds,
            })

            // Update target to point to the new thread (panel-only, no canvas node).
            this.target = {
                nodeId: `node-${threadId}`,
                type: 'aiChatThread',
                referenceId: threadId
            }
            this.onAiChatThreadCreated?.({ threadId })
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
