import {
    type CanvasEnginePoint,
    type CanvasEngineRect,
} from '../geometry/index.ts'
import {
    type CanvasGeometryNode,
    type CanvasPort,
} from '../scene/types.ts'

export type PortDirection = CanvasPort['direction']
export type PortRole = 'source' | 'target'
export type ConnectionGeometryNode = CanvasGeometryNode & {
    ports?: readonly CanvasPort[]
    extent?: 'parent' | [[number, number], [number, number]]
    expandParent?: boolean
}
export type PortIdentity = {
    nodeId: string
    id: string | null
    type: PortRole
    position: PortDirection
}
export type LocalPort = PortIdentity & CanvasEngineRect
export type ResolvedPort = PortIdentity & CanvasEnginePoint
export type ProjectedConnectionNode = {
    nodeId: string
    bounds: CanvasEngineRect
    ports: readonly LocalPort[]
}
export type PortConnection = {
    source: string
    sourceHandle: string | null
    target: string
    targetHandle: string | null
}
export type ConnectionSession = {
    isValid: boolean | null
    start: ResolvedPort
    candidate: ResolvedPort | null
    panePointer: CanvasEnginePoint
    worldPointer: CanvasEnginePoint
}
