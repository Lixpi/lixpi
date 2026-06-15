'use strict'

import { v4 as uuidv4 } from 'uuid'
import { NATS_SUBJECTS, STREAM_STATUS } from '@lixpi/constants'
import type {
    AiInteractionChatSendMessagePayload,
    AiInteractionChatStopMessagePayload,
    ImageGenerationTrace,
    ImageGenerationSize,
    MediaBranchLineagePlan,
    MediaGenerationRunMeta,
    VideoGenerationTrace,
    WorkspaceContextResolution
} from '@lixpi/constants'

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS

import AuthService from '$src/services/auth-service.ts'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.ts'
import { MarkdownStreamParser } from '@lixpi/markdown-stream-parser'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { organizationStore } from '$src/stores/organizationStore.ts'

type SendChatMessageOptions = Omit<AiInteractionChatSendMessagePayload, 'threadId'> & {
    aiModels?: string[]
    aiImageModel?: string
    aiImageModels?: string[]
    imageSize?: ImageGenerationSize
    aiVideoModel?: string
    aiVideoModels?: string[]
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string
    // Workspace Object Store URI of an existing generated video that VEO should
    // extend (continuation generation). Built by WorkspaceCanvas from the
    // source VideoCanvasNode's fileId + workspaceId when the thread is rooted
    // in an "Extend in new thread" action.
    videoSourceForExtension?: string
}

type MarkdownParserContext = {
    parser: ReturnType<typeof MarkdownStreamParser.getInstance>
    unsubscribe?: () => void
    aiProvider: string | null
    generationRun?: MediaGenerationRunMeta
}

export default class AiInteractionService {
    workspaceId: string
    aiChatThreadId: string
    segmentsReceiver: any
    markdownParserContexts: Map<string, MarkdownParserContext>
    currentAiProvider: string | null

    constructor({ workspaceId, aiChatThreadId }: { workspaceId: string; aiChatThreadId: string }) {
        this.workspaceId = workspaceId
        this.aiChatThreadId = aiChatThreadId
        this.segmentsReceiver = SegmentsReceiver
        this.markdownParserContexts = new Map()
        this.currentAiProvider = null

        this.initNatsSubscriptions()
    }

    getRunKey(generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.reasoningRunId || this.aiChatThreadId
    }

    getParserInstanceId(runKey: string): string {
        return runKey === this.aiChatThreadId ? this.aiChatThreadId : `${this.aiChatThreadId}:${runKey}`
    }

    getGenerationRun(content: any): MediaGenerationRunMeta | undefined {
        return content?.generationRun
            ?? content?.imageGenerationTrace?.generationRun
            ?? content?.videoGenerationTrace?.generationRun
    }

    cleanupMarkdownParserContext(runKey: string): void {
        const context = this.markdownParserContexts.get(runKey)
        context?.unsubscribe?.()
        MarkdownStreamParser.removeInstance(this.getParserInstanceId(runKey))
        this.markdownParserContexts.delete(runKey)
        if (runKey === this.aiChatThreadId) {
            this.currentAiProvider = null
        }
    }

    initMarkdownParser(generationRun?: MediaGenerationRunMeta, aiProvider?: string) {
        const runKey = this.getRunKey(generationRun)
        this.cleanupMarkdownParserContext(runKey)

        const parserInstanceId = this.getParserInstanceId(runKey)
        // Initialize markdown stream parser (exact replication of backend pattern)
        const parser = MarkdownStreamParser.getInstance(parserInstanceId)

        const context: MarkdownParserContext = {
            parser,
            aiProvider: aiProvider || null,
            ...(generationRun ? { generationRun } : {}),
        }
        this.markdownParserContexts.set(runKey, context)

        // Subscribe to parsed segments from the markdown stream parser
        context.unsubscribe = parser.subscribeToTokenParse((parsedSegment, unsubscribe) => {
            // Emit parsed content to segmentsReceiver with aiProvider and aiChatThreadId
            const currentContext = this.markdownParserContexts.get(runKey) ?? context
            this.segmentsReceiver.receiveSegment({
                ...parsedSegment,
                aiProvider: currentContext.aiProvider,
                aiChatThreadId: this.aiChatThreadId,
                ...(currentContext.generationRun ? { generationRun: currentContext.generationRun } : {}),
            })

            // Cleanup on stream end
            if (parsedSegment.status === 'END_STREAM') {
                unsubscribe()
                MarkdownStreamParser.removeInstance(parserInstanceId)
                this.markdownParserContexts.delete(runKey)
                if (runKey === this.aiChatThreadId) {
                    this.currentAiProvider = null
                }
            }
        })
    }

    updateRunProvider(runKey: string, aiProvider: string | undefined): string | null {
        if (!aiProvider) {
            return this.markdownParserContexts.get(runKey)?.aiProvider ?? this.currentAiProvider
        }

        const existingContext = this.markdownParserContexts.get(runKey)
        if (existingContext) {
            existingContext.aiProvider = aiProvider
        }
        if (runKey === this.aiChatThreadId) {
            this.currentAiProvider = aiProvider
        }
        return aiProvider
    }

    async initNatsSubscriptions() {
        try {
            if (!this.workspaceId || !this.aiChatThreadId)
                throw new Error('AiInteractionService requires workspaceId and aiChatThreadId')

            const subject = `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${this.workspaceId}.${this.aiChatThreadId}`

            // Only unsubscribe previous subscriptions for THIS specific thread, not all threads
            servicesStore.getData('nats')!.getSubscriptions([subject]).forEach(sub => sub.unsubscribe())

            console.log(`[AI_INTERACTION] Subscribing to NATS response channel: ${subject}`)
            this.subscribeToChatMessages()
        } catch (error) {
            console.error('Failed to initialize NATS service:', error)
        }
    }

    async subscribeToChatMessages() {
        const subject = `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${this.workspaceId}.${this.aiChatThreadId}`
        // Subscribe to responses for this specific workspace and thread
        servicesStore.getData('nats')!.subscribe(
            subject,
            (data, msg) => {
                this.onChatMessageResponse(data)
            }
        )
    }


    onChatMessageResponse(data: any) {
        try {
            if (data?.error) {
                alert(`Failed to receive chat message: \n${JSON.stringify(data.error)}`)
                return
            }

            const { content } = data

            if (!content) {
                console.error('No content in AI chat message:', data)
                return
            }

            const generationRun = this.getGenerationRun(content)
            const runKey = this.getRunKey(generationRun)
            const aiProvider = this.updateRunProvider(runKey, content.aiProvider)
            const segmentBase = {
                aiProvider,
                aiChatThreadId: this.aiChatThreadId,
                ...(generationRun ? { generationRun } : {}),
            }

            if (content.status === STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED) {
                const workspaceContextResolution = content.workspaceContextResolution as WorkspaceContextResolution
                console.log('[AI_INTERACTION] CONTEXT_RELEVANCE_RESOLVED received:', {
                    selectionCount: workspaceContextResolution?.selections.length ?? 0,
                    improvedDescriptorCount: Object.keys(workspaceContextResolution?.improvedDescriptors ?? {}).length,
                    narrowedMediaCount: workspaceContextResolution?.narrowedMediaNodeIds.length ?? 0,
                })
                this.segmentsReceiver.receiveSegment({
                    type: 'context_relevance_resolved',
                    workspaceContextResolution,
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.CONTEXT_RELEVANCE_ERROR) {
                console.log('[AI_INTERACTION] CONTEXT_RELEVANCE_ERROR received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'context_relevance_error',
                    error: content.error || 'Workspace context relevance failed',
                    ...segmentBase,
                })
                return
            }

            // Handle image generation events (bypass markdown parser)
            if (content.status === STREAM_STATUS.IMAGE_GENERATION_TRACE) {
                const imageGenerationTrace = content.imageGenerationTrace as ImageGenerationTrace
                console.log('[AI_INTERACTION] IMAGE_GENERATION_TRACE received:', {
                    imageModelId: imageGenerationTrace?.imageModelId,
                    referenceCount: imageGenerationTrace?.referenceImages.length ?? 0,
                    excludedReferenceCount: imageGenerationTrace?.excludedReferences.length ?? 0,
                })
                this.segmentsReceiver.receiveSegment({
                    type: 'image_generation_trace',
                    imageGenerationTrace,
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.IMAGE_PARTIAL) {
                console.log('[AI_INTERACTION] IMAGE_PARTIAL received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'image_partial',
                    imageUrl: content.imageUrl,
                    fileId: content.fileId,
                    workspaceId: this.workspaceId,
                    partialIndex: content.partialIndex,
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.IMAGE_BRANCH_RESOLVED) {
                console.log('[AI_INTERACTION] IMAGE_BRANCH_RESOLVED received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'image_branch_resolved',
                    imageBranchResolution: content.resolution,
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.MEDIA_LINEAGE_PLANNED) {
                const lineagePlan = content.lineagePlan as MediaBranchLineagePlan
                console.log('[AI_INTERACTION] MEDIA_LINEAGE_PLANNED received:', {
                    generationRequestId: lineagePlan?.generationRequestId,
                    branchForkCount: lineagePlan?.branchForks.length ?? 0,
                    runAssignmentCount: lineagePlan?.runAssignments.length ?? 0,
                })
                this.segmentsReceiver.receiveSegment({
                    type: 'media_lineage_planned',
                    mediaBranchLineagePlan: lineagePlan,
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.IMAGE_BRANCH_RESOLUTION_ERROR) {
                console.log('[AI_INTERACTION] IMAGE_BRANCH_RESOLUTION_ERROR received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'image_branch_resolution_error',
                    error: content.error || 'Image branch resolution failed',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.IMAGE_COMPLETE) {
                console.log('[AI_INTERACTION] IMAGE_COMPLETE received:', content)

                this.segmentsReceiver.receiveSegment({
                    type: 'image_complete',
                    imageUrl: content.imageUrl,
                    fileId: content.fileId,
                    workspaceId: this.workspaceId,
                    responseId: content.responseId,
                    revisedPrompt: content.revisedPrompt,
                    aiProvider: aiProvider || '',
                    imageModelProvider: content.imageModelProvider || content.aiProvider || '',
                    imageModelId: content.imageModelId || '',
                    ...(generationRun ? { generationRun } : {}),
                    aiChatThreadId: this.aiChatThreadId
                })
                return
            }

            if (content.status === STREAM_STATUS.IMAGE_ERROR) {
                console.log('[AI_INTERACTION] IMAGE_ERROR received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'image_error',
                    error: content.error || 'Image generation failed',
                    ...segmentBase,
                })
                return
            }

            // Video generation events (VEO). PENDING creates the canvas placeholder
            // and starts the PIXI traveling outline; GENERATING is a keepalive ping
            // emitted during the multi-minute poll loop; COMPLETE finalizes the
            // canvas node and removes the outline; ERROR cleans up.
            if (content.status === STREAM_STATUS.VIDEO_GENERATION_TRACE) {
                const videoGenerationTrace = content.videoGenerationTrace as VideoGenerationTrace
                console.log('[AI_INTERACTION] VIDEO_GENERATION_TRACE received:', {
                    videoModelId: videoGenerationTrace?.videoModelId,
                    referenceCount: videoGenerationTrace?.referenceImages.length ?? 0,
                    excludedReferenceCount: videoGenerationTrace?.excludedReferences.length ?? 0,
                })
                this.segmentsReceiver.receiveSegment({
                    type: 'video_generation_trace',
                    videoGenerationTrace,
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.VIDEO_PENDING) {
                console.log('[AI_INTERACTION] VIDEO_PENDING received')
                this.segmentsReceiver.receiveSegment({
                    type: 'video_pending',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.VIDEO_GENERATING) {
                this.segmentsReceiver.receiveSegment({
                    type: 'video_generating',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.VIDEO_COMPLETE) {
                console.log('[AI_INTERACTION] VIDEO_COMPLETE received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'video_complete',
                    videoUrl: content.videoUrl,
                    fileId: content.fileId,
                    workspaceId: this.workspaceId,
                    posterUrl: content.posterUrl,
                    posterFileId: content.posterFileId,
                    frameUrl: content.frameUrl,
                    frameFileId: content.frameFileId,
                    durationSeconds: content.durationSeconds,
                    aspectRatio: content.aspectRatio,
                    hasAudio: content.hasAudio,
                    responseId: content.responseId,
                    revisedPrompt: content.revisedPrompt,
                    videoModel: content.videoModelId,
                    videoModelProvider: content.videoModelProvider || content.aiProvider || '',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.VIDEO_ERROR) {
                console.log('[AI_INTERACTION] VIDEO_ERROR received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'video_error',
                    error: content.error || 'Video generation failed',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.ERROR) {
                this.segmentsReceiver.receiveSegment({
                    status: 'ERROR',
                    error: content.text || content.error || 'AI generation failed',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.COLLAPSIBLE_START) {
                this.segmentsReceiver.receiveSegment({
                    type: 'collapsible_start',
                    collapsibleTitle: content.collapsibleTitle || 'Image generation prompt',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.COLLAPSIBLE_END) {
                this.segmentsReceiver.receiveSegment({
                    type: 'collapsible_end',
                    ...segmentBase,
                })
                return
            }

            // Route raw tokens through markdown parser (exact replication of backend pattern)
            if (content.status === STREAM_STATUS.START_STREAM) {
                // Initialize fresh parser instance for this stream
                this.initMarkdownParser(generationRun, aiProvider || undefined)
                // startParsing() emits START_STREAM event via subscribeToTokenParse callback
                this.markdownParserContexts.get(runKey)?.parser.startParsing()
            } else if (content.status === STREAM_STATUS.STREAMING && content.text) {
                // Feed raw token to parser - it will emit parsed segments via subscribeToTokenParse callback
                this.markdownParserContexts.get(runKey)?.parser.parseToken(content.text)
            } else if (content.status === STREAM_STATUS.END_STREAM) {
                // stopParsing() will emit END_STREAM event internally via subscribeToTokenParse callback
                this.markdownParserContexts.get(runKey)?.parser.stopParsing()
            }
        } catch (error) {
            console.error('[AI_INTERACTION] onChatMessageResponse failed:', { data }, error)
        }
    }

    async sendChatMessage({
        messages,
        aiModel,
        aiModels,
        aiImageModel,
        aiImageModels,
        imageSize,
        aiVideoModel,
        aiVideoModels,
        videoAspectRatio,
        videoResolution,
        videoDuration,
        videoSourceForExtension,
        referencedFeatureIds,
        imageBranchCandidateSnapshot,
        workspaceContextSnapshot,
    }: SendChatMessageOptions) {
        const organizationId = organizationStore.getData('organizationId')
        const user = userStore.getData()

        const payload: Record<string, any> = {
            token: await AuthService.getTokenSilently(),
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId,
            messages,
            aiModel,
            organizationId
        }

        if (referencedFeatureIds?.length) {
            payload.referencedFeatureIds = referencedFeatureIds
        }

        if (imageBranchCandidateSnapshot) {
            payload.imageBranchCandidateSnapshot = imageBranchCandidateSnapshot
        }

        // Whole-workspace descriptors index for the API relevance stage. Sent on
        // every turn (text-only included); the API consumes it in a later phase.
        if (workspaceContextSnapshot) {
            payload.workspaceContextSnapshot = workspaceContextSnapshot
        }

        // Add image model routing options if an image model is selected
        if (aiImageModel) {
            payload.aiImageModel = aiImageModel
            payload.imageSize = imageSize || 'auto'
        }

        // Add video model routing options if a video model is selected. The
        // text model decides between generate_image vs generate_video at runtime
        // when both are present — see ImageBranchResolver + LangGraph routing.
        if (aiVideoModel) {
            payload.aiVideoModel = aiVideoModel
            if (videoAspectRatio) payload.videoAspectRatio = videoAspectRatio
            if (videoResolution) payload.videoResolution = videoResolution
            if (videoDuration) payload.videoDuration = videoDuration
            if (videoSourceForExtension) payload.videoSourceForExtension = videoSourceForExtension
        }

        const reasoningModelIds = aiModels?.length ? aiModels : aiModel ? [aiModel] : []
        const imageModelIds = aiImageModels?.length ? aiImageModels : aiImageModel ? [aiImageModel] : []
        const videoModelIds = aiVideoModels?.length ? aiVideoModels : aiVideoModel ? [aiVideoModel] : []
        const selectedModelCount = reasoningModelIds.length + imageModelIds.length + videoModelIds.length
        const scalarModelCount = (aiModel ? 1 : 0) + (aiImageModel ? 1 : 0) + (aiVideoModel ? 1 : 0)
        if (selectedModelCount > scalarModelCount) {
            payload.mediaGenerationRequest = {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: uuidv4(),
                reasoningModelIds,
                imageModelIds,
                videoModelIds,
                imageOptions: {
                    imageSize: imageSize || 'auto',
                },
                videoOptions: {
                    ...(videoAspectRatio ? { aspectRatio: videoAspectRatio } : {}),
                    ...(videoResolution ? { resolution: videoResolution } : {}),
                    ...(videoDuration ? { duration: videoDuration } : {}),
                    ...(videoSourceForExtension ? { sourceForExtension: videoSourceForExtension } : {}),
                },
            }
        }

        console.log(`[AI_INTERACTION] Publishing message to ${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE}`, {
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId,
            aiModel,
            reasoningModelCount: reasoningModelIds.length,
            messageCount: messages.length,
            imageModelCount: imageModelIds.length,
            videoModelCount: videoModelIds.length,
            hasImageModel: imageModelIds.length > 0,
            hasVideoModel: videoModelIds.length > 0,
            referencedFeatureCount: referencedFeatureIds?.length ?? 0,
            imageBranchCandidateCount: imageBranchCandidateSnapshot?.candidates.length ?? 0,
            workspaceContextNodeCount: workspaceContextSnapshot?.nodes.length ?? 0,
        })

        servicesStore.getData('nats')!.publish(AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE, payload)
    }

    async stopChatMessage() {
        const payload = {
            token: await AuthService.getTokenSilently(),
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId
        }

        servicesStore.getData('nats')!.publish(AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE, payload)
    }

    disconnect() {
        const subject = `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${this.workspaceId}.${this.aiChatThreadId}`
        for (const runKey of Array.from(this.markdownParserContexts.keys())) {
            this.cleanupMarkdownParserContext(runKey)
        }
        servicesStore.getData('nats')?.getSubscriptions([subject]).forEach(sub => sub.unsubscribe())
        this.currentAiProvider = null
    }

    destroy() {
        this.disconnect()
    }
}
