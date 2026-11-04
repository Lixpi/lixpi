import { isOrthogonalRouteClear } from './index.ts'
import {
    type CanvasEnginePoint,
} from '../../geometry/types.ts'

// Adjacent segments may meet, but a route must not retrace a leg or return to
// an earlier segment. This also rejects two endpoint escapes sharing a rail.
export const isOrthogonalRouteSimple = (points: readonly CanvasEnginePoint[]): boolean => {
    if (!isOrthogonalRouteClear(points, []))
        return false

    const distinct = points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y)

    for (let index = 1; index < distinct.length; index++) {
        const start = distinct[index - 1]
        const end = distinct[index]
        const next = distinct[index + 1]

        if (
            next
            && (end.x - start.x) * (next.x - end.x) + (end.y - start.y) * (next.y - end.y) < 0
        )
            return false

        const earlier = distinct.slice(1, index - 1).map(
            (point, segment) => ({
                id: `${segment}`,
                x: Math.min(distinct[segment].x, point.x),
                y: Math.min(distinct[segment].y, point.y),
                width: Math.abs(distinct[segment].x - point.x),
                height: Math.abs(distinct[segment].y - point.y),
            }),
        )

        if (!isOrthogonalRouteClear(
            [start, end],
            earlier,
            0.000001,
        ))
            return false
    }

    return distinct.length > 1
}
