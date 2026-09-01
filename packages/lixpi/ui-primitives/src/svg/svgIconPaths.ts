export type SvgPathIcon = {
    pathData: string[]
    minX: number
    minY: number
    width: number
    height: number
}

function parseViewBox(value: string | null): [number, number, number, number] | null {
    if (!value) return null
    const parts = value
        .trim()
        .split(/[\s,]+/)
        .map((part) => Number.parseFloat(part))

    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null
    return [parts[0]!, parts[1]!, parts[2]!, parts[3]!]
}

function parseDimension(value: string | null): number | null {
    if (!value) return null
    const dimension = Number.parseFloat(value)
    return Number.isFinite(dimension) && dimension > 0 ? dimension : null
}

export function extractSvgPathIcon(svgMarkup: string): SvgPathIcon {
    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgMarkup, 'image/svg+xml')
    const svgEl = svgDoc.querySelector('svg')
    const viewBox = parseViewBox(svgEl?.getAttribute('viewBox') ?? null)
    const width = viewBox?.[2] ?? parseDimension(svgEl?.getAttribute('width') ?? null) ?? 24
    const height = viewBox?.[3] ?? parseDimension(svgEl?.getAttribute('height') ?? null) ?? 24

    return {
        pathData: Array.from(svgDoc.querySelectorAll('path'))
            .map((path) => path.getAttribute('d') || '')
            .filter(Boolean),
        minX: viewBox?.[0] ?? 0,
        minY: viewBox?.[1] ?? 0,
        width,
        height,
    }
}

export function appendSvgPathIcon(
    iconGroup: any,
    svgMarkup: string,
    {
        x,
        y,
        size,
        fill,
    }: {
        x: number
        y: number
        size: number
        fill: string
    },
): void {
    const icon = extractSvgPathIcon(svgMarkup)
    const scale = size / Math.max(icon.width, icon.height)
    const offsetX = (size - icon.width * scale) / 2
    const offsetY = (size - icon.height * scale) / 2
    const transform = `translate(${x + offsetX}, ${y + offsetY}) scale(${scale}) translate(${-icon.minX}, ${-icon.minY})`

    iconGroup.selectAll('*').remove()
    for (const pathData of icon.pathData) {
        iconGroup.append('path')
            .attr('d', pathData)
            .attr('fill', fill)
            .attr('transform', transform)
    }
}
