'use strict'

import type {
    CanvasEnginePoint,
    CanvasEngineRect,
} from '../geometry/index.ts'

export type CollisionBox = CanvasEngineRect & {
    id: string
    fixed?: boolean
    margin?: number
    overlapThreshold?: number
}

export type CollisionOptions = {
    iterations?: number
    overlapThreshold?: number
    margin?: number
    excludePairs?: Set<string>
    shouldResolvePair?: (a: CollisionBox, b: CollisionBox) => boolean
}

export type CollisionResult = {
    nodes: Map<string, CanvasEnginePoint>
    numIterations: number
    hasChanges: boolean
}
