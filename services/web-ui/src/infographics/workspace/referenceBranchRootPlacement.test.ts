import { describe, expect, it } from 'vitest'

import { computeReferenceBranchRootMarkerPosition } from '$src/infographics/workspace/referenceBranchRootPlacement.ts'

describe('computeReferenceBranchRootMarkerPosition', () => {
    it('preserves the configured first-media slot when the marker fits after the references', () => {
        const position = computeReferenceBranchRootMarkerPosition({
            referenceGroupRect: { x: 100, y: 40, width: 300, height: 600 },
            markerDimensions: { width: 140, height: 44 },
            mediaHeight: 500,
            rootToFirstMediaGap: 520,
            markerToMediaGap: 240,
            referenceToMarkerMinGap: 16,
        })

        expect(position).toEqual({ x: 540, y: 318 })
    })

    it('keeps a neutral branch origin marker out of the source media when the desired media slot is too close', () => {
        const referenceGroupRect = { x: 40, y: 120, width: 800, height: 800 }
        const position = computeReferenceBranchRootMarkerPosition({
            referenceGroupRect,
            markerDimensions: { width: 260, height: 52 },
            mediaHeight: 800,
            rootToFirstMediaGap: 384,
            markerToMediaGap: 312,
            referenceToMarkerMinGap: 64,
        })

        expect(position.x).toBe(referenceGroupRect.x + referenceGroupRect.width + 64)
        expect(position.y).toBe(494)
    })

    it('keeps a parentless fork marker out of the source media when its marker-to-media gap consumes the root gap', () => {
        const referenceGroupRect = { x: -160, y: -80, width: 640, height: 500 }
        const position = computeReferenceBranchRootMarkerPosition({
            referenceGroupRect,
            markerDimensions: { width: 180, height: 40 },
            mediaHeight: 500,
            rootToFirstMediaGap: 384,
            markerToMediaGap: 384,
            referenceToMarkerMinGap: 12,
        })

        expect(position.x).toBe(492)
        expect(position.x).toBeGreaterThan(referenceGroupRect.x + referenceGroupRect.width)
        expect(position.y).toBe(150)
    })

    it('treats a negative minimum clearance as zero instead of allowing overlap', () => {
        const referenceGroupRect = { x: 0, y: 0, width: 400, height: 400 }
        const position = computeReferenceBranchRootMarkerPosition({
            referenceGroupRect,
            markerDimensions: { width: 300, height: 60 },
            mediaHeight: 400,
            rootToFirstMediaGap: 120,
            markerToMediaGap: 200,
            referenceToMarkerMinGap: -80,
        })

        expect(position.x).toBe(referenceGroupRect.x + referenceGroupRect.width)
        expect(position.y).toBe(170)
    })
})
