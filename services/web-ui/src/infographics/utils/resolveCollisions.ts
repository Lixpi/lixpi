// Node collision resolution algorithm
// Naive O(n²) implementation that pushes overlapping nodes apart

type NodeBox = {
    id: string
    x: number
    y: number
    width: number
    height: number
    margin?: number
    overlapThreshold?: number
}

type CollisionOptions = {
    iterations?: number        // Max iterations (default: 50)
    overlapThreshold?: number  // Minimum overlap to trigger resolution (default: 0.5)
    margin?: number            // Extra spacing around nodes (default: 20)
    excludePairs?: Set<string> // Set of "nodeIdA-nodeIdB" pairs to skip collision resolution for
    shouldResolvePair?: (a: NodeBox, b: NodeBox) => boolean
}

type CollisionResult = {
    nodes: Map<string, { x: number; y: number }>  // Updated positions keyed by node id
    numIterations: number
    hasChanges: boolean
}

export function resolveCollisions(
    nodes: NodeBox[],
    options: CollisionOptions = {}
): CollisionResult {
    const {
        iterations = 50,
        overlapThreshold = 0.5,
        margin = 20,
        excludePairs,
        shouldResolvePair,
    } = options

    // Create mutable boxes with margin applied. A box can override the global
    // resolver margin so callers can keep the resolver geometry-agnostic while
    // still configuring spacing per workspace node type.
    const boxes = nodes.map(node => ({
        id: node.id,
        x: node.x - (node.margin ?? margin),
        y: node.y - (node.margin ?? margin),
        width: node.width + (node.margin ?? margin) * 2,
        height: node.height + (node.margin ?? margin) * 2,
        margin: node.margin ?? margin,
        overlapThreshold: node.overlapThreshold ?? overlapThreshold,
        moved: false
    }))

    let numIterations = 0

    // Iteratively resolve collisions
    for (let iter = 0; iter < iterations; iter++) {
        let moved = false

        // Check all pairs for collisions O(n²)
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const A = boxes[i]
                const B = boxes[j]

                // Skip excluded pairs such as parent/child nodes that are allowed to overlap.
                if (excludePairs && (excludePairs.has(`${A.id}-${B.id}`) || excludePairs.has(`${B.id}-${A.id}`))) {
                    continue
                }

                // Calculate center positions
                const centerAX = A.x + A.width * 0.5
                const centerAY = A.y + A.height * 0.5
                const centerBX = B.x + B.width * 0.5
                const centerBY = B.y + B.height * 0.5

                // Calculate distance between centers
                const dx = centerAX - centerBX
                const dy = centerAY - centerBY

                // Calculate overlap (penetration depth) along each axis
                const px = (A.width + B.width) * 0.5 - Math.abs(dx)
                const py = (A.height + B.height) * 0.5 - Math.abs(dy)

                const pairOverlapThreshold = Math.min(A.overlapThreshold, B.overlapThreshold)

                // Check if there's significant overlap on BOTH axes
                if (px > pairOverlapThreshold && py > pairOverlapThreshold) {
                    const originalA = {
                        id: A.id,
                        x: A.x + A.margin,
                        y: A.y + A.margin,
                        width: A.width - A.margin * 2,
                        height: A.height - A.margin * 2,
                    }
                    const originalB = {
                        id: B.id,
                        x: B.x + B.margin,
                        y: B.y + B.margin,
                        width: B.width - B.margin * 2,
                        height: B.height - B.margin * 2,
                    }
                    if (shouldResolvePair && !shouldResolvePair(originalA, originalB)) continue

                    A.moved = B.moved = moved = true

                    // Resolve along the SMALLEST overlap axis (minimum translation)
                    if (px < py) {
                        // Move along x-axis
                        const sx = dx > 0 ? 1 : -1
                        const moveAmount = (px / 2) * sx
                        A.x += moveAmount
                        B.x -= moveAmount
                    } else {
                        // Move along y-axis
                        const sy = dy > 0 ? 1 : -1
                        const moveAmount = (py / 2) * sy
                        A.y += moveAmount
                        B.y -= moveAmount
                    }
                }
            }
        }

        numIterations++

        // Early exit if no overlaps were found
        if (!moved) break
    }

    // Build result map with updated positions (accounting for margin)
    const result = new Map<string, { x: number; y: number }>()
    let hasChanges = false

    for (const box of boxes) {
        if (box.moved) {
            hasChanges = true
            result.set(box.id, {
                x: box.x + box.margin,
                y: box.y + box.margin
            })
        }
    }

    return { nodes: result, numIterations, hasChanges }
}
