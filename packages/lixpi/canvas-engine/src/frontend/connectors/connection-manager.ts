import {
    type ConnectionSession,
    type PortConnection,
    type PortRole,
    type ResolvedPort,
} from '../../shared/connectors/geometry-types.ts'

import { ConnectionGeometry } from './connection-geometry.ts'
import { PortMeasurement } from './port-measurement.ts'

import { ElementStyleLease } from '@lixpi/ui-primitives/dom'
import {
    flattenSvgPath,
    getPathLength,
    getPointAtPathLength,
    isPointNearPath,
    type PathPoint,
} from '@lixpi/ui-primitives/svg'
import {
    getAdaptiveBoundedZoomScalingOptions,
    getEdgeScaledSizes,
} from '../../shared/index.ts'
import { computeConnectorDatum } from './connector-datum.ts'
import { computeConnectorSpread } from './connector-spread.ts'
import { HandleConnectionGesture } from './handle-connection-gesture.ts'
import {
    type ConnectorRenderDatum,
} from './connector-renderer.ts'
import {
    type EdgeConfig,
    type EdgeAnchor,
    type NodeConfig,
    type AnchorPosition,
} from '../../shared/connectors/path-types.ts'
import {
    type ConnectionNode,
    type ConnectionEdge,
    type ConnectionManagerConfig,
    type ProximityCandidate,
} from './connection-types.ts'

type EdgeNodeGeometry = {
    x: number
    y: number
    width: number
    height: number
}

type HandleMeta = {
    nodeId: string
    handleId: string
    isTarget: boolean
    handleDomNode: Element
    edgeUpdaterType?: PortRole
    reconnectingEdgeId?: string
}

const generateEdgeId = (): string => {
    const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)

    return `edge-${random}`
}

export const getEdgeAnchorPositions = (edge: ConnectionEdge): {
    source: 'left' | 'right'
    target: 'left' | 'right'
} => {
    const source = edge.sourceHandle === 'left' ? 'left' : 'right'
    const target = edge.targetHandle === 'left' ? 'left' : 'right'

    return {
        source,
        target,
    }
}

// Compute anchor 't' value based on pointer Y position relative to the node side
// Returns value between 0 (top) and 1 (bottom) for left/right sides
const computeTFromPointerPosition = (
    pointerY: number,
    nodeTop: number,
    nodeHeight: number,
): number => {
    if (nodeHeight <= 0)
        return 0.5

    const relativeY = pointerY - nodeTop
    const t = Math.max(
        0,
        Math.min(1, relativeY / nodeHeight),
    )

    return t
}

const isSameConnection = (
    a: ConnectionEdge,
    b: {
        sourceNodeId: string
        targetNodeId: string
        sourceHandle?: string | null
        targetHandle?: string | null
    },
) => {
    return a.sourceNodeId === b.sourceNodeId
        && a.targetNodeId === b.targetNodeId
        && (a.sourceHandle ?? null) === (b.sourceHandle ?? null)
        && (a.targetHandle ?? null) === (b.targetHandle ?? null)
}

export class ConnectionManager<Node extends ConnectionNode = ConnectionNode> {
    private readonly config: ConnectionManagerConfig<Node>

    private readonly geometry = new ConnectionGeometry()
    private readonly measurement: PortMeasurement

    private nodeElements: Map<string, HTMLElement> = new Map()
    private nodes: Node[] = []
    private edges: ConnectionEdge[] = []

    private selectedEdgeId: string | null = null
    private connectionInProgress: ConnectionSession | null = null

    private reconnectingEdge: {
        edgeId: string
        edgeUpdaterType: PortRole
    } | null = null

    private proximityCandidate: ProximityCandidate | null = null
    private currentEdgeClickAreaWidth: number
    readonly flowId: string
    private readonly document: Document
    private readonly view: Window
    private destroyed = false
    private handleGesture: HandleConnectionGesture | null = null
    private connectionEpoch = 0

    private menuConnectionCleanup: (() => void) | null = null

    // Cache for fast synchronous drawing backend datum recomputation on zoom change.
    // Avoids the full connectionManager.render() cost when only markerOffset changes.
    private cachedEdgeConfigs: Array<{
        edgeConfig: EdgeConfig
        isSelected: boolean
    }> | null = null
    private cachedWorldNodeMap: Map<string, NodeConfig> | null = null
    private cachedConnectorData: ConnectorRenderDatum[] = []
    private cachedFlattenedEdgePaths = new Map<string, {
        svgPath: string
        points: PathPoint[]
    }>()
    private cachedDefaultColor = '#000000'
    private cachedFocusColor = '#000000'

    private getEdgeNodeGeometry(node: Node): EdgeNodeGeometry {
        return {
            x: node.position.x,
            y: node.position.y,
            width: node.dimensions.width,
            height: node.dimensions.height,
        }
    }

    private getRenderedEdgeSourceNodeId(
        edge: ConnectionEdge,
        _nodeById: Map<string, Node>,
        worldNodeMap: Map<string, NodeConfig>,
    ): string {
        const candidate = this.config.renderedSourceNodeId?.(edge, this.nodes) ?? edge.sourceNodeId

        return worldNodeMap.has(candidate) ? candidate : edge.sourceNodeId
    }

    private resolveAnchorT(
        node: Node | undefined,
        t: number | undefined,
    ): number {
        return this.config.isCentered(node) ? 0.5 : (t ?? 0.5)
    }

    private canAutoAlignTarget(node: Node | undefined): boolean {
        return Boolean(node && !this.config.isCentered(node))
    }

    private buildEdgeAnchor(
        nodeId: string,
        position: AnchorPosition,
        t: number | undefined,
        nodeById: Map<string, Node>,
    ): EdgeAnchor {
        const node = nodeById.get(nodeId)
        const resolvedT = this.resolveAnchorT(node, t)

        return {
            nodeId,
            position,
            t: resolvedT,
        }
    }

    public constructor(config: ConnectionManagerConfig<Node>) {
        this.config = {
            ...config,
            settings: structuredClone(config.settings),
        }
        this.currentEdgeClickAreaWidth = this.config.settings.scaling.clickAreaWidth
        this.flowId = config.flowId ?? crypto.randomUUID()
        this.document = config.paneEl.ownerDocument
        const view = this.document.defaultView

        if (!view)
            throw new Error('Connection manager requires a browser document')

        this.view = view

        this.measurement = new PortMeasurement(this.config.paneEl, this.flowId)
    }

    private portAnchor(
        nodeId: string,
        handleId: string | undefined,
        fallback: AnchorPosition,
        t: number | undefined,
        nodes: Map<string, Node>,
        contentAnchor = false,
        logicalNodeId = nodeId,
    ): EdgeAnchor {
        const node = nodes.get(logicalNodeId)
        const port = node?.ports?.find(port => port.id === handleId)

        if (
            !port
            || !node
        )
            return this.buildEdgeAnchor(
                nodeId,
                fallback,
                t,
                nodes,
            )

        const verticalSide = port.direction === 'left' || port.direction === 'right'

        if (nodeId !== logicalNodeId) {
            const length = verticalSide ? node.dimensions.height : node.dimensions.width
            const position = verticalSide ? port.anchor.y : port.anchor.x
            const projectedT = contentAnchor
                && verticalSide
                ? t
                : length > 0
                    ? position / length
                    : 0.5

            return this.buildEdgeAnchor(
                nodeId,
                port.direction,
                projectedT,
                nodes,
            )
        }

        const y = contentAnchor
            && verticalSide
            && t !== undefined
            ? node.dimensions.height * Math.max(
                0,
                Math.min(1, t),
            )
            : port.anchor.y

        return {
            nodeId,
            position: port.direction,
            t: 0,
            offset: {
                x: port.anchor.x - (port.direction === 'right' ? node.dimensions.width : 0),
                y: y - (port.direction === 'bottom' ? node.dimensions.height : 0),
            },
        }
    }

    public syncNodes(canvasNodes: Node[]) {
        if (this.destroyed)
            return

        this.geometry.replace(canvasNodes)
        const nodeIds = new Set(
            canvasNodes.map(node => node.nodeId),
        )

        for (const id of this.nodeElements.keys())
            if (!nodeIds.has(id))
                this.nodeElements.delete(id)

        if (
            this.connectionInProgress
            && !nodeIds.has(this.connectionInProgress.start.nodeId)
        )
            this.cancelTransientConnection()

        this.nodes = canvasNodes
    }

    public registerNodeElement(
        nodeId: string,
        nodeElement: HTMLElement,
    ) {
        if (this.destroyed)
            return

        this.nodeElements.set(nodeId, nodeElement)

        if (this.nodes.find(node => node.nodeId === nodeId)?.ports !== undefined)
            return

        const node = this.geometry.get(nodeId)

        if (!node)
            return

        const measured = this.measurement.read(
            nodeId,
            nodeElement,
            this.config.getTransform()[2],
            node.bounds,
        )

        if (measured)
            this.geometry.measure(nodeId, measured)
    }

    public syncEdges(edges: ConnectionEdge[]) {
        if (this.destroyed)
            return

        this.edges = edges

        if (
            this.selectedEdgeId
            && !edges.some(e => e.edgeId === this.selectedEdgeId)
        )
            this.selectEdge(null)
    }

    public cancelTransientConnection(): void {
        this.connectionEpoch++
        const gesture = this.handleGesture
        this.handleGesture = null
        gesture?.cancel()
        const hadTransientConnection = Boolean(
            this.connectionInProgress || this.reconnectingEdge || this.proximityCandidate || this.menuConnectionCleanup,
        )
        const menuCleanup = this.menuConnectionCleanup

        this.menuConnectionCleanup = null
        this.connectionInProgress = null
        this.reconnectingEdge = null
        this.proximityCandidate = null

        if (menuCleanup) {
            menuCleanup()

            return
        }

        if (hadTransientConnection)
            this.render()
    }

    public startConnectionFromMenu(nodeId: string) {
        if (this.destroyed)
            return

        this.cancelTransientConnection()

        const node = this.geometry.get(nodeId)

        if (!node)
            return

        const sourceHandle = this.geometry.ports.find(port => port.nodeId === nodeId && port.type === 'source')

        if (!sourceHandle)
            return

        const connectionEpoch = ++this.connectionEpoch
        let ended = false
        const fromHandle = sourceHandle
        // Menu sessions wait for movement before drawing.
        this.connectionInProgress = {
            isValid: null,
            start: fromHandle,
            candidate: null,
            panePointer: {
                x: 0,
                y: 0,
            },
            worldPointer: {
                x: 0,
                y: 0,
            },
        }

        // Change cursor to crosshair on the pane
        const cursor = new ElementStyleLease(this.config.paneEl, { cursor: 'crosshair' })

        const onMouseMove = (e: MouseEvent) => {
            if (
                ended
                || this.destroyed
                || this.connectionEpoch !== connectionEpoch
            )
                return

            const transform = this.config.getTransform()
            const containerBounds = this.config.paneEl.getBoundingClientRect()

            if (!containerBounds)
                return

            // Convert screen position to renderer coordinates (accounting for pan + zoom)
            const screenRelX = e.clientX - containerBounds.left
            const screenRelY = e.clientY - containerBounds.top
            const rendererPos = {
                x: (screenRelX - transform[0]) / transform[2],
                y: (screenRelY - transform[1]) / transform[2],
            }

            // Find closest target handle
            const closestHandle = this.findClosestHandle(
                rendererPos,
                fromHandle,
                this.config.settings.menuConnectionSnapRadius,
            )

            const isValid = closestHandle ? this.isMenuConnectionValid(nodeId, closestHandle) : null

            this.connectionInProgress = {
                ...this.connectionInProgress!,
                isValid,
                candidate: closestHandle ?? null,
                panePointer: {
                    x: screenRelX,
                    y: screenRelY,
                },
                worldPointer: rendererPos,
            }

            this.render()
        }

        const onMouseUp = (e: MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()

            const toHandle = this.connectionInProgress?.candidate
            const isValid = this.connectionInProgress?.isValid

            cleanup()

            if (
                this.destroyed
                || this.connectionEpoch !== connectionEpoch
            )
                return

            if (
                toHandle
                && isValid
            ) {
                const toNodeId = toHandle.nodeId
                const toHandleId = toHandle.id ?? 'left'

                // Compute T values for straight lines when possible
                const sourceT = 0.5
                let targetT = 0.5

                const sourceNode = this.nodes.find(n => n.nodeId === nodeId)
                const targetNode = this.nodes.find(n => n.nodeId === toNodeId)

                if (
                    sourceNode
                    && targetNode
                    && this.canAutoAlignTarget(targetNode)
                ) {
                    const sourceY = sourceNode.position.y + sourceNode.dimensions.height * sourceT
                    const targetTop = targetNode.position.y
                    const targetBottom = targetTop + targetNode.dimensions.height

                    if (
                        sourceY >= targetTop
                        && sourceY <= targetBottom
                    )
                        targetT = (sourceY - targetTop) / targetNode.dimensions.height
                }

                const nextEdge: ConnectionEdge = {
                    edgeId: generateEdgeId(),
                    sourceNodeId: nodeId,
                    targetNodeId: toNodeId,
                    sourceHandle: sourceHandle.id ?? 'right',
                    targetHandle: toHandleId,
                    sourceT,
                    targetT,
                }

                this.config.onEdgesChange([...this.edges, nextEdge])
                this.selectEdge(nextEdge.edgeId)
            }
        }

        const onMouseDownCapture = (e: MouseEvent) => {
            // While menu-connection mode is active, suppress target-node mousedown
            // handlers so clicking to finish a connection cannot also start a drag,
            // focus an editor, or otherwise attach the target UI to mouse movement.
            e.preventDefault()
            e.stopPropagation()
        }

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape')
                cleanup()
        }

        const cleanup = () => {
            if (ended)
                return

            ended = true
            this.document.removeEventListener('mousemove', onMouseMove)
            this.document.removeEventListener(
                'mousedown',
                onMouseDownCapture,
                true,
            )
            this.document.removeEventListener(
                'mouseup',
                onMouseUp,
                true,
            )
            this.document.removeEventListener('keydown', onKeyDown)
            this.view.removeEventListener('blur', cleanup)
            this.connectionInProgress = null
            cursor.destroy()
            this.menuConnectionCleanup = null
            this.render()
        }

        this.menuConnectionCleanup = cleanup

        // Use capture for mouseup so we intercept before other handlers
        this.document.addEventListener('mousemove', onMouseMove)
        this.document.addEventListener(
            'mousedown',
            onMouseDownCapture,
            true,
        )
        this.document.addEventListener(
            'mouseup',
            onMouseUp,
            true,
        )
        this.document.addEventListener('keydown', onKeyDown)
        this.view.addEventListener('blur', cleanup)
    }

    private getMenuSnapPoint(
        nodeId: string,
        handle: ResolvedPort,
        pointer: {
            x: number
            y: number
        },
    ) {
        const node = this.geometry.get(nodeId)
        const canvasNode = this.nodes.find(candidate => candidate.nodeId === nodeId)

        if (
            !node
            || !canvasNode
        ) {
            return {
                x: handle.x ?? 0,
                y: handle.y ?? 0,
            }
        }

        const isLeftHandle = handle.id === 'left' || handle.position === 'left'
        const port = canvasNode.ports?.find(port => port.id === handle.id)

        if (port)
            return {
                x: node.bounds.x + port.anchor.x,
                y: node.bounds.y + port.anchor.y,
            }

        const x = isLeftHandle
            ? node.bounds.x
            : node.bounds.x + canvasNode.dimensions.width

        return {
            x,
            y: node.bounds.y + canvasNode.dimensions.height / 2,
        }
    }

    private findClosestHandle(
        position: {
            x: number
            y: number
        },
        fromHandle: ResolvedPort,
        connectionRadius: number,
    ): ResolvedPort | null {
        let closest: ResolvedPort | null = null
        let minDist = Infinity

        for (const [nodeId, node] of this.geometry.entries()) {
            const handles = node.ports

            for (const handle of handles) {
                // Skip the same handle we're dragging from
                if (
                    handle.nodeId === fromHandle.nodeId
                    && handle.type === fromHandle.type
                    && handle.id === fromHandle.id
                )
                    continue

                const {
                    x: hx,
                    y: hy,
                } = this.getMenuSnapPoint(
                    nodeId,
                    handle,
                    position,
                )

                const dist = Math.sqrt((hx - position.x) ** 2 + (hy - position.y) ** 2)

                if (
                    dist <= connectionRadius
                    && dist < minDist
                ) {
                    minDist = dist
                    closest = {
                        ...handle,
                        x: hx,
                        y: hy,
                    }
                }
            }
        }

        return closest
    }

    private isMenuConnectionValid(
        sourceNodeId: string,
        targetHandle: ResolvedPort,
    ): boolean {
        // No self-loops
        if (targetHandle.nodeId === sourceNodeId)
            return false

        if (
            this.nodes.find(node => node.nodeId === targetHandle.nodeId)?.ports
            && targetHandle.type !== 'target'
        )
            return false

        // No duplicates
        const candidate = {
            sourceNodeId,
            targetNodeId: targetHandle.nodeId,
            sourceHandle: 'right',
            targetHandle: targetHandle.id ?? 'left',
        }

        for (const existing of this.edges) {
            if (isSameConnection(existing, candidate))
                return false
        }

        return true
    }

    public onHandlePointerDown(
        event: MouseEvent | TouchEvent,
        meta: HandleMeta,
    ) {
        if (this.destroyed)
            return

        this.cancelTransientConnection()
        const connectionEpoch = ++this.connectionEpoch
        event.preventDefault()
        event.stopPropagation()

        this.reconnectingEdge = meta.reconnectingEdgeId
            && meta.edgeUpdaterType
            ? {
                edgeId: meta.reconnectingEdgeId,
                edgeUpdaterType: meta.edgeUpdaterType,
            }
            : null

        this.handleGesture = new HandleConnectionGesture(
            event,
            {
                onError: this.config.onError,
                domNode: this.config.paneEl,
                getTransform: this.config.getTransform,
                geometry: this.geometry,
                ownerId: this.flowId,
    
                nodeId: meta.nodeId,
                handleId: meta.handleId,
                isTarget: meta.isTarget,
                connectionRadius: 30,
    
                updateConnection: (state: ConnectionSession) => {
                    if (
                        this.destroyed
                        || this.connectionEpoch !== connectionEpoch
                    )
                        return

                    this.connectionInProgress = state
                    this.render()
                },
    
                cancelConnection: () => {
                    if (this.connectionEpoch === connectionEpoch)
                        this.cancelTransientConnection()
                },
    
                isValidConnection: (connection: PortConnection) => {
                    if (
                        this.destroyed
                        || this.connectionEpoch !== connectionEpoch
                    )
                        return false

                    // No self-loops
                    if (
                        'source' in connection
                        && 'target' in connection
                        && connection.source === connection.target
                    )
                        return false

                    const candidate = {
                        sourceNodeId: connection.source,
                        targetNodeId: connection.target,
                        sourceHandle: connection.sourceHandle ?? null,
                        targetHandle: connection.targetHandle ?? null,
                    }

                    // No duplicates
                    for (const existing of this.edges) {
                        if (this.reconnectingEdge?.edgeId === existing.edgeId)
                            continue

                        if (isSameConnection(existing, candidate))
                            return false
                    }

                    return true
                },
    
                onConnect: (connection: PortConnection) => {
                    if (
                        this.destroyed
                        || this.connectionEpoch !== connectionEpoch
                    )
                        return

                    if (this.reconnectingEdge)
                        return

                    // Explicit ports retain their roles. Structural fallback uses drag direction.
                    const usesPorts = this.nodes.some(node => node.nodeId === connection.source && node.ports)
                    const fromNodeId = usesPorts ? connection.source : this.connectionInProgress?.start?.nodeId
                    const fromHandleId = usesPorts ? connection.sourceHandle : this.connectionInProgress?.start?.id

                    if (!fromNodeId)
                        return

                    const toNodeId = fromNodeId === connection.source ? connection.target : connection.source
                    const toHandleId = fromNodeId === connection.source ? connection.targetHandle : connection.sourceHandle
    
                    // Source always attaches at center of side (t=0.5).
                    const sourceT = 0.5
                    let targetT = 0.5
    
                    // Try to make a straight horizontal line by aligning target anchor
                    // with the source Y. If source Y falls within the target node's
                    // vertical range, adjust targetT so both endpoints share the same Y.
                    // This gives perfectly straight lines whenever geometrically possible.
                    const sourceNode = this.nodes.find(n => n.nodeId === fromNodeId)
                    const targetNode = this.nodes.find(n => n.nodeId === toNodeId)

                    if (
                        sourceNode
                        && targetNode
                        && this.canAutoAlignTarget(targetNode)
                    ) {
                        const sourceY = sourceNode.position.y + sourceNode.dimensions.height * sourceT
                        const targetTop = targetNode.position.y
                        const targetBottom = targetTop + targetNode.dimensions.height

                        if (
                            sourceY >= targetTop
                            && sourceY <= targetBottom
                        ) {
                            // Source Y is within target node range — straight line!
                            targetT = (sourceY - targetTop) / targetNode.dimensions.height
                        }
                        // Otherwise targetT stays 0.5, producing a 3-point connector
                    }

                    const nextEdge: ConnectionEdge = {
                        edgeId: generateEdgeId(),
                        sourceNodeId: fromNodeId,
                        targetNodeId: toNodeId,
                        sourceHandle: fromHandleId ?? undefined,
                        targetHandle: toHandleId ?? undefined,
                        sourceT,
                        targetT,
                    }
    
                    this.config.onEdgesChange([...this.edges, nextEdge])
                    this.selectEdge(nextEdge.edgeId)
                },
    
                onReconnectEnd: (_event: MouseEvent | TouchEvent, finalState: ConnectionSession) => {
                    if (
                        this.destroyed
                        || this.connectionEpoch !== connectionEpoch
                    )
                        return

                    if (!this.reconnectingEdge)
                        return

                    const edgeIdToUpdate = this.reconnectingEdge.edgeId

                    // If dropped in empty space (no target node), delete the edge
                    if (!finalState.candidate) {
                        this.selectEdge(null)
                        this.config.onEdgesChange(
                            this.edges.filter(e => e.edgeId !== edgeIdToUpdate),
                        )

                        return
                    }

                    if (!finalState.isValid)
                        return

                    const edgeToUpdate = this.edges.find(e => e.edgeId === edgeIdToUpdate)

                    if (!edgeToUpdate)
                        return

                    const updatedEdge: ConnectionEdge = { ...edgeToUpdate }
    
                    // Get the node being reconnected to
                    const reconnectedNode = this.nodes.find(n => n.nodeId === finalState.candidate!.nodeId)

                    // Reconnect logic: edgeUpdaterType tells us which end is being moved
                    // 'source' means moving the source end, 'target' means moving the target end
                    if (this.reconnectingEdge.edgeUpdaterType === 'source') {
                        updatedEdge.sourceNodeId = finalState.candidate.nodeId
                        updatedEdge.sourceHandle = finalState.candidate?.id ?? undefined

                        // Compute t from drop position
                        if ((this.config.isReconnectionCentered ?? this.config.isCentered)(reconnectedNode))
                            updatedEdge.sourceT = 0.5
                        else if (
                            reconnectedNode
                            && finalState.candidate
                        ) {
                            updatedEdge.sourceT = computeTFromPointerPosition(
                                finalState.candidate.y,
                                reconnectedNode.position.y,
                                reconnectedNode.dimensions.height,
                            )
                        } else
                            updatedEdge.sourceT = 0.5
                    } else {
                        updatedEdge.targetNodeId = finalState.candidate.nodeId
                        updatedEdge.targetHandle = finalState.candidate?.id ?? undefined

                        // Compute t from drop position
                        if ((this.config.isReconnectionCentered ?? this.config.isCentered)(reconnectedNode))
                            updatedEdge.targetT = 0.5
                        else if (
                            reconnectedNode
                            && finalState.candidate
                        ) {
                            updatedEdge.targetT = computeTFromPointerPosition(
                                finalState.candidate.y,
                                reconnectedNode.position.y,
                                reconnectedNode.dimensions.height,
                            )
                        } else
                            updatedEdge.targetT = 0.5
                    }

                    // Validate again (avoid creating duplicates via reconnect)
                    for (const existing of this.edges) {
                        if (existing.edgeId === updatedEdge.edgeId)
                            continue

                        if (isSameConnection(existing, updatedEdge))
                            return
                    }

                    const nextEdges = this.edges.map(e => e.edgeId === updatedEdge.edgeId ? updatedEdge : e)
                    this.config.onEdgesChange(nextEdges)
                    this.selectEdge(updatedEdge.edgeId)
                },
    
                panBy: this.config.panBy,
            },
        )
    }

    public selectEdge(edgeId: string | null) {
        if (this.destroyed)
            return

        this.selectedEdgeId = edgeId
        this.config.onSelectedEdgeChange?.(edgeId)
        this.render()
    }

    public deleteSelectedEdge() {
        if (!this.selectedEdgeId)
            return

        const toDelete = this.selectedEdgeId
        this.selectEdge(null)
        this.config.onEdgesChange(
            this.edges.filter(e => e.edgeId !== toDelete),
        )
    }

    public deselect() {
        this.selectEdge(null)
    }

    public render() {
        if (this.destroyed)
            return

        if (
            !this.edges.length
            && !this.connectionInProgress
            && !this.proximityCandidate
        ) {
            this.cachedEdgeConfigs = null
            this.cachedWorldNodeMap = null
            this.cachedConnectorData = []
            this.cachedFlattenedEdgePaths.clear()
            this.config.onConnectorGeometry?.([])

            return
        }

        const nodeById = new Map<string, Node>(
            this.nodes.map(node => [node.nodeId, node]),
        )

        const worldNodeMap = new Map<string, NodeConfig>()

        for (const canvasNode of this.nodes) {
            const geometry = this.getEdgeNodeGeometry(canvasNode)
            worldNodeMap.set(
                canvasNode.nodeId,
                {
                    id: canvasNode.nodeId,
                    shape: 'rect',
                    x: geometry.x,
                    y: geometry.y,
                    width: geometry.width,
                    height: geometry.height,
                    className: 'canvas-edge-node',
                },
            )

            for (const additional of this.config.additionalGeometry?.(canvasNode, this.nodes) ?? [])
                worldNodeMap.set(additional.id, additional)
        }

        // Get current zoom for proportional scaling
        const transform = this.config.getTransform()
        const zoom = transform[2]
        const connectorScaling = this.config.settings.scaling

        // Marker offsets and hit areas are part of edge geometry/hit testing, so
        // they stay in world units. Stroke width and arrowhead size are screen
        // pixels for the drawing backend renderer and must not be pre-scaled here.
        const edgeScaledSizes = this.config.settings.useZoomCompensatedScaling
            ? getEdgeScaledSizes(
                zoom,
                {
                    baseStrokeWidth: connectorScaling.strokeWidth,
                    baseMarkerSize: connectorScaling.markerSize,
                    baseMarkerOffset: connectorScaling.markerOffset,
                    baseClickAreaWidth: connectorScaling.clickAreaWidth,
                    zoomScaling: getAdaptiveBoundedZoomScalingOptions(connectorScaling.zoomScaling),
                },
            )
            : {
                markerOffset: connectorScaling.markerOffset,
                clickAreaWidth: connectorScaling.clickAreaWidth,
                markerSize: connectorScaling.markerSize,
            }
        const scaledMarkerOffset = edgeScaledSizes.markerOffset
        const scaledClickAreaWidth = edgeScaledSizes.clickAreaWidth
        const scaledMarkerSizeWorld = edgeScaledSizes.markerSize
        const drawingStrokeWidth = connectorScaling.strokeWidth
        const drawingMarkerSize = connectorScaling.markerSize
        this.currentEdgeClickAreaWidth = scaledClickAreaWidth

        // Read CSS connector colors for drawing backend rendering (set as CSS custom props on paneEl)
        const paneStyle = this.view.getComputedStyle(this.config.paneEl)
        const drawingDefaultColor = paneStyle.getPropertyValue('--connector-line-default-color').trim() || '#000000'
        const drawingFocusColor = paneStyle.getPropertyValue('--connector-line-focus-color').trim() || '#000000'
        this.cachedDefaultColor = drawingDefaultColor
        this.cachedFocusColor = drawingFocusColor
        const connectorData: ConnectorRenderDatum[] = []
        const drawingEdgeConfigsForCache: Array<{
            edgeConfig: EdgeConfig
            isSelected: boolean
        }> = []
        const addConnectorDatum = (
            edgeConfig: EdgeConfig,
            isSelected: boolean,
        ): void => {
            if (!this.config.onConnectorGeometry)
                return

            drawingEdgeConfigsForCache.push({
                edgeConfig,
                isSelected,
            })
            const drawingDatum = computeConnectorDatum(
                edgeConfig,
                worldNodeMap,
                {
                    selected: isSelected,
                    color: drawingDefaultColor,
                    selectedColor: drawingFocusColor,
                    strokeWidth: drawingStrokeWidth,
                    markerSize: drawingMarkerSize,
                    markerOffset: scaledMarkerOffset,
                    worldMarkerSize: scaledMarkerSizeWorld,
                    markerBodyLengthFraction: this.config.markerBodyLengthFraction,
                },
            )

            if (drawingDatum)
                connectorData.push(drawingDatum)
        }

        // Compute spread-out t values for edges sharing the same node+side
        // This prevents multiple edges from converging to the exact same point

        // If we handle proximity, include the ghost edge in calculations so it behaves exactly like a real edge
        const effectiveEdges = [...this.edges]

        if (
            this.proximityCandidate
            && !this.connectionInProgress
        ) {
            const ghostEdgeData: ConnectionEdge = {
                edgeId: '__canvas-proximity-temp', // Use consistent ID
                sourceNodeId: this.proximityCandidate.sourceNodeId,
                sourceHandle: this.proximityCandidate.sourceHandle,
                targetNodeId: this.proximityCandidate.targetNodeId,
                targetHandle: this.proximityCandidate.targetHandle,
                sourceT: 0.5,
                targetT: 0.5,
            }
            effectiveEdges.push(ghostEdgeData)
        }

        const spreadEdges = effectiveEdges.map(
            edge => ({
                ...edge,
                sourceHandle: nodeById.get(edge.sourceNodeId)?.ports?.find(port => port.id === edge.sourceHandle)?.direction ?? edge.sourceHandle,
                targetHandle: nodeById.get(edge.targetNodeId)?.ports?.find(port => port.id === edge.targetHandle)?.direction ?? edge.targetHandle,
            }),
        )
        const spreadTValues = computeConnectorSpread(
            spreadEdges,
            this.nodes,
            {
                isCentered: this.config.isCentered,
                ...this.config.settings.autoAlign,
            },
        )

        // Update proximity candidate T-values with computed ones so commit uses them too
        if (
            this.proximityCandidate
            && !this.connectionInProgress
        ) {
            const computed = spreadTValues.get('__canvas-proximity-temp')

            if (computed) {
                this.proximityCandidate.sourceT = computed.sourceT
                this.proximityCandidate.targetT = computed.targetT
            }
        }

        // Add committed edges (skip the one being reconnected)
        for (const e of this.edges) {
            // Hide the edge being reconnected - it will be shown as in-progress line
            if (
                this.reconnectingEdge?.edgeId === e.edgeId
                && this.connectionInProgress
            )
                continue

            const edgeTargetNode = nodeById.get(e.targetNodeId)
            const {
                source,
                target: storedTarget,
            } = getEdgeAnchorPositions(e)
            const target = e.targetHandle == null
                && this.config.defaultTargetHandle?.(edgeTargetNode) === 'left'
                ? 'left'
                : storedTarget
            const isSelected = e.edgeId === this.selectedEdgeId

            // Use spread t values to prevent convergence, fall back to stored values
            const tValues = spreadTValues.get(e.edgeId)
            let sourceT = tValues?.sourceT
                ?? e.sourceT
                ?? 0.5
            let targetT = tValues?.targetT
                ?? e.targetT
                ?? 0.5
            let sourceContentAnchor = false
            let targetContentAnchor = false

            // A component may anchor a connector to content within its surface.
            if (this.config.sourceAnchorT) {
                const computedT = this.config.sourceAnchorT(
                    e,
                    this.nodeElements.get(e.sourceNodeId),
                )

                if (
                    computedT !== null
                    && Number.isFinite(computedT)
                ) {
                    sourceT = computedT
                    sourceContentAnchor = true

                    // Re-calculate targetT to align with the specific message source height
                    // This prevents the arrow from pointing to the bottom of the target when the thread is long
                    const sourceNode = this.nodes.find(n => n.nodeId === e.sourceNodeId)
                    const targetNode = this.nodes.find(n => n.nodeId === e.targetNodeId)

                    if (
                        sourceNode
                        && targetNode
                        && this.canAutoAlignTarget(targetNode)
                    ) {
                        const targetHeight = targetNode.dimensions.height

                        if (targetHeight < this.config.settings.autoAlign.minSlideHeight)
                            targetT = 0.5
                        else {
                            const sourceY = sourceNode.position.y + sourceNode.dimensions.height * sourceT
                            const targetTop = targetNode.position.y

                            const idealT = (sourceY - targetTop) / targetHeight
                            const m = this.config.settings.autoAlign.edgeMargin
                            targetT = Math.max(
                                m,
                                Math.min(1 - m, idealT),
                            )
                            targetContentAnchor = true
                        }
                    }
                }
            }

            const targetMarker = this.config.targetMarker?.(edgeTargetNode, isSelected) ?? (isSelected ? 'arrowhead-selected' : 'arrowhead')
            const renderedSourceNodeId = this.getRenderedEdgeSourceNodeId(
                e,
                nodeById,
                worldNodeMap,
            )

            const edgeConfig: EdgeConfig = {
                id: e.edgeId,
                source: this.portAnchor(
                    renderedSourceNodeId,
                    e.sourceHandle,
                    source,
                    sourceT,
                    nodeById,
                    sourceContentAnchor,
                    e.sourceNodeId,
                ),
                target: this.portAnchor(
                    e.targetNodeId,
                    e.targetHandle,
                    target,
                    targetT,
                    nodeById,
                    targetContentAnchor,
                ),
                pathType: e.pathType ?? this.config.settings.lineCurve,
                marker: targetMarker,
                laneIndex: tValues?.laneIndex ?? 0,
                laneCount: tValues?.laneCount ?? 1,
            }

            addConnectorDatum(edgeConfig, isSelected)
        }

        // Add in-progress edge (new connection or reconnecting existing edge)
        if (this.connectionInProgress) {
            const to = this.connectionInProgress.candidate ?? this.connectionInProgress.worldPointer

            const tempNodeId = '__canvas-temp-target'
            const snappedTargetNodeId = this.connectionInProgress.candidate?.nodeId
                ?? null
            const snappedTargetNode = snappedTargetNodeId
                ? this.nodes.find(node => node.nodeId === snappedTargetNodeId) ?? null
                : null
            const snappedTargetPosition = this.connectionInProgress.candidate?.position as 'left' | 'right' | 'top' | 'bottom' | undefined

            if (
                !snappedTargetNode
                || !snappedTargetPosition
                || !this.connectionInProgress.candidate
            ) {
                const tempNode: NodeConfig = {
                    id: tempNodeId,
                    shape: 'rect',
                    x: to.x,
                    y: to.y,
                    width: 0,
                    height: 0,
                    anchorOverrides: {
                        left: {
                            x: to.x,
                            y: to.y,
                        },
                        right: {
                            x: to.x,
                            y: to.y,
                        },
                        top: {
                            x: to.x,
                            y: to.y,
                        },
                        bottom: {
                            x: to.x,
                            y: to.y,
                        },
                        center: {
                            x: to.x,
                            y: to.y,
                        },
                    },
                }
                worldNodeMap.set(tempNodeId, tempNode)
            }

            // When reconnecting, show the edge from the anchored end to the cursor
            // When creating new connection, show dashed line from source to cursor
            const isReconnecting = this.reconnectingEdge !== null
            const reconnectingEdgeData = isReconnecting
                ? this.edges.find(e => e.edgeId === this.reconnectingEdge?.edgeId)
                : null

            let sourceNodeId: string
            let sourcePosition: 'left' | 'right' | 'center'
            let sourceHandleId: string | undefined

            if (
                isReconnecting
                && reconnectingEdgeData
            ) {
                // When reconnecting, the source is the end that's NOT being dragged
                if (this.reconnectingEdge!.edgeUpdaterType === 'source') {
                    // Dragging source end, so anchor from target
                    sourceNodeId = reconnectingEdgeData.targetNodeId
                    sourceHandleId = reconnectingEdgeData.targetHandle
                    sourcePosition = (reconnectingEdgeData.targetHandle === 'left' ? 'left' : 'right') as 'left' | 'right'
                } else {
                    // Dragging target end, so anchor from source
                    sourceNodeId = reconnectingEdgeData.sourceNodeId
                    sourceHandleId = reconnectingEdgeData.sourceHandle
                    sourcePosition = (reconnectingEdgeData.sourceHandle === 'left' ? 'left' : 'right') as 'left' | 'right'
                }
            } else {
                // New connection - use the fromHandle
                sourceNodeId = this.connectionInProgress.start.nodeId
                sourceHandleId = this.connectionInProgress.start.id ?? undefined
                sourcePosition = this.connectionInProgress.start.position as 'left' | 'right'
            }

            const snappedTargetT = snappedTargetNode
                && snappedTargetPosition
                && this.connectionInProgress.candidate
                ? computeTFromPointerPosition(
                    this.connectionInProgress.candidate.y,
                    snappedTargetNode.position.y,
                    snappedTargetNode.dimensions.height,
                )
                : undefined

            const tempEdge: EdgeConfig = {
                id: '__canvas-temp-edge',
                source: this.portAnchor(
                    sourceNodeId,
                    sourceHandleId,
                    sourcePosition,
                    undefined,
                    nodeById,
                ),
                target: snappedTargetNode
                    && snappedTargetPosition
                    && this.connectionInProgress.candidate
                    ? this.portAnchor(
                        snappedTargetNode.nodeId,
                        this.connectionInProgress.candidate.id ?? undefined,
                        snappedTargetPosition,
                        snappedTargetT,
                        nodeById,
                    )
                    : {
                        nodeId: tempNodeId,
                        position: 'center',
                    },
                pathType: this.config.settings.lineCurve,
                marker: 'arrowhead',
                lineStyle: isReconnecting ? 'solid' : 'dashed',
            }
            addConnectorDatum(tempEdge, false)
        }

        // Draw potential proximity connection
        if (
            this.proximityCandidate
            && !this.connectionInProgress
        ) {
            // Retrieve computed values or fall back to candidate/default
            const computed = spreadTValues.get('__canvas-proximity-temp')
            const sourceT = computed?.sourceT ?? this.proximityCandidate.sourceT
            const targetT = computed?.targetT ?? this.proximityCandidate.targetT

            const ghostEdge: EdgeConfig = {
                id: '__canvas-proximity-edge',
                source: this.buildEdgeAnchor(
                    this.proximityCandidate.sourceNodeId,
                    this.proximityCandidate.sourceHandle,
                    sourceT,
                    nodeById,
                ),
                target: this.buildEdgeAnchor(
                    this.proximityCandidate.targetNodeId,
                    this.proximityCandidate.targetHandle,
                    targetT,
                    nodeById,
                ),
                pathType: this.config.settings.lineCurve,
                marker: 'arrowhead',
                lineStyle: 'dashed',
            }
            addConnectorDatum(ghostEdge, false)
        }

        this.config.onConnectorGeometry?.(connectorData)
        this.cachedEdgeConfigs = drawingEdgeConfigsForCache
        this.cachedWorldNodeMap = worldNodeMap
        this.cachedConnectorData = connectorData
        this.cachedFlattenedEdgePaths.clear()

        this.attachEdgeInteractionHandlers()
    }

    // Fast synchronous drawing backend datum recomputation when only zoom changes.
    // Called from the viewport zoom handler after the viewport is applied,
    // then flushed synchronously by canvasMediaLayer.renderNow().
    public recomputeConnectorGeometry(zoom: number): boolean {
        if (
            !this.cachedEdgeConfigs
            || !this.cachedWorldNodeMap
            || !this.config.onConnectorGeometry
        )
            return false

        const connectorScaling = this.config.settings.scaling
        // Recompute world-space offsets/hit areas on zoom changes. The cached
        // drawing backend edge datum still carries base screen pixels for stroke/arrow sizes;
        // `ConnectorRenderer` applies the matching adaptive bounded curve during
        // paint so path geometry and rendered chrome stay in sync.
        const edgeScaledSizes = this.config.settings.useZoomCompensatedScaling
            ? getEdgeScaledSizes(
                zoom,
                {
                    baseStrokeWidth: connectorScaling.strokeWidth,
                    baseMarkerSize: connectorScaling.markerSize,
                    baseMarkerOffset: connectorScaling.markerOffset,
                    baseClickAreaWidth: connectorScaling.clickAreaWidth,
                    zoomScaling: getAdaptiveBoundedZoomScalingOptions(connectorScaling.zoomScaling),
                },
            )
            : {
                markerOffset: connectorScaling.markerOffset,
                clickAreaWidth: connectorScaling.clickAreaWidth,
                markerSize: connectorScaling.markerSize,
            }
        const scaledMarkerOffset = edgeScaledSizes.markerOffset
        this.currentEdgeClickAreaWidth = edgeScaledSizes.clickAreaWidth
        const scaledMarkerSizeWorld = edgeScaledSizes.markerSize

        const connectorData: ConnectorRenderDatum[] = []

        for (const {
            edgeConfig,
            isSelected,
        } of this.cachedEdgeConfigs) {
            const drawingDatum = computeConnectorDatum(
                edgeConfig,
                this.cachedWorldNodeMap,
                {
                    selected: isSelected,
                    color: this.cachedDefaultColor,
                    selectedColor: this.cachedFocusColor,
                    strokeWidth: connectorScaling.strokeWidth,
                    markerSize: connectorScaling.markerSize,
                    markerOffset: scaledMarkerOffset,
                    worldMarkerSize: scaledMarkerSizeWorld,
                    markerBodyLengthFraction: this.config.markerBodyLengthFraction,
                },
            )

            if (drawingDatum)
                connectorData.push(drawingDatum)
        }

        this.cachedConnectorData = connectorData
        this.cachedFlattenedEdgePaths.clear()
        this.config.onConnectorGeometry(connectorData)

        return true
    }

    private paneClickHandler: ((e: MouseEvent) => void) | null = null
    private paneMouseMoveHandler: ((e: MouseEvent) => void) | null = null

    private getFlattenedEdgePath(edge: ConnectorRenderDatum): PathPoint[] {
        const cached = this.cachedFlattenedEdgePaths.get(edge.id)

        if (cached?.svgPath === edge.svgPath)
            return cached.points

        const points = flattenSvgPath(edge.svgPath)
        this.cachedFlattenedEdgePaths.set(
            edge.id,
            {
                svgPath: edge.svgPath,
                points,
            },
        )

        return points
    }

    private getWorldPointFromClient(
        clientX: number,
        clientY: number,
    ): PathPoint {
        const paneBounds = this.config.paneEl.getBoundingClientRect()
        const transform = this.config.getTransform()

        return {
            x: (clientX - paneBounds.left - transform[0]) / transform[2],
            y: (clientY - paneBounds.top - transform[1]) / transform[2],
        }
    }

    private worldPointToClientPoint(point: PathPoint): PathPoint {
        const paneBounds = this.config.paneEl.getBoundingClientRect()
        const transform = this.config.getTransform()

        return {
            x: paneBounds.left + point.x * transform[2] + transform[0],
            y: paneBounds.top + point.y * transform[2] + transform[1],
        }
    }

    private findEdgeIdAtClientPoint(
        clientX: number,
        clientY: number,
    ): string | null {
        const worldPoint = this.getWorldPointFromClient(clientX, clientY)
        const hitRadius = Math.max(1, this.currentEdgeClickAreaWidth / 2)
        const committedEdgeIds = new Set(
            this.edges.map(edge => edge.edgeId),
        )

        for (const edge of [...this.cachedConnectorData].reverse()) {
            if (!committedEdgeIds.has(edge.id))
                continue

            if (isPointNearPath(
                worldPoint,
                this.getFlattenedEdgePath(edge),
                hitRadius,
            ))
                return edge.id
        }

        return null
    }

    public getEdgeMidpointRect(edgeId: string): DOMRect | null {
        const edge = this.cachedConnectorData.find(candidate => candidate.id === edgeId)

        if (!edge)
            return null

        const points = this.getFlattenedEdgePath(edge)
        const pathLength = getPathLength(points)
        const midpoint = getPointAtPathLength(points, pathLength / 2)

        if (!midpoint)
            return null

        const screenMid = this.worldPointToClientPoint(midpoint.point)
        const tangentLength = Math.hypot(midpoint.tangent.x, midpoint.tangent.y) || 1
        let normalX = -midpoint.tangent.y / tangentLength
        let normalY = midpoint.tangent.x / tangentLength

        if (normalY < 0) {
            normalX = -normalX
            normalY = -normalY
        }

        const menuRadius = 18
        const gap = 10
        const distance = menuRadius + gap
        const menuCenterX = screenMid.x + normalX * distance
        const menuCenterY = screenMid.y + normalY * distance
        const targetX = menuCenterX
        const targetY = menuCenterY - menuRadius - 9

        return new DOMRect(
            targetX,
            targetY,
            1,
            1,
        )
    }

    private attachEdgeInteractionHandlers() {
        if (this.paneClickHandler)
            return // Already attached

        this.paneClickHandler = (e: MouseEvent) => {
            const target = e.target as HTMLElement

            if (this.config.isNodeTarget?.(target))
                return

            const edgeId = this.findEdgeIdAtClientPoint(e.clientX, e.clientY)

            if (!edgeId)
                return

            e.preventDefault()
            e.stopPropagation()
            this.selectEdge(edgeId)
        }

        this.paneMouseMoveHandler = (e: MouseEvent) => {
            // Don't interfere with cursor if we are currently drawing a connection
            // or if the user is dragging something (mouse button is held down)
            if (
                this.connectionInProgress
                || e.buttons > 0
            ) {
                this.config.paneEl.classList.remove('is-hovering-edge')

                return
            }

            const target = e.target as HTMLElement

            if (this.config.isNodeTarget?.(target)) {
                this.config.paneEl.classList.remove('is-hovering-edge')

                return
            }

            this.config.paneEl.classList.toggle(
                'is-hovering-edge',
                Boolean(
                    this.findEdgeIdAtClientPoint(e.clientX, e.clientY),
                ),
            )
        }

        this.config.paneEl.addEventListener('click', this.paneClickHandler)
        this.config.paneEl.addEventListener('mousemove', this.paneMouseMoveHandler)
    }

    public checkProximity(
        nodeId: string,
        position: {
            x: number
            y: number
        },
        dimensions: {
            width: number
            height: number
        },
    ) {
        const draggedNode = this.nodes.find(n => n.nodeId === nodeId)

        if (!draggedNode)
            return

        let closestCandidate: ProximityCandidate | null = null
        let distance = this.config.settings.proximityConnectThreshold

        for (const candidate of this.nodes) {
            if (
                candidate.nodeId === nodeId
                || !this.config.canConnectProximity?.(draggedNode, candidate)
            )
                continue

            if (this.edges.some(edge => edge.sourceNodeId === nodeId && edge.targetNodeId === candidate.nodeId))
                continue

            const delta = Math.hypot(
                position.x + dimensions.width - candidate.position.x,
                position.y + dimensions.height / 2 - candidate.position.y - candidate.dimensions.height / 2,
            )

            if (delta > distance)
                continue

            distance = delta
            closestCandidate = {
                sourceNodeId: nodeId,
                targetNodeId: candidate.nodeId,
                sourceHandle: 'right',
                targetHandle: 'left',
                sourceT: 0.5,
                targetT: 0.5,
            }
        }

        if (
            this.proximityCandidate?.sourceNodeId !== closestCandidate?.sourceNodeId
            || this.proximityCandidate?.targetNodeId !== closestCandidate?.targetNodeId
        )
            this.proximityCandidate = closestCandidate
    }

    public commitProximityConnection() {
        if (!this.proximityCandidate)
            return

        const newEdge: ConnectionEdge = {
            edgeId: generateEdgeId(),
            sourceNodeId: this.proximityCandidate.sourceNodeId,
            sourceHandle: this.proximityCandidate.sourceHandle,
            targetNodeId: this.proximityCandidate.targetNodeId,
            targetHandle: this.proximityCandidate.targetHandle,
            // Use the calculated T values so strict position matches ghost edge (no jump)
            sourceT: this.proximityCandidate.sourceT ?? 0.5,
            targetT: this.proximityCandidate.targetT ?? 0.5,
        }

        const nextEdges = [...this.edges, newEdge]
        this.config.onEdgesChange(nextEdges)

        this.proximityCandidate = null
    }

    public destroy() {
        if (this.destroyed)
            return

        this.destroyed = true
        this.cancelTransientConnection()
        this.config.paneEl.removeEventListener('mousemove', this.paneMouseMoveHandler!)
        this.nodeElements.clear()

        // Remove click handler
        if (this.paneClickHandler) {
            this.config.paneEl.removeEventListener('click', this.paneClickHandler)
            this.paneClickHandler = null
        }

        this.geometry.clear()
        this.nodes = []
        this.edges = []
        this.cachedEdgeConfigs = null
        this.cachedWorldNodeMap = null
        this.cachedConnectorData = []
        this.cachedFlattenedEdgePaths.clear()
        this.connectionInProgress = null
        this.selectedEdgeId = null
        this.reconnectingEdge = null
        this.menuConnectionCleanup?.()
    }
}
