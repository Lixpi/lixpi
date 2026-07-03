'use strict'

import type { CanvasEnginePoint } from '../geometry/index.ts'

import type {
    CollisionBox,
    CollisionOptions,
    CollisionResult,
} from './types.ts'

export function resolveCollisions(
    nodes: CollisionBox[],
    options: CollisionOptions = {},
): CollisionResult {
    const {
        iterations = 50,
        overlapThreshold = 0.5,
        margin = 20,
        excludePairs,
        shouldResolvePair,
    } = options

    const boxes = nodes.map(node => ({
        id: node.id,
        x: node.x - (node.margin ?? margin),
        y: node.y - (node.margin ?? margin),
        width: node.width + (node.margin ?? margin) * 2,
        height: node.height + (node.margin ?? margin) * 2,
        margin: node.margin ?? margin,
        overlapThreshold: node.overlapThreshold ?? overlapThreshold,
        moved: false,
    }))

    let numIterations = 0

    for (let iter = 0; iter < iterations; iter++) {
        let moved = false

        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const boxA = boxes[i]
                const boxB = boxes[j]
                if (!boxA || !boxB) continue

                if (excludePairs && (excludePairs.has(`${boxA.id}-${boxB.id}`) || excludePairs.has(`${boxB.id}-${boxA.id}`))) {
                    continue
                }

                const centerAX = boxA.x + boxA.width * 0.5
                const centerAY = boxA.y + boxA.height * 0.5
                const centerBX = boxB.x + boxB.width * 0.5
                const centerBY = boxB.y + boxB.height * 0.5
                const dx = centerAX - centerBX
                const dy = centerAY - centerBY
                const px = (boxA.width + boxB.width) * 0.5 - Math.abs(dx)
                const py = (boxA.height + boxB.height) * 0.5 - Math.abs(dy)
                const pairOverlapThreshold = Math.min(boxA.overlapThreshold, boxB.overlapThreshold)

                if (px > pairOverlapThreshold && py > pairOverlapThreshold) {
                    const originalA = {
                        id: boxA.id,
                        x: boxA.x + boxA.margin,
                        y: boxA.y + boxA.margin,
                        width: boxA.width - boxA.margin * 2,
                        height: boxA.height - boxA.margin * 2,
                    }
                    const originalB = {
                        id: boxB.id,
                        x: boxB.x + boxB.margin,
                        y: boxB.y + boxB.margin,
                        width: boxB.width - boxB.margin * 2,
                        height: boxB.height - boxB.margin * 2,
                    }
                    if (shouldResolvePair && !shouldResolvePair(originalA, originalB)) continue

                    boxA.moved = true
                    boxB.moved = true
                    moved = true

                    if (px < py) {
                        const sx = dx > 0 ? 1 : -1
                        const moveAmount = (px / 2) * sx
                        boxA.x += moveAmount
                        boxB.x -= moveAmount
                    } else {
                        const sy = dy > 0 ? 1 : -1
                        const moveAmount = (py / 2) * sy
                        boxA.y += moveAmount
                        boxB.y -= moveAmount
                    }
                }
            }
        }

        numIterations++
        if (!moved) break
    }

    const result = new Map<string, CanvasEnginePoint>()
    let hasChanges = false

    for (const box of boxes) {
        if (!box.moved) continue
        hasChanges = true
        result.set(box.id, {
            x: box.x + box.margin,
            y: box.y + box.margin,
        })
    }

    return { nodes: result, numIterations, hasChanges }
}
