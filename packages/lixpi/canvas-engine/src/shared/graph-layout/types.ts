import {
    type EngineEdge,
} from '../scene/types.ts'

// Forward edges form fan-out trees and use horizontal Bezier paths. Relations
// connect nodes across trees; feedback returns through exterior lanes.
export type CanvasGraphEdgeKind = 'forward' | 'relation' | 'feedback'

// A tree expresses an actual fan-out. Joins and feedback remain edges; they
// never assign a shared result to an arbitrary primary parent.
export type CanvasGraphTree = {
    rootId: string
    children?: Readonly<Record<string, readonly string[]>>
}

// Stages define left-to-right reading order. alignNodeId places one member on
// the horizontal reading line shared with the other stages.
export type CanvasGraphStage = {
    trees: readonly CanvasGraphTree[]
    alignNodeId?: string
}

export type CanvasGraphSpacing = {
    // Clearance kept around every node. It also sets the route endpoint lead
    // and the feedback lane spacing. Depth columns are two gaps apart.
    nodeGap: number
    // Vertical gap between sibling subtrees and between trees in a stage.
    siblingGap: number
    collisionIterations: number
    overlapThreshold: number
}

export type CanvasGraphLayoutOptions<EdgeData = unknown> = {
    // When omitted, every node without an incoming forward edge roots a tree
    // in a single stage and forward edges supply the children.
    stages?: readonly CanvasGraphStage[]
    edgeKind?: (edge: EngineEdge<EdgeData>) => CanvasGraphEdgeKind
    spacing?: Partial<CanvasGraphSpacing>
}
