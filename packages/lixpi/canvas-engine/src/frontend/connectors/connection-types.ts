import {
    type CanvasGeometryNode,
    type BoundedZoomScalingOptions,
    type CanvasPort,
} from '../../shared/index.ts'
import {
    type ConnectorRenderDatum,
} from './connector-renderer.ts'
import {
    type NodeConfig,
    type PathType,
    type MarkerType,
} from './types.ts'
import {
    type SpreadEdge,
} from './connector-spread.ts'

export type ConnectionNode = CanvasGeometryNode & {
    ports?: readonly CanvasPort[]
    extent?: 'parent' | [[number, number], [number, number]]
    expandParent?: boolean
}

export type ConnectionEdge<Data = unknown> = SpreadEdge & {
    pathType?: PathType
    data?: Data
}
export type ProximityCandidate = {
    sourceNodeId: string
    sourceHandle: 'left' | 'right'
    targetNodeId: string
    targetHandle: 'left' | 'right'
    sourceT?: number
    targetT?: number
}

export type ConnectionSettings = {
    lineCurve: PathType
    useZoomCompensatedScaling: boolean
    scaling: {
        strokeWidth: number
        markerSize: number
        markerOffset: {
            source: number
            target: number
        }
        clickAreaWidth: number
        zoomScaling: BoundedZoomScalingOptions
    }
    proximityConnectThreshold: number
    menuConnectionSnapRadius: number
    autoAlign: {
        minSlideHeight: number
        edgeMargin: number
    }
    styles: {
        lineDefaultColor: string
        lineFocusColor: string
    }
}

export type ConnectionManagerConfig<Node extends ConnectionNode> = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    flowId?: string
    getTransform: () => [number, number, number]
    panBy: (delta: {
        x: number
        y: number
    }) => Promise<boolean>
    onEdgesChange: (edges: ConnectionEdge[]) => void
    onError: (error: unknown) => void
    onSelectedEdgeChange?: (edgeId: string | null) => void
    onConnectorGeometry?: (edges: ConnectorRenderDatum[]) => void
    settings: ConnectionSettings
    markerBodyLengthFraction: number
} & ConnectionPolicy<Node>

export type ConnectionPolicy<Node extends ConnectionNode> = {
    isCentered: (node: Node | undefined) => boolean
    isReconnectionCentered?: (node: Node | undefined) => boolean
    defaultTargetHandle?: (node: Node | undefined) => 'left' | 'right'
    targetMarker?: (
        node: Node | undefined,
        selected: boolean,
    ) => MarkerType
    additionalGeometry?: (
        node: Node,
        nodes: readonly Node[],
    ) => readonly NodeConfig[]
    renderedSourceNodeId?: (
        edge: ConnectionEdge,
        nodes: readonly Node[],
    ) => string
    // A content-relative vertical anchor overrides left/right named-port height.
    // Null or a nonfinite value keeps the port's configured anchor.
    sourceAnchorT?: (
        edge: ConnectionEdge,
        element: HTMLElement | undefined,
    ) => number | null
    isNodeTarget?: (target: Element) => boolean
    canConnectProximity?: (
        source: Node,
        target: Node,
    ) => boolean
}
