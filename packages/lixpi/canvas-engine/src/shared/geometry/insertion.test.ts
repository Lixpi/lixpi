import {
    describe,
    it,
    expect,
} from 'vitest'
import { computeVerticallyCenteredY } from './rectangles.ts'
import {
    computeCenteredPositionToRightOfRect,
    computeNextRowPositionToRightOfRect,
    computeStackedPositionToRightOfRect,
    computeViewportCenterInsertionPosition,
    computeViewportGridInsertionPosition,
    screenDimensionsToWorldDimensions,
    screenSizeToWorldSize,
} from './insertion.ts'

// =============================================================================
// ZOOM-NORMALIZED INSERTION HELPERS
// =============================================================================

describe('screenSizeToWorldSize', () => {
    it('keeps 100% insertion scale at zoom 1', () => {
        expect(screenSizeToWorldSize(400, 1)).toBe(400)
    })

    it('expands world size at lower zoom so inserted nodes appear at 100% screen scale', () => {
        expect(screenSizeToWorldSize(400, 0.5)).toBe(800)
    })

    it('falls back to zoom 1 for invalid zoom values', () => {
        expect(screenSizeToWorldSize(400, 0)).toBe(400)
        expect(screenSizeToWorldSize(400, Number.NaN)).toBe(400)
    })
})

describe('screenDimensionsToWorldDimensions', () => {
    it('normalizes both dimensions against the current viewport zoom', () => {
        expect(screenDimensionsToWorldDimensions({ width: 400, height: 500 }, 0.25)).toEqual({
            width: 1600,
            height: 2000,
        })
    })
})

describe('computeViewportGridInsertionPosition', () => {
    it('places inserted nodes at stable screen offsets in the current viewport', () => {
        const position = computeViewportGridInsertionPosition(0, { x: -200, y: -100, zoom: 0.5 })

        expect(position).toEqual({ x: 500, y: 300 })
    })

    it('keeps the existing three-column insertion pattern in screen space', () => {
        const position = computeViewportGridInsertionPosition(4, { x: 0, y: 0, zoom: 2 })

        expect(position).toEqual({ x: 250, y: 225 })
    })
})

describe('computeViewportCenterInsertionPosition', () => {
    it('centers fixed canvas-unit dimensions in the current viewport', () => {
        const position = computeViewportCenterInsertionPosition(
            { width: 400, height: 300 },
            { x: -100, y: -50, zoom: 0.5 },
            { width: 1000, height: 800 },
        )

        expect(position).toEqual({ x: 1000, y: 750 })
    })
})

describe('computeStackedPositionToRightOfRect', () => {
    it('places stacked outputs to the right of the supplied visual bounds', () => {
        const position = computeStackedPositionToRightOfRect(
            { x: 100, y: 200, width: 520, height: 500 },
            1,
            400,
            96,
        )

        expect(position).toEqual({ x: 716, y: 696 })
    })
})

describe('computeNextRowPositionToRightOfRect', () => {
    it('places the first branch row beside the supplied visual bounds', () => {
        const position = computeNextRowPositionToRightOfRect(
            { x: 100, y: 200, width: 520, height: 500 },
            undefined,
            400,
            96,
            160,
        )

        expect(position).toEqual({ x: 716, y: 200 })
    })

    it('places the next branch row below the previous branch root only', () => {
        const position = computeNextRowPositionToRightOfRect(
            { x: 100, y: 200, width: 520, height: 500 },
            { x: 716, y: 200, width: 400, height: 400 },
            400,
            96,
            160,
        )

        expect(position).toEqual({ x: 716, y: 760 })
    })
})

describe('computeCenteredPositionToRightOfRect', () => {
    it('centers a square placeholder against a landscape predecessor', () => {
        const position = computeCenteredPositionToRightOfRect(
            { x: 100, y: 375, width: 800, height: 450 },
            800,
            192,
        )

        expect(position).toEqual({ x: 1092, y: 200 })
    })

    it('recomputes the same center line when a partial or final image resolves to a new height', () => {
        const predecessor = { x: 100, y: 375, width: 800, height: 450 }

        expect(computeVerticallyCenteredY(predecessor, 800)).toBe(200)
        expect(computeVerticallyCenteredY(predecessor, 600)).toBe(300)
        expect(computeVerticallyCenteredY(predecessor, 450)).toBe(375)
    })
})
