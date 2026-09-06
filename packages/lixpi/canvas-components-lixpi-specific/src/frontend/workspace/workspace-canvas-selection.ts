import {
    getIntersectingNodeIds,
    unionRectangles,
    type CanvasEngineRect as Rect,
} from '@lixpi/canvas-engine/shared'
import {
    type CanvasConnectionControls,
    type CanvasController,
    type CanvasSelection,
    type MarqueeController,
    type NodeLayerManager,
    type SelectionOverlay,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type CanvasNode,
    type CanvasState,
} from '@lixpi/constants'
import {
    type WorkspaceMediaLayer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/media'

export type WorkspaceCanvasSelectionPorts = {
    pane: HTMLElement
    viewport: HTMLElement
    runtime: CanvasController
    media: WorkspaceMediaLayer
    layers: NodeLayerManager
    marqueeStyle: {
        borderColor: string
        backgroundColor: string
    }
    getState: () => CanvasState | null
    getNodeWorldPosition: (node: CanvasNode) => {
        x: number
        y: number
    }
    getNodeGeometryOverride: (nodeId: string) => {
        position?: {
            x: number
            y: number
        }
        dimensions?: {
            width: number
            height: number
        }
    } | undefined
    getConnections: () => CanvasConnectionControls | null
    lockPan: () => () => void
    startGroupDrag: (
        event: MouseEvent,
        nodeId: string,
    ) => void
    suppressPaneClick: () => void
    addContext: (nodeIds: Iterable<string>) => void
    scheduleEdges: () => void
    menu: {
        showNode: (nodeId: string) => void
        showEdge: (edgeId: string) => void
        hide: () => void
        repositionNode: (nodeId: string | null) => void
        repositionEdge: (edgeId: string | null) => void
    }
}

export class WorkspaceCanvasSelection {
    readonly selection: CanvasSelection
    readonly overlay: SelectionOverlay
    readonly marquee: MarqueeController
    private edgeId: string | null = null

    constructor(private readonly ports: WorkspaceCanvasSelectionPorts) {
        this.selection = ports.runtime.selection
        this.overlay = ports.runtime.installSelectionOverlay({
            marquee: {
                ...ports.marqueeStyle,
                radius: 8,
            },
            onGroupPointerDown: event => {
                if (!this.shouldShowGroupOverlay())
                    return

                const primaryNodeId = Array.from(this.selection.nodeIds)[0]

                if (primaryNodeId)
                    this.ports.startGroupDrag(event, primaryNodeId)
            },
        })
        this.marquee = ports.runtime.installMarquee({
            lock: this.ports.lockPan,
            onStart: () => {
                this.ports.getConnections()?.cancelTransientConnection()
                this.clearEdgeSelection(true)
                this.overlay.setGroup(null)

                if (this.selection.nodeIds.size > 0)
                    this.setNodes(
                        new Set(),
                    )
            },
            onChange: bounds => {
                this.updateMarquee()
                this.setNodes(
                    new Set(
                        this.getSelectableNodeIdsInRect(bounds),
                    ),
                    true,
                )
                this.ports.suppressPaneClick()
            },
            onEnd: moved => {
                this.hideMarquee()
                this.ports.getConnections()?.cancelTransientConnection()
                this.updateGroupOverlay()

                if (
                    moved
                    && this.selection.fromMarquee
                )
                    this.ports.addContext(this.selection.nodeIds)
            },
            onCancel: () => {
                this.clearMarquee()
                this.ports.getConnections()?.cancelTransientConnection()
            },
        })
    }

    get selectedEdgeId(): string | null {
        return this.edgeId
    }

    getSingleNodeId(): string | null {
        return this.selection.nodeIds.size === 1 ? (Array.from(this.selection.nodeIds)[0] ?? null) : null
    }

    isNodeSelected = (nodeId: string): boolean => this.selection.nodeIds.has(nodeId)

    selectNode = (nodeId: string | null): void => void this.setNodes(nodeId ? new Set([nodeId]) : new Set())

    toggleNode = (nodeId: string): void => void this.reflectChange(
        this.selection.toggle(nodeId),
    )

    setNodes = (
        nodeIds: Set<string>,
        fromMarquee = false,
    ): void => void this.reflectChange(
        this.selection.replace(
            this.filterSelectableNodeIds(nodeIds),
            fromMarquee,
        ),
    )

    clearNodes(): void {
        if (this.selection.nodeIds.size === 0) {
            this.ports.menu.hide()
            this.updateGroupOverlay()

            return
        }

        this.setNodes(
            new Set(),
        )
    }

    setEdgeSelection(edgeId: string | null): void {
        this.edgeId = edgeId

        if (edgeId) {
            this.selectNode(null)
            this.ports.menu.showEdge(edgeId)
        } else
            this.ports.menu.hide()
    }

    clearEdgeSelection(force = false): void {
        if (
            !force
            && !this.edgeId
        )
            return

        this.edgeId = null
        this.ports.getConnections()?.deselect()
        this.ports.menu.hide()
    }

    restoreEdgeSelection(): void {
        if (this.edgeId)
            this.ports.getConnections()?.selectEdge(this.edgeId)
    }

    repositionNodeMenu(): void {
        this.ports.menu.repositionNode(
            this.getSingleNodeId(),
        )
    }

    repositionEdgeMenu(): void {
        this.ports.menu.repositionEdge(this.edgeId)
    }

    getOverlayBounds = (): Rect | null => {
        const state = this.ports.getState()

        if (
            !state
            || !this.shouldShowGroupOverlay()
            || this.marquee.active
        )
            return null

        const nodes = state.nodes.filter(node => this.selection.nodeIds.has(node.nodeId))

        return nodes.length > 0 ? unionRectangles(
            nodes.map(this.getBoundsForNode),
            16,
        ) : null
    }

    shouldFillOverlayBounds = (): boolean => Boolean(
        this.ports.getState(),
    )

    updateGroupOverlay = (): void => {
        const bounds = this.getOverlayBounds()
        this.ports.media.setSelectionOverlayBounds(bounds, { fill: this.shouldFillOverlayBounds() })
        this.overlay.setGroup(this.shouldShowGroupOverlay() ? bounds : null)
    }

    reconcileMountedNodes(existingNodeIds: ReadonlySet<string>): void {
        const nodeIds = new Set(
            Array.from(this.selection.nodeIds).filter(nodeId => existingNodeIds.has(nodeId)),
        )

        if (nodeIds.size !== this.selection.nodeIds.size)
            this.selection.replace(nodeIds, this.selection.fromMarquee)

        this.updateNodeClasses(
            new Set(),
            this.selection.nodeIds,
        )
        this.ports.media.setSelectedImageNodes(this.selection.nodeIds)
        this.updateGroupOverlay()
        this.updateSelectionDrivenUi()
    }

    clearMarquee(): void {
        this.marquee.cancel()
        this.hideMarquee()
        this.ports.media.setSelectionOverlayBounds(null)
        this.overlay.setGroup(null)
    }

    reset(): void {
        this.overlay.reset()
        this.clearState()
        this.clearMarquee()
    }

    clearState(): void {
        this.selection.clear()
        this.edgeId = null
    }

    containsOverlayTarget(target: EventTarget | null): boolean {
        return target instanceof Node && this.overlay.contains(target)
    }

    isCanvasBackgroundTarget(target: EventTarget | null): boolean {
        if (!(target instanceof Element))
            return false

        if (!this.ports.pane.contains(target))
            return false

        if (this.overlay.contains(target))
            return false

        return !target.closest(
            [
                '[data-node-id]',
                '.workspace-ai-chat-floating-panel',
                '.workspace-canvas-global-composer-host',
                '.ai-prompt-input-floating',
                '.workspace-edge-node',
                '.workspace-handle',
                '.document-resize-handle',
                '.node-drag-overlay',
                '.bubble-menu',
                '.workspace-generated-media-chrome',
                '.workspace-video-controls-host',
            ].join(', '),
        )
    }

    private getBoundsForNode = (node: CanvasNode): Rect => {
        const override = this.ports.getNodeGeometryOverride(node.nodeId)
        const position = override?.position ?? this.ports.getNodeWorldPosition(node)
        const dimensions = override?.dimensions ?? node.dimensions

        return {
            ...position,
            ...dimensions,
        }
    }

    private filterSelectableNodeIds(nodeIds: Set<string>): Set<string> {
        const state = this.ports.getState()

        if (!state)
            return nodeIds

        const selectableNodeIds = new Set(
            state.nodes.map(node => node.nodeId),
        )

        return new Set(
            Array.from(nodeIds).filter(nodeId => selectableNodeIds.has(nodeId)),
        )
    }

    private getSelectableNodeIdsInRect(rect: Rect): string[] {
        return getIntersectingNodeIds(
            this.ports.getState()?.nodes ?? [],
            rect,
            this.getBoundsForNode,
        )
    }

    private shouldShowGroupOverlay(): boolean {
        if (
            !this.ports.getState()
            || this.selection.nodeIds.size === 0
        )
            return false

        return this.selection.nodeIds.size > 1 || this.selection.fromMarquee
    }

    private updateMarquee(): void {
        const bounds = this.marquee.bounds
        this.ports.media.setMarqueeRect(bounds)
        this.overlay.setMarquee(bounds)
    }

    private hideMarquee(): void {
        this.ports.media.setMarqueeRect(null)
        this.overlay.setMarquee(null)
    }

    private reflectChange(previousNodeIds: ReadonlySet<string>): void {
        if (this.selection.nodeIds.size > 0)
            this.clearEdgeSelection()

        this.updateNodeClasses(previousNodeIds, this.selection.nodeIds)
        this.updateGroupOverlay()
        this.updateSelectionDrivenUi()
        this.ports.media.setSelectedImageNodes(this.selection.nodeIds)
        this.ports.scheduleEdges()
    }

    private updateNodeClasses(
        previousNodeIds: ReadonlySet<string>,
        nextNodeIds: ReadonlySet<string>,
    ): void {
        for (const nodeId of previousNodeIds) {
            if (nextNodeIds.has(nodeId))
                continue

            this.ports.viewport.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.classList.remove('is-selected')
        }

        for (const nodeId of nextNodeIds) {
            if (previousNodeIds.has(nodeId))
                continue

            const element = this.ports.viewport.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
            element?.classList.add('is-selected')

            if (element)
                this.ports.layers.bringToFront(element)
        }
    }

    private updateSelectionDrivenUi(): void {
        const nodeId = this.getSingleNodeId()

        if (!nodeId) {
            this.ports.menu.hide()

            return
        }

        this.edgeId = null
        this.ports.getConnections()?.deselect()
        this.ports.menu.hide()
        this.ports.menu.showNode(nodeId)

        if (!this.ports.getState()?.nodes.some(node => node.nodeId === nodeId))
            this.ports.menu.hide()
    }
}
