// Pure connector geometry, including obstacle-aware orthogonal routing.

import {
    getBezierPath,
    getStraightPath,
    getSmoothStepPath,
} from './standard.ts'
import {
    type PathType,
    type ComputedPath,
    type AnchorPosition,
    type NodeConfig,
} from '../path-types.ts'

// Simple node bounds type for path obstacle avoidance
type NodeBounds = {
    id: string
    x: number
    y: number
    width: number
    height: number
}

type OrthogonalPoint = {
    x: number
    y: number
}

const orthogonalRouteBlockers = (
    points: readonly OrthogonalPoint[],
    nodes: readonly NodeBounds[],
    margin: number,
): NodeBounds[] =>
    nodes.filter(
        node => points.slice(1).some((end, index) => {
            const start = points[index]
            const left = node.x - margin
            const right = node.x + node.width + margin
            const top = node.y - margin
            const bottom = node.y + node.height + margin

            return start.y === end.y
                ? start.y >= top
                    && start.y <= bottom
                    && Math.max(start.x, end.x) > left
                    && Math.min(start.x, end.x) < right
                : start.x >= left
                    && start.x <= right
                    && Math.max(start.y, end.y) > top
                    && Math.min(start.y, end.y) < bottom
        }),
    )

// Layout-computed routes and automatic detours share the same clearance test.
export const isOrthogonalRouteClear = (
    points: readonly OrthogonalPoint[],
    nodes: readonly NodeBounds[],
    margin: number = 10,
): boolean =>
    points.every(
        (point, index) =>
            Number.isFinite(point.x) && Number.isFinite(point.y) && (!index || point.x === points[index - 1].x || point.y === points[index - 1].y),
    )
        && orthogonalRouteBlockers(
            points,
            nodes,
            margin,
        ).length === 0

export class OrthogonalRoutingError extends Error {
    constructor(readonly edgeId?: string) {
        super(`Orthogonal connector${edgeId ? ` ${edgeId}` : ''} cannot clear obstacles with local detours`)
        this.name = 'OrthogonalRoutingError'
    }
}

const toPathDirection = (position: AnchorPosition) => (position === 'center' ? 'bottom' : position)

// Build a horizontal symmetric S-curve bezier path
// Leaves horizontally from source, transitions in the middle, arrives horizontally at target
// This is the custom path type used in contextSelector for smooth horizontal flows
const buildHorizontalBezierPath = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
): string => {
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
const findSafeVerticalLane = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    obstacleNodes: NodeBounds[],
    margin: number = 15,
): number => {
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
    const forbiddenRanges: Array<{
        left: number
        right: number
    }> = []

    for (const node of nodesInYRange) {
        forbiddenRanges.push({
            left: node.x - margin,
            right: node.x + node.width + margin,
        })
    }

    // Merge overlapping forbidden ranges
    forbiddenRanges.sort((a, b) => a.left - b.left)
    const mergedRanges: Array<{
        left: number
        right: number
    }> = []

    for (const range of forbiddenRanges) {
        if (mergedRanges.length === 0)
            mergedRanges.push(range)
        else {
            const last = mergedRanges.at(-1)!

            if (range.left <= last.right) {
                // Overlapping, merge
                last.right = Math.max(last.right, range.right)
            } else
                mergedRanges.push(range)
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

    const validRanges: Array<{
        left: number
        right: number
    }> = []

    // Check space before first forbidden range
    if (mergedRanges[0].left > searchLeft)
        validRanges.push({
            left: searchLeft,
            right: mergedRanges[0].left,
        })

    // Check gaps between forbidden ranges
    for (let i = 0; i < mergedRanges.length - 1; i++) {
        validRanges.push({
            left: mergedRanges[i].right,
            right: mergedRanges[i + 1].left,
        })
    }

    // Check space after last forbidden range
    const lastMergedRange = mergedRanges.at(-1)!

    if (lastMergedRange.right < searchRight)
        validRanges.push({
            left: lastMergedRange.right,
            right: searchRight,
        })

    // If no valid ranges at all (shouldn't happen), fall back to midpoint
    if (validRanges.length === 0)
        return midX

    // Find the valid range closest to the midpoint
    let bestX = midX
    let bestDistance = Infinity

    for (const range of validRanges) {
        // Find closest point in this range to the midpoint
        const clampedX = Math.max(
            range.left,
            Math.min(range.right, midX),
        )
        const distance = Math.abs(clampedX - midX)

        if (distance < bestDistance) {
            bestDistance = distance
            bestX = clampedX
        }
    }

    return bestX
}

// Find a safe Y position for a horizontal detour around a blocking node
const findSafeHorizontalLane = (
    node: NodeBounds,
    sourceY: number,
    targetY: number,
    margin: number = 15,
): number => {
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
const buildMultiSegmentPath = (
    input: OrthogonalPoint[],
    borderRadius: number = 8,
): string => {
    const points = input.filter((point, index) => !index || point.x !== input[index - 1].x || point.y !== input[index - 1].y).filter(
        (
            point,
            index,
            all,
        ) => !index || index === all.length - 1 || !(
                (point.x === all[index - 1].x && point.x === all[index + 1].x
                    || point.y === all[index - 1].y && point.y === all[index + 1].y)
                && (point.x - all[index - 1].x) * (all[index + 1].x - point.x) + (point.y - all[index - 1].y) * (all[index + 1].y - point.y) >= 0
            ),
    )

    if (points.length < 2)
        return ''

    if (points.length === 2)
        return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`

    const segments: string[] = [`M ${points[0].x},${points[0].y}`]

    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1]
        const curr = points[i]
        const next = points[i + 1]

        // Calculate distances to determine max radius
        const distToPrev = Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y)
        const distToNext = Math.abs(next.x - curr.x) + Math.abs(next.y - curr.y)
        const r = Math.min(
            borderRadius,
            distToPrev / 2,
            distToNext / 2,
        )

        if (r < 1) {
            segments.push(`L ${curr.x},${curr.y}`)

            continue
        }

        // Direction from prev to curr
        const dirFromPrev = {
            x: curr.x === prev.x
                ? 0
                : curr.x > prev.x
                    ? 1
                    : -1,
            y: curr.y === prev.y
                ? 0
                : curr.y > prev.y
                    ? 1
                    : -1,
        }
        // Direction from curr to next
        const dirToNext = {
            x: next.x === curr.x
                ? 0
                : next.x > curr.x
                    ? 1
                    : -1,
            y: next.y === curr.y
                ? 0
                : next.y > curr.y
                    ? 1
                    : -1,
        }

        // Curve start (approaching the corner)
        const curveStart = {
            x: curr.x - dirFromPrev.x * r,
            y: curr.y - dirFromPrev.y * r,
        }
        // Curve end (leaving the corner)
        const curveEnd = {
            x: curr.x + dirToNext.x * r,
            y: curr.y + dirToNext.y * r,
        }

        segments.push(`L ${curveStart.x},${curveStart.y}`)
        segments.push(`Q ${curr.x},${curr.y} ${curveEnd.x},${curveEnd.y}`)
    }

    // Final line to last point
    const last = points.at(-1)!
    segments.push(`L ${last.x},${last.y}`)

    return segments.join(' ')
}

// A local detour can clear its first blocker and enter another node on a
// later leg. Check the complete candidate before painting it, then absorb
// newly encountered blockers into the same detour envelope.
const buildObstacleDetourPoints = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    firstBlocker: NodeBounds,
    obstacleNodes: NodeBounds[],
): OrthogonalPoint[] => {
    const absorbedIds = new Set([firstBlocker.id])
    let envelope = { ...firstBlocker }
    const goingRight = targetX > sourceX
    const intersections = (points: OrthogonalPoint[]): NodeBounds[] => orthogonalRouteBlockers(
        points,
        obstacleNodes,
        10,
    )

    // Every unsuccessful pass must absorb at least one new obstacle.
    for (let attempt = 0; attempt <= obstacleNodes.length; attempt++) {
        const preferredY = findSafeHorizontalLane(
            envelope,
            sourceY,
            targetY,
        )
        const alternateY = preferredY === envelope.y - 15
            ? envelope.y + envelope.height + 15
            : envelope.y - 15
        const beforeX = goingRight ? envelope.x - 20 : envelope.x + envelope.width + 20
        const afterX = goingRight ? envelope.x + envelope.width + 20 : envelope.x - 20
        let newlyBlocked: NodeBounds[] = []

        for (const detourY of [preferredY, alternateY]) {
            const points = [
                {
                    x: sourceX,
                    y: sourceY,
                },
                {
                    x: beforeX,
                    y: sourceY,
                },
                {
                    x: beforeX,
                    y: detourY,
                },
                {
                    x: afterX,
                    y: detourY,
                },
                {
                    x: afterX,
                    y: targetY,
                },
                {
                    x: targetX,
                    y: targetY,
                },
            ]
            const blocked = intersections(points)

            if (blocked.length === 0)
                return points

            if (newlyBlocked.length === 0)
                newlyBlocked = blocked.filter(node => !absorbedIds.has(node.id))
        }

        if (newlyBlocked.length === 0)
            break

        const left = Math.min(envelope.x, ...newlyBlocked.map(node => node.x))
        const top = Math.min(envelope.y, ...newlyBlocked.map(node => node.y))
        const right = Math.max(envelope.x + envelope.width, ...newlyBlocked.map(node => node.x + node.width))
        const bottom = Math.max(envelope.y + envelope.height, ...newlyBlocked.map(node => node.y + node.height))
        envelope = {
            ...envelope,
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }

        for (const node of newlyBlocked)
            absorbedIds.add(node.id)
    }

    throw new OrthogonalRoutingError()
}

// Automatic routing solves along the endpoint axis. Vertical ports use the
// same obstacle solver with transposed geometry, so their leads stay vertical.
const buildOrthogonalPoints = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    obstacleNodes: NodeBounds[],
    laneIndex: number,
    laneCount: number,
): OrthogonalPoint[] => {
    const source = {
        x: sourceX,
        y: sourceY,
    }
    const target = {
        x: targetX,
        y: targetY,
    }

    if (
        Math.abs(targetY - sourceY) < 2
        && Math.abs(targetX - sourceX) > 1
        && isOrthogonalRouteClear([source, target], obstacleNodes)
    )
        return [source, target]

    let midX = findSafeVerticalLane(
        sourceX,
        sourceY,
        targetX,
        targetY,
        obstacleNodes,
    )

    if (laneCount > 1) {
        const offset = (laneIndex - (laneCount - 1) / 2) * 15
        midX += targetX > sourceX ? offset : -offset
    }

    const points = [
        source,
        {
            x: midX,
            y: sourceY,
        },
        {
            x: midX,
            y: targetY,
        },
        target,
    ]
    const blocker = orthogonalRouteBlockers(
        points,
        obstacleNodes,
        10,
    )[0]

    return blocker
        ? buildObstacleDetourPoints(
            sourceX,
            sourceY,
            targetX,
            targetY,
            blocker,
            obstacleNodes,
        )
        : points
}

const buildOrthogonalPath = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    sourcePosition: AnchorPosition,
    targetPosition: AnchorPosition,
    borderRadius: number,
    bendPoints: OrthogonalPoint[] | undefined,
    obstacleNodes: NodeBounds[],
    sourceNodeId: string | undefined,
    targetNodeId: string | undefined,
    laneIndex: number,
    laneCount: number,
): string => {
    const obstacles = obstacleNodes.filter(node => node.id !== sourceNodeId && node.id !== targetNodeId)

    if (bendPoints?.length) {
        const points = [
            {
                x: sourceX,
                y: sourceY,
            },
            ...bendPoints,
            {
                x: targetX,
                y: targetY,
            },
        ]

        if (!isOrthogonalRouteClear(points, obstacles))
            throw new OrthogonalRoutingError()

        return buildMultiSegmentPath(points, borderRadius)
    }

    const sourceVertical = sourcePosition === 'top' || sourcePosition === 'bottom'
    const targetVertical = targetPosition === 'top' || targetPosition === 'bottom'
    const vertical = sourceVertical && targetVertical
    const direct = [
        {
            x: sourceX,
            y: sourceY,
        },
        sourceVertical ? {
            x: sourceX,
            y: targetY,
        } : {
            x: targetX,
            y: sourceY,
        },
        {
            x: targetX,
            y: targetY,
        },
    ]
    const points = sourceVertical !== targetVertical
        && isOrthogonalRouteClear(direct, obstacles)
        ? direct
        : vertical
            ? buildOrthogonalPoints(
                sourceY,
                sourceX,
                targetY,
                targetX,
                obstacles.map(
                    node => ({
                        ...node,
                        x: node.y,
                        y: node.x,
                        width: node.height,
                        height: node.width,
                    }),
                ),
                laneIndex,
                laneCount,
            ).map(
                point => ({
                    x: point.y,
                    y: point.x,
                }),
            )
            : buildOrthogonalPoints(
                sourceX,
                sourceY,
                targetX,
                targetY,
                obstacles,
                laneIndex,
                laneCount,
            )

    const outward = (
        endpoint: OrthogonalPoint,
        adjacent: OrthogonalPoint | undefined,
        position: AnchorPosition,
    ): boolean => {
        if (!adjacent)
            return false

        switch (position) {
            case 'top':
                return adjacent.x === endpoint.x && adjacent.y < endpoint.y
            case 'bottom':
                return adjacent.x === endpoint.x && adjacent.y > endpoint.y
            case 'left':
                return adjacent.y === endpoint.y && adjacent.x < endpoint.x
            case 'right':
                return adjacent.y === endpoint.y && adjacent.x > endpoint.x
            default:
                return true
        }
    }
    const first = points[0]
    const last = points.at(-1)!
    const firstLead = points.find(point => point.x !== first.x || point.y !== first.y)
    const lastLead = points.toReversed().find(point => point.x !== last.x || point.y !== last.y)

    if (
        outward(
            first,
            firstLead,
            sourcePosition,
        )
        && outward(
            last,
            lastLead,
            targetPosition,
        )
    )
        return buildMultiSegmentPath(points, borderRadius)

    // Backward, equal-side or obstructed mixed ports need outward leads before
    // crossing to the other endpoint. Reuse the same obstacle solver between
    // those leads, now including endpoint bodies as intermediate obstacles.
    const leadLength = Math.max(20, borderRadius)
    const lead = (
        point: OrthogonalPoint,
        position: AnchorPosition,
    ): OrthogonalPoint => ({
        x: point.x + (position === 'left'
            ? -leadLength
            : position === 'right'
                ? leadLength
                : 0),
        y: point.y + (position === 'top'
            ? -leadLength
            : position === 'bottom'
                ? leadLength
                : 0),
    })
    const sourceLead = lead(first, sourcePosition)
    const targetLead = lead(last, targetPosition)
    const bridge = sourceVertical
        ? buildOrthogonalPoints(
            sourceLead.x,
            sourceLead.y,
            targetLead.x,
            targetLead.y,
            obstacleNodes,
            laneIndex,
            laneCount,
        )
        : buildOrthogonalPoints(
            sourceLead.y,
            sourceLead.x,
            targetLead.y,
            targetLead.x,
            obstacleNodes.map(
                node => ({
                    ...node,
                    x: node.y,
                    y: node.x,
                    width: node.height,
                    height: node.width,
                }),
            ),
            laneIndex,
            laneCount,
        ).map(
            point => ({
                x: point.y,
                y: point.x,
            }),
        )
    const directed = [first, ...bridge, last]

    if (!isOrthogonalRouteClear(directed, obstacles))
        throw new OrthogonalRoutingError()

    return buildMultiSegmentPath(directed, borderRadius)
}

// Compute SVG path between two points using specified path type
// Returns computed path with SVG string and label coordinates
// allNodes is used by orthogonal paths to avoid node intersections
export const computePath = (
    pathType: PathType,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    sourcePosition: AnchorPosition,
    targetPosition: AnchorPosition,
    curvature: number = 0.25,
    borderRadius: number = 8,
    bendPoints?: Array<{
        x: number
        y: number
    }>,
    allNodes?: Map<string, NodeConfig>,
    sourceNodeId?: string,
    targetNodeId?: string,
    laneIndex: number = 0,
    laneCount: number = 1,
): ComputedPath => {
    switch (pathType) {
        case 'bezier': {
            const [path, labelX, labelY, offsetX, offsetY] = getBezierPath({
                sourceX,
                sourceY,
                sourcePosition: toPathDirection(sourcePosition),
                targetX,
                targetY,
                targetPosition: toPathDirection(targetPosition),
                curvature,
            })

            return {
                path,
                labelX,
                labelY,
                offsetX,
                offsetY,
            }
        }
        case 'straight': {
            const [path, labelX, labelY, offsetX, offsetY] = getStraightPath({
                sourceX,
                sourceY,
                targetX,
                targetY,
            })

            return {
                path,
                labelX,
                labelY,
                offsetX,
                offsetY,
            }
        }
        case 'smoothstep': {
            const [path, labelX, labelY, offsetX, offsetY] = getSmoothStepPath({
                sourceX,
                sourceY,
                sourcePosition: toPathDirection(sourcePosition),
                targetX,
                targetY,
                targetPosition: toPathDirection(targetPosition),
                borderRadius: 8, // Default border radius
                offset: 20, // Default orthogonal offset
            })

            return {
                path,
                labelX,
                labelY,
                offsetX,
                offsetY,
            }
        }
        case 'horizontal-bezier': {
            const path = buildHorizontalBezierPath(
                sourceX,
                sourceY,
                targetX,
                targetY,
            )
            // For custom paths, compute label position as midpoint
            const labelX = (sourceX + targetX) / 2
            const labelY = (sourceY + targetY) / 2
            const offsetX = Math.abs(labelX - sourceX)
            const offsetY = Math.abs(labelY - sourceY)

            return {
                path,
                labelX,
                labelY,
                offsetX,
                offsetY,
            }
        }
        case 'orthogonal': {
            // Convert nodes Map to array of bounds for obstacle avoidance
            const obstacleNodes: NodeBounds[] = allNodes
                ? Array.from(
                    allNodes.values(),
                ).map(
                    n => ({
                        id: n.id,
                        x: n.x,
                        y: n.y,
                        width: n.width,
                        height: n.height,
                    }),
                )
                : []

            const path = buildOrthogonalPath(
                sourceX,
                sourceY,
                targetX,
                targetY,
                sourcePosition,
                targetPosition,
                borderRadius,
                bendPoints,
                obstacleNodes,
                sourceNodeId,
                targetNodeId,
                laneIndex,
                laneCount,
            )
            // For orthogonal paths, compute label position as midpoint
            const labelX = (sourceX + targetX) / 2
            const labelY = (sourceY + targetY) / 2
            const offsetX = Math.abs(labelX - sourceX)
            const offsetY = Math.abs(labelY - sourceY)

            return {
                path,
                labelX,
                labelY,
                offsetX,
                offsetY,
            }
        }
        default:
            // Fallback to straight path
            const [path, labelX, labelY, offsetX, offsetY] = getStraightPath({
                sourceX,
                sourceY,
                targetX,
                targetY,
            })

            return {
                path,
                labelX,
                labelY,
                offsetX,
                offsetY,
            }
    }
}

// Compute label position for a path (center point)
// Useful for placing text or icons along edges
export const computeLabelPosition = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
): {
    x: number
    y: number
} => {
    return {
        x: (sourceX + targetX) / 2,
        y: (sourceY + targetY) / 2,
    }
}

// Adjust coordinates with offset
export const applyOffset = (
    x: number,
    y: number,
    offset?: {
        x?: number
        y?: number
    },
): {
    x: number
    y: number
} => {
    return {
        x: x + (offset?.x ?? 0),
        y: y + (offset?.y ?? 0),
    }
}
