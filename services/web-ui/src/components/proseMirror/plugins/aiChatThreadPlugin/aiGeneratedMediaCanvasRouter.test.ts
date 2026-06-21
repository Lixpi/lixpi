'use strict'

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getAiGeneratedImageCallbacks, setAiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'
import { getAiGeneratedVideoCallbacks, setAiGeneratedVideoCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedVideoNode.ts'
import { routeSegmentEventToCanvas } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedMediaCanvasRouter.ts'

const createImageCallbacks = () => ({
    onImageGenerationTraceToCanvas: vi.fn(),
    onImagePartialToCanvas: vi.fn(),
    onImageCompleteToCanvas: vi.fn(),
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
})
