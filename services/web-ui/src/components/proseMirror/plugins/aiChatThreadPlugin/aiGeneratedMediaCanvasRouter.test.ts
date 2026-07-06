'use strict'

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getAiGeneratedImageCallbacks, setAiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'
import { getAiGeneratedVideoCallbacks, setAiGeneratedVideoCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedVideoNode.ts'
import { routeSegmentEventToCanvas } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedMediaCanvasRouter.ts'

const createImageCallbacks = () => ({
    onImageGenerationTraceToCanvas: vi.fn(),
    onImagePartialToCanvas: vi.fn(),
    onImageCompleteToCanvas: vi.fn(),
    onMediaGenerationRequestCompleteToCanvas: vi.fn(),
    onMediaGenerationSkippedToCanvas: vi.fn(),
    onImageBranchResolvedToCanvas: vi.fn(),
    onMediaLineagePlannedToCanvas: vi.fn(),
    onWorkspaceContextResolvedToCanvas: vi.fn(),
    onImageBranchResolutionErrorToCanvas: vi.fn(),
    onImageErrorToCanvas: vi.fn(),
})

const createVideoCallbacks = () => ({
    onVideoPendingToCanvas: vi.fn(),
    onVideoGeneratingToCanvas: vi.fn(),
    onVideoCompleteToCanvas: vi.fn(),
    onVideoGenerationTraceToCanvas: vi.fn(),
    onVideoErrorToCanvas: vi.fn(),
    onVideoBranchResolvedToCanvas: vi.fn(),
})

function resetCallbacks(): void {
    const imageCallbacks = createImageCallbacks()
    const videoCallbacks = createVideoCallbacks()
    setAiGeneratedImageCallbacks(imageCallbacks)
    setAiGeneratedVideoCallbacks(videoCallbacks)
}

describe('routeSegmentEventToCanvas', () => {
    let imageCallbacks: ReturnType<typeof createImageCallbacks>
    let videoCallbacks: ReturnType<typeof createVideoCallbacks>

    beforeEach(() => {
        resetCallbacks()
        imageCallbacks = getAiGeneratedImageCallbacks() as ReturnType<typeof createImageCallbacks>
        videoCallbacks = getAiGeneratedVideoCallbacks() as ReturnType<typeof createVideoCallbacks>
    })

    it('ignores events that do not identify a thread', () => {
        routeSegmentEventToCanvas({
            type: 'image_partial',
            imageUrl: 'https://cdn.example.com/image.png',
        } as any)

        expect(imageCallbacks.onImagePartialToCanvas).not.toHaveBeenCalled()
        expect(videoCallbacks.onVideoPendingToCanvas).not.toHaveBeenCalled()
    })

    it('maps image trace and partial events into image callbacks', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'image_generation_trace',
            generationRun: { generationRequestId: 'gen-1' } as any,
        }, {
            responseMessageId: 'resp-1',
        })
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'image_partial',
            imageUrl: 'https://cdn.example.com/image-partial.png',
            fileId: 'image-partial',
            aiProvider: 'OpenAI',
            workspaceId: 'workspace-1',
            partialIndex: 2,
            generationRun: { generationRequestId: 'gen-1' } as any,
        }, {
            responseMessageId: 'resp-1',
        })

        expect(imageCallbacks.onImageGenerationTraceToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            generationRun: { generationRequestId: 'gen-1' } as any,
        })
        expect(imageCallbacks.onImagePartialToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            imageUrl: 'https://cdn.example.com/image-partial.png',
            fileId: 'image-partial',
            workspaceId: 'workspace-1',
            partialIndex: 2,
            aiProvider: 'OpenAI',
            generationRun: { generationRequestId: 'gen-1' } as any,
        })
    })

    it('routes image complete events and injects caller-provided response ids', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'image_complete',
            imageUrl: 'https://cdn.example.com/final.png',
            fileId: 'image-final',
            workspaceId: 'workspace-2',
            responseId: 'response-77',
            revisedPrompt: 'Final prompt',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash',
            generationRun: { generationRequestId: 'gen-2' } as any,
        }, {
            responseMessageId: 'response-message-id',
        })

        expect(imageCallbacks.onImageCompleteToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            imageUrl: 'https://cdn.example.com/final.png',
            fileId: 'image-final',
            workspaceId: 'workspace-2',
            responseId: 'response-77',
            revisedPrompt: 'Final prompt',
            aiModel: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash',
            responseMessageId: 'response-message-id',
            generationRun: { generationRequestId: 'gen-2' } as any,
        })
    })

    it('maps image lineage and context resolution events to dedicated callbacks', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'media_lineage_planned',
            mediaBranchLineagePlan: { branchId: 'branch-1' },
        } as any)

        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'context_relevance_resolved',
            workspaceContextResolution: {
                branchNodeId: 'node-1',
                references: ['a'],
            } as any,
        } as any)

        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'image_branch_resolved',
            imageBranchResolution: { score: 0.9 } as any,
        } as any)

        expect(imageCallbacks.onMediaLineagePlannedToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            lineagePlan: { branchId: 'branch-1' },
            generationRun: undefined,
        })
        expect(imageCallbacks.onWorkspaceContextResolvedToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            resolution: {
                branchNodeId: 'node-1',
                references: ['a'],
            },
            generationRun: undefined,
        })
        expect(imageCallbacks.onImageBranchResolvedToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            resolution: { score: 0.9 },
            generationRun: undefined,
        })
    })

    it('routes image branch resolution errors as both resolution and error events', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'image_branch_resolution_error',
            error: 'resolution failed',
        } as any)

        expect(imageCallbacks.onImageBranchResolutionErrorToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            error: 'resolution failed',
            generationRun: undefined,
        })
        expect(imageCallbacks.onImageErrorToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            error: 'resolution failed',
            generationRun: undefined,
        })
    })

    it('maps video state transitions to the correct canvas callbacks', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'video_pending',
            aiProvider: 'OpenAI',
        } as any)
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'video_generating',
            aiProvider: 'OpenAI',
        } as any)

        expect(videoCallbacks.onVideoPendingToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            aiProvider: 'OpenAI',
            generationRun: undefined,
        })
        expect(videoCallbacks.onVideoGeneratingToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            aiProvider: 'OpenAI',
            generationRun: undefined,
        })
    })

    it('maps video complete payload and applies defaults for missing media metadata', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'video_complete',
            videoUrl: '/api/videos/workspace-id/video-id',
            fileId: 'video-id',
            workspaceId: 'workspace-id',
            responseId: 'video-response',
            revisedPrompt: 'Video prompt',
            videoModel: 'OpenAI:o4-mini',
        } as any, {
            responseMessageId: 'response-message-id',
        })

        expect(videoCallbacks.onVideoCompleteToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            videoUrl: '/api/videos/workspace-id/video-id',
            fileId: 'video-id',
            workspaceId: 'workspace-id',
            posterUrl: '',
            posterFileId: '',
            frameUrl: '',
            frameFileId: '',
            durationSeconds: 0,
            aspectRatio: 1.777,
            hasAudio: true,
            responseId: 'video-response',
            revisedPrompt: 'Video prompt',
            videoModel: 'OpenAI:o4-mini',
            videoModelProvider: '',
            responseMessageId: 'response-message-id',
            generationRun: undefined,
        })
    })

    it('uses aiChatThreadId when threadId is not provided', () => {
        routeSegmentEventToCanvas({
            aiChatThreadId: 'thread-id-fallback',
            type: 'image_partial',
            imageUrl: 'https://cdn.example.com/image-partial.png',
            fileId: 'fallback-file',
            workspaceId: 'workspace-fallback',
            aiProvider: 'OpenAI',
        } as any)
        routeSegmentEventToCanvas({
            aiChatThreadId: 'thread-id-fallback',
            type: 'video_complete',
            videoUrl: '/api/videos/workspace-id/fallback-video',
            fileId: 'fallback-video',
            workspaceId: 'workspace-id',
            responseId: 'fallback-video-response',
            revisedPrompt: 'Fallback prompt',
            videoModel: 'OpenAI:o4-mini',
        }, {
            responseMessageId: 'response-message-id',
        })

        expect(imageCallbacks.onImagePartialToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-id-fallback',
            imageUrl: 'https://cdn.example.com/image-partial.png',
            fileId: 'fallback-file',
            workspaceId: 'workspace-fallback',
            partialIndex: 0,
            aiProvider: 'OpenAI',
            generationRun: undefined,
        })
        expect(videoCallbacks.onVideoCompleteToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-id-fallback',
            videoUrl: '/api/videos/workspace-id/fallback-video',
            fileId: 'fallback-video',
            workspaceId: 'workspace-id',
            posterUrl: '',
            posterFileId: '',
            frameUrl: '',
            frameFileId: '',
            durationSeconds: 0,
            aspectRatio: 1.777,
            hasAudio: true,
            responseId: 'fallback-video-response',
            revisedPrompt: 'Fallback prompt',
            videoModel: 'OpenAI:o4-mini',
            videoModelProvider: '',
            responseMessageId: 'response-message-id',
            generationRun: undefined,
        })
    })

    it('does not emit callbacks for events without the payload fields that route requires', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'image_complete',
        } as any)

        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'image_branch_resolved',
        } as any)

        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'media_lineage_planned',
        } as any)

        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'context_relevance_resolved',
        } as any)

        expect(imageCallbacks.onImageCompleteToCanvas).not.toHaveBeenCalled()
        expect(imageCallbacks.onImageBranchResolvedToCanvas).not.toHaveBeenCalled()
        expect(imageCallbacks.onMediaLineagePlannedToCanvas).not.toHaveBeenCalled()
        expect(imageCallbacks.onWorkspaceContextResolvedToCanvas).not.toHaveBeenCalled()
    })

    it('defaults generationRequestId for skipped media generations', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'media_generation_skipped',
        } as any)

        expect(imageCallbacks.onMediaGenerationSkippedToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            generationRequestId: '',
            generationRun: undefined,
        })
    })

    it('is a no-op for unrecognized segment types', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'weird_event' as any,
        } as any)

        expect(Object.keys(imageCallbacks).every((key) => (imageCallbacks as any)[key].mock.calls.length === 0)).toBe(true)
        expect(Object.keys(videoCallbacks).every((key) => (videoCallbacks as any)[key].mock.calls.length === 0)).toBe(true)
    })

    it('maps video trace and error callbacks', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'video_generation_trace',
        } as any)
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'video_error',
            error: 'video failed',
        } as any)

        expect(videoCallbacks.onVideoGenerationTraceToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            generationRun: undefined,
        })
        expect(videoCallbacks.onVideoErrorToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            error: 'video failed',
            generationRun: undefined,
        })
    })

    it('uses `threadId` over `aiChatThreadId` when both are present', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-primary',
            aiChatThreadId: 'thread-fallback',
            type: 'video_generating',
            aiProvider: 'OpenAI',
        } as any)

        expect(videoCallbacks.onVideoGeneratingToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-primary',
            aiProvider: 'OpenAI',
            generationRun: undefined,
        })
    })

    it('forwards generation metadata in media-complete callbacks', () => {
        const generationRun = {
            generationRequestId: 'gen-3',
            reasoningRunId: 'reasoning-run',
            mediaRunId: 'media-run',
            mediaModelId: 'image-model',
            mediaType: 'image',
            variantIndex: 2,
        } as any

        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'image_complete',
            imageUrl: 'https://cdn.example.com/final.png',
            fileId: 'image-final',
            workspaceId: 'workspace-2',
            responseId: 'response-77',
            revisedPrompt: 'Final prompt',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash',
            generationRun,
        }, {
            responseMessageId: 'response-message-id',
        })

        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'video_complete',
            videoUrl: '/api/videos/workspace-id/video-id',
            fileId: 'video-id',
            workspaceId: 'workspace-2',
            responseId: 'video-response',
            revisedPrompt: 'Video prompt',
            videoModel: 'OpenAI:o4-mini',
            generationRun,
        }, {
            responseMessageId: 'response-message-id',
        })

        expect(imageCallbacks.onImageCompleteToCanvas).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'thread-1',
            generationRun,
        }))
        expect(videoCallbacks.onVideoCompleteToCanvas).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'thread-1',
            generationRun,
        }))
    })

    it('falls back to empty responseMessageId for image complete callbacks when not provided', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'image_complete',
            imageUrl: 'https://cdn.example.com/final.png',
            responseId: 'response-77',
            aiProvider: 'OpenAI',
        } as any)

        expect(imageCallbacks.onImageCompleteToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            imageUrl: 'https://cdn.example.com/final.png',
            fileId: '',
            workspaceId: '',
            responseId: 'response-77',
            revisedPrompt: '',
            aiModel: 'OpenAI',
            imageModelProvider: '',
            imageModelId: '',
            responseMessageId: '',
            generationRun: undefined,
        })
    })

    it('forwards request-complete and skipped-generation metadata', () => {
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'media_generation_request_complete',
            generationRequestId: 'request-complete',
        } as any)
        routeSegmentEventToCanvas({
            threadId: 'thread-1',
            type: 'media_generation_skipped',
            generationRequestId: 'request-skipped',
        } as any)

        expect(imageCallbacks.onMediaGenerationRequestCompleteToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            generationRequestId: 'request-complete',
            generationRun: undefined,
        })
        expect(imageCallbacks.onMediaGenerationSkippedToCanvas).toHaveBeenCalledWith({
            threadId: 'thread-1',
            generationRequestId: 'request-skipped',
            generationRun: undefined,
        })
    })
})
