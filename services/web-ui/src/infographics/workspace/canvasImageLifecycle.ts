import type { CanvasState, ImageCanvasNode } from '@lixpi/constants'
import { deleteImage } from '$src/utils/imageUtils.ts'

type TrackedCanvasImage = {
    fileId: string
    workspaceId: string
}

export function createCanvasImageLifecycleTracker() {
    let previousImages = new Map<string, TrackedCanvasImage>()

    function extractImagesFromCanvasState(canvasState: CanvasState | null): Map<string, TrackedCanvasImage> {
        const images = new Map<string, TrackedCanvasImage>()

        if (!canvasState) return images

        for (const node of canvasState.nodes) {
            if (node.type === 'image') {
                const imageNode = node as ImageCanvasNode
                images.set(imageNode.fileId, {
                    fileId: imageNode.fileId,
                    workspaceId: imageNode.workspaceId,
                })
            }
        }

        return images
    }

    function trackCanvasState(canvasState: CanvasState | null): void {
        const currentImages = extractImagesFromCanvasState(canvasState)

        // Find images that were removed (present in previous but not in current)
        for (const [fileId, trackedImage] of previousImages) {
            if (!currentImages.has(fileId)) {
                // Image was removed from canvas, schedule deletion
                // Use setTimeout to avoid blocking the current operation
                setTimeout(() => {
                    deleteImage(fileId, trackedImage.workspaceId)
                }, 0)
            }
        }

        previousImages = currentImages
    }

    function initializeFromCanvasState(canvasState: CanvasState | null): void {
        // Initialize tracking without triggering deletions
        // Used when first loading a workspace
        previousImages = extractImagesFromCanvasState(canvasState)
    }

    function destroy(): void {
        previousImages.clear()
    }

    return {
        trackCanvasState,
        initializeFromCanvasState,
        destroy,
    }
}
