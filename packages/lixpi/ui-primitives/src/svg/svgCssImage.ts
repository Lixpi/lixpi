export const svgToCssImageUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
