export type PathPoint = {
    x: number
    y: number
}

export type PathPointWithTangent = {
    point: PathPoint
    tangent: PathPoint
}

const parsePathNumbers = (rawArgs: string): number[] => (rawArgs.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? []).map(Number)

const cubicAt = (
    start: number,
    controlA: number,
    controlB: number,
    end: number,
    progress: number,
): number => {
    const inverse = 1 - progress

    return inverse ** 3 * start + 3 * inverse ** 2 * progress * controlA + 3 * inverse * progress ** 2 * controlB + progress ** 3 * end
}

const quadraticAt = (
    start: number,
    control: number,
    end: number,
    progress: number,
): number => {
    const inverse = 1 - progress

    return inverse ** 2 * start + 2 * inverse * progress * control + progress ** 2 * end
}

export const flattenSvgPath = (svgPath: string): PathPoint[] => {
    const remainder = svgPath.replace(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g, '').replace(/[MmLlHhVvCcQqZz\s,]/g, '')

    if (remainder)
        throw new Error('Path flattening supports M, L, H, V, C, Q and Z commands')

    const points: PathPoint[] = []
    const commandRegex = /([MmLlHhVvCcQqZz])([^MmLlHhVvCcQqZz]*)/g
    let current: PathPoint = {
        x: 0,
        y: 0,
    }
    let subpathStart: PathPoint = {
        x: 0,
        y: 0,
    }
    let match: RegExpExecArray | null

    const pushPoint = (point: PathPoint): void => {
        current = point
        points.push(point)
    }

    while ((match = commandRegex.exec(svgPath)) !== null) {
        const command = match[1]
        const args = parsePathNumbers(match[2])
        const count = (
            {
                M: 2,
                L: 2,
                H: 1,
                V: 1,
                C: 6,
                Q: 4,
                Z: 0,
            } as Record<string, number>
        )[command.toUpperCase()]

        if (
            args.some(value => !Number.isFinite(value))
            || (count === 0 ? args.length !== 0 : args.length === 0 || args.length % count !== 0)
        )
            throw new Error('Invalid SVG path coordinates')

        if (
            points.length === 0
            && command.toUpperCase() !== 'M'
        )
            throw new Error('SVG paths must start with a move command')

        if (
            points.length > 0
            && command.toUpperCase() === 'M'
        )
            throw new Error('Path flattening requires a single continuous subpath')

        const isRelative = command === command.toLowerCase()
        const absolutePoint = (
            x: number,
            y: number,
        ): PathPoint =>
            isRelative
                ? {
                    x: current.x + x,
                    y: current.y + y,
                }
                : {
                    x,
                    y,
                }

        switch (command.toUpperCase()) {
            case 'M': {
                for (let argIndex = 0; argIndex < args.length; argIndex += 2) {
                    const point = absolutePoint(args[argIndex], args[argIndex + 1])

                    if (argIndex === 0) {
                        current = point
                        subpathStart = point
                        points.push(point)
                    } else
                        pushPoint(point)
                }

                break
            }
            case 'L': {
                for (let argIndex = 0; argIndex < args.length; argIndex += 2) {
                    pushPoint(
                        absolutePoint(args[argIndex], args[argIndex + 1]),
                    )
                }

                break
            }
            case 'H': {
                for (const rawX of args) {
                    pushPoint({
                        x: isRelative ? current.x + rawX : rawX,
                        y: current.y,
                    })
                }

                break
            }
            case 'V': {
                for (const rawY of args) {
                    pushPoint({
                        x: current.x,
                        y: isRelative ? current.y + rawY : rawY,
                    })
                }

                break
            }
            case 'C': {
                for (let argIndex = 0; argIndex < args.length; argIndex += 6) {
                    const segmentStart = current
                    const controlA = absolutePoint(args[argIndex], args[argIndex + 1])
                    const controlB = absolutePoint(args[argIndex + 2], args[argIndex + 3])
                    const segmentEnd = absolutePoint(args[argIndex + 4], args[argIndex + 5])

                    for (let step = 1; step <= 24; step++) {
                        const progress = step / 24
                        pushPoint({
                            x: cubicAt(
                                segmentStart.x,
                                controlA.x,
                                controlB.x,
                                segmentEnd.x,
                                progress,
                            ),
                            y: cubicAt(
                                segmentStart.y,
                                controlA.y,
                                controlB.y,
                                segmentEnd.y,
                                progress,
                            ),
                        })
                    }
                }

                break
            }
            case 'Q': {
                for (let argIndex = 0; argIndex < args.length; argIndex += 4) {
                    const segmentStart = current
                    const control = absolutePoint(args[argIndex], args[argIndex + 1])
                    const segmentEnd = absolutePoint(args[argIndex + 2], args[argIndex + 3])

                    for (let step = 1; step <= 16; step++) {
                        const progress = step / 16
                        pushPoint({
                            x: quadraticAt(
                                segmentStart.x,
                                control.x,
                                segmentEnd.x,
                                progress,
                            ),
                            y: quadraticAt(
                                segmentStart.y,
                                control.y,
                                segmentEnd.y,
                                progress,
                            ),
                        })
                    }
                }

                break
            }
            case 'Z': {
                pushPoint(subpathStart)

                break
            }
        }
    }

    return points
}

const segmentLength = (
    start: PathPoint,
    end: PathPoint,
): number => Math.hypot(end.x - start.x, end.y - start.y)

export const getPathLength = (points: PathPoint[]): number => {
    let total = 0

    for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
        total += segmentLength(points[pointIndex - 1], points[pointIndex])
    }

    return total
}

export const getPointAtPathLength = (
    points: PathPoint[],
    targetLength: number,
): PathPointWithTangent | null => {
    if (points.length === 0)
        return null

    if (points.length === 1)
        return {
            point: points[0],
            tangent: {
                x: 1,
                y: 0,
            },
        }

    let walked = 0

    for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
        const start = points[pointIndex - 1]
        const end = points[pointIndex]
        const length = segmentLength(start, end)

        if (length <= 0)
            continue

        if (walked + length >= targetLength) {
            const progress = Math.max(
                0,
                Math.min(1, (targetLength - walked) / length),
            )

            return {
                point: {
                    x: start.x + (end.x - start.x) * progress,
                    y: start.y + (end.y - start.y) * progress,
                },
                tangent: {
                    x: end.x - start.x,
                    y: end.y - start.y,
                },
            }
        }

        walked += length
    }

    const start = points.at(-2)!
    const end = points.at(-1)!

    return {
        point: end,
        tangent: {
            x: end.x - start.x,
            y: end.y - start.y,
        },
    }
}

const getSquaredDistanceToSegment = (
    point: PathPoint,
    start: PathPoint,
    end: PathPoint,
): number => {
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const lengthSquared = deltaX * deltaX + deltaY * deltaY

    if (lengthSquared <= 0)
        return (point.x - start.x) ** 2 + (point.y - start.y) ** 2

    const progress = Math.max(
        0,
        Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared),
    )
    const closest = {
        x: start.x + progress * deltaX,
        y: start.y + progress * deltaY,
    }

    return (point.x - closest.x) ** 2 + (point.y - closest.y) ** 2
}

export const isPointNearPath = (
    point: PathPoint,
    points: PathPoint[],
    radius: number,
): boolean => {
    const radiusSquared = radius * radius

    for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
        if (getSquaredDistanceToSegment(
            point,
            points[pointIndex - 1],
            points[pointIndex],
        ) <= radiusSquared)
            return true
    }

    return false
}
