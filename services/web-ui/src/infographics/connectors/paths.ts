// Path building utilities wrapping XYFlow edge utilities
// Provides both XYFlow standard paths and custom path types

import { getBezierPath, getStraightPath, getSmoothStepPath, Position } from '@xyflow/system'
import type { PathType, ComputedPath, AnchorPosition, NodeConfig } from '$src/infographics/connectors/types.ts'

// Simple node bounds type for path obstacle avoidance
type NodeBounds = {
    id: string
    x: number
    y: number
    width: number
    height: number
}

// Convert our simplified anchor position to XYFlow's Position enum
function toXYFlowPosition(position: AnchorPosition): Position {
    switch (position) {
        case 'left': return Position.Left
        case 'right': return Position.Right
        case 'top': return Position.Top
        case 'bottom': return Position.Bottom
        case 'center': return Position.Bottom  // Default to bottom for center
    }
}

// Build a horizontal symmetric S-curve bezier path
// Leaves horizontally from source, transitions in the middle, arrives horizontally at target
// This is the custom path type used in contextSelector for smooth horizontal flows
function buildHorizontalBezierPath(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number
): string {
    // Place both control points at the horizontal midpoint
    const midX = (sourceX + targetX) / 2

    // Control point 1: at midpoint X, source Y (stays horizontal from source)
    const c1x = midX
    const c1y = sourceY

    // Control point 2: at midpoint X, target Y (stays horizontal to target)
    const c2x = midX
    const c2y = targetY

    return `M ${sourceX},${sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`
}

// Find a safe vertical lane X position that avoids ALL nodes
// The vertical segment goes from sourceY to targetY, so any node that overlaps
// this Y range AND would be intersected by our vertical line is a blocker
// Returns X coordinate for the vertical segment that won't intersect any nodes
function findSafeVerticalLane(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    obstacleNodes: NodeBounds[],
    margin: number = 15
): number {
    const minY = Math.min(sourceY, targetY)
    const maxY = Math.max(sourceY, targetY)

    // For a 3-segment path (H→V→H), the vertical segment will be at some X position
    // between sourceX and targetX (ideally midpoint). We need to find an X where
    // the vertical line from sourceY to targetY doesn't intersect any node.

    // First, find all nodes that overlap with our Y range (these could block the vertical segment)
    const nodesInYRange = obstacleNodes.filter(node => {
        const nodeTop = node.y
        const nodeBottom = node.y + node.height
        // Node overlaps with the vertical range of the edge
        return nodeBottom + margin > minY && nodeTop - margin < maxY
    })

    if (nodesInYRange.length === 0) {
        // No nodes in our Y range, use the midpoint
        return (sourceX + targetX) / 2
    }

    // Collect all "forbidden" X ranges where we can't place the vertical segment
    // A vertical line at X would hit a node if X is within [node.x - margin, node.x + node.width + margin]
    const forbiddenRanges: Array<{ left: number; right: number }> = []

    for (const node of nodesInYRange) {
        forbiddenRanges.push({
            left: node.x - margin,
            right: node.x + node.width + margin
        })
    }

    // Merge overlapping forbidden ranges
    forbiddenRanges.sort((a, b) => a.left - b.left)
    const mergedRanges: Array<{ left: number; right: number }> = []
    for (const range of forbiddenRanges) {
        if (mergedRanges.length === 0) {
            mergedRanges.push(range)
        } else {
            const last = mergedRanges[mergedRanges.length - 1]
            if (range.left <= last.right) {
                // Overlapping, merge
                last.right = Math.max(last.right, range.right)
            } else {
                mergedRanges.push(range)
            }
        }
    }

    // The vertical segment should ideally be between sourceX and targetX
    // But if all positions between them are blocked, we go outside
    const minX = Math.min(sourceX, targetX)
    const maxX = Math.max(sourceX, targetX)
    const midX = (sourceX + targetX) / 2

    // Find valid X positions (gaps between forbidden ranges)
    // We search in a wider range: from leftmost obstacle edge to rightmost
    const searchLeft = Math.min(minX, ...mergedRanges.map(r => r.left)) - margin * 2
    const searchRight = Math.max(maxX, ...mergedRanges.map(r => r.right)) + margin * 2

    const validRanges: Array<{ left: number; right: number }> = []

    // Check space before first forbidden range
    if (mergedRanges[0].left > searchLeft) {
        validRanges.push({ left: searchLeft, right: mergedRanges[0].left })
    }

    // Check gaps between forbidden ranges
    for (let i = 0; i < mergedRanges.length - 1; i++) {
        validRanges.push({
            left: mergedRanges[i].right,
            right: mergedRanges[i + 1].left
        })
    }

    // Check space after last forbidden range
    if (mergedRanges[mergedRanges.length - 1].right < searchRight) {
        validRanges.push({ left: mergedRanges[mergedRanges.length - 1].right, right: searchRight })
    }

    // If no valid ranges at all (shouldn't happen), fall back to midpoint
    if (validRanges.length === 0) {
        return midX
    }

    // Find the valid range closest to the midpoint
    let bestX = midX
    let bestDistance = Infinity

    for (const range of validRanges) {
        // Find closest point in this range to the midpoint
        const clampedX = Math.max(range.left, Math.min(range.right, midX))
        const distance = Math.abs(clampedX - midX)

        if (distance < bestDistance) {
            bestDistance = distance
            bestX = clampedX
        }
    }

    return bestX
}

// Check if a horizontal line from x1 to x2 at height y intersects any node
function horizontalLineIntersectsNodes(
    x1: number,
    x2: number,
    y: number,
    nodes: NodeBounds[],
    margin: number = 10
): NodeBounds | null {
    const minX = Math.min(x1, x2)
    const maxX = Math.max(x1, x2)

    for (const node of nodes) {
        const nodeLeft = node.x - margin
        const nodeRight = node.x + node.width + margin
        const nodeTop = node.y - margin
        const nodeBottom = node.y + node.height + margin

        // Check if line passes through node's bounding box
        if (y >= nodeTop && y <= nodeBottom && nodeRight > minX && nodeLeft < maxX) {
            return node
        }
    }
    return null
}

// Find a safe Y position for a horizontal detour around a blocking node
function findSafeHorizontalLane(
    node: NodeBounds,
    sourceY: number,
    targetY: number,
    margin: number = 15
): number {
    const nodeTop = node.y - margin
    const nodeBottom = node.y + node.height + margin

    // Go above or below the node, whichever is closer to our path
    const avgY = (sourceY + targetY) / 2
    const distToTop = Math.abs(avgY - nodeTop)
    const distToBottom = Math.abs(avgY - nodeBottom)

    // Return Y position that avoids the node
    return distToTop < distToBottom ? nodeTop : nodeBottom
}

// Build an SVG path with rounded corners from a sequence of orthogonal points
function buildMultiSegmentPath(
    points: Array<{ x: number; y: number }>,
    borderRadius: number = 8
): string {
    if (points.length < 2) return ''
    if (points.length === 2) {
        return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`
    }

    const segments: string[] = [`M ${points[0].x},${points[0].y}`]

    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1]
        const curr = points[i]
        const next = points[i + 1]

        // Calculate distances to determine max radius
        const distToPrev = Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y)
        const distToNext = Math.abs(next.x - curr.x) + Math.abs(next.y - curr.y)
        const r = Math.min(borderRadius, distToPrev / 2, distToNext / 2)

        if (r < 1) {
            segments.push(`L ${curr.x},${curr.y}`)
            continue
        }

        // Direction from prev to curr
        const dirFromPrev = {
            x: curr.x === prev.x ? 0 : (curr.x > prev.x ? 1 : -1),
            y: curr.y === prev.y ? 0 : (curr.y > prev.y ? 1 : -1)
        }
        // Direction from curr to next
        const dirToNext = {
            x: next.x === curr.x ? 0 : (next.x > curr.x ? 1 : -1),
            y: next.y === curr.y ? 0 : (next.y > curr.y ? 1 : -1)
        }

        // Curve start (approaching the corner)
        const curveStart = {
            x: curr.x - dirFromPrev.x * r,
            y: curr.y - dirFromPrev.y * r
        }
        // Curve end (leaving the corner)
        const curveEnd = {
            x: curr.x + dirToNext.x * r,
            y: curr.y + dirToNext.y * r
        }

        segments.push(`L ${curveStart.x},${curveStart.y}`)
        segments.push(`Q ${curr.x},${curr.y} ${curveEnd.x},${curveEnd.y}`)
    }

    // Final line to last point
    const last = points[points.length - 1]
    segments.push(`L ${last.x},${last.y}`)

    return segments.join(' ')
}

// Build an orthogonal (circuit board style) path through bend points
// Uses quadratic bezier curves for smooth corner rounding at each bend
// bendPoints are the intermediate waypoints computed by elkjs
// obstacleNodes are all nodes to avoid (excluding source/target)
// laneIndex/laneCount are used to spread vertical segments for edges sharing same target
// ALWAYS produces orthogonal (horizontal/vertical) segments, NEVER diagonal
function buildOrthogonalPath(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    borderRadius: number = 24,
    bendPoints?: Array<{ x: number; y: number }>,
    obstacleNodes?: NodeBounds[],
    sourceNodeId?: string,
    targetNodeId?: string,
    laneIndex: number = 0,
    laneCount: number = 1
): string {
    // If no bend points provided (or empty), compute an orthogonal path
    if (!bendPoints || bendPoints.length === 0) {
        // Filter out source and target nodes from obstacles
        const filteredObstacles = obstacleNodes?.filter(
            n => n.id !== sourceNodeId && n.id !== targetNodeId
        ) ?? []

        const verticalDist = Math.abs(targetY - sourceY)
        const horizontalDist = Math.abs(targetX - sourceX)

        // Straight horizontal line when endpoints are at the same Y
        if (verticalDist < 2 && horizontalDist > 1) {
            return `M ${sourceX},${sourceY} L ${targetX},${targetY}`
        }

        // Otherwise use obstacle-aware 3-point routing
        // Find a safe vertical lane that avoids all intermediate nodes
        let midX = findSafeVerticalLane(sourceX, sourceY, targetX, targetY, filteredObstacles)

        // Apply lane offset for edges sharing the same target
        // Higher laneIndex (lower source on screen) = vertical segment closer to target
        // This prevents lines from crossing each other
        if (laneCount > 1) {
            const laneSpacing = 15  // Pixels between adjacent lanes
            const goingRight = targetX > sourceX

            // Calculate offset: laneIndex 0 (topmost source) is furthest from target
            // For left-to-right: smaller laneIndex = more to the left (further from target)
            // For right-to-left: smaller laneIndex = more to the right (further from target)
            const offset = (laneIndex - (laneCount - 1) / 2) * laneSpacing

            if (goingRight) {
                // Going left to right: offset moves lane left (negative) for lower index
                midX = midX + offset
            } else {
                // Going right to left: offset moves lane right (positive) for lower index
                midX = midX - offset
            }
        }

        // Check if horizontal segments would pass through any nodes
        // Segment 1: sourceX to midX at sourceY
        // Segment 2: midX to targetX at targetY
        const blockingNode1 = horizontalLineIntersectsNodes(sourceX, midX, sourceY, filteredObstacles)
        const blockingNode2 = horizontalLineIntersectsNodes(midX, targetX, targetY, filteredObstacles)

        // If first horizontal segment is blocked, we need to go around
        if (blockingNode1) {
            // Route around the blocking node
            // Determine which way to go around (above or below)
            const detourY = findSafeHorizontalLane(blockingNode1, sourceY, targetY)

            // Determine a safe X to start the horizontal run - BEFORE the blocking node
            const nodeLeft = blockingNode1.x - 20
            const nodeRight = blockingNode1.x + blockingNode1.width + 20

            // Which side of the node should we pass on X-axis?
            // If going left-to-right, we need to get past the right side
            // If going right-to-left, we need to get past the left side
            const goingRight = targetX > sourceX

            if (goingRight) {
                // We're going right, so go around the right side of the node
                return buildMultiSegmentPath(
                    [
                        { x: sourceX, y: sourceY },
                        { x: nodeLeft, y: sourceY },      // Go horizontal to just before node
                        { x: nodeLeft, y: detourY },      // Go vertical to detour height
                        { x: nodeRight, y: detourY },     // Go horizontal past the node
                        { x: nodeRight, y: targetY },     // Go vertical to target Y
                        { x: targetX, y: targetY }
                    ],
                    borderRadius
                )
            } else {
                // We're going left, so go around the left side of the node
                return buildMultiSegmentPath(
                    [
                        { x: sourceX, y: sourceY },
                        { x: nodeRight, y: sourceY },     // Go horizontal to just after node
                        { x: nodeRight, y: detourY },     // Go vertical to detour height
                        { x: nodeLeft, y: detourY },      // Go horizontal past the node
                        { x: nodeLeft, y: targetY },      // Go vertical to target Y
                        { x: targetX, y: targetY }
                    ],
                    borderRadius
                )
            }
        }

        // If second horizontal segment is blocked, route around
        if (blockingNode2) {
            const detourY = findSafeHorizontalLane(blockingNode2, sourceY, targetY)
            const nodeLeft = blockingNode2.x - 20
            const nodeRight = blockingNode2.x + blockingNode2.width + 20
            const goingRight = targetX > sourceX

            if (goingRight) {
                return buildMultiSegmentPath(
                    [
                        { x: sourceX, y: sourceY },
                        { x: nodeLeft, y: sourceY },      // Go horizontal to just before node
                        { x: nodeLeft, y: detourY },      // Go vertical to detour height
                        { x: nodeRight, y: detourY },     // Go horizontal past the node
                        { x: nodeRight, y: targetY },     // Go vertical to target Y
                        { x: targetX, y: targetY }
                    ],
                    borderRadius
                )
            } else {
                return buildMultiSegmentPath(
                    [
                        { x: sourceX, y: sourceY },
                        { x: nodeRight, y: sourceY },
                        { x: nodeRight, y: detourY },
                        { x: nodeLeft, y: detourY },
                        { x: nodeLeft, y: targetY },
                        { x: targetX, y: targetY }
                    ],
                    borderRadius
                )
            }
        }

        // Also check if the vertical segment at midX passes through any node
        // This catches nodes that are in the vertical path but weren't caught by horizontal checks
        const blockingVerticalNode = filteredObstacles.find(node => {
            const nodeLeft = node.x - 10
            const nodeRight = node.x + node.width + 10
            const nodeTop = node.y - 10
            const nodeBottom = node.y + node.height + 10
            const minY = Math.min(sourceY, targetY)
            const maxY = Math.max(sourceY, targetY)

            // Check if midX is within node's X range and node overlaps our Y range
            return midX >= nodeLeft && midX <= nodeRight && nodeBottom > minY && nodeTop < maxY
        })

        if (blockingVerticalNode) {
            // Route around this node by going around it horizontally
            const detourY = findSafeHorizontalLane(blockingVerticalNode, sourceY, targetY)
            const nodeLeft = blockingVerticalNode.x - 20
            const nodeRight = blockingVerticalNode.x + blockingVerticalNode.width + 20

            // Choose to go around on the side closer to midX
            const useLeft = Math.abs(nodeLeft - midX) < Math.abs(nodeRight - midX)
            const safeMidX = useLeft ? nodeLeft : nodeRight

            return buildMultiSegmentPath(
                [
                    { x: sourceX, y: sourceY },
                    { x: safeMidX, y: sourceY },
                    { x: safeMidX, y: targetY },
                    { x: targetX, y: targetY }
                ],
                borderRadius
            )
        }

        const r = Math.min(
            borderRadius,
            Math.abs(midX - sourceX) / 2,
            Math.abs(targetX - midX) / 2,
            Math.abs(targetY - sourceY) / 2
        )

        if (r < 1 || Math.abs(targetY - sourceY) < 1) {
            // Horizontal line or too small for rounding
            return `M ${sourceX},${sourceY} L ${midX},${sourceY} L ${midX},${targetY} L ${targetX},${targetY}`
        }

        const dirY = targetY > sourceY ? 1 : -1
        const dirX = targetX > sourceX ? 1 : -1

        return [
            `M ${sourceX},${sourceY}`,
            `L ${midX - r * dirX},${sourceY}`,
            `Q ${midX},${sourceY} ${midX},${sourceY + r * dirY}`,
            `L ${midX},${targetY - r * dirY}`,
            `Q ${midX},${targetY} ${midX + r * dirX},${targetY}`,
            `L ${targetX},${targetY}`
        ].join(' ')
    }

    // Build full point sequence: source -> bend points -> target
    const points = [
        { x: sourceX, y: sourceY },
        ...bendPoints,
        { x: targetX, y: targetY }
    ]

    // Build path with rounded corners at each bend point
    const segments: string[] = [`M ${points[0].x},${points[0].y}`]

    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1]
        const curr = points[i]
        const next = points[i + 1]

        // Calculate distances to determine max radius
        const distToPrev = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2)
        const distToNext = Math.sqrt((next.x - curr.x) ** 2 + (next.y - curr.y) ** 2)
        const maxRadius = Math.min(borderRadius, distToPrev / 2, distToNext / 2)

        if (maxRadius < 1) {
            // Too close for rounding, just draw straight lines
            segments.push(`L ${curr.x},${curr.y}`)
            continue
        }

        // Direction vectors
        const dirFromPrev = {
            x: curr.x - prev.x === 0 ? 0 : (curr.x - prev.x) / Math.abs(curr.x - prev.x),
            y: curr.y - prev.y === 0 ? 0 : (curr.y - prev.y) / Math.abs(curr.y - prev.y)
        }
        const dirToNext = {
            x: next.x - curr.x === 0 ? 0 : (next.x - curr.x) / Math.abs(next.x - curr.x),
            y: next.y - curr.y === 0 ? 0 : (next.y - curr.y) / Math.abs(next.y - curr.y)
        }

        // Start point of curve (offset from corner towards prev)
        const curveStart = {
            x: curr.x - dirFromPrev.x * maxRadius,
            y: curr.y - dirFromPrev.y * maxRadius
        }

        // End point of curve (offset from corner towards next)
        const curveEnd = {
            x: curr.x + dirToNext.x * maxRadius,
            y: curr.y + dirToNext.y * maxRadius
        }

        // Line to curve start, then quadratic bezier around the corner
        segments.push(`L ${curveStart.x},${curveStart.y}`)
        segments.push(`Q ${curr.x},${curr.y} ${curveEnd.x},${curveEnd.y}`)
    }

    // Final line to target
    const lastPoint = points[points.length - 1]
    segments.push(`L ${lastPoint.x},${lastPoint.y}`)

    return segments.join(' ')
}

// Compute SVG path between two points using specified path type
// Returns computed path with SVG string and label coordinates
// allNodes is used by orthogonal paths to avoid node intersections
export function computePath(
    pathType: PathType,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    sourcePosition: AnchorPosition,
    targetPosition: AnchorPosition,
    curvature: number = 0.25,
    borderRadius: number = 8,
    bendPoints?: Array<{ x: number; y: number }>,
    allNodes?: Map<string, NodeConfig>,
    sourceNodeId?: string,
    targetNodeId?: string,
    laneIndex: number = 0,
    laneCount: number = 1
): ComputedPath {
    switch (pathType) {
        case 'bezier': {
            const [path, labelX, labelY, offsetX, offsetY] = getBezierPath({
                sourceX,
                sourceY,
                sourcePosition: toXYFlowPosition(sourcePosition),
                targetX,
                targetY,
                targetPosition: toXYFlowPosition(targetPosition),
                curvature
            })
            return { path, labelX, labelY, offsetX, offsetY }
        }

        case 'straight': {
            const [path, labelX, labelY, offsetX, offsetY] = getStraightPath({
                sourceX,
                sourceY,
                targetX,
                targetY
            })
            return { path, labelX, labelY, offsetX, offsetY }
        }

        case 'smoothstep': {
            const [path, labelX, labelY, offsetX, offsetY] = getSmoothStepPath({
                sourceX,
                sourceY,
                sourcePosition: toXYFlowPosition(sourcePosition),
                targetX,
                targetY,
                targetPosition: toXYFlowPosition(targetPosition),
                borderRadius: 8,  // Default border radius
                offset: 20        // Default orthogonal offset
            })
            return { path, labelX, labelY, offsetX, offsetY }
        }

        case 'horizontal-bezier': {
            const path = buildHorizontalBezierPath(sourceX, sourceY, targetX, targetY)
            // For custom paths, compute label position as midpoint
            const labelX = (sourceX + targetX) / 2
            const labelY = (sourceY + targetY) / 2
            const offsetX = Math.abs(labelX - sourceX)
            const offsetY = Math.abs(labelY - sourceY)
            return { path, labelX, labelY, offsetX, offsetY }
        }

        case 'orthogonal': {
            // Convert nodes Map to array of bounds for obstacle avoidance
            const obstacleNodes: NodeBounds[] = allNodes
                ? Array.from(allNodes.values()).map(n => ({
                    id: n.id,
                    x: n.x,
                    y: n.y,
                    width: n.width,
                    height: n.height
                }))
                : []

            const path = buildOrthogonalPath(
                sourceX, sourceY, targetX, targetY,
                borderRadius, bendPoints,
                obstacleNodes, sourceNodeId, targetNodeId,
                laneIndex, laneCount
            )
            // For orthogonal paths, compute label position as midpoint
            const labelX = (sourceX + targetX) / 2
            const labelY = (sourceY + targetY) / 2
            const offsetX = Math.abs(labelX - sourceX)
            const offsetY = Math.abs(labelY - sourceY)
            return { path, labelX, labelY, offsetX, offsetY }
        }

        default:
            // Fallback to straight path
            const [path, labelX, labelY, offsetX, offsetY] = getStraightPath({
                sourceX,
                sourceY,
                targetX,
                targetY
            })
            return { path, labelX, labelY, offsetX, offsetY }
    }
}

// Compute label position for a path (center point)
// Useful for placing text or icons along edges
export function computeLabelPosition(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number
): { x: number; y: number } {
    return {
        x: (sourceX + targetX) / 2,
        y: (sourceY + targetY) / 2
    }
}

// Adjust coordinates with offset
export function applyOffset(
    x: number,
    y: number,
    offset?: { x?: number; y?: number }
): { x: number; y: number } {
    return {
        x: x + (offset?.x ?? 0),
        y: y + (offset?.y ?? 0)
    }
}
