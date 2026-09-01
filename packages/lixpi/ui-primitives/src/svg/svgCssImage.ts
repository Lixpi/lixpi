export function svgToCssImageUrl(svg: string): string {
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
