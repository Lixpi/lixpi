import {
    type CanvasEnginePoint,
} from '../../geometry/index.ts'
import {
    type PortDirection,
} from '../geometry-types.ts'
import {
    type StandardPathOptions,
} from './standard.ts'

const directions: Record<PortDirection, CanvasEnginePoint> = {
    left: {
        x: -1,
        y: 0,
    },
    right: {
        x: 1,
        y: 0,
    },
    top: {
        x: 0,
        y: -1,
    },
    bottom: {
        x: 0,
        y: 1,
    },
}

export const smoothStepPoints = (options: StandardPathOptions) => {
    const {
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition = 'bottom',
        targetPosition = 'top',
        offset = 20,
    } = options
    const source = {
        x: sourceX,
        y: sourceY,
    }
    const target = {
        x: targetX,
        y: targetY,
    }
    const sourceDir = directions[sourcePosition]
    const targetDir = directions[targetPosition]
    const sourceGapped = {
        x: sourceX + sourceDir.x * offset,
        y: sourceY + sourceDir.y * offset,
    }
    const targetGapped = {
        x: targetX + targetDir.x * offset,
        y: targetY + targetDir.y * offset,
    }
    const axis = sourcePosition === 'left'
        || sourcePosition === 'right'
        ? 'x'
        : 'y'
    const direction = sourceGapped[axis] < targetGapped[axis] ? 1 : -1
    const sourceCorrection = {
        x: 0,
        y: 0,
    }
    const targetCorrection = {
        x: 0,
        y: 0,
    }
    let points: CanvasEnginePoint[]
    let labelX: number
    let labelY: number

    if (sourceDir[axis] * targetDir[axis] === -1) {
        labelX = (sourceGapped.x + targetGapped.x) / 2
        labelY = (sourceGapped.y + targetGapped.y) / 2
        const vertical = [{
            x: labelX,
            y: sourceGapped.y,
        }, {
            x: labelX,
            y: targetGapped.y,
        }]
        const horizontal = [{
            x: sourceGapped.x,
            y: labelY,
        }, {
            x: targetGapped.x,
            y: labelY,
        }]
        points = sourceDir[axis] === direction
            ? axis === 'x'
                ? vertical
                : horizontal
            : axis === 'x'
                ? horizontal
                : vertical
    } else {
        const sourceTarget = [{
            x: sourceGapped.x,
            y: targetGapped.y,
        }]
        const targetSource = [{
            x: targetGapped.x,
            y: sourceGapped.y,
        }]
        points = axis === 'x'
            ? sourceDir.x === direction
                ? targetSource
                : sourceTarget
            : sourceDir.y === direction
                ? sourceTarget
                : targetSource

        if (sourcePosition === targetPosition) {
            const diff = Math.abs(source[axis] - target[axis])

            if (diff <= offset) {
                const correction = Math.min(offset - 1, offset - diff)

                if (sourceDir[axis] === direction)
                    sourceCorrection[axis] = (sourceGapped[axis] > source[axis] ? -1 : 1) * correction
                else
                    targetCorrection[axis] = (targetGapped[axis] > target[axis] ? -1 : 1) * correction
            }
        } else {
            const otherAxis = axis === 'x' ? 'y' : 'x'
            const same = sourceDir[axis] === targetDir[otherAxis]
            const greater = sourceGapped[otherAxis] > targetGapped[otherAxis]
            const less = sourceGapped[otherAxis] < targetGapped[otherAxis]
            const flip = sourceDir[axis] === 1 ? (!same && greater) || (same && less) : (!same && less) || (same && greater)

            if (flip)
                points = axis === 'x' ? sourceTarget : targetSource
        }

        const a = {
            x: sourceGapped.x + sourceCorrection.x,
            y: sourceGapped.y + sourceCorrection.y,
        }
        const b = {
            x: targetGapped.x + targetCorrection.x,
            y: targetGapped.y + targetCorrection.y,
        }
        const dx = Math.max(
            Math.abs(a.x - points[0].x),
            Math.abs(b.x - points[0].x),
        )
        const dy = Math.max(
            Math.abs(a.y - points[0].y),
            Math.abs(b.y - points[0].y),
        )
        labelX = dx >= dy ? (a.x + b.x) / 2 : points[0].x
        labelY = dx >= dy ? points[0].y : (a.y + b.y) / 2
    }

    const first = {
        x: sourceGapped.x + sourceCorrection.x,
        y: sourceGapped.y + sourceCorrection.y,
    }
    const last = {
        x: targetGapped.x + targetCorrection.x,
        y: targetGapped.y + targetCorrection.y,
    }

    return {
        points: [source, ...(first.x !== points[0].x
            || first.y !== points[0].y
            ? [first]
            : []), ...points, ...(last.x !== points.at(-1)!.x
                || last.y !== points.at(-1)!.y
                ? [last]
                : []), target],
        labelX,
        labelY,
    }
}
