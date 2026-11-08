// Simple node bounds type for path obstacle avoidance
export type NodeBounds = {
    id: string
    x: number
    y: number
    width: number
    height: number
}

export type OrthogonalPoint = {
    x: number
    y: number
}

export const orthogonalRouteBlockers = (
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
