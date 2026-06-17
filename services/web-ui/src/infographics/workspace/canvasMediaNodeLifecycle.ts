import type {
    CanvasNode,
    CanvasNodeType,
    CanvasState,
    ImageCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'
import { deleteImage } from '$src/utils/imageUtils.ts'
import { deleteVideo } from '$src/utils/videoUtils.ts'

export type TrackedCanvasMediaNode = {
    key: string
    fileId: string
    workspaceId: string
    nodeType: CanvasNodeType
    posterFileId?: string
}

export type CanvasMediaNodeLifecycleConfig = {
    nodeType: CanvasNodeType
    trackNode: (node: CanvasNode) => TrackedCanvasMediaNode | null
    deleteTrackedNode: (trackedNode: TrackedCanvasMediaNode) => void | Promise<void>
}

export type CanvasMediaNodeLifecycleTrackerInstance = {
    trackCanvasState: (canvasState: CanvasState | null) => void
    initializeFromCanvasState: (canvasState: CanvasState | null) => void
    destroy: () => void
}

export const imageCanvasMediaNodeLifecycleConfig: CanvasMediaNodeLifecycleConfig = {
    nodeType: 'image',
    trackNode: (node) => {
        if (node.type !== 'image') return null

        const imageNode = node as ImageCanvasNode
        if (!imageNode.fileId) return null

        return {
            key: `image:${imageNode.fileId}`,
            fileId: imageNode.fileId,
            workspaceId: imageNode.workspaceId,
            nodeType: 'image',
        }
    },
    deleteTrackedNode: (trackedNode) => {
        return deleteImage(trackedNode.fileId, trackedNode.workspaceId)
    },
}

export const videoCanvasMediaNodeLifecycleConfig: CanvasMediaNodeLifecycleConfig = {
    nodeType: 'video',
    trackNode: (node) => {
        if (node.type !== 'video') return null

        const videoNode = node as VideoCanvasNode
        if (!videoNode.fileId) return null

        return {
            key: `video:${videoNode.fileId}`,
            fileId: videoNode.fileId,
            posterFileId: videoNode.posterFileId || undefined,
            workspaceId: videoNode.workspaceId,
            nodeType: 'video',
        }
    },
    deleteTrackedNode: (trackedNode) => {
        return deleteVideo(trackedNode.fileId, trackedNode.workspaceId, trackedNode.posterFileId)
    },
}

class CanvasMediaNodeLifecycleTracker implements CanvasMediaNodeLifecycleTrackerInstance {
    private previousMediaNodes = new Map<string, TrackedCanvasMediaNode>()
    private readonly configsByNodeType: Map<CanvasNodeType, CanvasMediaNodeLifecycleConfig>

    constructor(configs: CanvasMediaNodeLifecycleConfig[]) {
        this.configsByNodeType = new Map()
        for (const config of configs) {
            this.configsByNodeType.set(config.nodeType, config)
        }
    }

    trackCanvasState(canvasState: CanvasState | null): void {
        const currentMediaNodes = this.extractMediaNodesFromCanvasState(canvasState)

        for (const [key, trackedNode] of this.previousMediaNodes) {
            if (currentMediaNodes.has(key)) continue
            this.scheduleDeletion(trackedNode)
        }

        this.previousMediaNodes = currentMediaNodes
    }

    initializeFromCanvasState(canvasState: CanvasState | null): void {
        this.previousMediaNodes = this.extractMediaNodesFromCanvasState(canvasState)
    }

    destroy(): void {
        this.previousMediaNodes.clear()
    }

    private extractMediaNodesFromCanvasState(canvasState: CanvasState | null): Map<string, TrackedCanvasMediaNode> {
        const mediaNodes = new Map<string, TrackedCanvasMediaNode>()

        if (!canvasState) return mediaNodes

        for (const node of canvasState.nodes) {
            const config = this.configsByNodeType.get(node.type)
            const trackedNode = config?.trackNode(node)
            if (!trackedNode) continue

            mediaNodes.set(trackedNode.key, trackedNode)
        }

        return mediaNodes
    }

    private scheduleDeletion(trackedNode: TrackedCanvasMediaNode): void {
        const config = this.configsByNodeType.get(trackedNode.nodeType)
        if (!config) return

        setTimeout(() => {
            void config.deleteTrackedNode(trackedNode)
        }, 0)
    }
}

export function createCanvasMediaNodeLifecycleTracker(
    configs: CanvasMediaNodeLifecycleConfig[] = [
        imageCanvasMediaNodeLifecycleConfig,
        videoCanvasMediaNodeLifecycleConfig,
    ]
): CanvasMediaNodeLifecycleTrackerInstance {
    return new CanvasMediaNodeLifecycleTracker(configs)
}
