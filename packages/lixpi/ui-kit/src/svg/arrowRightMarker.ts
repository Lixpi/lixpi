import { extractSvgPathIcon } from '@lixpi/ui-primitives/svg'
import { arrowRightIcon } from './svgIcons.ts'

export type ArrowRightMarker = {
    paths: readonly string[]
    width: number
    reference: {
        x: number
        y: number
    }
    bodyLengthFraction: number
}

// The native artwork joins the line at x=48 and reaches its tip at x=228.992.
export const arrowRightMarkerBodyLengthFraction = (228.992 - 48) / 256

export const createArrowRightMarker = (): ArrowRightMarker => {
    const icon = extractSvgPathIcon(arrowRightIcon)

    return {
        paths: icon.pathData,
        width: icon.width,
        reference: {
            x: 48,
            y: 128,
        },
        bodyLengthFraction: arrowRightMarkerBodyLengthFraction,
    }
}
