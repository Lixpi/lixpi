import {
    isOrthogonalRouteClear,
    type NodeBounds,
    type OrthogonalPoint,
} from './route-clearance.ts'
import { isOrthogonalRouteSimple } from './route-simplicity.ts'

type DirectedRouteOptions = {
    source: OrthogonalPoint
    target: OrthogonalPoint
    sourceLead: OrthogonalPoint
    targetLead: OrthogonalPoint
    sourceVertical: boolean
    targetVertical: boolean
    obstacles: NodeBounds[]
    bridgeObstacles: NodeBounds[]
    laneOffset: number
}

// Keep the endpoint escapes while finding a bridge that cannot cross or retrace them.
export const findSimpleDirectedRoute = (options: DirectedRouteOptions): OrthogonalPoint[] | null => {
    const {
        source,
        target,
        sourceLead: start,
        targetLead: end,
        sourceVertical,
        targetVertical,
        obstacles,
        bridgeObstacles,
        laneOffset,
    } = options
    let left = Math.min(
        source.x,
        target.x,
        start.x,
        end.x,
    )
    let right = Math.max(
        source.x,
        target.x,
        start.x,
        end.x,
    )
    let top = Math.min(
        source.y,
        target.y,
        start.y,
        end.y,
    )
    let bottom = Math.max(
        source.y,
        target.y,
        start.y,
        end.y,
    )

    for (const node of bridgeObstacles) {
        left = Math.min(left, node.x)
        right = Math.max(right, node.x + node.width)
        top = Math.min(top, node.y)
        bottom = Math.max(bottom, node.y + node.height)
    }

    left -= 30
    right += 30
    top -= 30
    bottom += 30
    const xs = [...new Set([
        (start.x + end.x) / 2 + laneOffset,
        end.x,
        start.x,
        left,
        right,
    ])]
    const ys = [...new Set([
        (start.y + end.y) / 2 + laneOffset,
        end.y,
        start.y,
        top,
        bottom,
    ])]
    const candidates: OrthogonalPoint[][] = []

    if (
        sourceVertical
        && targetVertical
    ) for (const x of xs)
        candidates.push([start, {
            x,
            y: start.y,
        }, {
            x,
            y: end.y,
        }, end])
    else if (
        !sourceVertical
        && !targetVertical
    ) for (const y of ys)
        candidates.push([start, {
            x: start.x,
            y,
        }, {
            x: end.x,
            y,
        }, end])
    else
        for (const x of xs)
            for (const y of ys)
                candidates.push(
                    sourceVertical
                        ? [start, {
                            x,
                            y: start.y,
                        }, {
                            x,
                            y,
                        }, {
                            x: end.x,
                            y,
                        }, end]
                        : [start, {
                            x: start.x,
                            y,
                        }, {
                            x,
                            y,
                        }, {
                            x,
                            y: end.y,
                        }, end],
                )

    for (const bridge of candidates) {
        const route = [source, ...bridge, target]

        if (
            isOrthogonalRouteSimple(route)
            && isOrthogonalRouteClear(bridge, bridgeObstacles)
            && isOrthogonalRouteClear(route, obstacles)
        )
            return route
    }

    return null
}
