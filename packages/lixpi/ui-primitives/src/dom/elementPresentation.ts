function parseTransformScale(transform: string): number {
    const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/u)
    if (matrixMatch?.[1]) {
        const values = matrixMatch[1].split(',').map(value => Number.parseFloat(value.trim()))
        const scale = Math.hypot(values[0] ?? 1, values[1] ?? 0)
        if (Number.isFinite(scale) && scale > 0) return scale
    }

    const matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/u)
    if (matrix3dMatch?.[1]) {
        const values = matrix3dMatch[1].split(',').map(value => Number.parseFloat(value.trim()))
        const scale = Math.hypot(values[0] ?? 1, values[1] ?? 0)
        if (Number.isFinite(scale) && scale > 0) return scale
    }

    const scaleMatch = transform.match(/scale\(\s*([\d.+-]+)/u)
    const scale = scaleMatch?.[1] ? Number.parseFloat(scaleMatch[1]) : 1
    return Number.isFinite(scale) && scale > 0 ? scale : 1
}

export function getElementScale(element: HTMLElement | SVGElement): number {
    const transform = element.ownerDocument.defaultView?.getComputedStyle(element).transform || element.style.transform
    return parseTransformScale(transform)
}

export function copyCssCustomProperties(source: HTMLElement | SVGElement, target: HTMLElement | SVGElement, names: readonly string[]): void {
    const styles = source.ownerDocument.defaultView?.getComputedStyle(source)
    for (const name of names) {
        const value = styles?.getPropertyValue(name).trim() || source.style.getPropertyValue(name).trim()
        if (value) target.style.setProperty(name, value)
    }
}
