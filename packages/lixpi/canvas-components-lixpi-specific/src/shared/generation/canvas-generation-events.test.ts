'use strict'

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    CanvasGenerationEvents,
    type CanvasMediaSegment,
    type CanvasMediaSegmentOptions,
} from './canvas-generation-events.ts'

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
    let events: CanvasGenerationEvents
    const routeSegmentEventToCanvas = (event: CanvasMediaSegment, options?: CanvasMediaSegmentOptions) => events.route(event, options)
    afterEach(() => events.destroy())
    let imageCallbacks: ReturnType<typeof createImageCallbacks>
    let videoCallbacks: ReturnType<typeof createVideoCallbacks>

    beforeEach(() => {
        imageCallbacks = createImageCallbacks()
        videoCallbacks = createVideoCallbacks()
        events = new CanvasGenerationEvents(error => {
            throw error
        })
        events.subscribeImages(imageCallbacks)
        events.subscribeVideos(videoCallbacks)
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

    it.each(['image_partial', 'video_pending', 'canvas_geometry_resolved', 'media_generation_request_complete', 'stream_failure'])('retains workspace identity when routing %s', type => {
        const event: CanvasMediaSegment = {
            type,
            workspaceId: 'originating-workspace',
            conversationAssetId: 'thread',
            canvasGeometry,
            generationRequestId: 'request',
            ...(type === 'stream_failure' ? { status: 'ERROR', error: 'stream failed' } : {}),
        }
        routeSegmentEventToCanvas(event)
        const callback = type === 'image_partial'
            ? imageCallbacks.onImagePartialToCanvas
            : type === 'video_pending'
            ? videoCallbacks.onVideoPendingToCanvas
            : type === 'canvas_geometry_resolved'
            ? imageCallbacks.onCanvasGeometryResolvedToCanvas
            : type === 'media_generation_request_complete'
            ? imageCallbacks.onMediaGenerationRequestCompleteToCanvas
            : imageCallbacks.onImageErrorToCanvas
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'originating-workspace', threadId: 'thread' }))
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

describe('canvas generation subscription lifetime', () => {
    it('keeps independent canvas subscriptions even when one owner closes', () => {
        const first = new CanvasGenerationEvents(vi.fn())
        const second = new CanvasGenerationEvents(vi.fn())
        const firstListener = vi.fn()
        const secondListener = vi.fn()
        first.subscribeImages({ onImageErrorToCanvas: firstListener })
        second.subscribeImages({ onImageErrorToCanvas: secondListener })
        first.destroy()
        const event = { type: 'image_error', threadId: 'conversation', error: 'failed' }
        first.route(event)
        second.route(event)
        expect(firstListener).not.toHaveBeenCalled()
        expect(secondListener).toHaveBeenCalledTimes(1)
        expect(() => first.subscribeImages({})).toThrow('Canvas generation events are disposed')
        second.destroy()
    })

    it('adds listeners without replacing existing listeners and releases only the requested one', () => {
        const owner = new CanvasGenerationEvents(vi.fn())
        const first = vi.fn()
        const second = vi.fn()
        const release = owner.subscribeVideos({ onVideoErrorToCanvas: first })
        owner.subscribeVideos({ onVideoErrorToCanvas: second })
        owner.route({ type: 'video_error', threadId: 'conversation' })
        release()
        release()
        owner.route({ type: 'video_error', threadId: 'conversation' })
        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(2)
        owner.destroy()
    })

    it('does not call a listener removed during the same event dispatch', () => {
        const owner = new CanvasGenerationEvents(vi.fn())
        const second = vi.fn()
        let release = () => {}
        owner.subscribeImages({ onImageErrorToCanvas: () => release() })
        release = owner.subscribeImages({ onImageErrorToCanvas: second })
        owner.route({ type: 'image_error', threadId: 'conversation' })
        expect(second).not.toHaveBeenCalled()
        owner.destroy()
    })

    it('isolates mutable payloads between subscribers and from the source event', () => {
        const owner = new CanvasGenerationEvents(vi.fn())
        const second = vi.fn()
        owner.subscribeImages({
            onCanvasGeometryResolvedToCanvas: payload => {
                payload.canvasGeometry.nodes.length = 0
            },
        })
        owner.subscribeImages({ onCanvasGeometryResolvedToCanvas: second })
        const event = {
            type: 'canvas_geometry_resolved',
            threadId: 'conversation',
            canvasGeometry: {
                layoutRevision: 2,
                nodes: [{ nodeId: 'node', position: { x: 1, y: 2 }, dimensions: { width: 20, height: 30 } }],
            },
        }
        owner.route(event)
        expect(event.canvasGeometry.nodes).toHaveLength(1)
        expect(second.mock.calls[0][0].canvasGeometry.nodes).toHaveLength(1)
        owner.destroy()
    })

    it('reports synchronous and asynchronous failures without skipping sibling subscriptions', async () => {
        const reportError = vi.fn()
        const owner = new CanvasGenerationEvents(reportError)
        const received = vi.fn()
        owner.subscribeImages({
            onImageErrorToCanvas: () => {
                throw new Error('sync')
            },
        })
        owner.subscribeImages({
            onImageErrorToCanvas: async () => {
                throw new Error('async')
            },
        })
        owner.subscribeImages({ onImageErrorToCanvas: received })
        owner.route({ type: 'image_error', threadId: 'conversation' })
        await Promise.resolve()
        expect(received).toHaveBeenCalledTimes(1)
        expect(reportError.mock.calls.map(([error]) => error.message)).toEqual(['sync', 'async'])
        owner.destroy()
    })

    it('maps general stream failure into the canvas failure callback', () => {
        const owner = new CanvasGenerationEvents(vi.fn())
        const failed = vi.fn()
        owner.subscribeImages({ onImageErrorToCanvas: failed })
        owner.route({ status: 'ERROR', conversationAssetId: 'conversation', error: 'request failed' })
        expect(failed).toHaveBeenCalledWith({ threadId: 'conversation', error: 'request failed', generationRun: undefined })
        owner.destroy()
    })

    it('stops secondary resolver-error callbacks when a primary callback disposes the owner', () => {
        const owner = new CanvasGenerationEvents(vi.fn())
        const failed = vi.fn()
        owner.subscribeImages({
            onMediaBranchResolutionErrorToCanvas: () => owner.destroy(),
            onImageErrorToCanvas: failed,
        })
        owner.route({ type: 'image_branch_resolution_error', threadId: 'conversation' })
        expect(failed).not.toHaveBeenCalled()
    })
})
