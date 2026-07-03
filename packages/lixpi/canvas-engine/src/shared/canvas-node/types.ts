'use strict'

import type { CanvasNode } from '@lixpi/constants'

import type { CanvasEngineRect } from '../geometry/index.ts'

export type RigidCanvasNodeGroup = {
    id: string
    nodeIds: string[]
    rect: CanvasEngineRect
    margin?: number
    overlapThreshold?: number
}

export type RigidCanvasNodeCollisionResult = {
    nodes: CanvasNode[]
    changed: boolean
    movedGroupCount: number
    movedNodeCount: number
    collisionIterations: number
}
