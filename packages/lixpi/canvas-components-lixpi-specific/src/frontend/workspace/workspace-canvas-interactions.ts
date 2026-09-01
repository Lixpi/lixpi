import {
    type CanvasConnectionControls,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    rectangleContainsPoint,
    type CanvasEngineRect,
} from '@lixpi/canvas-engine/shared'
import { WorkspaceCanvasMenu } from '@lixpi/canvas-components-lixpi-specific/frontend/menus'
import {
    type CanvasNode,
    type CanvasState,
    type WorkspaceEdgePathType,
} from '@lixpi/constants'
import {
    type DragStartOptions,
} from './workspace-canvas-contracts.ts'

type GestureState = {
    readonly draggingNodeId: string | null
    readonly resizingNodeId: string | null
    consumePaneClick: () => boolean
}

type MarqueeState = {
    readonly active: boolean
    start: (event: MouseEvent) => void
}

type SelectionState = {
    marquee: MarqueeState
    isCanvasBackgroundTarget: (target: EventTarget | null) => boolean
    clearNodes: () => void
    clearEdgeSelection: (hideMenu: boolean) => void
    clearMarquee: () => void
}

type PendingCircleGeometry = {
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
}

export type WorkspaceCanvasInteractionsPorts = {
    pane: HTMLElement
    viewport: HTMLElement
    gestures: GestureState
    selection: SelectionState
    isDestroyed: () => boolean
    getState: () => CanvasState | null
    getNode: (nodeId: string | undefined) => CanvasNode | undefined
    getConnections: () => CanvasConnectionControls | null
    getWorldRect: (node: CanvasNode, nodesById: Map<string, CanvasNode>) => CanvasEngineRect
    getPendingCircle: (
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
    ) => PendingCircleGeometry | null
    clientToWorld: (clientX: number, clientY: number) => { x: number; y: number }
    cancelInteraction: () => void
    suspendPanZoom: (nodeId: string) => void
    startDrag: (event: MouseEvent, nodeId: string, options: DragStartOptions) => void
    deleteNodes: (nodeIds: ReadonlySet<string>) => Promise<void>
    downloadMedia: (assetId: string, rendition: 'original' | 'preview', useDownloadRoute: boolean) => Promise<void>
    replaceMedia: (nodeId: string) => void
    openAsset: (assetId: string) => void
    commit: (state: CanvasState) => void
    defaultConnectorCurve: WorkspaceEdgePathType
    getMenuVisualScale: () => number
}

export class WorkspaceCanvasInteractions {
    readonly menu: WorkspaceCanvasMenu

    constructor(private readonly ports: WorkspaceCanvasInteractionsPorts) {
        this.menu = new WorkspaceCanvasMenu({
            pane: ports.pane,
            viewport: ports.viewport,
            getNode: nodeId => ports.getNode(nodeId),
            getEdgeRect: edgeId => ports.getConnections()?.getEdgeMidpointRect(edgeId) ?? null,
            actions: {
                onDeleteEdge: this.deleteEdge,
                onChangeConnectorCurve: this.changeConnectorCurve,
                onDeleteNode: nodeId => {
                    void ports.deleteNodes(new Set([nodeId]))
                },
                onDownloadMedia: this.downloadMedia,
                onReplaceMedia: ports.replaceMedia,
                onOpenAsset: this.openAsset,
                onTriggerConnection: nodeId => ports.getConnections()?.startConnectionFromMenu(nodeId),
            },
            getVisualScale: ports.getMenuVisualScale,
        })
        ports.pane.addEventListener('pointerdown', this.handlePointerDown, true)
        ports.pane.addEventListener('mousemove', this.handleMouseMove, true)
        ports.pane.addEventListener('mouseleave', this.handleMouseLeave)
        ports.pane.addEventListener('mousedown', this.handleMouseDown, true)
        ports.pane.addEventListener('click', this.handleClick)
    }

    destroy(): void {
        this.ports.pane.removeEventListener('click', this.handleClick)
        this.ports.pane.removeEventListener('mousedown', this.handleMouseDown, true)
        this.ports.pane.removeEventListener('mouseleave', this.handleMouseLeave)
        this.ports.pane.removeEventListener('mousemove', this.handleMouseMove, true)
        this.ports.pane.removeEventListener('pointerdown', this.handlePointerDown, true)
        this.ports.pane.style.cursor = ''
        this.menu.destroy()
    }

    private deleteEdge = (edgeId: string): void => {
        const connections = this.ports.getConnections()
        if (!connections) return
        connections.selectEdge(edgeId)
        connections.deleteSelectedEdge()
    }

    private changeConnectorCurve = (edgeId: string): void => {
        const state = this.ports.getState()
        if (!state) return
        const edgeIndex = state.edges.findIndex(edge => edge.edgeId === edgeId)
        if (edgeIndex === -1) return
        const edge = state.edges[edgeIndex]
        const currentCurve = edge.pathType ?? this.ports.defaultConnectorCurve
        const pathType = currentCurve === 'horizontal-bezier' ? 'orthogonal' : 'horizontal-bezier'
        const edges = [...state.edges]
        edges[edgeIndex] = { ...edge, pathType }
        this.ports.commit({ ...state, edges })
    }

    private downloadMedia = (nodeId: string): void => {
        const node = this.ports.getNode(nodeId)
        if (!node || !('assetId' in node) || !node.assetId) return
        if (!['mediaDocument', 'audio', 'image', 'video'].includes(node.type)) return
        void this.ports.downloadMedia(
            node.assetId,
            node.type === 'video' ? 'preview' : 'original',
            node.type === 'mediaDocument' || node.type === 'audio',
        )
    }

    private openAsset = (nodeId: string): void => {
        const node = this.ports.getNode(nodeId)
        if (!node || !('assetId' in node) || !node.assetId) return
        this.ports.openAsset(node.assetId)
    }

    private hitTest(point: { x: number; y: number }): CanvasNode | null {
        const state = this.ports.getState()
        if (!state) return null
        const nodesById = new Map(state.nodes.map(node => [node.nodeId, node]))
        for (let index = state.nodes.length - 1; index >= 0; index--) {
            const node = state.nodes[index]
            if (!['image', 'video', 'document', 'branchOrigin', 'branchFork', 'branchLine'].includes(node.type)) continue
            const worldRect = this.ports.getWorldRect(node, nodesById)
            const pendingCircle = this.ports.getPendingCircle(node.nodeId, worldRect, node.dimensions)
            const rect = pendingCircle ? { ...pendingCircle.position, ...pendingCircle.dimensions } : worldRect
            if (rectangleContainsPoint(rect, point)) return node
        }
        return null
    }

    private handleClick = (event: MouseEvent): void => {
        if (this.ports.isDestroyed() || this.ports.gestures.consumePaneClick()) return
        if (!this.ports.selection.isCanvasBackgroundTarget(event.target)) return
        this.ports.selection.clearNodes()
        this.ports.selection.clearEdgeSelection(true)
    }

    private handlePointerDown = (event: PointerEvent): void => {
        if (event.button !== 0 || !event.isPrimary) return
        if (!this.ports.selection.isCanvasBackgroundTarget(event.target) || !this.ports.getState()) return
        const point = this.ports.clientToWorld(event.clientX, event.clientY)
        const nodeId = this.hitTest(point)?.nodeId
        if (nodeId) this.ports.suspendPanZoom(nodeId)
    }

    private handleMouseMove = (event: MouseEvent): void => {
        if (this.ports.gestures.resizingNodeId) return
        if (
            !this.ports.getState()
            || this.ports.gestures.draggingNodeId
            || this.ports.selection.marquee.active
            || !this.ports.selection.isCanvasBackgroundTarget(event.target)
        ) {
            this.ports.pane.style.cursor = ''
            return
        }
        this.hitTest(this.ports.clientToWorld(event.clientX, event.clientY))
        this.ports.pane.style.cursor = ''
    }

    private handleMouseLeave = (): void => {
        if (!this.ports.gestures.resizingNodeId) this.ports.pane.style.cursor = ''
    }

    private handleMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0) return
        if (!this.ports.selection.isCanvasBackgroundTarget(event.target) || !this.ports.getState()) return
        this.ports.cancelInteraction()
        const node = this.hitTest(this.ports.clientToWorld(event.clientX, event.clientY))
        if (node) {
            this.ports.startDrag(event, node.nodeId, { suppressPaneClick: true })
            return
        }
        if (event.metaKey || event.ctrlKey) return
        event.preventDefault()
        event.stopPropagation()
        this.ports.selection.clearMarquee()
        this.ports.selection.marquee.start(event)
    }
}
