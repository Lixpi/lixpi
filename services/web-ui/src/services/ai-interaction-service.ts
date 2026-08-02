'use strict'

import { v4 as uuidv4 } from 'uuid'
import {
    getAiInteractionResponseSubject,
    NATS_SUBJECTS,
    STREAM_STATUS,
    type AiInteractionChatSendMessagePayload,
    type AiInteractionMediaGenerationRequest,
    type CapabilityGenerationTrace,
    type CapabilityRunEventStreamPayload,
    type CanvasGeometryUpdate,
    type ImageGenerationTrace,
    type ImageGenerationSize,
    type MediaBranchLineagePlan,
    type MediaGenerationConfigSelectionGroup,
    type MediaGenerationRunMeta,
    type MediaGenerationRequest,
    type MediaGenerationRequestEvent,
    type VideoGenerationTrace,
    type WorkspaceContextResolution,
} from '@lixpi/constants'
import AuthService from '$src/services/auth-service.ts'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { toCapabilityRunEventSegment } from '$src/services/capability-run-stream.ts'

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS

function debugAiInteractionLog(...args: unknown[]): void {
    try {
        if (globalThis.localStorage?.getItem('lixpi:debug:workspace-canvas') === '1') console.debug(...args)
    } catch {
        // Storage can be unavailable in restricted browser contexts.
    }
}

type SendChatMessageOptions = Omit<AiInteractionChatSendMessagePayload, 'conversationAssetId'> & {
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
    regeneration?: NonNullable<AiInteractionMediaGenerationRequest['regeneration']>
    // Asset ID of an existing generated video that VEO should extend. The API
    // authorizes it and resolves the source Blob coordinate. Built by
    // WorkspaceCanvas from the source VideoCanvasNode when the conversation is rooted
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
    hasMore?: boolean
}

type MediaGenerationRequestSubmissionAcknowledgment = {
    generationRequestId: string
    status: 'submitted' | 'awaiting-reference-resolution'
    requestRevision: number
    mediaEventSubject: string
}

const isMediaGenerationRequestSubmissionAcknowledgment = (
    data: unknown,
): data is MediaGenerationRequestSubmissionAcknowledgment => {
    if (!data || typeof data !== 'object') return false
    const candidate = data as Record<string, unknown>
    return typeof candidate.generationRequestId === 'string'
        && (candidate.status === 'submitted' || candidate.status === 'awaiting-reference-resolution')
        && typeof candidate.requestRevision === 'number'
        && typeof candidate.mediaEventSubject === 'string'
}

type StopAiChatMessageTarget = {
    workspaceId: string
    conversationAssetId: string
    generationRequestId?: string
}

type StopAiChatMessageResult = {
    status: 'stopped'
    generationRequestId?: string
    canvasGeometry?: CanvasGeometryUpdate
}

type AiInteractionServiceOptions = {
    workspaceId: string
    conversationAssetId: string
    organizationId?: string
    onError?: (error: unknown) => void
}

export async function stopAiChatMessageForThread({
    workspaceId,
    conversationAssetId,
    generationRequestId,
}: StopAiChatMessageTarget): Promise<StopAiChatMessageResult> {
    const payload = {
        token: await AuthService.getTokenSilently(),
        workspaceId,
        conversationAssetId,
        ...(generationRequestId ? { generationRequestId } : {}),
    }

    const result = await servicesStore.getData('nats')!.request(
        AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE,
        payload,
    ) as StopAiChatMessageResult | { error: string }
    if ('error' in result) throw new Error(result.error)
    return result
}

const requestMediaGenerationAction = async <T>(subject: string, payload: Record<string, unknown>): Promise<T> => {
    const result = await servicesStore.getData('nats')!.request(subject, {
        token: await AuthService.getTokenSilently(),
        ...payload,
    }) as T | { error: string }
    if (result && typeof result === 'object' && 'error' in result) throw new Error(result.error)
    return result as T
}

export const resolveMediaGenerationReference = async (payload: {
    generationRequestId: string
    workspaceId: string
    requestRevision: number
    bindingId: string
    assetId: string
}): Promise<unknown> => await requestMediaGenerationAction(
    AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.RESOLVE_REFERENCE,
    payload,
)

export const cancelMediaGenerationRequest = async (payload: {
    generationRequestId: string
    workspaceId: string
    requestRevision: number
}): Promise<unknown> => await requestMediaGenerationAction(
    AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.CANCEL,
    payload,
)

export const startMediaGenerationVerification = async (payload: {
    generationRequestId: string
    workspaceId: string
    requestRevision: number
    generationRun: number
    assetId: string
}): Promise<{ verificationUrl: string; expiresAt: number; requestRevision: number }> =>
    await requestMediaGenerationAction(
        AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.VERIFICATION_START,
        payload,
    )

export const getMediaGenerationRequest = async (payload: {
    generationRequestId: string
    workspaceId: string
    includeCheckpoint?: boolean
}): Promise<{
    request: MediaGenerationRequest
    checkpoint?: {
        promptDocument: unknown
        selectedReferences: Array<{ assetId: string; nodeId?: string }>
        modelSelection: unknown
        configuration: unknown
    }
    liveSubject: string
}> => await requestMediaGenerationAction(
    AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.GET,
    payload,
)

export const replayMediaGenerationRequest = async (payload: {
    generationRequestId: string
    workspaceId: string
    startStreamSequence?: number
}): Promise<{
    request: MediaGenerationRequest
    liveSubject: string
    replay: {
        events: Array<{ event: MediaGenerationRequestEvent; streamSequence: number }>
        hasMore: boolean
    }
}> => await requestMediaGenerationAction(
    AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.REPLAY,
    payload,
)

export default class AiInteractionService {
    workspaceId: string
    conversationAssetId: string
    organizationId: string
    segmentsReceiver: any
    currentAiProvider: string | null
    providersByRunKey: Map<string, string>
    pipelineEventIds: Set<string>
    pipelineLocalStreamSeq: number
    onError: ((error: unknown) => void) | null

    constructor({
        workspaceId,
        conversationAssetId,
        organizationId,
        onError,
    }: AiInteractionServiceOptions) {
        this.workspaceId = workspaceId
        this.conversationAssetId = conversationAssetId
        this.organizationId = organizationId ?? ''
        this.segmentsReceiver = SegmentsReceiver
        this.currentAiProvider = null
        this.providersByRunKey = new Map()
        this.pipelineEventIds = new Set()
        this.pipelineLocalStreamSeq = 0
        this.onError = onError ?? null

        this.initNatsSubscriptions()
    }

    getRunKey(generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.reasoningRunId || this.conversationAssetId
    }

    getGenerationRun(content: any): MediaGenerationRunMeta | undefined {
        return content?.generationRun
            ?? content?.imageGenerationTrace?.generationRun
            ?? content?.videoGenerationTrace?.generationRun
            ?? content?.capabilityGenerationTrace?.generationRun
    }

    getChatResponseSubject(): string {
        return getAiInteractionResponseSubject(
            userStore.getData('userId') as string,
            this.organizationId,
            this.conversationAssetId,
        )
    }

    updateRunProvider(runKey: string, aiProvider: string | undefined): string | null {
        if (!aiProvider) {
            return this.providersByRunKey.get(runKey) ?? this.currentAiProvider
        }

        this.providersByRunKey.set(runKey, aiProvider)
        if (runKey === this.conversationAssetId) {
            this.currentAiProvider = aiProvider
        }
        return aiProvider
    }

    async initNatsSubscriptions() {
        try {
            if (!this.workspaceId || !this.conversationAssetId || !this.organizationId)
                throw new Error('AiInteractionService requires workspaceId, conversationAssetId, and organizationId')

            const subject = this.getChatResponseSubject()

            // Only unsubscribe previous subscriptions for THIS specific thread, not all threads
            servicesStore.getData('nats')!.getSubscriptions([subject]).forEach((sub: { unsubscribe: () => void }) => sub.unsubscribe())

            debugAiInteractionLog(`[AI_INTERACTION] Subscribing to NATS response channel: ${subject}`)
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
            let hasMore = false
            do {
                const result = await servicesStore.getData('nats')!.request(
                    AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME,
                    {
                        token: await AuthService.getTokenSilently(),
                        workspaceId: this.workspaceId,
                        conversationAssetId: this.conversationAssetId,
                        localStreamSeq: this.pipelineLocalStreamSeq,
                    },
                ) as PipelineReplayResult
                if (result?.error) {
                    console.error('[AI_INTERACTION] CHAT_PIPELINE_RESUME failed:', result.error)
                    return
                }
                const events = result.events ?? []
                for (const event of events) {
                    this.onChatMessageResponse({
                        ...event.payload,
                        pipelineStreamSeq: event.streamSequence,
                    })
                }
                hasMore = result.hasMore === true && events.length > 0
            } while (hasMore)
        } catch (error) {
            console.error('[AI_INTERACTION] CHAT_PIPELINE_RESUME failed:', error)
        }
    }


    onChatMessageResponse(data: any) {
        try {
            if (!this.shouldProcessPipelinePayload(data)) return

            if (data?.error) {
                console.error('[AI_INTERACTION] Failed to receive chat message:', data.error)
                this.onError?.(data.error)
                return
            }

            if (isMediaGenerationRequestSubmissionAcknowledgment(data)) {
                debugAiInteractionLog('[AI_INTERACTION] Media generation request accepted:', {
                    generationRequestId: data.generationRequestId,
                    status: data.status,
                    requestRevision: data.requestRevision,
                })
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
                conversationAssetId: this.conversationAssetId,
                usesServerProseMirror: true,
                ...(generationRun ? { generationRun } : {}),
            }

            if (content.status === STREAM_STATUS.CAPABILITY_RUN_EVENT) {
                this.segmentsReceiver.receiveSegment(toCapabilityRunEventSegment(
                    content as CapabilityRunEventStreamPayload,
                ))
                return
            }

            if (content.status === STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED) {
                const workspaceContextResolution = content.workspaceContextResolution as WorkspaceContextResolution
                debugAiInteractionLog('[AI_INTERACTION] CONTEXT_RELEVANCE_RESOLVED received:', {
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
                debugAiInteractionLog('[AI_INTERACTION] CONTEXT_RELEVANCE_ERROR received:', content)
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
                debugAiInteractionLog('[AI_INTERACTION] IMAGE_GENERATION_TRACE received:', {
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

            if (content.status === STREAM_STATUS.CAPABILITY_GENERATION_TRACE) {
                const capabilityGenerationTrace = content.capabilityGenerationTrace as CapabilityGenerationTrace
                debugAiInteractionLog('[AI_INTERACTION] CAPABILITY_GENERATION_TRACE received:', {
                    capabilityId: capabilityGenerationTrace?.capabilityId,
                    capabilityRunId: capabilityGenerationTrace?.capabilityRunId,
                    stepCount: capabilityGenerationTrace?.steps.length ?? 0,
                })
                this.segmentsReceiver.receiveSegment({
                    type: 'capability_generation_trace',
                    capabilityGenerationTrace,
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.IMAGE_PARTIAL) {
                debugAiInteractionLog('[AI_INTERACTION] IMAGE_PARTIAL received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'image_partial',
                    imageUrl: content.imageUrl,
                    assetId: content.assetId,
                    workspaceId: this.workspaceId,
                    partialIndex: content.partialIndex,
                    ...(content.canvasGeometry ? { canvasGeometry: content.canvasGeometry } : {}),
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.MEDIA_BRANCH_RESOLVED) {
                debugAiInteractionLog('[AI_INTERACTION] MEDIA_BRANCH_RESOLVED received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'image_branch_resolved',
                    mediaBranchResolution: content.resolution,
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.MEDIA_LINEAGE_PLANNED) {
                const lineagePlan = content.lineagePlan as MediaBranchLineagePlan
                debugAiInteractionLog('[AI_INTERACTION] MEDIA_LINEAGE_PLANNED received:', {
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
                debugAiInteractionLog('[AI_INTERACTION] MEDIA_GENERATION_SKIPPED received:', {
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
                debugAiInteractionLog('[AI_INTERACTION] MEDIA_GENERATION_REQUEST_COMPLETE received:', {
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
                debugAiInteractionLog('[AI_INTERACTION] MEDIA_BRANCH_RESOLUTION_ERROR received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'image_branch_resolution_error',
                    error: content.error || 'Image branch resolution failed',
                    ...segmentBase,
                })
                return
            }

            if (content.status === STREAM_STATUS.CANVAS_GEOMETRY_RESOLVED) {
                debugAiInteractionLog('[AI_INTERACTION] CANVAS_GEOMETRY_RESOLVED received:', {
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
                debugAiInteractionLog('[AI_INTERACTION] IMAGE_COMPLETE received:', content)

                this.segmentsReceiver.receiveSegment({
                    type: 'image_complete',
                    imageUrl: content.imageUrl,
                    assetId: content.assetId,
                    workspaceId: this.workspaceId,
                    responseId: content.responseId,
                    revisedPrompt: content.revisedPrompt,
                    aiProvider: aiProvider || '',
                    usesServerProseMirror: true,
                    imageModelProvider: content.imageModelProvider || content.aiProvider || '',
                    imageModelId: content.imageModelId || '',
                    ...(content.canvasGeometry ? { canvasGeometry: content.canvasGeometry } : {}),
                    ...(generationRun ? { generationRun } : {}),
                    conversationAssetId: this.conversationAssetId
                })
                return
            }

            if (content.status === STREAM_STATUS.IMAGE_ERROR) {
                debugAiInteractionLog('[AI_INTERACTION] IMAGE_ERROR received:', content)
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
                debugAiInteractionLog('[AI_INTERACTION] VIDEO_GENERATION_TRACE received:', {
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
                debugAiInteractionLog('[AI_INTERACTION] VIDEO_PENDING received')
                this.segmentsReceiver.receiveSegment({
                    type: 'video_pending',
                    ...(content.canvasGeometry ? { canvasGeometry: content.canvasGeometry } : {}),
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
                debugAiInteractionLog('[AI_INTERACTION] VIDEO_COMPLETE received:', content)
                this.segmentsReceiver.receiveSegment({
                    type: 'video_complete',
                    videoUrl: content.videoUrl,
                    assetId: content.assetId,
                    workspaceId: this.workspaceId,
                    posterUrl: content.posterUrl,
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
                debugAiInteractionLog('[AI_INTERACTION] VIDEO_ERROR received:', content)
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
        regeneration,
        videoSourceForExtension,
        mediaBranchCandidateSnapshot,
        workspaceContextSnapshot,
        canvasVisibleArea,
    }: SendChatMessageOptions) {
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
            conversationAssetId: this.conversationAssetId,
            aiReasoningModels: reasoningModelIds,
            organizationId: this.organizationId
        }

        if (mediaBranchCandidateSnapshot) {
            payload.mediaBranchCandidateSnapshot = mediaBranchCandidateSnapshot
        }

        // Explicit composer context for this submitted turn.
        if (workspaceContextSnapshot) {
            payload.workspaceContextSnapshot = workspaceContextSnapshot
        }

        if (canvasVisibleArea) {
            payload.canvasVisibleArea = canvasVisibleArea
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
        const regenerationMediaTypes = regeneration?.mode === 'existing-prompt'
            ? Array.from(new Set(regeneration.replayPrompts.map(prompt => prompt.mediaType)))
            : []
        const hasVideoOutput = regenerationMediaTypes.length > 0
            ? regenerationMediaTypes.includes('video')
            : videoModelsEnabled || Boolean(videoSourceForExtension)
        const hasImageOutput = regenerationMediaTypes.length > 0
            ? regenerationMediaTypes.includes('image')
            : imageModelsEnabled || !hasVideoOutput
        const outputMediaTypes: Array<'image' | 'video'> = regenerationMediaTypes.length > 0
            ? regenerationMediaTypes
            : [
                ...(hasImageOutput ? ['image' as const] : []),
                ...(hasVideoOutput ? ['video' as const] : []),
            ]
        const matrixImageModelIds = outputMediaTypes.includes('image') ? imageModelIds : []
        const matrixVideoModelIds = outputMediaTypes.includes('video') ? videoModelIds : []
        const selectedSectionCounts = [reasoningModelIds.length, matrixImageModelIds.length, matrixVideoModelIds.length]
        const totalSelectedModelCount = selectedSectionCounts.reduce((sum, count) => sum + count, 0)
        const sectionsWithSelection = selectedSectionCounts.filter((count) => count > 0).length
        if (regeneration || totalSelectedModelCount > sectionsWithSelection) {
            payload.mediaGenerationRequest = {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: uuidv4(),
                outputMediaTypes,
                useMultipleReasoningModels: reasoningModelsEnabled,
                useMultipleImageModels: imageModelsEnabled,
                useMultipleVideoModels: videoModelsEnabled,
                reasoningModelIds,
                imageModelIds: matrixImageModelIds,
                videoModelIds: matrixVideoModelIds,
                ...(matrixImageModelIds.length > 0 ? { imageOptions: {
                    imageSize: imageSize || 'auto',
                    ...(imageModelsEnabled && imageConfigGroups?.length ? { configGroups: imageConfigGroups } : {}),
                } } : {}),
                ...(matrixVideoModelIds.length > 0 ? { videoOptions: {
                    ...(videoAspectRatio ? { aspectRatio: videoAspectRatio } : {}),
                    ...(videoResolution ? { resolution: videoResolution } : {}),
                    ...(videoDuration ? { duration: videoDuration } : {}),
                    ...(videoSourceForExtension ? { sourceForExtension: videoSourceForExtension } : {}),
                    ...(videoModelsEnabled && videoConfigGroups?.length ? { configGroups: videoConfigGroups } : {}),
                } } : {}),
                ...(regeneration ? { regeneration } : {}),
            }
        }

        debugAiInteractionLog(`[AI_INTERACTION] Publishing message to ${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE}`, {
            workspaceId: this.workspaceId,
            conversationAssetId: this.conversationAssetId,
            reasoningModelCount: reasoningModelIds.length,
            imageModelCount: imageModelIds.length,
            videoModelCount: videoModelIds.length,
            matrixOutputMediaTypes: payload.mediaGenerationRequest?.outputMediaTypes ?? [],
            matrixImageModelCount: payload.mediaGenerationRequest?.imageModelIds?.length ?? 0,
            matrixVideoModelCount: payload.mediaGenerationRequest?.videoModelIds?.length ?? 0,
            hasImageModel: imageModelIds.length > 0,
            hasVideoModel: videoModelIds.length > 0,
            mediaBranchCandidateCount: mediaBranchCandidateSnapshot?.candidates.length ?? 0,
            workspaceContextNodeCount: workspaceContextSnapshot?.nodes.length ?? 0,
        })

        servicesStore.getData('nats')!.publish(AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE, payload)
    }

    async stopChatMessage(): Promise<void> {
        await stopAiChatMessageForThread({
            workspaceId: this.workspaceId,
            conversationAssetId: this.conversationAssetId,
        })
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
