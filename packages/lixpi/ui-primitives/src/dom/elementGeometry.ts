export const getElementBorderRadius = (
    element: HTMLElement,
    width: number,
    height: number,
): number => {
    const styles = element.ownerDocument.defaultView!.getComputedStyle(element)
    const parse = (value: string): number => {
        const first = value.trim().split(/\s+/)[0]
        const number = Number.parseFloat(first)

        if (!Number.isFinite(number))
            return 0

        return first.endsWith('%') ? (Math.min(width, height) * number) / 100 : number
    }

    return Math.max(
        0,
        Math.min(
            width / 2,
            height / 2,
            Math.max(
                ...[styles.borderTopLeftRadius, styles.borderTopRightRadius, styles.borderBottomRightRadius, styles.borderBottomLeftRadius].map(parse),
            ),
        ),
    )
}
