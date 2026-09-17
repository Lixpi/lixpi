import {
    type PortDirection,
} from '../geometry-types.ts'
import { smoothStepPoints } from './smoothstep.ts'
import { roundedBend } from './rounding.ts'

export type StandardPathOptions = {
    sourceX: number
    sourceY: number
    targetX: number
    targetY: number
    sourcePosition?: PortDirection
    targetPosition?: PortDirection
    curvature?: number
    borderRadius?: number
    offset?: number
}
export type PathResult = [string, number, number, number, number]

export const getStraightPath = (options: StandardPathOptions): PathResult => {
    const {
        sourceX,
        sourceY,
        targetX,
        targetY,
    } = options
    const x = (sourceX + targetX) / 2
    const y = (sourceY + targetY) / 2

    return [`M ${sourceX},${sourceY}L ${targetX},${targetY}`, x, y, Math.abs(x - sourceX), Math.abs(y - sourceY)]
}

const controlOffset = (
    distance: number,
    curvature: number,
): number => (distance >= 0 ? distance / 2 : curvature * 25 * Math.sqrt(-distance))

const control = (
    side: PortDirection,
    x: number,
    y: number,
    otherX: number,
    otherY: number,
    curvature: number,
): [number, number] => {
    switch (side) {
        case 'left':
            return [x - controlOffset(x - otherX, curvature), y]
        case 'right':
            return [x + controlOffset(otherX - x, curvature), y]
        case 'top':
            return [x, y - controlOffset(y - otherY, curvature)]
        case 'bottom':
            return [x, y + controlOffset(otherY - y, curvature)]
    }
}

export const getBezierPath = (options: StandardPathOptions): PathResult => {
    const {
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition = 'bottom',
        targetPosition = 'top',
        curvature = 0.25,
    } = options
    const [sx, sy] = control(
        sourcePosition,
        sourceX,
        sourceY,
        targetX,
        targetY,
        curvature,
    )
    const [tx, ty] = control(
        targetPosition,
        targetX,
        targetY,
        sourceX,
        sourceY,
        curvature,
    )
    const x = sourceX * 0.125 + sx * 0.375 + tx * 0.375 + targetX * 0.125
    const y = sourceY * 0.125 + sy * 0.375 + ty * 0.375 + targetY * 0.125

    return [`M${sourceX},${sourceY} C${sx},${sy} ${tx},${ty} ${targetX},${targetY}`, x, y, Math.abs(x - sourceX), Math.abs(y - sourceY)]
}

export const getSmoothStepPath = (options: StandardPathOptions): PathResult => {
    const {
        points,
        labelX,
        labelY,
    } = smoothStepPoints(options)
    let path = `M${points[0].x} ${points[0].y}`

    for (let i = 1; i < points.length - 1; i++)
        path += roundedBend(
            points[i - 1],
            points[i],
            points[i + 1],
            options.borderRadius ?? 5,
        )

    const last = points.at(-1)!
    path += `L${last.x} ${last.y}`

    return [path, labelX, labelY, Math.abs(options.targetX - options.sourceX) / 2, Math.abs(options.targetY - options.sourceY) / 2]
}
