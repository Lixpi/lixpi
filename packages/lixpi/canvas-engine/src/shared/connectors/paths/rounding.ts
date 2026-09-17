import {
    type CanvasEnginePoint,
} from '../../geometry/index.ts'

export const roundedBend = (
    a: CanvasEnginePoint,
    b: CanvasEnginePoint,
    c: CanvasEnginePoint,
    radius: number,
): string => {
    const size = Math.min(
        Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / 2,
        Math.sqrt((c.x - b.x) ** 2 + (c.y - b.y) ** 2) / 2,
        radius,
    )
    const {
        x,
        y,
    } = b

    if (
        (a.x === x && x === c.x)
        || (a.y === y && y === c.y)
    )
        return `L${x} ${y}`

    if (a.y === y)
        return `L ${x + size * (a.x < c.x ? -1 : 1)},${y}Q ${x},${y} ${x},${y + size * (a.y < c.y ? 1 : -1)}`

    return `L ${x},${y + size * (a.y < c.y ? -1 : 1)}Q ${x},${y} ${x + size * (a.x < c.x ? 1 : -1)},${y}`
}
