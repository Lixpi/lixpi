import {
    GraphicsPath,
    Matrix,
} from 'pixi.js'
import {
    type VectorShape,
} from './resources.ts'

export const projectVectorPath = (
    source: string,
    projection?: VectorShape['projection'],
): GraphicsPath => {
    const path = new GraphicsPath(source)

    if (!projection)
        return path

    const {
        x,
        y,
        zoom,
        snapResolution,
    } = projection

    if (
        ![x, y, zoom].every(Number.isFinite)
        || zoom <= 0
        || (snapResolution !== undefined && (!Number.isFinite(snapResolution) || snapResolution <= 0))
    )
        throw new RangeError('Vector projection requires finite coordinates and positive scales')

    path.transform(
        new Matrix(
            zoom,
            0,
            0,
            zoom,
            x,
            y,
        ),
    )

    if (snapResolution) {
        for (const {
            action,
            data,
        } of path.instructions) {
            const length = action === 'moveTo'
                || action === 'lineTo'
                ? 2
                : action === 'quadraticCurveTo'
                    ? 4
                    : action === 'bezierCurveTo'
                        ? 6
                        : 0

            for (let i = 0; i < length; i++)
                data[i] = Math.round(data[i] * snapResolution) / snapResolution

            if (action === 'arcToSvg') {
                data[5] = Math.round(data[5] * snapResolution) / snapResolution
                data[6] = Math.round(data[6] * snapResolution) / snapResolution
            }
        }
    }

    return path
}

// Pixi supplies curve tessellation; dash distances continue across its line
// segments and restart at each SVG subpath, matching connector stroke semantics.
export const dashVectorPath = (
    path: GraphicsPath,
    input: readonly number[],
): GraphicsPath => {
    if (!input.length)
        return path

    if (input.some(length => !Number.isFinite(length) || length <= 0))
        throw new RangeError('Dash lengths must be positive and finite')

    const pattern = input.length % 2 ? [...input, ...input] : input
    const output = new GraphicsPath()
    let segments = 0

    for (const { shape } of path.shapePath.shapePrimitives) {
        if (
            !('points' in shape)
            || !Array.isArray(shape.points)
        )
            throw new Error('Dashed vector paths require SVG path geometry')

        const points: number[] = 'closePath' in shape
            && shape.closePath
            ? [...shape.points, ...shape.points.slice(0, 2)]
            : shape.points
        let index = 0
        let remaining = pattern[0]

        for (let i = 2; i < points.length; i += 2) {
            let x = points[i - 2]
            let y = points[i - 1]
            const endX = points[i]
            const endY = points[i + 1]
            const length = Math.hypot(endX - x, endY - y)

            if (!length)
                continue

            const dx = (endX - x) / length
            const dy = (endY - y) / length
            let left = length

            while (left > 1e-8) {
                if (++segments > 100000)
                    throw new RangeError('Dashed vector path exceeds the segment limit')

                const step = Math.min(remaining, left)
                const nextX = x + dx * step
                const nextY = y + dy * step

                if (index % 2 === 0)
                    output.moveTo(x, y).lineTo(nextX, nextY)

                x = nextX
                y = nextY
                left -= step
                remaining -= step

                if (remaining <= 1e-8) {
                    index = (index + 1) % pattern.length
                    remaining = pattern[index]
                }
            }
        }
    }

    return output
}
