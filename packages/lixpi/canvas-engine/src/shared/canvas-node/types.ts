'use strict'

import type { CanvasEngineRect } from '../geometry/index.ts'
import type { CanvasPositionedNode } from '../scene/types.ts'

export type RigidCanvasNodeGroup = {
    id: string
    nodeIds: string[]
    rect: CanvasEngineRect
    margin?: number
    overlapThreshold?: number
}

export type RigidCanvasNodeCollisionResult<Node extends CanvasPositionedNode = CanvasPositionedNode> = {
    nodes: Node[]
    changed: boolean
    movedGroupCount: number
    movedNodeCount: number
    collisionIterations: number
}
