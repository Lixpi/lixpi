'use strict'

import { v4 as uuidv4 } from 'uuid'
import {
    NATS_SUBJECTS,
    STREAM_STATUS,
    type AiInteractionChatSendMessagePayload,
    type ImageGenerationTrace,
    type ImageGenerationSize,
    type MediaBranchLineagePlan,
    type MediaGenerationConfigSelectionGroup,
    type MediaGenerationRunMeta,
    type VideoGenerationTrace,
    type WorkspaceContextResolution
} from '@lixpi/constants'
import AuthService from '$src/services/auth-service.ts'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { organizationStore } from '$src/stores/organizationStore.ts'

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS

type SendChatMessageOptions = Omit<AiInteractionChatSendMessagePayload, 'threadId'> & {
    useMultipleReasoningModels?: boolean
    useMultipleImageModels?: boolean
    useMultipleVideoModels?: boolean
    aiImageModels?: string[]
    imageSize?: ImageGenerationSize
    imageConfigGroups?: MediaGenerationConfigSelectionGroup[]
    aiVideoModels?: string[]
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string
    videoConfigGroups?: MediaGenerationConfigSelectionGroup[]
    proseMirrorInitialDoc?: object
    proseMirrorBaseVersion?: number
    // Workspace Object Store URI of an existing generated video that VEO should
    // extend (continuation generation). Built by WorkspaceCanvas from the
    // source VideoCanvasNode's fileId + workspaceId when the thread is rooted
    // in an "Extend in new thread" action.
    videoSourceForExtension?: string
}

type PipelineEventEnvelope = {
    kind: 'PIPELINE_EVENT'
    workspaceId: string
    pipelineId: string
    eventId: string
    payload: Record<string, any>
    publishedAt: number
    streamSequence: number
}

type PipelineReplayResult = {
    error?: unknown
    events?: PipelineEventEnvelope[]
}

export default class AiInteractionService {
    workspaceId: string
    aiChatThreadId: string
    segmentsReceiver: any
    currentAiProvider: string | null
    providersByRunKey: Map<string, string>
    pipelineEventIds: Set<string>
    pipelineLocalStreamSeq: number

    constructor({ workspaceId, aiChatThreadId }: { workspaceId: string; aiChatThreadId: string }) {
        this.workspaceId = workspaceId
        this.aiChatThreadId = aiChatThreadId
        this.segmentsReceiver = SegmentsReceiver
        this.currentAiProvider = null
        this.providersByRunKey = new Map()
        this.pipelineEventIds = new Set()
        this.pipelineLocalStreamSeq = 0

        this.initNatsSubscriptions()
    }

    getRunKey(generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.reasoningRunId || this.aiChatThreadId
    }

    getGenerationRun(content: any): MediaGenerationRunMeta | undefined {
        return content?.generationRun
            ?? content?.imageGenerationTrace?.generationRun
            ?? content?.videoGenerationTrace?.generationRun
    }

    getChatResponseSubject(): string {
        return `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${this.workspaceId}.${this.aiChatThreadId}`
    }

    updateRunProvider(runKey: string, aiProvider: string | undefined): string | null {
        if (!aiProvider) {
            return this.providersByRunKey.get(runKey) ?? this.currentAiProvider
        }

        this.providersByRunKey.set(runKey, aiProvider)
        if (runKey === this.aiChatThreadId) {
            this.currentAiProvider = aiProvider
        }
        return aiProvider
    }

    async initNatsSubscriptions() {
        try {
            if (!this.workspaceId || !this.aiChatThreadId)
                throw new Error('AiInteractionService requires workspaceId and aiChatThreadId')

            const subject = this.getChatResponseSubject()

            // Only unsubscribe previous subscriptions for THIS specific thread, not all threads
            servicesStore.getData('nats')!.getSubscriptions([subject]).forEach((sub: { unsubscribe: () => void }) => sub.unsubscribe())

            console.log(`[AI_INTERACTION] Subscribing to NATS response channel: ${subject}`)
            this.subscribeToChatMessages()
            void this.resumePipelineEventStream()
        } catch (error) {
            console.error('Failed to initialize NATS service:', error)
        }
    }

    async subscribeToChatMessages() {
        const subject = this.getChatResponseSubject()
        // Subscribe to responses for this specific workspace and thread
        servicesStore.getData('nats')!.subscribe(
            subject,
            (data: any, _msg: unknown) => {
                this.onChatMessageResponse(data)
            }
        )
    }

    shouldProcessPipelinePayload(data: any): boolean {
        const pipelineEventId = typeof data?.pipelineEventId === 'string' ? data.pipelineEventId : ''
        const pipelineStreamSeq = typeof data?.pipelineStreamSeq === 'number' ? data.pipelineStreamSeq : 0

        if (pipelineEventId) {
            if (this.pipelineEventIds.has(pipelineEventId)) {
                this.pipelineLocalStreamSeq = Math.max(this.pipelineLocalStreamSeq, pipelineStreamSeq)
                return false
            }
            this.pipelineEventIds.add(pipelineEventId)
        }

        this.pipelineLocalStreamSeq = Math.max(this.pipelineLocalStreamSeq, pipelineStreamSeq)
        return true
    }

    async resumePipelineEventStream(): Promise<void> {
        try {
            const result = await servicesStore.getData('nats')!.request(
                AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME,
                {
                    token: await AuthService.getTokenSilently(),
                    workspaceId: this.workspaceId,
                    aiChatThreadId: this.aiChatThreadId,
                    localStreamSeq: this.pipelineLocalStreamSeq,
                },
            ) as PipelineReplayResult
            if (result?.error) {
                console.error('[AI_INTERACTION] CHAT_PIPELINE_RESUME failed:', result.error)
                return
            }
            for (const event of result.events ?? []) {
                this.onChatMessageResponse({
                    ...event.payload,
                    pipelineStreamSeq: event.streamSequence,
                })
            }
        } catch (error) {
            console.error('[AI_INTERACTION] CHAT_PIPELINE_RESUME failed:', error)
        }
    }


    onChatMessageResponse(data: any) {
        try {
            if (!this.shouldProcessPipelinePayload(data)) return

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
                usesServerProseMirror: true,
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
                    ...(content.canvasGeometry ? { canvasGeometry: content.canvasGeometry } : {}),
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.MEDIA_BRANCH_RESOLVED) {
                console.log('[AI_INTERACTION] MEDIA_BRANCH_RESOLVED received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'image_branch_resolved',
                    mediaBranchResolution: content.resolution,
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

            if (content.status === STREAM_STATUS.MEDIA_GENERATION_SKIPPED) {
                console.log('[AI_INTERACTION] MEDIA_GENERATION_SKIPPED received:', {
                    generationRequestId: content.generationRequestId,
                })
                this.segmentsReceiver.receiveSegment({
                    type: 'media_generation_skipped',
                    generationRequestId: content.generationRequestId || '',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.MEDIA_GENERATION_REQUEST_COMPLETE) {
                console.log('[AI_INTERACTION] MEDIA_GENERATION_REQUEST_COMPLETE received:', {
                    generationRequestId: content.generationRequestId,
                })
                this.segmentsReceiver.receiveSegment({
                    type: 'media_generation_request_complete',
                    generationRequestId: content.generationRequestId || generationRun?.generationRequestId || '',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.MEDIA_BRANCH_RESOLUTION_ERROR) {
                console.log('[AI_INTERACTION] MEDIA_BRANCH_RESOLUTION_ERROR received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'image_branch_resolution_error',
                    error: content.error || 'Image branch resolution failed',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.CANVAS_GEOMETRY_RESOLVED) {
                console.log('[AI_INTERACTION] CANVAS_GEOMETRY_RESOLVED received:', {
                    layoutRevision: content.canvasGeometry?.layoutRevision,
                    nodeCount: content.canvasGeometry?.nodes?.length ?? 0,
                })
                this.segmentsReceiver.receiveSegment({
                    type: 'canvas_geometry_resolved',
                    canvasGeometry: content.canvasGeometry,
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
                    usesServerProseMirror: true,
                    imageModelProvider: content.imageModelProvider || content.aiProvider || '',
                    imageModelId: content.imageModelId || '',
                    ...(content.canvasGeometry ? { canvasGeometry: content.canvasGeometry } : {}),
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
                    ...(content.canvasGeometry ? { canvasGeometry: content.canvasGeometry } : {}),
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
        } catch (error) {
            console.error('[AI_INTERACTION] onChatMessageResponse failed:', { data }, error)
        }
    }

    async sendChatMessage({
        messages,
        aiReasoningModels,
        useMultipleReasoningModels,
        useMultipleImageModels,
        useMultipleVideoModels,
        aiImageModels,
        imageSize,
        imageConfigGroups,
        aiVideoModels,
        videoAspectRatio,
        videoResolution,
        videoDuration,
        videoConfigGroups,
        videoSourceForExtension,
        referencedFeatureIds,
        mediaBranchCandidateSnapshot,
        workspaceContextSnapshot,
        canvasVisibleArea,
        proseMirrorInitialDoc,
        proseMirrorBaseVersion,
    }: SendChatMessageOptions) {
        const organizationId = organizationStore.getData('organizationId')
        const user = userStore.getData()

        // When a section flag is omitted, infer multi-model mode from the model
        // count; otherwise multi off collapses the section to its first model.
        const inferModeFromModels = (modelIds: string[] | undefined): boolean => (modelIds?.length ?? 0) > 1
        const reasoningModelsEnabled = useMultipleReasoningModels ?? inferModeFromModels(aiReasoningModels)
        const imageModelsEnabled = useMultipleImageModels ?? inferModeFromModels(aiImageModels)
        const videoModelsEnabled = useMultipleVideoModels ?? inferModeFromModels(aiVideoModels)
        const collapseForMode = (modelIds: string[] | undefined, useMultiple: boolean): string[] =>
            useMultiple ? (modelIds ?? []) : (modelIds ?? []).slice(0, 1)
        const reasoningModelIds = collapseForMode(aiReasoningModels, reasoningModelsEnabled)
        const imageModelIds = collapseForMode(aiImageModels, imageModelsEnabled)
        const videoModelIds = collapseForMode(aiVideoModels, videoModelsEnabled)

        const payload: Record<string, any> = {
            token: await AuthService.getTokenSilently(),
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId,
            messages,
            aiReasoningModels: reasoningModelIds,
            organizationId
        }

        if (referencedFeatureIds?.length) {
            payload.referencedFeatureIds = referencedFeatureIds
        }

        if (mediaBranchCandidateSnapshot) {
            payload.mediaBranchCandidateSnapshot = mediaBranchCandidateSnapshot
        }

        // Whole-workspace descriptors index for the API relevance stage. Sent on
        // every turn (text-only included); the API consumes it in a later phase.
        if (workspaceContextSnapshot) {
            payload.workspaceContextSnapshot = workspaceContextSnapshot
        }

        if (canvasVisibleArea) {
            payload.canvasVisibleArea = canvasVisibleArea
        }

        if (proseMirrorInitialDoc) {
            payload.proseMirrorInitialDoc = proseMirrorInitialDoc
        }

        if (typeof proseMirrorBaseVersion === 'number') {
            payload.proseMirrorBaseVersion = proseMirrorBaseVersion
        }

        // Add image model routing options if an image model is selected
        if (imageModelIds.length > 0) {
            payload.aiImageModels = imageModelIds
            payload.imageSize = imageSize || 'auto'
        }

        // Add video model routing options if a video model is selected. The
        // text model decides between generate_image vs generate_video at runtime
        // when both are present — see MediaBranchResolver + LangGraph routing.
        if (videoModelIds.length > 0) {
            payload.aiVideoModels = videoModelIds
            if (videoAspectRatio) payload.videoAspectRatio = videoAspectRatio
            if (videoResolution) payload.videoResolution = videoResolution
            if (videoDuration) payload.videoDuration = videoDuration
            if (videoSourceForExtension) payload.videoSourceForExtension = videoSourceForExtension
        }

        // The media-generation matrix is needed only when some section carries
        // more than one model; a single model per section runs the plain path.
        const matrixVideoModelIds = videoModelsEnabled || Boolean(videoSourceForExtension) ? videoModelIds : []
        const selectedSectionCounts = [reasoningModelIds.length, imageModelIds.length, matrixVideoModelIds.length]
        const totalSelectedModelCount = selectedSectionCounts.reduce((sum, count) => sum + count, 0)
        const sectionsWithSelection = selectedSectionCounts.filter((count) => count > 0).length
        if (totalSelectedModelCount > sectionsWithSelection) {
            payload.mediaGenerationRequest = {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: uuidv4(),
                useMultipleReasoningModels: reasoningModelsEnabled,
                useMultipleImageModels: imageModelsEnabled,
                useMultipleVideoModels: videoModelsEnabled,
                reasoningModelIds,
                imageModelIds,
                videoModelIds: matrixVideoModelIds,
                imageOptions: {
                    imageSize: imageSize || 'auto',
                    ...(imageModelsEnabled && imageConfigGroups?.length ? { configGroups: imageConfigGroups } : {}),
                },
                ...(matrixVideoModelIds.length > 0 ? { videoOptions: {
                    ...(videoAspectRatio ? { aspectRatio: videoAspectRatio } : {}),
                    ...(videoResolution ? { resolution: videoResolution } : {}),
                    ...(videoDuration ? { duration: videoDuration } : {}),
                    ...(videoSourceForExtension ? { sourceForExtension: videoSourceForExtension } : {}),
                    ...(videoModelsEnabled && videoConfigGroups?.length ? { configGroups: videoConfigGroups } : {}),
                } } : {}),
            }
        }

        console.log(`[AI_INTERACTION] Publishing message to ${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE}`, {
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId,
            reasoningModelCount: reasoningModelIds.length,
            messageCount: messages.length,
            imageModelCount: imageModelIds.length,
            videoModelCount: videoModelIds.length,
            hasImageModel: imageModelIds.length > 0,
            hasVideoModel: videoModelIds.length > 0,
            referencedFeatureCount: referencedFeatureIds?.length ?? 0,
            mediaBranchCandidateCount: mediaBranchCandidateSnapshot?.candidates.length ?? 0,
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
        const subject = this.getChatResponseSubject()
        servicesStore.getData('nats')?.getSubscriptions([subject]).forEach((sub: { unsubscribe: () => void }) => sub.unsubscribe())
        this.currentAiProvider = null
        this.providersByRunKey.clear()
        this.pipelineEventIds.clear()
    }

    destroy() {
        this.disconnect()
    }
}
