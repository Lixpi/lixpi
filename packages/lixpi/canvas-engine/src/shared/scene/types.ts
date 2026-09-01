'use strict'

import type {
    CanvasEnginePoint,
    CanvasEngineRect,
    CanvasEngineSize,
} from '../geometry/index.ts'

export type CanvasPositionedNode = {
    nodeId: string
    position: CanvasEnginePoint
    parentId?: string
}

export type CanvasGeometryNode = CanvasPositionedNode & {
    dimensions: CanvasEngineSize
}

export type CanvasViewport = CanvasEnginePoint & { zoom: number }

export type CanvasPort = {
    id: string
    role: 'input' | 'output' | 'both'
    anchor: CanvasEnginePoint
    direction: 'left' | 'right' | 'top' | 'bottom'
}

export type EngineNode<Data = unknown> = CanvasGeometryNode & {
    type: string
    data: Data
    ports: readonly CanvasPort[]
}

export type EdgeEndpoint = { nodeId: string; portId: string }
export type ConnectorPathType = 'bezier' | 'straight' | 'smoothstep' | 'horizontal-bezier' | 'orthogonal'

export type EngineEdge<Data = unknown> = {
    edgeId: string
    source: EdgeEndpoint
    target: EdgeEndpoint
    path: ConnectorPathType
    data: Data
}

export type SceneSnapshot<NodeData = unknown, EdgeData = unknown> = {
    sceneKey: string
    revision: string
    nodes: readonly EngineNode<NodeData>[]
    edges: readonly EngineEdge<EdgeData>[]
}

export type NodeGeometryChange = {
    nodeId: string
    position: CanvasEnginePoint
    dimensions: CanvasEngineSize
    parentId?: string | null
}

export type CanvasIntent =
    | { kind: 'geometry'; sceneKey: string; revision: string; changes: readonly NodeGeometryChange[] }
    | { kind: 'connect'; sceneKey: string; source: EdgeEndpoint; target: EdgeEndpoint }
    | { kind: 'reconnect'; sceneKey: string; edgeId: string; source: EdgeEndpoint; target: EdgeEndpoint }
    | { kind: 'delete'; sceneKey: string; nodeIds: readonly string[]; edgeIds: readonly string[] }
    | { kind: 'viewport'; sceneKey: string; viewport: CanvasViewport }

export type NodeGeometryPolicy<Data = unknown> = {
    measure: (node: EngineNode<Data>) => {
        visualBounds: CanvasEngineRect
        hitBounds: CanvasEngineRect
        selectionBounds: CanvasEngineRect
        collisionBounds: CanvasEngineRect
        connectorBounds: CanvasEngineRect
    }
    resize: { min: CanvasEngineSize; max?: CanvasEngineSize; preserveAspectRatio: boolean }
    movable: boolean
    collisionGroup?: string
}

export type Dispose = () => void
