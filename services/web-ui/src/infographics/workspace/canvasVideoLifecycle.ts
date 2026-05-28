import type { CanvasState, VideoCanvasNode } from '@lixpi/constants'
import { deleteVideo } from '$src/utils/videoUtils.ts'

// Sibling of canvasImageLifecycle.ts. Watches VideoCanvasNode entries across
// canvas state commits and, when a video node disappears, fires the workspace
// video delete (MP4 + poster) so orphan media doesn't accumulate in the Object
// Store. Initialization (initializeFromCanvasState) snapshots the current set
// without scheduling any deletions, matching how the image tracker behaves on
// first workspace load.

type TrackedCanvasVideo = {
    fileId: string
    posterFileId?: string
    workspaceId: string
}

export function createCanvasVideoLifecycleTracker() {
    let previousVideos = new Map<string, TrackedCanvasVideo>()

    function extractVideosFromCanvasState(canvasState: CanvasState | null): Map<string, TrackedCanvasVideo> {
        const videos = new Map<string, TrackedCanvasVideo>()

        if (!canvasState) return videos

        for (const node of canvasState.nodes) {
            if (node.type === 'video') {
                const videoNode = node as VideoCanvasNode
                if (!videoNode.fileId) continue // skip placeholder nodes that have no stored MP4 yet
                videos.set(videoNode.fileId, {
                    fileId: videoNode.fileId,
                    posterFileId: videoNode.posterFileId || undefined,
                    workspaceId: videoNode.workspaceId,
                })
            }
        }

        return videos
    }

    function trackCanvasState(canvasState: CanvasState | null): void {
        const currentVideos = extractVideosFromCanvasState(canvasState)

        for (const [fileId, tracked] of previousVideos) {
            if (!currentVideos.has(fileId)) {
                setTimeout(() => {
                    deleteVideo(fileId, tracked.workspaceId, tracked.posterFileId)
                }, 0)
            }
        }

        previousVideos = currentVideos
    }

    function initializeFromCanvasState(canvasState: CanvasState | null): void {
        previousVideos = extractVideosFromCanvasState(canvasState)
    }

    function destroy(): void {
        previousVideos.clear()
    }

    return {
        trackCanvasState,
        initializeFromCanvasState,
        destroy,
    }
}
