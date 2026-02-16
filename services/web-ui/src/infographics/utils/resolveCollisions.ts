// Node collision resolution algorithm
// Naive O(n²) implementation that pushes overlapping nodes apart

type NodeBox = {
    id: string
    x: number
    y: number
    width: number
    height: number
}

type CollisionOptions = {
    iterations?: number        // Max iterations (default: 50)
    overlapThreshold?: number  // Minimum overlap to trigger resolution (default: 0.5)
    margin?: number            // Extra spacing around nodes (default: 20)
    excludePairs?: Set<string> // Set of "nodeIdA-nodeIdB" pairs to skip collision resolution for
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
        excludePairs
    } = options

    // Create mutable boxes with margin applied
    const boxes = nodes.map(node => ({
        id: node.id,
        x: node.x - margin,
        y: node.y - margin,
        width: node.width + margin * 2,
        height: node.height + margin * 2,
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

                // Skip excluded pairs (e.g. anchored images overlapping their thread)
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

                // Check if there's significant overlap on BOTH axes
                if (px > overlapThreshold && py > overlapThreshold) {
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
                x: box.x + margin,
                y: box.y + margin
            })
        }
    }

    return { nodes: result, numIterations, hasChanges }
}
