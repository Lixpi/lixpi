export function sanitizeSvgId(value: string, fallback = 'svg'): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-') || fallback
}
