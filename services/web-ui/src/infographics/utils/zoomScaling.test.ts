'use strict'

import { describe, it, expect } from 'vitest'
import {
	getAdaptiveZoomMultiplier,
	scaleCanvasChromeForZoom,
	scaleCanvasChromeToScreenForZoom,
	getCanvasChromeScreenLayout,
	scaleForZoom,
	getEdgeScaledSizes,
	getResizeHandleScaledSizes,
} from '$src/infographics/utils/zoomScaling.ts'
import { worldSizeToScreenSize } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

const boundedZoomScaling = { minZoom: 0.4 }
const edgeScalingConfig = { zoomScaling: boundedZoomScaling }
const resizeHandleScalingConfig = { zoomScaling: boundedZoomScaling }

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
// getCanvasChromeScreenLayout
// =============================================================================

describe('getCanvasChromeScreenLayout', () => {
	const viewport = { x: 120, y: -45, zoom: 1 }
	const worldPosition = { x: 200, y: 320 }
	const worldDimensions = { width: 640, height: 360 }
	const baseGap = 6
	const baseIconSize = 34
	const minZoom = 0.4

	function getLayout(zoom: number) {
		return getCanvasChromeScreenLayout({
			viewport: { ...viewport, zoom },
			worldPosition,
			worldDimensions,
			baseGap,
			zoomScaling: boundedZoomScaling,
		})
	}

	it('keeps screen-space DOM chrome visually identical throughout the scaling band', () => {
		for (let zoomStep = 40; zoomStep <= 500; zoomStep += 1) {
			const zoom = zoomStep / 100
			const layout = getLayout(zoom)

			expect(layout.screenScale).toBeCloseTo(1, 10)
			expect(baseIconSize * layout.screenScale).toBeCloseTo(baseIconSize, 10)
			expect(layout.screenGap).toBeCloseTo(baseGap, 10)
		}
	})

	it('freezes the scaling curve below the lower breakpoint so overview zooms thin chrome deterministically', () => {
		let previousScreenIconSize = 0

		for (let zoomStep = 1; zoomStep < 40; zoomStep += 1) {
			const zoom = zoomStep / 100
			const layout = getLayout(zoom)
			const screenIconSize = baseIconSize * layout.screenScale

			expect(layout.screenScale).toBeCloseTo(zoom / minZoom, 10)
			expect(screenIconSize).toBeCloseTo(baseIconSize * zoom / minZoom, 10)
			expect(screenIconSize).toBeLessThan(baseIconSize)
			expect(screenIconSize).toBeGreaterThan(previousScreenIconSize)
			expect(layout.screenGap).toBeCloseTo(baseGap * zoom / minZoom, 10)

			previousScreenIconSize = screenIconSize
		}
	})

	it('keeps the chrome right edge aligned with the projected media right edge', () => {
		for (let zoomStep = 1; zoomStep <= 500; zoomStep += 1) {
			const zoom = zoomStep / 100
			const layout = getLayout(zoom)

			expect(layout.layoutWidth * layout.screenScale).toBeCloseTo(worldDimensions.width * zoom, 10)
			expect(layout.left + layout.layoutWidth * layout.screenScale)
				.toBeCloseTo(viewport.x + (worldPosition.x + worldDimensions.width) * zoom, 10)
		}
	})

	it('projects the chrome top from the media bottom plus bounded screen gap', () => {
		for (const zoom of [0.18, 0.4, 0.42, 1.05, 2]) {
			const layout = getLayout(zoom)
			const expectedMediaBottom = viewport.y + (worldPosition.y + worldDimensions.height) * zoom

			expect(layout.top).toBeCloseTo(expectedMediaBottom + layout.screenGap, 10)
		}
	})

	it('matches connector chrome screen scaling at representative zooms', () => {
		for (const zoom of [0.15, 0.18, 0.39, 0.4, 0.45, 0.56, 1, 1.61, 3]) {
			const layout = getLayout(zoom)

			expect(layout.screenScale).toBeCloseTo(scaleCanvasChromeToScreenForZoom(1, zoom, boundedZoomScaling), 10)
			expect(layout.screenGap).toBeCloseTo(scaleCanvasChromeToScreenForZoom(baseGap, zoom, boundedZoomScaling), 10)
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
		expect(sizes.size).toBe(48)  // 24 / 0.5
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
})
