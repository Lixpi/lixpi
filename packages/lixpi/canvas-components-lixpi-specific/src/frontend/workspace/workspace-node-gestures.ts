import {
    type CanvasNode,
    type CanvasState,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type WorkspaceCollisionFlowSettings,
} from '@lixpi/constants'
import {
    growParentBounds,
    resolveCollisions,
    type CanvasEngineRect as Rect,
    type CanvasEnginePoint as Point,
    type CanvasEngineSize as Size,
    type CanvasViewport,
    type ResizeHandle,
} from '@lixpi/canvas-engine/shared'
import {
    Lifetime,
    type CanvasConnectionControls,
    type GestureCancelReason,
    type NodeTransformOptions,
    type NodeResizeOptions,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type WorkspaceGeometry,
} from '../../shared/branch-tree-layout/workspace-geometry.ts'
import { computeWorkspaceDragPlan } from '../../shared/canvas-node/workspace-drag-plan.ts'
import {
    type WorkspaceMediaLayer,
} from '../media/workspace-media-layer.ts'

type BranchMarker = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
type Scope = {
    workspaceId: string
    sceneKey: string
}
type GestureScope = Scope & { id: number }

export type WorkspaceNodeDragOptions = {
    onClick?: () => void
    suppressPaneClick?: boolean
    allowSelection?: boolean
}

export type WorkspaceNodeGesturesPorts = {
    pane: HTMLElement
    readScope: () => Scope | null
    readState: () => CanvasState | null
    runtime: {
        cancelInteraction: (reason: GestureCancelReason) => void
        startNodeDrag: (options: NodeTransformOptions) => unknown
        startNodeResize: (options: NodeResizeOptions) => unknown
    }
    findElement: (nodeId: string) => HTMLElement | null
    media: () => Pick<WorkspaceMediaLayer, 'getNodeBounds' | 'setNodeLiveTransform' | 'setSelectedImageNodes' | 'setSelectionOverlayBounds'> | null
    connections: () => Pick<CanvasConnectionControls, 'checkProximity' | 'commitProximityConnection' | 'cancelTransientConnection'> | null
    geometry: Pick<WorkspaceGeometry, 'createCollisionPlan' | 'getResolvedNodePositionFromCollisionBox' | 'toParentRelativePosition'>
    collisionSettings: WorkspaceCollisionFlowSettings
    selectedNodeIds: () => ReadonlySet<string>
    isSelected: (nodeId: string) => boolean
    select: (nodeId: string) => void
    toggleSelection: (nodeId: string) => void
    bringToFront: (element: HTMLElement) => void
    lockPan: () => () => void
    getViewport: () => CanvasViewport
    updateChromeTransform: (
        nodeId: string,
        position: Point,
        dimensions: Size,
        viewport: CanvasViewport,
    ) => void
    updateChromeLayout: () => void
    scheduleEdges: () => void
    cancelEdges: () => void
    repositionMenu: () => void
    updateSelectionOverlay: () => void
    getSelectionBounds: () => Rect | null
    shouldFillSelectionBounds: () => boolean
    syncNodeGeometry: (nodes: CanvasNode[]) => void
    syncMedia: () => void
    rememberManualMarker: (
        node: BranchMarker,
        dimensions: Size,
    ) => void
    commit: (state: CanvasState) => void
    setTimer: (
        callback: () => void,
        delay: number,
    ) => () => void
}

const isBranchMarker = (node: CanvasNode): node is BranchMarker =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

export class WorkspaceNodeGestures {
    draggingNodeId: string | null = null
    resizingNodeId: string | null = null
    private nextNodeClickSuppressed = false
    private nextPaneClickSuppressed = false
    private cancelSuppression: (() => void) | null = null
    private releasePointerLock: (() => void) | null = null
    private addedNoPan = false
    private activeScope: GestureScope | null = null
    private gestureRevision = 0
    private activeCleanup: (() => void) | null = null
    private closed = false

    constructor(private readonly ports: WorkspaceNodeGesturesPorts) {}

    private get currentCanvasState(): CanvasState | null {
        return this.ports.readState()
    }

    consumeNodeClick(): boolean {
        const suppressed = this.nextNodeClickSuppressed
        this.nextNodeClickSuppressed = false

        return suppressed
    }

    consumePaneClick(): boolean {
        const suppressed = this.nextPaneClickSuppressed
        this.nextPaneClickSuppressed = false

        return suppressed
    }

    suppressPaneClick(): void {
        if (!this.closed)
            this.nextPaneClickSuppressed = true
    }

    private suppressNodeClick(): void {
        this.cancelSuppression?.()
        this.nextNodeClickSuppressed = true
        const scope = this.activeScope
        this.cancelSuppression = this.ports.setTimer(
            () => {
                if (this.activeScope !== scope)
                    return

                this.cancelSuppression = null
                this.nextNodeClickSuppressed = false
            },
            0,
        )
    }

    suspendPanLock(_nodeId: string): void {
        if (this.closed)
            return

        if (!this.ports.pane.classList.contains('nopan')) {
            this.ports.pane.classList.add('nopan')
            this.addedNoPan = true
        }

        this.releasePointerLock ??= this.ports.lockPan()
    }

    releasePanLock(): void {
        const release = this.releasePointerLock
        this.releasePointerLock = null

        if (this.addedNoPan) {
            this.addedNoPan = false
            this.ports.pane.classList.remove('nopan')
        }

        release?.()
    }

    clear(): void {
        this.disposeInteraction('scene-change')
    }

    destroy(): void {
        if (this.closed)
            return

        this.closed = true
        this.disposeInteraction('destroyed')
    }

    private disposeInteraction(reason: GestureCancelReason): void {
        const scope = this.activeScope
        const cleanup = this.activeCleanup
        const cancelTimer = this.cancelSuppression
        const lifetime = new Lifetime()
        lifetime.own(() => {
            if (this.activeScope !== scope)
                return

            this.activeScope = null
            this.activeCleanup = null
            this.cancelSuppression = null
            this.nextNodeClickSuppressed = false
            this.nextPaneClickSuppressed = false
            this.draggingNodeId = null
            this.resizingNodeId = null
            this.releasePanLock()
        })
        lifetime.own(() => cancelTimer?.())
        lifetime.own(() => cleanup?.())
        lifetime.own(() => this.ports.runtime.cancelInteraction(reason))
        lifetime.destroy()
    }

    private ownGestureCleanup(
        scope: GestureScope,
        cleanup: () => void,
    ): () => void {
        let released = false
        const release = () => {
            if (released)
                return

            released = true
            cleanup()

            if (this.activeScope !== scope)
                return

            this.activeCleanup = null
            this.draggingNodeId = null
            this.resizingNodeId = null
            this.releasePanLock()
        }
        this.activeCleanup = release

        return release
    }

    private begin(): GestureScope | null {
        if (this.closed)
            return null

        const revision = this.gestureRevision
        this.disposeInteraction('replaced')

        if (
            this.closed
            || revision !== this.gestureRevision
        )
            return null

        const scope = this.ports.readScope()

        if (
            !scope
            || !this.ports.readState()
        )
            return null

        const active = {
            ...scope,
            id: ++this.gestureRevision,
        }
        this.activeScope = active

        return active
    }

    private isCurrent(scope: GestureScope): boolean {
        if (
            this.closed
            || this.activeScope !== scope
            || !this.currentCanvasState
        )
            return false

        const current = this.ports.readScope()

        return current?.workspaceId === scope.workspaceId && current.sceneKey === scope.sceneKey
    }

    private getNodesById(nodes = this.currentCanvasState?.nodes ?? []): Map<string, CanvasNode> {
        return new Map(
            nodes.map(node => [node.nodeId, node]),
        )
    }

    startDrag(
        event: MouseEvent,
        nodeId: string,
        options: WorkspaceNodeDragOptions = {},
    ) {
        const scope = this.begin()

        if (!scope)
            return

        event.preventDefault()
        event.stopPropagation()

        if (!this.currentCanvasState)
            return

        const allowSelection = options.allowSelection !== false

        const dragPlan = computeWorkspaceDragPlan({
            nodes: this.currentCanvasState.nodes,
            primaryNodeId: nodeId,
            selectedNodeIds: this.ports.selectedNodeIds(),
        })
        const resolvedNodeId = dragPlan.resolvedNodeId

        if (
            event.metaKey
            || event.ctrlKey
        ) {
            if (allowSelection)
                this.ports.toggleSelection(resolvedNodeId)
            else {
                if (options.suppressPaneClick)
                    this.suppressPaneClick()

                options.onClick?.()
            }

            this.releasePanLock()

            return
        }

        const nodeEl = this.ports.findElement(resolvedNodeId)

        if (!nodeEl) {
            this.releasePanLock()

            return
        }

        this.suspendPanLock(resolvedNodeId)

        // Defer selection: don't select on mousedown. Selecting here can cause
        // the selection overlay to appear (e.g. for AI chat threads) which sits
        // above the clicked element at a higher z-index, stealing the subsequent
        // mouseup/click. Instead, selection happens:
        //   - on first meaningful mouse movement (selects resolvedNodeId for drag)
        //   - on mouseup without movement (selects original nodeId for click)
        const wasAlreadySelected = this.ports.isSelected(resolvedNodeId)

        const draggedNodeIds = dragPlan.draggedNodeIds
        const draggedNodeEntries = new Map<string, {
            el: HTMLElement
            startLeft: number
            startTop: number
            startWidth: number
            startHeight: number
        }>()

        for (const draggedNodeId of draggedNodeIds) {
            const draggedNodeEl = this.ports.findElement(draggedNodeId)
            const bounds = this.ports.media()?.getNodeBounds(draggedNodeId)

            if (
                !draggedNodeEl
                || !bounds
            )
                continue

            draggedNodeEntries.set(
                draggedNodeId,
                {
                    el: draggedNodeEl,
                    startLeft: bounds.x,
                    startTop: bounds.y,
                    startWidth: bounds.width,
                    startHeight: bounds.height,
                },
            )
        }

        if (draggedNodeEntries.size === 0) {
            this.releasePanLock()

            return
        }

        const cleanup = this.ownGestureCleanup(scope, () => {
            for (const entry of draggedNodeEntries.values()) entry.el.classList.remove('is-dragging')
        })
        let dragVisualsActivated = false
        const activateDragVisuals = () => {
            if (
                !this.isCurrent(scope)
                || dragVisualsActivated
            )
                return

            dragVisualsActivated = true
            this.draggingNodeId = resolvedNodeId

            for (const [draggedNodeId, entry] of draggedNodeEntries) {
                entry.el.classList.add('is-dragging')

                if (draggedNodeId !== resolvedNodeId)
                    this.ports.bringToFront(entry.el)
            }
        }

        const handleMouseMove = (bounds: ReadonlyMap<string, Rect>) => {
            if (!this.isCurrent(scope))
                return

            for (const [draggedNodeId, entry] of draggedNodeEntries) {
                if (!this.isCurrent(scope))
                    return

                const next = bounds.get(draggedNodeId)!
                const currentPos = {
                    x: next.x,
                    y: next.y,
                }
                const currentDims = {
                    width: next.width,
                    height: next.height,
                }
                this.ports.media()?.setNodeLiveTransform(
                    draggedNodeId,
                    currentPos,
                    currentDims,
                )

                if (!this.isCurrent(scope))
                    return

                this.ports.updateChromeTransform(
                    draggedNodeId,
                    currentPos,
                    currentDims,
                    this.ports.getViewport(),
                )

                if (!this.isCurrent(scope))
                    return
            }

            const primaryNodeEntry = draggedNodeEntries.get(resolvedNodeId)

            if (!primaryNodeEntry)
                return

            const primaryBounds = bounds.get(resolvedNodeId)!
            const currentPos = {
                x: primaryBounds.x,
                y: primaryBounds.y,
            }
            const currentDims = {
                width: primaryBounds.width,
                height: primaryBounds.height,
            }

            if (dragPlan.allowProximityConnection)
                this.ports.connections()?.checkProximity(
                    resolvedNodeId,
                    currentPos,
                    currentDims,
                )

            if (!this.isCurrent(scope))
                return

            this.ports.scheduleEdges()

            if (!this.isCurrent(scope))
                return

            this.ports.repositionMenu()

            if (!this.isCurrent(scope))
                return

            this.ports.updateSelectionOverlay()

            if (!this.isCurrent(scope))
                return

            this.ports.media()?.setSelectedImageNodes(
                this.ports.selectedNodeIds(),
            )
        }

        const handleMouseUp = (
            upEvent: MouseEvent,
            _bounds: ReadonlyMap<string, Rect>,
            dragDidMove: boolean,
        ) => {
            if (!this.isCurrent(scope))
                return

            cleanup()

            if (!this.isCurrent(scope))
                return

            this.ports.cancelEdges()

            if (!this.isCurrent(scope))
                return

            if (!dragDidMove) {
                // No drag occurred — this was a click. Collision logic can
                // legitimately move nearby nodes and must only run after movement.
                if (options.onClick)
                    this.suppressNodeClick()

                if (allowSelection)
                    this.ports.select(nodeId)

                if (!this.isCurrent(scope))
                    return

                if (options.suppressPaneClick)
                    this.suppressPaneClick()

                options.onClick?.()

                return
            }

            if (dragPlan.allowProximityConnection)
                this.ports.connections()?.commitProximityConnection()

            if (
                !this.isCurrent(scope)
                || !this.currentCanvasState
            )
                return

            const releaseState = this.currentCanvasState
            this.suppressNodeClick()

            if (options.suppressPaneClick)
                this.suppressPaneClick()

            const finalDraggedPositions = new Map<string, {
                x: number
                y: number
            }>()

            for (const draggedNodeId of draggedNodeEntries.keys()) {
                const bounds = this.ports.media()?.getNodeBounds(draggedNodeId)

                if (bounds)
                    finalDraggedPositions.set(
                        draggedNodeId,
                        {
                            x: bounds.x,
                            y: bounds.y,
                        },
                    )
            }

            let updatedNodes = releaseState.nodes
            updatedNodes = updatedNodes.map((node: CanvasNode) => {
                const finalWorldPosition = finalDraggedPositions.get(node.nodeId)

                if (!finalWorldPosition)
                    return node

                if (
                    node.parentId
                    && finalDraggedPositions.has(node.parentId)
                ) {
                    // Parent and child moved together as one selected group. The
                    // live DOM/PIXI positions are world coordinates, but persisted
                    // child positions remain parent-relative. Keep the existing
                    // relative position so the parent's movement carries the child
                    // exactly once after the state commit.
                    return node
                }

                const releasedNode: CanvasNode = {
                    ...node,
                    position: finalWorldPosition,
                }
                delete releasedNode.parentId
                delete releasedNode.expandParent
                delete releasedNode.extent

                return releasedNode
            })

            const manuallyMovedBranchMarkerNodeIds = new Set<string>()

            if (dragPlan.allowCollisionResolution) {
                const collisionExclusions = new Set<string>()

                for (const child of updatedNodes) {
                    if (child.parentId)
                        collisionExclusions.add(`${child.parentId}-${child.nodeId}`)
                }

                const collisionSettings = this.ports.collisionSettings
                const collisionPlan = this.ports.geometry.createCollisionPlan(
                    updatedNodes,
                    dragPlan.isParentContainerDrag,
                    collisionSettings,
                )

                const {
                    nodes: movedNodes,
                    hasChanges,
                } = resolveCollisions(
                    collisionPlan.nodeBoxes,
                    {
                        iterations: collisionPlan.iterations,
                        margin: 0,
                        excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined,
                        shouldResolvePair: collisionPlan.shouldResolvePair,
                    },
                )

                if (hasChanges) {
                    updatedNodes = updatedNodes.map((n: CanvasNode) => {
                        if (!this.isCurrent(scope))
                            return n

                        const newPos = movedNodes.get(n.nodeId)

                        if (newPos) {
                            const resolvedPosition = this.ports.geometry.getResolvedNodePositionFromCollisionBox(
                                n,
                                newPos,
                                collisionPlan.entries,
                            )
                            this.ports.media()?.setNodeLiveTransform(
                                n.nodeId,
                                resolvedPosition,
                                n.dimensions,
                            )

                            if (!this.isCurrent(scope))
                                return n

                            this.ports.updateChromeTransform(
                                n.nodeId,
                                resolvedPosition,
                                n.dimensions,
                                this.ports.getViewport(),
                            )

                            if (!this.isCurrent(scope))
                                return n

                            const nextPosition = n.parentId
                                ? this.ports.geometry.toParentRelativePosition(
                                    resolvedPosition,
                                    n.parentId,
                                    this.getNodesById(updatedNodes),
                                )
                                : resolvedPosition

                            if (isBranchMarker(n))
                                manuallyMovedBranchMarkerNodeIds.add(n.nodeId)

                            return {
                                ...n,
                                position: nextPosition,
                            }
                        }

                        return n
                    })
                }
            }

            for (const draggedNodeId of finalDraggedPositions.keys()) {
                const draggedNode = updatedNodes.find((node: CanvasNode) => node.nodeId === draggedNodeId)

                if (
                    draggedNode
                    && isBranchMarker(draggedNode)
                )
                    manuallyMovedBranchMarkerNodeIds.add(draggedNode.nodeId)
            }

            for (const movedBranchMarkerNodeId of manuallyMovedBranchMarkerNodeIds) {
                if (!this.isCurrent(scope))
                    return

                const movedBranchMarkerNode = updatedNodes.find((node: CanvasNode) => node.nodeId === movedBranchMarkerNodeId)

                if (
                    !movedBranchMarkerNode
                    || !isBranchMarker(movedBranchMarkerNode)
                )
                    continue

                const movedBranchMarkerEl = this.ports.findElement(movedBranchMarkerNodeId)
                this.ports.rememberManualMarker(
                    movedBranchMarkerNode,
                    {
                        width: movedBranchMarkerEl?.offsetWidth ?? movedBranchMarkerNode.dimensions.width,
                        height: movedBranchMarkerEl?.offsetHeight ?? movedBranchMarkerNode.dimensions.height,
                    },
                )
            }

            if (!this.isCurrent(scope))
                return

            this.ports.commit({
                ...releaseState,
                nodes: updatedNodes,
            })

            if (!this.isCurrent(scope))
                return

            // Final reposition after collision resolution may have moved the node
            this.ports.repositionMenu()
            this.ports.updateSelectionOverlay()
        }

        try {
            this.ports.runtime.startNodeDrag({
                event,
                targets: Array.from(
                    draggedNodeEntries,
                    ([nodeId, entry]) => ({
                        nodeId,
                        bounds: {
                            x: entry.startLeft,
                            y: entry.startTop,
                            width: entry.startWidth,
                            height: entry.startHeight,
                        },
                    }),
                ),
                threshold: 6,
                onStart: () => {
                    if (!this.isCurrent(scope))
                        return

                    if (
                        allowSelection
                        && !wasAlreadySelected
                    )
                        this.ports.select(resolvedNodeId)

                    activateDragVisuals()
                },
                onChange: handleMouseMove,
                onEnd: handleMouseUp,
                onCancel: reason => {
                    cleanup()

                    if (!this.isCurrent(scope))
                        return

                    this.ports.cancelEdges()
                    this.ports.connections()?.cancelTransientConnection()

                    if (
                        reason !== 'destroyed'
                        && reason !== 'scene-change'
                        && this.currentCanvasState
                    ) {
                        this.ports.syncNodeGeometry(this.currentCanvasState.nodes)
                        this.ports.syncMedia()
                        this.ports.updateChromeLayout()
                        this.ports.updateSelectionOverlay()
                        this.ports.scheduleEdges()
                    }
                },
            })
        } catch (error) {
            cleanup()

            throw error
        }
    }

    startResize(
        event: MouseEvent,
        nodeId: string,
        handlePosition: ResizeHandle,
    ) {
        const scope = this.begin()

        if (!scope)
            return

        event.preventDefault()
        event.stopPropagation()

        const nodeEl = this.ports.findElement(nodeId)

        if (
            !nodeEl
            || !this.currentCanvasState
        ) {
            this.releasePanLock()

            return
        }

        // Find the node to check if it's an image (for aspect ratio locking)
        const node = this.currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        const isImageNode = node?.type === 'image'

        // PIXI owns image pixels, so resize behavior uses persisted geometry
        // instead of a rendered surface or duplicated media metadata.
        let aspectRatio: number | null = null

        if (isImageNode) {
            aspectRatio = node.dimensions.height > 0
                ? node.dimensions.width / node.dimensions.height
                : null
        }

        this.resizingNodeId = nodeId
        nodeEl.classList.add('is-resizing')

        const handle = event.currentTarget instanceof HTMLElement
            && event.currentTarget.classList.contains('document-resize-handle')
            ? event.currentTarget
            : null
        handle?.classList.add('is-dragging')

        const cleanup = this.ownGestureCleanup(scope, () => {
            nodeEl.classList.remove('is-resizing')
            handle?.classList.remove('is-dragging')
        })
        const startBounds = this.ports.media()?.getNodeBounds(nodeId)

        if (!startBounds) {
            cleanup()

            return
        }

        const minWidth = isImageNode ? 50 : 200
        const constraints = {
            min: {
                width: minWidth,
                height: isImageNode
                    && aspectRatio
                    ? minWidth / aspectRatio
                    : 150,
            },
            preserveAspectRatio: Boolean(aspectRatio),
            aspectRatio: aspectRatio ?? undefined,
        }

        const handleMouseMove = (boundsById: ReadonlyMap<string, Rect>) => {
            if (!this.isCurrent(scope))
                return

            const bounds = boundsById.get(nodeId)!
            const liveResizePosition = {
                x: bounds.x,
                y: bounds.y,
            }
            const liveResizeDimensions = {
                width: bounds.width,
                height: bounds.height,
            }

            this.ports.media()?.setNodeLiveTransform(
                nodeId,
                liveResizePosition,
                liveResizeDimensions,
            )

            if (!this.isCurrent(scope))
                return

            this.ports.updateChromeTransform(
                nodeId,
                liveResizePosition,
                liveResizeDimensions,
                this.ports.getViewport(),
            )

            if (!this.isCurrent(scope))
                return

            this.ports.media()?.setSelectedImageNodes(
                this.ports.selectedNodeIds(),
            )

            if (!this.isCurrent(scope))
                return

            this.ports.media()?.setSelectionOverlayBounds(
                this.ports.getSelectionBounds(),
                { fill: this.ports.shouldFillSelectionBounds() },
            )

            if (!this.isCurrent(scope))
                return

            // Grow the parent's engine bounds while resizing its child.
            if (node?.parentId) {
                const parentBounds = this.ports.media()?.getNodeBounds(node.parentId)

                if (parentBounds) {
                    const parentSize = growParentBounds(
                        parentBounds,
                        bounds,
                        48,
                    )
                    this.ports.media()?.setNodeLiveTransform(
                        node.parentId,
                        parentBounds,
                        parentSize,
                    )
                }
            }

            this.ports.scheduleEdges()
            this.ports.repositionMenu()
        }

        const handleMouseUp = () => {
            if (!this.isCurrent(scope))
                return

            cleanup()

            if (
                !this.isCurrent(scope)
                || !this.currentCanvasState
            )
                return

            const releaseState = this.currentCanvasState
            const bounds = this.ports.media()?.getNodeBounds(nodeId)

            if (!bounds)
                return

            const newDimensions = {
                width: bounds.width,
                height: bounds.height,
            }
            // Persist parent-relative coordinates from the engine's world bounds.
            const newWorldPosition = {
                x: bounds.x,
                y: bounds.y,
            }
            const resizingNode = releaseState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
            const newPosition = resizingNode?.parentId
                ? this.ports.geometry.toParentRelativePosition(
                    newWorldPosition,
                    resizingNode.parentId,
                    this.getNodesById(),
                )
                : newWorldPosition

            const updatedNodes = releaseState.nodes.map(
                (n: CanvasNode) => n.nodeId === nodeId ? {
                    ...n,
                    dimensions: newDimensions,
                    position: newPosition,
                } : n,
            )

            if (!this.isCurrent(scope))
                return

            this.ports.commit({
                ...releaseState,
                nodes: updatedNodes,
            })

            if (!this.isCurrent(scope))
                return

            // Final reposition at new size
            this.ports.repositionMenu()
        }

        try {
            this.ports.runtime.startNodeResize({
                event,
                target: {
                    nodeId,
                    bounds: startBounds,
                },
                handle: handlePosition,
                constraints,
                lock: () => this.ports.lockPan(),
                onChange: handleMouseMove,
                onEnd: handleMouseUp,
                onCancel: reason => {
                    cleanup()

                    if (!this.isCurrent(scope))
                        return

                    this.ports.cancelEdges()

                    if (
                        reason !== 'destroyed'
                        && reason !== 'scene-change'
                        && this.currentCanvasState
                    ) {
                        this.ports.syncNodeGeometry(this.currentCanvasState.nodes)
                        this.ports.syncMedia()
                        this.ports.updateChromeLayout()
                        this.ports.updateSelectionOverlay()
                        this.ports.scheduleEdges()
                    }
                },
            })
        } catch (error) {
            cleanup()

            throw error
        }
    }
}
