export type SvgRectangle = {
    x: number
    y: number
    width: number
    height: number
}

export const roundedRectanglePath = (
    rect: SvgRectangle,
    radius: number,
): string => {
    const {
        x,
        y,
        width,
        height,
    } = rect
    const r = Math.max(
        0,
        Math.min(
            radius,
            width / 2,
            height / 2,
        ),
    )
    const right = x + width
    const bottom = y + height

    if (r === 0)
        return `M${x} ${y} H${right} V${bottom} H${x} Z`

    return `M${x + r} ${y} H${right - r} A${r} ${r} 0 0 1 ${right} ${y + r} V${bottom - r} A${r} ${r} 0 0 1 ${right - r} ${bottom} H${x + r} A${r} ${r} 0 0 1 ${x} ${bottom - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
}
