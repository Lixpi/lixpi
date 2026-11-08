import {
    type CanvasGeometryUpdate,
    type CapabilityRunEvent,
    type MediaBranchVlmResolution,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
    type WorkspaceContextResolution,
} from '@lixpi/constants'

export type CanvasMediaSegment = {
    type?: string
    status?: string
    conversationAssetId?: string
    workspaceId?: string
    threadId?: string
    generationRequestId?: string
    capabilityRunEvent?: CapabilityRunEvent
    generationRun?: MediaGenerationRunMeta
    canvasGeometry?: CanvasGeometryUpdate
    mediaBranchResolution?: MediaBranchVlmResolution
    mediaBranchLineagePlan?: MediaBranchLineagePlan
    workspaceContextResolution?: WorkspaceContextResolution
    imageUrl?: string
    videoUrl?: string
    assetId?: string
    partialIndex?: number
    aiProvider?: string
    responseId?: string
    revisedPrompt?: string
    imageModelProvider?: string
    imageModelId?: string
    durationSeconds?: number
    aspectRatio?: number
    hasAudio?: boolean
    videoModel?: string
    videoModelProvider?: string
    error?: string
}

export type CanvasMediaSegmentOptions = { responseMessageId?: string }

export type AiGeneratedImageCallbacks = {
    onCapabilityRunEventToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        event: CapabilityRunEvent
    }) => void | Promise<void>
    onAddToCanvas?: (data: {
        workspaceId?: string
        imageUrl: string
        assetId: string
        responseId: string
        revisedPrompt: string
        aiModel: string
    }) => void | Promise<void>
    onImagePartialToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        imageUrl: string
        assetId: string
        partialIndex: number
        aiProvider: string
        canvasGeometry?: CanvasGeometryUpdate
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onImageCompleteToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        imageUrl: string
        assetId: string
        responseId: string
        revisedPrompt: string
        aiModel: string
        imageModelProvider: string
        imageModelId?: string
        responseMessageId: string
        canvasGeometry?: CanvasGeometryUpdate
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onImageGenerationTraceToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onMediaBranchResolvedToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        resolution: MediaBranchVlmResolution
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onMediaLineagePlannedToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        lineagePlan: MediaBranchLineagePlan
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onMediaGenerationSkippedToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        generationRequestId: string
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onMediaGenerationRequestCompleteToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        generationRequestId: string
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    // Applies API-resolved authoritative node geometry (positions/dimensions)
    // pushed over the chat stream — the client never recomputes this layout.
    onCanvasGeometryResolvedToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        canvasGeometry: CanvasGeometryUpdate
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onWorkspaceContextResolvedToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        resolution: WorkspaceContextResolution
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onMediaBranchResolutionErrorToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        error: string
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onImageErrorToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        error: string
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
}

export type AiGeneratedVideoCallbacks = {
    onAddToCanvas?: (data: {
        workspaceId?: string
        videoUrl: string
        assetId: string
        durationSeconds: number
        aspectRatio: number
        hasAudio: boolean
        responseId: string
        revisedPrompt: string
        videoModel: string
    }) => void | Promise<void>
    onVideoPendingToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        aiProvider: string
        canvasGeometry?: CanvasGeometryUpdate
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onVideoGeneratingToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        aiProvider: string
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onVideoCompleteToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        videoUrl: string
        assetId: string
        durationSeconds: number
        aspectRatio: number
        hasAudio: boolean
        responseId: string
        revisedPrompt: string
        videoModel: string
        videoModelProvider: string
        responseMessageId: string
        canvasGeometry?: CanvasGeometryUpdate
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onVideoGenerationTraceToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    onVideoErrorToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        error: string
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
    // The structured VLM resolver is shared with images; video uses the same
    // resolution payload, so the resolved/error callbacks are reused from the
    // image callback surface rather than duplicated here.
    onVideoBranchResolvedToCanvas?: (data: {
        workspaceId?: string
        threadId: string
        resolution: MediaBranchVlmResolution
        generationRun?: MediaGenerationRunMeta
    }) => void | Promise<void>
}

const routeSegmentEventToCanvas = (
    event: CanvasMediaSegment,
    imageCallbacks: AiGeneratedImageCallbacks,
    videoCallbacks: AiGeneratedVideoCallbacks,
    options: CanvasMediaSegmentOptions,
): void => {
    const threadId = event.conversationAssetId || event.threadId

    if (!threadId)
        return

    const identity = {
        threadId,
        ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    }
    const { generationRun } = event
    const responseMessageId = options.responseMessageId ?? ''

    switch (event.type) {
        case 'capability_run_event':
            if (event.capabilityRunEvent) {
                imageCallbacks.onCapabilityRunEventToCanvas?.({
                    ...identity,
                    event: event.capabilityRunEvent,
                })
            }

            return
        case 'image_generation_trace':
            imageCallbacks.onImageGenerationTraceToCanvas?.({
                ...identity,
                generationRun,
            })

            return
        case 'image_partial':
            imageCallbacks.onImagePartialToCanvas?.({
                ...identity,
                imageUrl: event.imageUrl || '',
                assetId: event.assetId || '',
                partialIndex: event.partialIndex || 0,
                aiProvider: event.aiProvider || '',
                ...(event.canvasGeometry ? { canvasGeometry: event.canvasGeometry } : {}),
                generationRun,
            })

            return
        case 'image_complete':
            if (
                !event.imageUrl
                && !event.assetId
                && !event.canvasGeometry
            )
                return

            imageCallbacks.onImageCompleteToCanvas?.({
                ...identity,
                imageUrl: event.imageUrl || '',
                assetId: event.assetId || '',
                responseId: event.responseId || '',
                revisedPrompt: event.revisedPrompt || '',
                aiModel: event.aiProvider || '',
                imageModelProvider: event.imageModelProvider || '',
                imageModelId: event.imageModelId || '',
                responseMessageId,
                ...(event.canvasGeometry ? { canvasGeometry: event.canvasGeometry } : {}),
                generationRun,
            })

            return
        case 'image_error':
            imageCallbacks.onImageErrorToCanvas?.({
                ...identity,
                error: event.error || 'Image generation failed',
                generationRun,
            })

            return
        case 'image_branch_resolved':
            if (event.mediaBranchResolution) {
                imageCallbacks.onMediaBranchResolvedToCanvas?.({
                    ...identity,
                    resolution: event.mediaBranchResolution,
                    generationRun,
                })
            }

            return
        case 'media_lineage_planned':
            if (event.mediaBranchLineagePlan) {
                imageCallbacks.onMediaLineagePlannedToCanvas?.({
                    ...identity,
                    lineagePlan: event.mediaBranchLineagePlan,
                    generationRun,
                })
            }

            return
        case 'media_generation_skipped':
            imageCallbacks.onMediaGenerationSkippedToCanvas?.({
                ...identity,
                generationRequestId: event.generationRequestId || '',
                generationRun,
            })

            return
        case 'media_generation_request_complete':
            imageCallbacks.onMediaGenerationRequestCompleteToCanvas?.({
                ...identity,
                generationRequestId: event.generationRequestId || '',
                generationRun,
            })

            return
        case 'canvas_geometry_resolved':
            if (event.canvasGeometry) {
                imageCallbacks.onCanvasGeometryResolvedToCanvas?.({
                    ...identity,
                    canvasGeometry: event.canvasGeometry,
                    generationRun,
                })
            }

            return
        case 'context_relevance_resolved':
            if (event.workspaceContextResolution) {
                imageCallbacks.onWorkspaceContextResolvedToCanvas?.({
                    ...identity,
                    resolution: event.workspaceContextResolution,
                    generationRun,
                })
            }

            return
        case 'image_branch_resolution_error':
            imageCallbacks.onMediaBranchResolutionErrorToCanvas?.({
                ...identity,
                error: event.error || 'Image branch resolution failed',
                generationRun,
            })
            imageCallbacks.onImageErrorToCanvas?.({
                ...identity,
                error: event.error || 'Image branch resolution failed',
                generationRun,
            })

            return
        case 'video_pending':
            videoCallbacks.onVideoPendingToCanvas?.({
                ...identity,
                aiProvider: event.aiProvider || '',
                ...(event.canvasGeometry ? { canvasGeometry: event.canvasGeometry } : {}),
                generationRun,
            })

            return
        case 'video_generating':
            videoCallbacks.onVideoGeneratingToCanvas?.({
                ...identity,
                aiProvider: event.aiProvider || '',
                generationRun,
            })

            return
        case 'video_complete':
            if (!event.videoUrl)
                return

            videoCallbacks.onVideoCompleteToCanvas?.({
                ...identity,
                videoUrl: event.videoUrl,
                assetId: event.assetId || '',
                durationSeconds: event.durationSeconds || 0,
                aspectRatio: event.aspectRatio || 1.777,
                hasAudio: event.hasAudio ?? true,
                responseId: event.responseId || '',
                revisedPrompt: event.revisedPrompt || '',
                videoModel: event.videoModel || '',
                videoModelProvider: event.videoModelProvider || '',
                responseMessageId,
                ...(event.canvasGeometry ? { canvasGeometry: event.canvasGeometry } : {}),
                generationRun,
            })

            return
        case 'video_error':
            videoCallbacks.onVideoErrorToCanvas?.({
                ...identity,
                error: event.error || 'Video generation failed',
                generationRun,
            })

            return
        case 'video_generation_trace':
            videoCallbacks.onVideoGenerationTraceToCanvas?.({
                ...identity,
                generationRun,
            })

            return
        default:
            if (event.status === 'ERROR')
                imageCallbacks.onImageErrorToCanvas?.({
                    ...identity,
                    error: event.error || 'AI generation failed',
                    generationRun,
                })
    }
}

export class CanvasGenerationEvents {
    private readonly imageListeners = new Set<AiGeneratedImageCallbacks>()
    private readonly videoListeners = new Set<AiGeneratedVideoCallbacks>()
    private destroyed = false

    constructor(private readonly reportError: (error: unknown) => void) {}

    subscribeImages(callbacks: AiGeneratedImageCallbacks): () => void {
        return this.subscribe(this.imageListeners, callbacks)
    }

    subscribeVideos(callbacks: AiGeneratedVideoCallbacks): () => void {
        return this.subscribe(this.videoListeners, callbacks)
    }

    route(
        event: CanvasMediaSegment,
        options: CanvasMediaSegmentOptions = {},
    ): void {
        if (this.destroyed)
            return

        for (const listener of [...this.imageListeners]) {
            if (this.imageListeners.has(listener))
                routeSegmentEventToCanvas(
                    event,
                    listener,
                    {},
                    options,
                )
        }

        for (const listener of [...this.videoListeners]) {
            if (this.videoListeners.has(listener))
                routeSegmentEventToCanvas(
                    event,
                    {},
                    listener,
                    options,
                )
        }
    }

    destroy(): void {
        this.destroyed = true
        this.imageListeners.clear()
        this.videoListeners.clear()
    }

    private subscribe<Callbacks extends object>(
        listeners: Set<Callbacks>,
        callbacks: Callbacks,
    ): () => void {
        if (this.destroyed)
            throw new Error('Canvas generation events are disposed')

        const wrapped = Object.fromEntries(
            Object.entries(callbacks).map(
                ([name, callback]) => [name, (data: unknown) => {
                    if (
                        !listeners.has(wrapped)
                        || typeof callback !== 'function'
                    )
                        return

                    void this.invoke(callback, data)
                }],
            ),
        ) as Callbacks
        listeners.add(wrapped)

        return () => void listeners.delete(wrapped)
    }

    private async invoke(
        callback: (data: unknown) => unknown,
        data: unknown,
    ): Promise<void> {
        try {
            await callback(
                structuredClone(data),
            )
        } catch (error) {
            this.reportError(error)
        }
    }
}
