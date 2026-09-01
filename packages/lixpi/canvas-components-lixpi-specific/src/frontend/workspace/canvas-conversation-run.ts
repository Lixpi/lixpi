import {
    type AiInteractionChatSendMessagePayload,
    type AiInteractionMediaGenerationRequest,
    type CanvasNode,
    type CanvasState,
    type ImageGenerationSize,
    type MediaGenerationConfigSelectionGroup,
    type MediaBranchCandidateSnapshot,
} from '@lixpi/constants'
import {
    extractPromptTextFromContentJSON,
    type AiPromptComposerSubmitData,
} from '../../shared/composer/canvas-conversation-content.ts'
import {
    getBranchMarkerPromptParts,
    type BranchMarkerPromptPart,
} from '../../shared/branch-tree-layout/marker-prompt-parts.ts'
import {
    getPromptTextFromMessages,
    type WorkspaceGenerationContext,
    type ChatMessageLike,
} from '../../shared/generation/workspace-generation-context.ts'
import {
    type CanvasGenerationSubmitOptions,
} from '../../shared/generation/canvas-generation-submission.ts'
import {
    type CanvasConversationEditorScope,
} from './canvas-conversation-editors.ts'
import {
    type CanvasMediaSegment,
    type CanvasMediaSegmentOptions,
} from '../../shared/generation/canvas-generation-events.ts'

export type CanvasGenerationRequest = Omit<AiInteractionChatSendMessagePayload, 'conversationAssetId'> & {
    mediaGenerationMode?: 'image' | 'video'
    useMultipleReasoningModels?: boolean
    useMultipleImageModels?: boolean
    useMultipleVideoModels?: boolean
    reasoningConfigGroups?: MediaGenerationConfigSelectionGroup[]
    aiImageModels?: string[]
    imageSize?: ImageGenerationSize
    imageConfigGroups?: MediaGenerationConfigSelectionGroup[]
    aiVideoModels?: string[]
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string
    videoConfigGroups?: MediaGenerationConfigSelectionGroup[]
    regeneration?: NonNullable<AiInteractionMediaGenerationRequest['regeneration']>
    videoSourceForExtension?: string
}

export type CanvasConversationSubmit = Omit<AiPromptComposerSubmitData, 'imageOptions' | 'videoOptions' | 'contentJSON' | 'capabilityInputs'> & {
    messages: ChatMessageLike[]
    imageOptions?: { aiImageModels: string[]; imageGenerationSize?: ImageGenerationSize; configGroups?: MediaGenerationConfigSelectionGroup[] }
    videoOptions?: AiPromptComposerSubmitData['videoOptions'] & { sourceVideoNodeId?: string }
    referenceNodeIds?: string[]
}

export type CanvasConversationThread = {
    threadId: string
    organizationId: string
    content?: object
    proseMirrorVersion?: number
}

export type CanvasConversationEditor = {
    activate: () => void
    readContent: () => object | undefined
    submitPersisted: () => void
    destroy: () => void
}

export type CanvasConversationEditorMount = {
    container: HTMLElement
    workspaceId: string
    thread: CanvasConversationThread
    onChange: (content: object) => void
    onStreaming: (content: object) => void
    onSubmit: (data: CanvasConversationSubmit) => Promise<void>
    onStop: () => void
    onReceiving: (threadId: string, receiving: boolean) => void
    onSegment: (event: CanvasMediaSegment, options?: CanvasMediaSegmentOptions) => void
}

export type CanvasConversationTransport = {
    send: (request: CanvasGenerationRequest) => Promise<unknown>
    stop: () => Promise<unknown>
    disconnect: () => void
}

export type CanvasGenerationPreflight = {
    generationRequestId?: string
    placementAnchorNodeId?: string
    referenceNodeIds: string[]
    promptText: string
    promptParts: BranchMarkerPromptPart[]
    mediaBranchCandidateSnapshot: MediaBranchCandidateSnapshot
    createdAt: number
}

export type CanvasConversationRunOptions = CanvasGenerationSubmitOptions & {
    workspaceId: string
    thread: CanvasConversationThread
    submittedData?: AiPromptComposerSubmitData
}

export type CanvasConversationRunPorts = {
    mountEditor: (options: CanvasConversationEditorMount) => CanvasConversationEditor
    connect: (options: { workspaceId: string; thread: CanvasConversationThread; onError: (error: unknown) => void }) => CanvasConversationTransport
    context: WorkspaceGenerationContext
    readCanvasState: () => CanvasState | null
    getContextTitles: (nodes: CanvasNode[]) => Record<string, string>
    getVisibleArea: () => { width: number; height: number } | undefined
    createRequestId: () => string
    now: () => number
    publishContent: (content: object) => void
    rememberContent: (threadId: string, content: object, streaming: boolean | null) => void
    refreshProjection: (threadId: string) => void
    setReceiving?: (threadId: string, receiving: boolean) => void
    hasPendingPlacement: (threadId: string) => boolean
    deferTeardown: (threadId: string) => void
    preflight: (placement: CanvasGenerationPreflight, data: AiPromptComposerSubmitData, regeneration: CanvasGenerationSubmitOptions['regeneration']) => void
    clearContext: () => void
    fail: () => void
    teardown: () => void
    reportError: (error: unknown) => void
    onSegment: (event: CanvasMediaSegment, options?: CanvasMediaSegmentOptions) => void
}

export class CanvasConversationRun {
    private editor: CanvasConversationEditor | null = null
    private transport: CanvasConversationTransport | null = null
    private readonly options: CanvasConversationRunOptions

    constructor(
        private readonly scope: CanvasConversationEditorScope,
        options: CanvasConversationRunOptions,
        private readonly ports: CanvasConversationRunPorts,
    ) {
        this.options = structuredClone(options)
        const { thread, workspaceId } = this.options
        const editor = ports.mountEditor({
            container: scope.container,
            thread,
            workspaceId,
            onChange: content => this.contentChanged(content, false),
            onStreaming: content => this.contentChanged(content, true),
            onSubmit: data => this.submit(data),
            onStop: () => {
                void this.stop()
            },
            onReceiving: (threadId, receiving) => this.receivingChanged(threadId, receiving),
            onSegment: (event, options) => {
                if (!scope.isCurrent()) return
                if (event.workspaceId && event.workspaceId !== workspaceId) return
                if ((event.conversationAssetId || event.threadId) !== thread.threadId) return
                ports.onSegment(event, options)
            },
        })
        this.editor = editor
        scope.own(() => editor.destroy())
        if (!scope.isCurrent()) throw new DOMException('Canvas conversation was replaced', 'AbortError')
        const transport = ports.connect({
            workspaceId,
            thread,
            onError: () => {
                if (scope.isCurrent()) ports.fail()
            },
        })
        this.transport = transport
        scope.own(() => transport.disconnect())
        if (!scope.isCurrent()) throw new DOMException('Canvas conversation was replaced', 'AbortError')
        editor.activate()
    }

    submitPersisted(): void {
        if (this.scope.isCurrent()) this.editor?.submitPersisted()
    }

    private contentChanged(content: object, streaming: boolean): void {
        if (!this.scope.isCurrent()) return
        const { threadId } = this.options.thread
        this.ports.rememberContent(threadId, content, streaming)
        if (!this.scope.isCurrent()) return
        if (!streaming) this.ports.publishContent(content)
        if (this.scope.isCurrent()) this.ports.refreshProjection(threadId)
    }

    private receivingChanged(threadId: string, receiving: boolean): void {
        if (!this.scope.isCurrent() || threadId !== this.options.thread.threadId) return
        this.ports.setReceiving?.(threadId, receiving)
        if (!this.scope.isCurrent()) return
        const content = this.editor?.readContent()
        if (content) {
            this.ports.rememberContent(threadId, content, null)
            this.ports.refreshProjection(threadId)
        }
        if (this.scope.isCurrent() && !receiving && !this.ports.hasPendingPlacement(threadId)) {
            this.ports.deferTeardown(threadId)
        }
    }

    private async stop(): Promise<void> {
        if (!this.scope.isCurrent() || !this.transport) return
        try {
            await this.transport.stop()
        } catch (error) {
            this.ports.reportError(error)
        }
    }

    private async submit(submission: CanvasConversationSubmit): Promise<void> {
        const submittedData = this.options.submittedData
        if (!this.scope.isCurrent() || !submittedData) return
        const { thread: { threadId }, workspaceId, regeneration } = this.options
        try {
            const content = this.editor?.readContent()
            if (content) {
                this.ports.publishContent(content)
                if (!this.scope.isCurrent()) return
                this.ports.refreshProjection(threadId)
            }
            if (!this.scope.isCurrent()) return
            const data = structuredClone(submission)
            const state = structuredClone(this.ports.readCanvasState())
            const excluded = new Set(this.options.excludedCanvasNodeIds)
            const nodes = (state?.nodes ?? []).filter(node => !excluded.has(node.nodeId))
            const edges = (state?.edges ?? []).filter(edge => !excluded.has(edge.sourceNodeId) && !excluded.has(edge.targetNodeId))
            const promptText = extractPromptTextFromContentJSON(submittedData.contentJSON) || getPromptTextFromMessages(data.messages)
            const promptParts = getBranchMarkerPromptParts({ type: 'doc', content: submittedData.contentJSON }, promptText)
            const submittedExplicitContextNodeIds = [
                ...new Set([
                    ...(this.options.explicitContextNodeIds ?? []),
                    ...(data.referenceNodeIds ?? []),
                ]),
            ].filter(nodeId => !excluded.has(nodeId))
            const mediaNodeIds = new Set(nodes.filter(node => node.type === 'image' || node.type === 'video').map(node => node.nodeId))
            const referenceNodeIds = submittedExplicitContextNodeIds.filter(nodeId => mediaNodeIds.has(nodeId))
            const { imageOptions, videoOptions } = data
            const hasMediaModel = Boolean(imageOptions?.aiImageModels?.length || videoOptions?.aiVideoModels?.length)
            const generationRequestId = hasMediaModel ? this.ports.createRequestId() : undefined
            const mediaBranchCandidateSnapshot = hasMediaModel
                ? this.ports.context.buildExplicitMediaCandidateSnapshot({
                    generationRunId: threadId,
                    nodes,
                    edges,
                    prompt: promptText,
                    referenceNodeIds,
                })
                : undefined
            const workspaceContextSnapshot = state
                ? this.ports.context.buildWorkspaceContextSnapshot({
                    workspaceId,
                    conversationAssetId: threadId,
                    prompt: promptText,
                    nodes,
                    edges,
                    contextChipNodeIds: submittedExplicitContextNodeIds,
                    titlesByNodeId: this.ports.getContextTitles(nodes),
                })
                : undefined
            if (mediaBranchCandidateSnapshot) {
                const placementAnchorNodeId = mediaBranchCandidateSnapshot.candidates.find(candidate => candidate.candidateId === mediaBranchCandidateSnapshot.activeTargetCandidateId)?.nodeId
                this.ports.preflight(
                    {
                        ...(generationRequestId ? { generationRequestId } : {}),
                        ...(placementAnchorNodeId ? { placementAnchorNodeId } : {}),
                        referenceNodeIds,
                        promptText,
                        promptParts,
                        mediaBranchCandidateSnapshot,
                        createdAt: this.ports.now(),
                    },
                    submittedData,
                    regeneration,
                )
            }
            if (!this.scope.isCurrent()) return
            const sourceVideoNode = state?.nodes.find(node => node.nodeId === videoOptions?.sourceVideoNodeId && node.type === 'video')
            const videoSourceForExtension = sourceVideoNode?.type === 'video' ? sourceVideoNode.assetId : undefined
            this.ports.clearContext()
            if (!this.scope.isCurrent()) return
            if (!this.transport) throw new Error('Canvas conversation transport is not initialized')
            await this.transport.send({
                ...(generationRequestId ? { generationRequestId } : {}),
                aiReasoningModels: data.aiReasoningModels ?? [],
                mediaGenerationMode: data.mediaGenerationMode,
                useMultipleReasoningModels: data.useMultipleReasoningModels,
                useMultipleImageModels: data.useMultipleImageModels,
                useMultipleVideoModels: data.useMultipleVideoModels,
                reasoningConfigGroups: submittedData.reasoningOptions?.configGroups,
                aiImageModels: imageOptions?.aiImageModels,
                imageSize: imageOptions?.imageGenerationSize,
                imageConfigGroups: imageOptions?.configGroups,
                aiVideoModels: videoOptions?.aiVideoModels,
                videoAspectRatio: videoOptions?.videoAspectRatio,
                videoResolution: videoOptions?.videoResolution,
                videoDuration: videoOptions?.videoDuration,
                videoConfigGroups: videoOptions?.configGroups,
                regeneration,
                videoSourceForExtension,
                mediaBranchCandidateSnapshot,
                workspaceContextSnapshot,
                canvasVisibleArea: this.ports.getVisibleArea(),
            })
        } catch (error) {
            this.ports.reportError(error)
            if (this.scope.isCurrent()) this.ports.teardown()
            throw error
        }
    }
}
