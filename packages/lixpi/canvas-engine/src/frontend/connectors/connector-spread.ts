import {
    type CanvasGeometryNode,
} from '../../shared/index.ts'

export type SpreadEdge = {
    edgeId: string
    sourceNodeId: string
    targetNodeId: string
    sourceHandle?: string
    targetHandle?: string
    sourceT?: number
    targetT?: number
}
export type ConnectorSpreadOptions<Node> = {
    isCentered: (node: Node | undefined) => boolean
    minSlideHeight: number
    edgeMargin: number
}

// Compute spread-out t values for edges that share the same node+side
// This prevents multiple edges from converging to the exact same point
// Edges are ordered by the OTHER node's Y position to prevent line crossings
// (higher source Y = lower t on target, so lines don't cross)
// Also computes lane indices for vertical segment ordering
export type SpreadResult = {
    sourceT: number
    targetT: number
    laneIndex: number // Index within edges sharing same target (0 = topmost source)
    laneCount: number // Total edges sharing same target
    sourceY: number // Source node center Y for lane calculation
}

export const computeConnectorSpread = <Node extends CanvasGeometryNode>(
    edges: readonly SpreadEdge[],
    nodes: readonly Node[],
    options: ConnectorSpreadOptions<Node>,
): Map<string, SpreadResult> => {
    const result = new Map<string, SpreadResult>()
    const nodeMap = new Map(
        nodes.map(n => [n.nodeId, n]),
    )

    // Group edges by source node+side
    const sourceGroups = new Map<string, SpreadEdge[]>()
    // Group edges by target node+side
    const targetGroups = new Map<string, SpreadEdge[]>()

    for (const edge of edges) {
        const sourceKey = `${edge.sourceNodeId}:${edge.sourceHandle ?? 'right'}`
        const targetKey = `${edge.targetNodeId}:${edge.targetHandle ?? 'left'}`

        if (!sourceGroups.has(sourceKey))
            sourceGroups.set(sourceKey, [])

        if (!targetGroups.has(targetKey))
            targetGroups.set(targetKey, [])

        sourceGroups.get(sourceKey)!.push(edge)
        targetGroups.get(targetKey)!.push(edge)

        const sourceNode = nodeMap.get(edge.sourceNodeId)
        const targetNode = nodeMap.get(edge.targetNodeId)
        const sourceY = sourceNode ? sourceNode.position.y + sourceNode.dimensions.height / 2 : 0

        // Default to stored T or 0.5
        const sourceT = options.isCentered(sourceNode) ? 0.5 : (edge.sourceT ?? 0.5)
        let targetT = options.isCentered(targetNode) ? 0.5 : (edge.targetT ?? 0.5)

        // Dynamic auto-align: If source Y hits the target node, FORCE straight line alignment
        // This ensures that even during dragging or node moving, the line attempts to stay straight
        // For off-axis nodes, we clamp to the nearest corner (top/bottom) instead of snapping to center
        if (
            sourceNode
            && targetNode
            && !options.isCentered(targetNode)
        ) {
            const targetHeight = targetNode.dimensions.height

            // When the target is shorter than the minimum slide height, snap to center
            if (
                targetHeight <= 0
                || targetHeight < options.minSlideHeight
            )
                targetT = 0.5
            else {
                const targetTop = targetNode.position.y

                // Calculate ideal straight-line projection
                const idealT = (sourceY - targetTop) / targetHeight

                // Clamp to be within the node side (0-1), leaving a configurable margin
                // effectively snapping to the top or bottom corner if the source is outside vertical bounds
                const m = options.edgeMargin
                targetT = Math.max(
                    m,
                    Math.min(1 - m, idealT),
                )
            }
        }

        // Initialize with values
        result.set(
            edge.edgeId,
            {
                sourceT,
                targetT,
                laneIndex: 0,
                laneCount: 1,
                sourceY,
            },
        )
    }

    // Spread source t values for edges sharing the same source node+side
    // Sort by TARGET node's Y position so lines don't cross
    for (const [, group] of sourceGroups) {
        if (group.length <= 1)
            continue

        if (options.isCentered(
            nodeMap.get(group[0]?.sourceNodeId),
        ))
            continue

        // Sort by target node Y position (smaller Y = higher on screen = smaller t)
        group.sort((a, b) => {
            const aTarget = nodeMap.get(a.targetNodeId)
            const bTarget = nodeMap.get(b.targetNodeId)
            const aY = aTarget ? aTarget.position.y + aTarget.dimensions.height / 2 : 0
            const bY = bTarget ? bTarget.position.y + bTarget.dimensions.height / 2 : 0

            return aY - bY
        })

        // Spread evenly between 0.35 and 0.65 (subtle spread near center)
        const count = group.length
        const margin = 0.35
        const range = 1 - 2 * margin
        const step = count > 1 ? range / (count - 1) : 0

        for (let i = 0; i < group.length; i++) {
            const edge = group[i]
            const values = result.get(edge.edgeId)!
            values.sourceT = count === 1 ? 0.5 : margin + i * step
        }
    }

    // Spread target t values for edges sharing the same target node+side
    // Sort by SOURCE node's Y position so lines don't cross
    // Also assign lane indices for vertical segment ordering
    for (const [, group] of targetGroups) {
        if (group.length <= 1)
            continue

        // Sort by source node Y position (smaller Y = higher on screen = smaller t)
        group.sort((a, b) => {
            const aSource = nodeMap.get(a.sourceNodeId)
            const bSource = nodeMap.get(b.sourceNodeId)
            const aY = aSource ? aSource.position.y + aSource.dimensions.height / 2 : 0
            const bY = bSource ? bSource.position.y + bSource.dimensions.height / 2 : 0

            return aY - bY
        })

        // Assign lane indices
        // We DO NOT override targetT here anymore. We prioritize standard straight lines.
        // If lines overlap, laneIndex will separate their vertical segments.
        const count = group.length

        for (let i = 0; i < group.length; i++) {
            const edge = group[i]
            const values = result.get(edge.edgeId)!
            values.laneIndex = i
            values.laneCount = count
        }
    }

    return result
}
