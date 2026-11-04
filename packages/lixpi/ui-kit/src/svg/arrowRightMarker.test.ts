import {
    describe,
    expect,
    it,
} from 'vitest'
import { extractSvgPathIcon } from '@lixpi/ui-primitives/svg'
import {
    arrowRightMarkerBodyLengthFraction,
    createArrowRightMarker,
} from './arrowRightMarker.ts'
import { arrowRightIcon } from './svgIcons.ts'

describe('createArrowRightMarker', () => {
    it('preserves the native arrow path, reference point, and body-length contract', () => {
        const icon = extractSvgPathIcon(arrowRightIcon)
        const marker = createArrowRightMarker()

        expect(marker.paths).toEqual(icon.pathData)
        expect(marker.width).toBe(256)
        expect(marker.reference).toEqual({
            x: 48,
            y: 128,
        })
        expect(marker.bodyLengthFraction).toBe((228.992 - 48) / 256)
        expect(marker.bodyLengthFraction).toBe(arrowRightMarkerBodyLengthFraction)
    })
})
