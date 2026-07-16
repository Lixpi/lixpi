'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAiGeneratedImageCallbacks, setAiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'
import { getAiGeneratedVideoCallbacks, setAiGeneratedVideoCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedVideoNode.ts'
import { routeSegmentEventToCanvas } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedMediaCanvasRouter.ts'

const createImageCallbacks = () => ({
    onImageGenerationTraceToCanvas: vi.fn(),
    onImagePartialToCanvas: vi.fn(),
    onImageCompleteToCanvas: vi.fn(),
    onMediaGenerationRequestCompleteToCanvas: vi.fn(),
    onMediaGenerationSkippedToCanvas: vi.fn(),
    onMediaBranchResolvedToCanvas: vi.fn(),
    onMediaLineagePlannedToCanvas: vi.fn(),
    onWorkspaceContextResolvedToCanvas: vi.fn(),
    onMediaBranchResolutionErrorToCanvas: vi.fn(),
    onCanvasGeometryResolvedToCanvas: vi.fn(),
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

const generationRun = { generationRequestId: 'request-1', mediaRunId: 'media-1' } as any
const canvasGeometry = {
    layoutRevision: 42,
    nodes: [],
    nodeSnapshots: [],
    edgeSnapshots: [],
}

describe('routeSegmentEventToCanvas', () => {
    let imageCallbacks: ReturnType<typeof createImageCallbacks>
    let videoCallbacks: ReturnType<typeof createVideoCallbacks>

    beforeEach(() => {
        imageCallbacks = createImageCallbacks()
        videoCallbacks = createVideoCallbacks()
        setAiGeneratedImageCallbacks(imageCallbacks)
        setAiGeneratedVideoCallbacks(videoCallbacks)
    })

    it('ignores events without a conversation Asset id', () => {
        routeSegmentEventToCanvas({ type: 'image_partial', assetId: 'asset-1' } as any)

        expect(imageCallbacks.onImagePartialToCanvas).not.toHaveBeenCalled()
        expect(videoCallbacks.onVideoPendingToCanvas).not.toHaveBeenCalled()
    })

    it('uses conversationAssetId as the authoritative thread identity', () => {
        routeSegmentEventToCanvas({
            conversationAssetId: 'conversation-1',
            threadId: 'legacy-thread-id',
            type: 'image_partial',
            imageUrl: 'data:image/png;base64,abc',
            assetId: 'asset-image-1',
            partialIndex: 2,
            aiProvider: 'OpenAI',
            canvasGeometry,
            generationRun,
        } as any)

        expect(imageCallbacks.onImagePartialToCanvas).toHaveBeenCalledWith({
            threadId: 'conversation-1',
            imageUrl: 'data:image/png;base64,abc',
            assetId: 'asset-image-1',
            partialIndex: 2,
            aiProvider: 'OpenAI',
            canvasGeometry,
            generationRun,
        })
    })

    it('forwards API geometry for VIDEO_PENDING rather than asking the canvas to synthesize a placeholder', () => {
        routeSegmentEventToCanvas({
            conversationAssetId: 'conversation-1',
            type: 'video_pending',
            aiProvider: 'Google',
            canvasGeometry,
            generationRun,
        } as any)

        expect(videoCallbacks.onVideoPendingToCanvas).toHaveBeenCalledWith({
            threadId: 'conversation-1',
            aiProvider: 'Google',
            canvasGeometry,
            generationRun,
        })
    })

    it('forwards final media Asset identity and authoritative geometry', () => {
        routeSegmentEventToCanvas({
            conversationAssetId: 'conversation-1',
            type: 'image_complete',
            imageUrl: '/api/assets/asset-image-1/original',
            assetId: 'asset-image-1',
            responseId: 'response-1',
            revisedPrompt: 'final image prompt',
            aiProvider: 'OpenAI',
            imageModelProvider: 'OpenAI',
            imageModelId: 'gpt-image-1',
            canvasGeometry,
            generationRun,
        } as any, { responseMessageId: 'message-1' })
        routeSegmentEventToCanvas({
            conversationAssetId: 'conversation-1',
            type: 'video_complete',
            videoUrl: '/api/assets/asset-video-1/original',
            assetId: 'asset-video-1',
            durationSeconds: 8,
            aspectRatio: 16 / 9,
            hasAudio: true,
            responseId: 'response-2',
            revisedPrompt: 'final video prompt',
            videoModel: 'veo-3.1',
            videoModelProvider: 'Google',
            canvasGeometry,
            generationRun,
        } as any, { responseMessageId: 'message-2' })

        expect(imageCallbacks.onImageCompleteToCanvas).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'conversation-1',
            assetId: 'asset-image-1',
            canvasGeometry,
            responseMessageId: 'message-1',
            generationRun,
        }))
        expect(videoCallbacks.onVideoCompleteToCanvas).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'conversation-1',
            assetId: 'asset-video-1',
            canvasGeometry,
            responseMessageId: 'message-2',
            generationRun,
        }))
    })

    it('forwards preserved-lineage plans unchanged to the canvas', () => {
        const lineagePlan = {
            generationRequestId: 'request-1',
            regenerationTarget: {
                branchId: 'branch-1',
                lineageParentNodeId: 'branch-fork-1',
                lineageParentType: 'branchFork',
            },
        }

        routeSegmentEventToCanvas({
            conversationAssetId: 'conversation-1',
            type: 'media_lineage_planned',
            mediaBranchLineagePlan: lineagePlan,
            generationRun,
        } as any)

        expect(imageCallbacks.onMediaLineagePlannedToCanvas).toHaveBeenCalledWith({
            threadId: 'conversation-1',
            lineagePlan,
            generationRun,
        })
    })

    it('routes standalone API geometry updates and terminal request events', () => {
        routeSegmentEventToCanvas({
            conversationAssetId: 'conversation-1',
            type: 'canvas_geometry_resolved',
            canvasGeometry,
            generationRun,
        } as any)
        routeSegmentEventToCanvas({
            conversationAssetId: 'conversation-1',
            type: 'media_generation_request_complete',
            generationRequestId: 'request-1',
            generationRun,
        } as any)

        expect(imageCallbacks.onCanvasGeometryResolvedToCanvas).toHaveBeenCalledWith({
            threadId: 'conversation-1',
            canvasGeometry,
            generationRun,
        })
        expect(imageCallbacks.onMediaGenerationRequestCompleteToCanvas).toHaveBeenCalledWith({
            threadId: 'conversation-1',
            generationRequestId: 'request-1',
            generationRun,
        })
    })

    it('does not route an image completion without an Asset, URL, or geometry', () => {
        routeSegmentEventToCanvas({
            conversationAssetId: 'conversation-1',
            type: 'image_complete',
        } as any)

        expect(imageCallbacks.onImageCompleteToCanvas).not.toHaveBeenCalled()
    })
})
