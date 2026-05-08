import type { CanvasNode, CanvasState } from '@lixpi/constants'
import type { WorldPosition } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

// Extension point for future non-image media node types (video, audio, etc.).
// Each registered handler receives the raw canvas node and its computed world
// position and is responsible for its own PIXI primitives and DOM ownership.
// Image nodes are handled by the core `pixiMediaLayer` and must NOT be
// registered here.

export type MediaNodeHandler<T extends CanvasNode = CanvasNode> = {
    // Return true when this handler owns the given node type.
    canHandle: (node: CanvasNode) => node is T

    // Called by the PIXI layer on every `sync` for nodes this handler owns.
    upsert: (node: T, worldPosition: WorldPosition, canvasState: CanvasState) => void

    // Called when the node is removed from the canvas state.
    remove: (nodeId: string) => void

    // Called on live drag/resize to keep the visual in sync with the DOM.
    setLiveTransform: (nodeId: string, worldPosition: WorldPosition, dimensions: { width: number; height: number }) => void

    // Called when the PIXI layer is being torn down.
    destroy: () => void
}

// Phase 3 video handler would be:
//   registry.register(createVideoNodeHandler({ ... }))
// and the pixiMediaLayer would call registry.dispatchSync(node, ...) for any
// node type it does not own natively.

export type MediaNodeRegistry = {
    register: <T extends CanvasNode>(handler: MediaNodeHandler<T>) => void
    dispatchSync: (node: CanvasNode, worldPosition: WorldPosition, canvasState: CanvasState) => boolean
    dispatchRemove: (nodeId: string) => void
    dispatchLiveTransform: (nodeId: string, worldPosition: WorldPosition, dimensions: { width: number; height: number }) => void
    destroy: () => void
}

export function createMediaNodeRegistry(): MediaNodeRegistry {
    const handlers: MediaNodeHandler[] = []

    function register<T extends CanvasNode>(handler: MediaNodeHandler<T>): void {
        handlers.push(handler as MediaNodeHandler)
    }

    function dispatchSync(node: CanvasNode, worldPosition: WorldPosition, canvasState: CanvasState): boolean {
        for (const handler of handlers) {
            if (handler.canHandle(node)) {
                handler.upsert(node, worldPosition, canvasState)
                return true
            }
        }
        return false
    }

    function dispatchRemove(nodeId: string): void {
        for (const handler of handlers) {
            handler.remove(nodeId)
        }
    }

    function dispatchLiveTransform(
        nodeId: string,
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ): void {
        for (const handler of handlers) {
            handler.setLiveTransform(nodeId, worldPosition, dimensions)
        }
    }

    function destroy(): void {
        for (const handler of handlers) {
            handler.destroy()
        }
        handlers.length = 0
    }

    return { register, dispatchSync, dispatchRemove, dispatchLiveTransform, destroy }
}
