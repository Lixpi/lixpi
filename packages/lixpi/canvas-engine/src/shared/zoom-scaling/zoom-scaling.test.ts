'use strict'

import {
    describe,
    it,
    expect,
} from 'vitest'
import {
    getCanvasChromeScreenLayout,
    getAdaptiveBoundedZoomScalingOptions,
    getAdaptiveZoomMultiplier,
    scaleCanvasChromeForZoom,
    scaleCanvasChromeScreenSizeForZoom,
    scaleCanvasChromeToScreenForZoom,
    scaleCanvasChromeWorldSizeForZoom,
    scaleForZoom,
    getEdgeScaledSizes,
    getResizeHandleScaledSizes,
} from './zoom-scaling.ts'

function worldSizeToScreenSize(size: number, viewport: { zoom: number }): number {
    return size * viewport.zoom
}

const boundedZoomScaling = { minZoom: 0.4 }
const adaptiveBoundedLowZoomPower = 0.45
const adaptiveBoundedZoomScaling = getAdaptiveBoundedZoomScalingOptions(boundedZoomScaling)
const edgeScalingConfig = { zoomScaling: boundedZoomScaling }
const adaptiveEdgeScalingConfig = { zoomScaling: adaptiveBoundedZoomScaling }
const resizeHandleScalingConfig = { zoomScaling: boundedZoomScaling }
const adaptiveResizeHandleScalingConfig = { zoomScaling: adaptiveBoundedZoomScaling }

function expectedAdaptiveBoundedScreenMultiplier(
    zoom: number,
    minZoom = boundedZoomScaling.minZoom,
    lowZoomPower = adaptiveBoundedLowZoomPower,
): number {
    const safeZoom = Number.isFinite(zoom) ? Math.max(zoom, 0.01) : 1
    const safeMinZoom = Number.isFinite(minZoom) ? Math.max(minZoom, 0.01) : 1
    if (safeZoom >= safeMinZoom) return Math.pow(Math.min(safeZoom, 1), lowZoomPower)
    return Math.pow(Math.min(safeMinZoom, 1), lowZoomPower) * (safeZoom / safeMinZoom)
}

// =============================================================================
// getAdaptiveZoomMultiplier
// =============================================================================

describe('getAdaptiveZoomMultiplier', () => {
    it('returns 1 at 100% zoom', () => {
        expect(getAdaptiveZoomMultiplier(1)).toBe(1)
    })

    it('shrinks below 1 for low zoom (power curve)', () => {
        const m = getAdaptiveZoomMultiplier(0.5)
        expect(m).toBeLessThan(1)
        expect(m).toBeGreaterThan(0)
    })

    it('grows above 1 for high zoom (linear)', () => {
        const m = getAdaptiveZoomMultiplier(2)
        expect(m).toBeGreaterThan(1)
    })

    it('applies default highZoomGrowth = 0.5', () => {
        // 1 + (2 - 1) * 0.5 = 1.5
        expect(getAdaptiveZoomMultiplier(2)).toBe(1.5)
    })

    it('applies default lowZoomPower = 0.4', () => {
        // pow(0.25, 0.4)
        const expected = Math.pow(0.25, 0.4)
        expect(getAdaptiveZoomMultiplier(0.25)).toBeCloseTo(expected, 10)
    })

    it('respects custom lowZoomPower', () => {
        const m = getAdaptiveZoomMultiplier(0.5, { lowZoomPower: 1.0 })
        expect(m).toBeCloseTo(0.5, 10)
    })

    it('respects custom highZoomGrowth', () => {
        // 1 + (3 - 1) * 1.0 = 3
        expect(getAdaptiveZoomMultiplier(3, { highZoomGrowth: 1.0 })).toBe(3)
    })
})

// =============================================================================
// scaleForZoom
// =============================================================================

describe('scaleForZoom', () => {
    it('constant mode: inversely scales (same visual size)', () => {
        expect(scaleForZoom(10, 0.5, { mode: 'constant' })).toBe(20)
        expect(scaleForZoom(10, 1.0, { mode: 'constant' })).toBe(10)
        expect(scaleForZoom(10, 2.0, { mode: 'constant' })).toBe(5)
    })

    it('adaptive mode: reduces less at low zoom than constant', () => {
        const constant = scaleForZoom(10, 0.25, { mode: 'constant' })
        const adaptive = scaleForZoom(10, 0.25, { mode: 'adaptive' })
        // Adaptive should be smaller than constant (it "shrinks" the visual size)
        expect(adaptive).toBeLessThan(constant)
    })

    it('adaptive mode: at zoom = 1.0 equals base size', () => {
        expect(scaleForZoom(16, 1.0, { mode: 'adaptive' })).toBe(16)
    })

    it('defaults to constant mode', () => {
        expect(scaleForZoom(10, 2.0)).toBe(5)
    })
})

// =============================================================================
// Adaptive bounded canvas chrome scaling
// =============================================================================

describe('adaptive bounded canvas chrome scaling', () => {
    it('adds the canvas-chrome low-zoom power without mutating the plain bounded config', () => {
        const adapted = getAdaptiveBoundedZoomScalingOptions(boundedZoomScaling)

        expect(adapted).toEqual({ minZoom: 0.4, lowZoomPower: adaptiveBoundedLowZoomPower })
        expect(boundedZoomScaling).toEqual({ minZoom: 0.4 })
    })

    it('preserves an explicit low-zoom power override', () => {
        const adapted = getAdaptiveBoundedZoomScalingOptions({ minZoom: 0.5, lowZoomPower: 0.7 })

        expect(adapted).toEqual({ minZoom: 0.5, lowZoomPower: 0.7 })
    })

    it('keeps screen chrome at base pixels at 100% and above', () => {
        for (const zoom of [1, 1.01, 1.5, 2, 5]) {
            expect(scaleCanvasChromeScreenSizeForZoom(34, zoom, adaptiveBoundedZoomScaling)).toBeCloseTo(34, 10)
            expect(scaleCanvasChromeToScreenForZoom(34, zoom, adaptiveBoundedZoomScaling)).toBeCloseTo(34, 10)
        }
    })

    it('shrinks screen chrome below 100% so low-zoom icons cannot look larger than high-zoom icons', () => {
        const iconAt200Percent = scaleCanvasChromeScreenSizeForZoom(34, 2, adaptiveBoundedZoomScaling)
        const iconAt44Percent = scaleCanvasChromeScreenSizeForZoom(34, 0.44, adaptiveBoundedZoomScaling)
        const iconAt35Percent = scaleCanvasChromeScreenSizeForZoom(34, 0.35, adaptiveBoundedZoomScaling)

        expect(iconAt200Percent).toBeCloseTo(34, 10)
        expect(iconAt44Percent).toBeCloseTo(34 * expectedAdaptiveBoundedScreenMultiplier(0.44), 10)
        expect(iconAt35Percent).toBeCloseTo(34 * expectedAdaptiveBoundedScreenMultiplier(0.35), 10)
        expect(iconAt44Percent).toBeLessThan(iconAt200Percent)
        expect(iconAt35Percent).toBeLessThan(iconAt44Percent)
    })

    it('decreases monotonically as the viewport zooms out from 100%', () => {
        let previousScreenSize = scaleCanvasChromeScreenSizeForZoom(34, 1, adaptiveBoundedZoomScaling)

        for (const zoom of [0.99, 0.75, 0.5, 0.44, 0.4, 0.25, 0.1]) {
            const screenSize = scaleCanvasChromeScreenSizeForZoom(34, zoom, adaptiveBoundedZoomScaling)
            expect(screenSize).toBeLessThan(previousScreenSize)
            previousScreenSize = screenSize
        }
    })

    it('is intentionally smaller than plain bounded scaling between the lower breakpoint and 100%', () => {
        for (const zoom of [0.4, 0.44, 0.47, 0.5, 0.75, 0.99]) {
            const plainScreenSize = scaleCanvasChromeScreenSizeForZoom(34, zoom, boundedZoomScaling)
            const adaptiveScreenSize = scaleCanvasChromeScreenSizeForZoom(34, zoom, adaptiveBoundedZoomScaling)

            expect(plainScreenSize).toBeCloseTo(34, 10)
            expect(adaptiveScreenSize).toBeLessThan(plainScreenSize)
        }
    })

    it('keeps world-space and screen-space helpers on the same final visual curve', () => {
        for (const zoom of [0.1, 0.25, 0.35, 0.4, 0.44, 0.47, 0.75, 1, 1.57, 2]) {
            const worldSize = scaleCanvasChromeWorldSizeForZoom(34, zoom, adaptiveBoundedZoomScaling)
            const screenSize = scaleCanvasChromeScreenSizeForZoom(34, zoom, adaptiveBoundedZoomScaling)

            expect(worldSize * zoom).toBeCloseTo(screenSize, 10)
            expect(screenSize).toBeCloseTo(34 * expectedAdaptiveBoundedScreenMultiplier(zoom), 10)
        }
    })
})

// =============================================================================
// getCanvasChromeScreenLayout
// =============================================================================

describe('getCanvasChromeScreenLayout', () => {
    const worldPosition = { x: 240, y: 360 }
    const worldDimensions = { width: 512, height: 288 }
    const baseGap = 6
    const viewportBase = { x: 120, y: -45 }

    function getLayout(zoom: number) {
        return getCanvasChromeScreenLayout({
            viewport: { ...viewportBase, zoom },
            worldPosition,
            worldDimensions,
            baseGap,
            zoomScaling: boundedZoomScaling,
        })
    }

    it('keeps generated-media icon chrome screen scale constant throughout the bounded band', () => {
        for (let zoomStep = 40; zoomStep <= 500; zoomStep += 1) {
            const zoom = zoomStep / 100
            const layout = getLayout(zoom)

            expect(layout.screenScale).toBeCloseTo(1, 10)
            expect(layout.screenGap).toBeCloseTo(baseGap, 10)
            expect(layout.screenWidth).toBeCloseTo(worldDimensions.width * zoom, 10)
            expect(layout.layoutWidth * layout.screenScale).toBeCloseTo(worldDimensions.width * zoom, 10)
        }
    })

    it('thins generated-media icon chrome only below the lower zoom breakpoint', () => {
        let previousScale = 0
        for (let zoomStep = 1; zoomStep < 40; zoomStep += 1) {
            const zoom = zoomStep / 100
            const layout = getLayout(zoom)
            const expectedScale = zoom / boundedZoomScaling.minZoom

            expect(layout.screenScale).toBeCloseTo(expectedScale, 10)
            expect(layout.screenScale).toBeLessThan(1)
            expect(layout.screenScale).toBeGreaterThan(previousScale)
            expect(layout.screenGap).toBeCloseTo(baseGap * expectedScale, 10)
            expect(layout.layoutWidth * layout.screenScale).toBeCloseTo(worldDimensions.width * zoom, 10)

            previousScale = layout.screenScale
        }
    })

    it('keeps the transformed strip right edge aligned with the projected media right edge', () => {
        for (const zoom of [0.1, 0.39, 0.4, 0.75, 1, 1.61, 2, 5]) {
            const layout = getLayout(zoom)
            const projectedRight = viewportBase.x + (worldPosition.x + worldDimensions.width) * zoom

            expect(layout.left + layout.layoutWidth * layout.screenScale).toBeCloseTo(projectedRight, 10)
        }
    })

    it('positions the strip top from projected media bottom plus the bounded screen gap', () => {
        for (const zoom of [0.18, 0.4, 1, 2]) {
            const layout = getLayout(zoom)
            const projectedBottom = viewportBase.y + (worldPosition.y + worldDimensions.height) * zoom

            expect(layout.top).toBeCloseTo(projectedBottom + layout.screenGap, 10)
        }
    })

    it('uses the same bounded scaling helper as connector chrome and bubble menus', () => {
        for (let zoomStep = 1; zoomStep <= 500; zoomStep += 1) {
            const zoom = zoomStep / 100
            const layout = getLayout(zoom)

            expect(layout.screenScale).toBeCloseTo(
                scaleCanvasChromeToScreenForZoom(1, zoom, boundedZoomScaling),
                10,
            )
            expect(layout.screenGap).toBeCloseTo(
                scaleCanvasChromeToScreenForZoom(baseGap, zoom, boundedZoomScaling),
                10,
            )
        }
    })

    it('uses the adaptive bounded curve for generated-media chrome when the caller opts in', () => {
        for (const zoom of [0.1, 0.35, 0.4, 0.44, 0.47, 0.75, 1, 1.57, 2]) {
            const layout = getCanvasChromeScreenLayout({
                viewport: { ...viewportBase, zoom },
                worldPosition,
                worldDimensions,
                baseGap,
                zoomScaling: adaptiveBoundedZoomScaling,
            })
            const expectedScale = expectedAdaptiveBoundedScreenMultiplier(zoom)
            const projectedRight = viewportBase.x + (worldPosition.x + worldDimensions.width) * zoom

            expect(layout.screenScale).toBeCloseTo(expectedScale, 10)
            expect(layout.screenGap).toBeCloseTo(baseGap * expectedScale, 10)
            expect(layout.left + layout.layoutWidth * layout.screenScale).toBeCloseTo(projectedRight, 10)

            if (zoom < 1) {
                expect(layout.screenScale).toBeLessThan(1)
            } else {
                expect(layout.screenScale).toBe(1)
            }
        }
    })
})

// =============================================================================
// getEdgeScaledSizes
// =============================================================================

describe('getEdgeScaledSizes', () => {
    it('at zoom = 1.0 returns default base values', () => {
        const sizes = getEdgeScaledSizes(1, edgeScalingConfig)
        expect(sizes.strokeWidth).toBe(2)
        expect(sizes.markerSize).toBe(16)
        expect(sizes.markerOffset.source).toBe(6)
        expect(sizes.markerOffset.target).toBe(19)
    })

    it('markerOffset target (19) is larger than source (6) at any zoom', () => {
        for (const zoom of [0.2, 0.5, 1.0, 1.5, 2.0, 3.0]) {
            const sizes = getEdgeScaledSizes(zoom, edgeScalingConfig)
            expect(sizes.markerOffset.target).toBeGreaterThan(sizes.markerOffset.source)
        }
    })

    it('keeps connector visual sizes exactly constant throughout the scaling band', () => {
        const base = {
            strokeWidth: 2,
            markerSize: 16,
            markerOffsetSource: 6,
            markerOffsetTarget: 19,
            clickAreaWidth: 24,
        }

        for (let zoomStep = 40; zoomStep <= 500; zoomStep += 1) {
            const zoom = zoomStep / 100
            const sizes = getEdgeScaledSizes(zoom, edgeScalingConfig)

            expect(sizes.strokeWidth * zoom).toBeCloseTo(base.strokeWidth, 10)
            expect(sizes.markerSize * zoom).toBeCloseTo(base.markerSize, 10)
            expect(sizes.markerOffset.source * zoom).toBeCloseTo(base.markerOffsetSource, 10)
            expect(sizes.markerOffset.target * zoom).toBeCloseTo(base.markerOffsetTarget, 10)
            expect(sizes.clickAreaWidth * zoom).toBeCloseTo(base.clickAreaWidth, 10)
        }
    })

    it('never lets the visual connector size grow with zoom above 100%', () => {
        const baseStroke = 2
        for (let zoomStep = 100; zoomStep <= 500; zoomStep += 1) {
            const zoom = zoomStep / 100
            const sizes = getEdgeScaledSizes(zoom, edgeScalingConfig)
            const visual = sizes.strokeWidth * zoom
            expect(visual).toBeCloseTo(baseStroke, 10)
        }
    })

    it('freezes connector world sizes below the scaling band so visual sizes thin only while zooming farther out', () => {
        const minZoom = 0.4
        let previousVisualStrokeWidth = 0

        for (let zoomStep = 1; zoomStep < 40; zoomStep += 1) {
            const zoom = zoomStep / 100
            const sizes = getEdgeScaledSizes(zoom, edgeScalingConfig)
            const visualStrokeWidth = sizes.strokeWidth * zoom

            expect(sizes.strokeWidth).toBeCloseTo(2 / minZoom, 10)
            expect(sizes.markerSize).toBeCloseTo(16 / minZoom, 10)
            expect(sizes.markerOffset.source).toBeCloseTo(6 / minZoom, 10)
            expect(sizes.markerOffset.target).toBeCloseTo(19 / minZoom, 10)
            expect(sizes.clickAreaWidth).toBeCloseTo(24 / minZoom, 10)
            expect(visualStrokeWidth).toBeCloseTo(2 * zoom / minZoom, 10)
            expect(visualStrokeWidth).toBeLessThan(2)
            expect(visualStrokeWidth).toBeGreaterThan(previousVisualStrokeWidth)

            previousVisualStrokeWidth = visualStrokeWidth
        }
    })

    it('does not change visual connector sizes at any zoom above the lower threshold', () => {
        for (const zoom of [0.4, 0.41, 0.48, 0.5, 0.84, 1.0, 1.04, 1.93, 2.0, 2.5, 3.0, 5.0]) {
            const sizes = getEdgeScaledSizes(zoom, edgeScalingConfig)
            expect(sizes.strokeWidth * zoom).toBeCloseTo(2, 10)
            expect(sizes.markerSize * zoom).toBeCloseTo(16, 10)
        }
    })

    it('renders connector chrome at identical PIXI screen sizes for every zoom percent above the lower threshold', () => {
        for (let zoomStep = 40; zoomStep <= 500; zoomStep += 1) {
            const zoom = zoomStep / 100
            const viewport = { x: 17, y: -29, zoom }
            const sizes = getEdgeScaledSizes(zoom, edgeScalingConfig)

            expect(worldSizeToScreenSize(sizes.strokeWidth, viewport)).toBeCloseTo(2, 10)
            expect(worldSizeToScreenSize(sizes.markerSize, viewport)).toBeCloseTo(16, 10)
            expect(worldSizeToScreenSize(sizes.markerOffset.source, viewport)).toBeCloseTo(6, 10)
            expect(worldSizeToScreenSize(sizes.markerOffset.target, viewport)).toBeCloseTo(19, 10)
            expect(worldSizeToScreenSize(sizes.clickAreaWidth, viewport)).toBeCloseTo(24, 10)
        }
    })

    it('renders PIXI connector screen sizes from base pixels instead of stale world widths', () => {
        for (let zoomStep = 40; zoomStep <= 500; zoomStep += 1) {
            const zoom = zoomStep / 100

            expect(scaleCanvasChromeToScreenForZoom(2, zoom, boundedZoomScaling)).toBeCloseTo(2, 10)
            expect(scaleCanvasChromeToScreenForZoom(16, zoom, boundedZoomScaling)).toBeCloseTo(16, 10)
        }
    })

    it('only thins PIXI connector screen sizes while zooming out below the lower threshold', () => {
        let previousStroke = 0
        for (let zoomStep = 1; zoomStep < 40; zoomStep += 1) {
            const zoom = zoomStep / 100
            const viewport = { x: 0, y: 0, zoom }
            const sizes = getEdgeScaledSizes(zoom, edgeScalingConfig)
            const stroke = worldSizeToScreenSize(sizes.strokeWidth, viewport)

            expect(stroke).toBeCloseTo(2 * zoom / 0.4, 10)
            expect(stroke).toBeLessThan(2)
            expect(stroke).toBeGreaterThan(previousStroke)
            previousStroke = stroke
        }
    })

    it('thins PIXI connector base pixels only below the lower threshold', () => {
        let previousStroke = 0
        for (let zoomStep = 1; zoomStep < 40; zoomStep += 1) {
            const zoom = zoomStep / 100
            const stroke = scaleCanvasChromeToScreenForZoom(2, zoom, boundedZoomScaling)

            expect(stroke).toBeCloseTo(2 * zoom / 0.4, 10)
            expect(stroke).toBeLessThan(2)
            expect(stroke).toBeGreaterThan(previousStroke)
            previousStroke = stroke
        }
    })

    it('applies adaptive low-zoom shrink to connector world geometry without changing high zoom', () => {
        for (const zoom of [0.1, 0.35, 0.4, 0.44, 0.47, 0.75, 1, 1.57, 2]) {
            const sizes = getEdgeScaledSizes(zoom, adaptiveEdgeScalingConfig)
            const expectedScreenMultiplier = expectedAdaptiveBoundedScreenMultiplier(zoom)

            expect(sizes.strokeWidth * zoom).toBeCloseTo(2 * expectedScreenMultiplier, 10)
            expect(sizes.markerSize * zoom).toBeCloseTo(16 * expectedScreenMultiplier, 10)
            expect(sizes.markerOffset.source * zoom).toBeCloseTo(6 * expectedScreenMultiplier, 10)
            expect(sizes.markerOffset.target * zoom).toBeCloseTo(19 * expectedScreenMultiplier, 10)
            expect(sizes.clickAreaWidth * zoom).toBeCloseTo(24 * expectedScreenMultiplier, 10)
        }
    })

    it('makes low-zoom connector pixels smaller than the old plain bounded constant pixels', () => {
        for (const zoom of [0.4, 0.44, 0.47, 0.75]) {
            const plainSizes = getEdgeScaledSizes(zoom, edgeScalingConfig)
            const adaptiveSizes = getEdgeScaledSizes(zoom, adaptiveEdgeScalingConfig)

            expect(plainSizes.strokeWidth * zoom).toBeCloseTo(2, 10)
            expect(plainSizes.markerSize * zoom).toBeCloseTo(16, 10)
            expect(adaptiveSizes.strokeWidth * zoom).toBeLessThan(plainSizes.strokeWidth * zoom)
            expect(adaptiveSizes.markerSize * zoom).toBeLessThan(plainSizes.markerSize * zoom)
        }
    })

    it('keeps adaptive connector screen sizes monotonic as the viewport zooms out', () => {
        let previousStroke = scaleCanvasChromeToScreenForZoom(2, 1, adaptiveBoundedZoomScaling)
        let previousArrow = scaleCanvasChromeToScreenForZoom(16, 1, adaptiveBoundedZoomScaling)

        for (const zoom of [0.99, 0.75, 0.5, 0.44, 0.4, 0.25, 0.1]) {
            const stroke = scaleCanvasChromeToScreenForZoom(2, zoom, adaptiveBoundedZoomScaling)
            const arrow = scaleCanvasChromeToScreenForZoom(16, zoom, adaptiveBoundedZoomScaling)

            expect(stroke).toBeLessThan(previousStroke)
            expect(arrow).toBeLessThan(previousArrow)
            previousStroke = stroke
            previousArrow = arrow
        }
    })

    it('uses the same deterministic bounded curve for canvas title sizes', () => {
        const baseTitleFontSize = 20

        for (let zoomStep = 40; zoomStep <= 500; zoomStep += 1) {
            const zoom = zoomStep / 100
            expect(scaleCanvasChromeForZoom(baseTitleFontSize, zoom, boundedZoomScaling) * zoom).toBeCloseTo(baseTitleFontSize, 10)
        }

        for (let zoomStep = 1; zoomStep < 40; zoomStep += 1) {
            const zoom = zoomStep / 100
            expect(scaleCanvasChromeForZoom(baseTitleFontSize, zoom, boundedZoomScaling)).toBeCloseTo(baseTitleFontSize / 0.4, 10)
            expect(scaleCanvasChromeForZoom(baseTitleFontSize, zoom, boundedZoomScaling) * zoom).toBeCloseTo(baseTitleFontSize * zoom / 0.4, 10)
            expect(scaleCanvasChromeForZoom(baseTitleFontSize, zoom, boundedZoomScaling) * zoom).toBeLessThan(baseTitleFontSize)
        }
    })

    it('accepts custom base config', () => {
        const sizes = getEdgeScaledSizes(1, {
            baseStrokeWidth: 4,
            baseMarkerSize: 20,
            baseMarkerOffset: { source: 10, target: 10 },
            zoomScaling: boundedZoomScaling,
        })

        expect(sizes.strokeWidth).toBe(4)
        expect(sizes.markerSize).toBe(20)
        expect(sizes.markerOffset.source).toBe(10)
        expect(sizes.markerOffset.target).toBe(10)
    })
})

// =============================================================================
// getResizeHandleScaledSizes
// =============================================================================

describe('getResizeHandleScaledSizes', () => {
    it('at zoom = 1.0 returns default sizes', () => {
        const sizes = getResizeHandleScaledSizes(1, resizeHandleScalingConfig)
        expect(sizes.size).toBe(24)
        expect(sizes.offset).toBe(6)
    })

    it('uses constant (inverse) scaling', () => {
        const sizes = getResizeHandleScaledSizes(0.5, resizeHandleScalingConfig)
        expect(sizes.size).toBe(48) // 24 / 0.5
        expect(sizes.offset).toBe(12) // 6 / 0.5
    })

    it('enforces minimum size', () => {
        // At very high zoom, the scaled size would shrink. The default min is 10.
        const sizes = getResizeHandleScaledSizes(100, resizeHandleScalingConfig)
        expect(sizes.size).toBeGreaterThanOrEqual(10)
    })

    it('handles near-zero zoom safely', () => {
        // Should not throw or produce Infinity
        const sizes = getResizeHandleScaledSizes(0.001, resizeHandleScalingConfig)
        expect(Number.isFinite(sizes.size)).toBe(true)
        expect(Number.isFinite(sizes.offset)).toBe(true)
    })

    it('freezes resize handle world sizes below the lower breakpoint', () => {
        const sizes = getResizeHandleScaledSizes(0.18, resizeHandleScalingConfig)

        expect(sizes.size).toBeCloseTo(24 / boundedZoomScaling.minZoom, 10)
        expect(sizes.offset).toBeCloseTo(6 / boundedZoomScaling.minZoom, 10)
        expect(sizes.size * 0.18).toBeLessThan(24)
    })

    it('applies adaptive low-zoom shrink to visible resize-handle pixels', () => {
        for (const zoom of [0.1, 0.35, 0.4, 0.44, 0.47, 0.75, 1, 2]) {
            const sizes = getResizeHandleScaledSizes(zoom, adaptiveResizeHandleScalingConfig)
            const expectedScreenMultiplier = expectedAdaptiveBoundedScreenMultiplier(zoom)

            expect(sizes.size * zoom).toBeCloseTo(24 * expectedScreenMultiplier, 10)
            expect(sizes.offset * zoom).toBeCloseTo(6 * expectedScreenMultiplier, 10)
        }
    })

    it('keeps adaptive resize-handle pixels smaller than plain bounded pixels below 100%', () => {
        for (const zoom of [0.4, 0.44, 0.47, 0.75]) {
            const plainSizes = getResizeHandleScaledSizes(zoom, resizeHandleScalingConfig)
            const adaptiveSizes = getResizeHandleScaledSizes(zoom, adaptiveResizeHandleScalingConfig)

            expect(plainSizes.size * zoom).toBeCloseTo(24, 10)
            expect(adaptiveSizes.size * zoom).toBeLessThan(plainSizes.size * zoom)
        }
    })
})
