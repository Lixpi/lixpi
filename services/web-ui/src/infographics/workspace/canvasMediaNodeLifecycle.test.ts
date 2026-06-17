import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasState } from '@lixpi/constants'
import {
    createCanvasMediaNodeLifecycleTracker,
    type CanvasMediaNodeLifecycleConfig,
} from './canvasMediaNodeLifecycle.ts'

const mocks = vi.hoisted(() => ({
    deleteImage: vi.fn(),
    deleteVideo: vi.fn(),
}))

vi.mock('$src/utils/imageUtils.ts', () => ({
    deleteImage: mocks.deleteImage,
}))

vi.mock('$src/utils/videoUtils.ts', () => ({
    deleteVideo: mocks.deleteVideo,
}))

function makeCanvasState(nodes: any[] = []): CanvasState {
    return {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes,
        edges: [],
    } as CanvasState
}

function makeImageNode(fileId: string, workspaceId = 'workspace-1'): any {
    return {
        nodeId: `node-${fileId}`,
        type: 'image',
        fileId,
        workspaceId,
        src: `/api/images/${workspaceId}/${fileId}`,
        aspectRatio: 1,
        position: { x: 0, y: 0 },
        dimensions: { width: 100, height: 100 },
    }
}

function makeVideoNode(fileId: string, posterFileId = 'poster-1', workspaceId = 'workspace-1'): any {
    return {
        nodeId: `node-${fileId}`,
        type: 'video',
        fileId,
        posterFileId,
        workspaceId,
        src: `/api/videos/${workspaceId}/${fileId}`,
        posterSrc: `/api/images/${workspaceId}/${posterFileId}`,
        aspectRatio: 1,
        durationSeconds: 4,
        hasAudio: false,
        position: { x: 0, y: 0 },
        dimensions: { width: 100, height: 100 },
    }
}

// =============================================================================
// CANVAS MEDIA NODE LIFECYCLE
// =============================================================================

describe('canvasMediaNodeLifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        mocks.deleteImage.mockReset()
        mocks.deleteVideo.mockReset()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('deletes removed image and video nodes through their configured deletion paths', async () => {
        const tracker = createCanvasMediaNodeLifecycleTracker()
        tracker.initializeFromCanvasState(makeCanvasState([
            makeImageNode('image-1'),
            makeVideoNode('video-1', 'poster-1'),
        ]))

        tracker.trackCanvasState(makeCanvasState([]))
        await vi.runAllTimersAsync()

        expect(mocks.deleteImage).toHaveBeenCalledWith('image-1', 'workspace-1')
        expect(mocks.deleteVideo).toHaveBeenCalledWith('video-1', 'workspace-1', 'poster-1')
    })

    it('does not delete nodes during initial snapshot or when the tracked media still exists', async () => {
        const tracker = createCanvasMediaNodeLifecycleTracker()
        tracker.initializeFromCanvasState(makeCanvasState([makeImageNode('image-1')]))

        tracker.trackCanvasState(makeCanvasState([makeImageNode('image-1')]))
        await vi.runAllTimersAsync()

        expect(mocks.deleteImage).not.toHaveBeenCalled()
        expect(mocks.deleteVideo).not.toHaveBeenCalled()
    })

    it('supports adding future media node types by config instead of duplicating lifecycle code', async () => {
        const deleteAudio = vi.fn()
        const audioConfig: CanvasMediaNodeLifecycleConfig = {
            nodeType: 'audio' as any,
            trackNode: (node) => {
                const audioNode = node as any
                if (audioNode.type !== 'audio') return null
                if (!audioNode.fileId) return null

                return {
                    key: `audio:${audioNode.fileId}`,
                    fileId: audioNode.fileId,
                    workspaceId: audioNode.workspaceId,
                    nodeType: 'audio' as any,
                }
            },
            deleteTrackedNode: deleteAudio,
        }
        const tracker = createCanvasMediaNodeLifecycleTracker([audioConfig])
        tracker.initializeFromCanvasState(makeCanvasState([{
            type: 'audio',
            fileId: 'audio-1',
            workspaceId: 'workspace-1',
        }]))

        tracker.trackCanvasState(makeCanvasState([]))
        await vi.runAllTimersAsync()

        expect(deleteAudio).toHaveBeenCalledWith({
            key: 'audio:audio-1',
            fileId: 'audio-1',
            workspaceId: 'workspace-1',
            nodeType: 'audio',
        })
    })
})
