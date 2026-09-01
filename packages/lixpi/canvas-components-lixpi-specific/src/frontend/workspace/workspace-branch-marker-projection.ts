import {
    estimateBranchMarkerDimensions,
    getBranchMarkerPromptDisplayText,
    getBranchMarkerPromptText,
    getBranchMarkerReasoningResponseText,
    getBranchMarkerThreadId,
    resizeBranchMarkerToDimensions,
    type BranchMarkerNode,
    type BranchMarkerPromptPart,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    type BranchMarkerConversationPreview,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    type CanvasNode,
    type CanvasState,
    type ExecutionTraceHandle,
} from '@lixpi/constants'
import {
    type BranchMarkerDimensionOptions,
} from './workspace-canvas-contracts.ts'

export type WorkspaceBranchMarkerProjectionPorts = {
    getState: () => CanvasState | null
    getConversationPreview: (node: BranchMarkerNode) => BranchMarkerConversationPreview | null
    getPromptParts: (node: BranchMarkerNode, preview: BranchMarkerConversationPreview | null | undefined) => BranchMarkerPromptPart[]
    getPromptTraceHandles: (node: BranchMarkerNode, preview: BranchMarkerConversationPreview | null | undefined) => ExecutionTraceHandle[]
    getLiveOverride: (nodeId: string) => { position?: { x: number; y: number }; dimensions?: { width: number; height: number } } | undefined
    deleteProjectionOverride: (nodeId: string) => void
    projectionOverrideNodeIds: Set<string>
    manuallyPositionedNodeIds: Set<string>
    syncMarker: (node: BranchMarkerNode) => void
    commit: (state: CanvasState) => void
    syncGeometry: (nodes: CanvasNode[]) => void
    syncMedia: (state: CanvasState) => void
    scheduleEdges: () => void
}

export class WorkspaceBranchMarkerProjection {
    constructor(private readonly ports: WorkspaceBranchMarkerProjectionPorts) {}

    static normalizeState(canvasState: CanvasState): CanvasState {
        let changed = false
        const nodes = canvasState.nodes.map((node): CanvasNode => {
            if (!WorkspaceBranchMarkerProjection.isMarker(node)) return node
            if (node.dimensions?.width > 0 && node.dimensions?.height > 0) return node
            const dimensions = estimateBranchMarkerDimensions(getBranchMarkerPromptText(node))
            changed = true
            return resizeBranchMarkerToDimensions(node, dimensions)
        })
        return changed ? { ...canvasState, nodes } : canvasState
    }

    getPromptTraceHandles = (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): ExecutionTraceHandle[] => this.ports.getPromptTraceHandles(node, preview)

    getPromptParts = (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): BranchMarkerPromptPart[] => this.ports.getPromptParts(node, preview)

    shouldShowResponseLine = (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): boolean => Boolean(getBranchMarkerReasoningResponseText(node, preview))

    resize = <T extends BranchMarkerNode>(node: T): T => {
        const preview = this.ports.getConversationPreview(node)
        const responseText = getBranchMarkerReasoningResponseText(node, preview)
        const promptText = getBranchMarkerPromptDisplayText(this.getPromptParts(node, preview))
        const dimensions = this.getContentDimensions(promptText, {
            responseLine: this.shouldShowResponseLine(node, preview),
            responseText,
        })
        return resizeBranchMarkerToDimensions(node, dimensions)
    }

    applyLiveGeometry = <T extends BranchMarkerNode>(node: T): T => {
        const override = this.ports.getLiveOverride(node.nodeId)
        if (!override?.position && !override?.dimensions) return node
        return {
            ...node,
            ...(override.position ? { position: override.position } : {}),
            ...(override.dimensions ? { dimensions: override.dimensions } : {}),
        } as T
    }

    preserveAcrossPromotion = (pendingNodeId: string, plannedNode: BranchMarkerNode): BranchMarkerNode => {
        if (pendingNodeId !== plannedNode.nodeId) this.clearProjectionGeometry(pendingNodeId)
        const nodeWithProjection = this.resize(plannedNode)
        this.clearProjectionGeometry(nodeWithProjection.nodeId)
        return nodeWithProjection
    }

    refresh = (threadId: string): void => {
        const state = this.ports.getState()
        if (!state) return

        const markersWithClearedProjectionGeometry: BranchMarkerNode[] = []
        const resizedOnCanvasMarkersById = new Map<string, BranchMarkerNode>()
        for (const node of state.nodes) {
            if (!WorkspaceBranchMarkerProjection.isMarker(node) || getBranchMarkerThreadId(node) !== threadId) continue

            if (this.ports.projectionOverrideNodeIds.has(node.nodeId)) {
                this.ports.deleteProjectionOverride(node.nodeId)
                this.ports.projectionOverrideNodeIds.delete(node.nodeId)
                markersWithClearedProjectionGeometry.push(node)
            }

            const resizedNode = this.resize(this.applyLiveGeometry(node))
            if (
                resizedNode.dimensions.width !== node.dimensions.width
                || resizedNode.dimensions.height !== node.dimensions.height
                || resizedNode.position.x !== node.position.x
                || resizedNode.position.y !== node.position.y
            ) {
                resizedOnCanvasMarkersById.set(node.nodeId, resizedNode)
            }
            this.ports.syncMarker(resizedNode)
        }
        if (resizedOnCanvasMarkersById.size > 0) {
            this.ports.commit({
                ...state,
                nodes: state.nodes.map(node => resizedOnCanvasMarkersById.get(node.nodeId) ?? node),
            })
        }
        if (markersWithClearedProjectionGeometry.length > 0 && resizedOnCanvasMarkersById.size === 0) {
            this.ports.syncGeometry(markersWithClearedProjectionGeometry)
            this.ports.syncMedia(state)
            this.ports.scheduleEdges()
        }
    }

    refreshThreads = (threadIds: Iterable<string>): void => {
        for (const threadId of threadIds) this.refresh(threadId)
    }

    private getContentDimensions(promptText: string, options: BranchMarkerDimensionOptions = {}): { width: number; height: number } {
        return estimateBranchMarkerDimensions(promptText, {
            responseLine: options.responseLine,
            responseText: options.responseText,
        })
    }

    private clearProjectionGeometry(nodeId: string): void {
        this.ports.deleteProjectionOverride(nodeId)
        this.ports.projectionOverrideNodeIds.delete(nodeId)
        this.ports.manuallyPositionedNodeIds.delete(nodeId)
    }

    private static isMarker(node: CanvasNode): node is BranchMarkerNode {
        return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
    }
}
