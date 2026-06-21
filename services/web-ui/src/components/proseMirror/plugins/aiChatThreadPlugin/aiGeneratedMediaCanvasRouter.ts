'use strict'

import { getAiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'
import { getAiGeneratedVideoCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedVideoNode.ts'
import type { SegmentEvent } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts'

// Optional, host-supplied values that can't be derived from the segment alone.
// The chat thread plugin passes the response message id it created while
// inserting the media into the chat document; the canvas-wide composer has no
// chat document and omits it.
type RouteOptions = {
    responseMessageId?: string
}

// Single source of truth for mapping a streamed media SegmentEvent to the
// registered canvas placement callbacks. Both consumers of the media stream use
// it: the aiChatThreadPlugin (which additionally mirrors media into the chat
// document) and the thread-less, canvas-wide composer (which only places spatial
// branch lineage nodes). This keeps the event → callback payload mapping in one
// place so the two paths can never drift.
export function routeSegmentEventToCanvas(event: SegmentEvent, options: RouteOptions = {}): void {
    const threadId = event.threadId || event.aiChatThreadId
    if (!threadId) return

    const imageCallbacks = getAiGeneratedImageCallbacks()
    const videoCallbacks = getAiGeneratedVideoCallbacks()
    const { generationRun } = event
    const responseMessageId = options.responseMessageId ?? ''

    switch (event.type) {
        case 'image_generation_trace':
            imageCallbacks.onImageGenerationTraceToCanvas?.({ threadId, generationRun })
            return

        case 'image_partial':
            imageCallbacks.onImagePartialToCanvas?.({
                threadId,
                imageUrl: event.imageUrl || '',
                fileId: event.fileId || '',
                workspaceId: event.workspaceId || '',
                partialIndex: event.partialIndex || 0,
                aiProvider: event.aiProvider || '',
                generationRun,
            })
            return

        case 'image_complete':
            if (!event.imageUrl) return
            imageCallbacks.onImageCompleteToCanvas?.({
                threadId,
                imageUrl: event.imageUrl,
                fileId: event.fileId || '',
                workspaceId: event.workspaceId || '',
                responseId: event.responseId || '',
                revisedPrompt: event.revisedPrompt || '',
                aiModel: event.aiProvider || '',
                imageModelProvider: event.imageModelProvider || '',
                imageModelId: event.imageModelId || '',
                responseMessageId,
                generationRun,
            })
            return

        case 'image_error':
            imageCallbacks.onImageErrorToCanvas?.({
                threadId,
                error: event.error || 'Image generation failed',
                generationRun,
            })
            return

        case 'image_branch_resolved':
            if (event.imageBranchResolution) {
                imageCallbacks.onImageBranchResolvedToCanvas?.({
                    threadId,
                    resolution: event.imageBranchResolution,
                    generationRun,
                })
            }
            return

        case 'media_lineage_planned':
            if (event.mediaBranchLineagePlan) {
                imageCallbacks.onMediaLineagePlannedToCanvas?.({
                    threadId,
                    lineagePlan: event.mediaBranchLineagePlan,
                    generationRun,
                })
            }
            return

        case 'context_relevance_resolved':
            if (event.workspaceContextResolution) {
                imageCallbacks.onWorkspaceContextResolvedToCanvas?.({
                    threadId,
                    resolution: event.workspaceContextResolution,
                    generationRun,
                })
            }
            return

        case 'image_branch_resolution_error':
            imageCallbacks.onImageBranchResolutionErrorToCanvas?.({
                threadId,
                error: event.error || 'Image branch resolution failed',
                generationRun,
            })
            imageCallbacks.onImageErrorToCanvas?.({
                threadId,
                error: event.error || 'Image branch resolution failed',
                generationRun,
            })
            return

        case 'video_pending':
            videoCallbacks.onVideoPendingToCanvas?.({ threadId, aiProvider: event.aiProvider || '', generationRun })
            return

        case 'video_generating':
            videoCallbacks.onVideoGeneratingToCanvas?.({ threadId, aiProvider: event.aiProvider || '', generationRun })
            return

        case 'video_complete':
            if (!event.videoUrl) return
            videoCallbacks.onVideoCompleteToCanvas?.({
                threadId,
                videoUrl: event.videoUrl,
                fileId: event.fileId || '',
                workspaceId: event.workspaceId || '',
                posterUrl: event.posterUrl || '',
                posterFileId: event.posterFileId || '',
                frameUrl: event.frameUrl || '',
                frameFileId: event.frameFileId || '',
                durationSeconds: event.durationSeconds || 0,
                aspectRatio: event.aspectRatio || 1.777,
                hasAudio: event.hasAudio ?? true,
                responseId: event.responseId || '',
                revisedPrompt: event.revisedPrompt || '',
                videoModel: event.videoModel || '',
                videoModelProvider: event.videoModelProvider || '',
                responseMessageId,
                generationRun,
            })
            return

        case 'video_error':
            videoCallbacks.onVideoErrorToCanvas?.({
                threadId,
                error: event.error || 'Video generation failed',
                generationRun,
            })
            return

        case 'video_generation_trace':
            videoCallbacks.onVideoGenerationTraceToCanvas?.({ threadId, generationRun })
            return
    }
}
