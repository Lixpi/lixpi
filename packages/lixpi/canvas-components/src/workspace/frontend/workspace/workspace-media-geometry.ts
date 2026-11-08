import { fitDimensionsToAspectRatio } from '@lixpi/canvas-engine/shared'
import {
    type CanvasNode,
    type CanvasState,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type WorkspaceEdge,
} from '@lixpi/constants'

type IntrinsicMediaSize = {
    nodeId: string
    width: number
    height: number
}

export type WorkspaceMediaGeometryPorts = {
    getState: () => CanvasState | null
    getActiveGesture: () => {
        draggingNodeId: string | null
        resizingNodeId: string | null
    }
    getWorldPosition: (
        node: CanvasNode,
        nodesById: Map<string, CanvasNode>,
    ) => {
        x: number
        y: number
    }
    toParentRelativePosition: (
        worldPosition: {
            x: number
            y: number
        },
        parentId: string,
        nodesById: Map<string, CanvasNode>,
    ) => {
        x: number
        y: number
    }
    rebalance: (
        nodes: CanvasNode[],
        edges: WorkspaceEdge[],
    ) => CanvasNode[]
    commit: (
        state: CanvasState,
        options: { preserveEditors: boolean },
    ) => void
    markImageFrameDecoded: (nodeId: string) => void
    clearImageCompletion: (nodeId: string) => void
}

export class WorkspaceMediaGeometry {
    constructor(private readonly ports: WorkspaceMediaGeometryPorts) {}

    handleVideoIntrinsicSize = (size: IntrinsicMediaSize): void => {
        const state = this.ports.getState()

        if (
            !state
            || this.hasActiveGesture(size.nodeId)
        )
            return

        const aspectRatio = this.getAspectRatio(size)

        if (!aspectRatio)
            return

        const node = state.nodes.find(
            (candidate: CanvasNode): candidate is VideoCanvasNode => candidate.type === 'video' && candidate.nodeId === size.nodeId,
        )

        if (!node)
            return

        const nextState = this.resizeNode(
            state,
            node,
            aspectRatio,
        )

        if (nextState)
            this.ports.commit(nextState, { preserveEditors: false })
    }

    handleImageIntrinsicSize = (size: IntrinsicMediaSize & { preserveNodeGeometry?: boolean }): void => {
        const state = this.ports.getState()
        const aspectRatio = this.getAspectRatio(size)

        if (
            !state
            || !aspectRatio
        ) {
            this.ports.clearImageCompletion(size.nodeId)

            return
        }

        const node = state.nodes.find(
            (candidate: CanvasNode): candidate is ImageCanvasNode => candidate.type === 'image' && candidate.nodeId === size.nodeId,
        )

        if (!node) {
            this.ports.clearImageCompletion(size.nodeId)

            return
        }

        this.ports.markImageFrameDecoded(size.nodeId)
        this.ports.clearImageCompletion(size.nodeId)

        if (
            size.preserveNodeGeometry
            || this.hasActiveGesture(size.nodeId)
        )
            return

        const nextState = this.resizeNode(
            state,
            node,
            aspectRatio,
        )

        if (nextState)
            this.ports.commit(nextState, { preserveEditors: true })
    }

    private hasActiveGesture(nodeId: string): boolean {
        const gesture = this.ports.getActiveGesture()

        return gesture.draggingNodeId === nodeId || gesture.resizingNodeId === nodeId
    }

    private getAspectRatio(size: IntrinsicMediaSize): number | null {
        if (
            !Number.isFinite(size.width)
            || !Number.isFinite(size.height)
            || size.width <= 0
            || size.height <= 0
        )
            return null

        const aspectRatio = size.width / size.height

        return Number.isFinite(aspectRatio)
            && aspectRatio > 0
            ? aspectRatio
            : null
    }

    private resizeNode(
        state: CanvasState,
        node: ImageCanvasNode | VideoCanvasNode,
        aspectRatio: number,
    ): CanvasState | null {
        const dimensions = fitDimensionsToAspectRatio(node.dimensions, aspectRatio)
        const previousAspectRatio = 'aspectRatio' in node
            && typeof node.aspectRatio === 'number'
            ? node.aspectRatio
            : 0
        const aspectChanged = Math.abs(previousAspectRatio - aspectRatio) > 0.001
        const widthChanged = Math.abs(node.dimensions.width - dimensions.width) > 0.5
        const heightChanged = Math.abs(node.dimensions.height - dimensions.height) > 0.5

        if (
            !aspectChanged
            && !widthChanged
            && !heightChanged
        )
            return null

        const nodesById = new Map(
            state.nodes.map(candidate => [candidate.nodeId, candidate]),
        )
        const worldPosition = this.ports.getWorldPosition(node, nodesById)
        const nextWorldPosition = {
            x: worldPosition.x + (node.dimensions.width - dimensions.width) / 2,
            y: worldPosition.y + (node.dimensions.height - dimensions.height) / 2,
        }
        const position = node.parentId
            ? this.ports.toParentRelativePosition(
                nextWorldPosition,
                node.parentId,
                nodesById,
            )
            : nextWorldPosition
        const nodes = state.nodes.map(
            candidate =>
                candidate.nodeId === node.nodeId
                    ? {
                        ...node,
                        aspectRatio,
                        position,
                        dimensions,
                    }
                    : candidate,
        )
        const resolvedNodes = node.generatedBy
            ? this.ports.rebalance(nodes, state.edges)
            : nodes

        return {
            ...state,
            nodes: resolvedNodes,
        }
    }
}
