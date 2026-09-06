export const sanitizeSvgId = (
    value: string,
    fallback = 'svg',
): string => value.replace(/[^a-zA-Z0-9_-]/g, '-') || fallback
