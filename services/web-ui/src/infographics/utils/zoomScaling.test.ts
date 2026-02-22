'use strict'

import { describe, it, expect } from 'vitest'
import {
	getAdaptiveZoomMultiplier,
	scaleForZoom,
	getEdgeScaledSizes,
	getResizeHandleScaledSizes,
} from '$src/infographics/utils/zoomScaling.ts'

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
// getEdgeScaledSizes
// =============================================================================

describe('getEdgeScaledSizes', () => {
	it('at zoom = 1.0 returns default base values', () => {
		const sizes = getEdgeScaledSizes(1)
		expect(sizes.strokeWidth).toBe(2)
		expect(sizes.markerSize).toBe(16)
		expect(sizes.markerOffset.source).toBe(6)
		expect(sizes.markerOffset.target).toBe(19)
	})

	it('markerOffset target (19) is larger than source (6) at any zoom', () => {
		for (const zoom of [0.2, 0.5, 1.0, 1.5, 2.0, 3.0]) {
			const sizes = getEdgeScaledSizes(zoom)
			expect(sizes.markerOffset.target).toBeGreaterThan(sizes.markerOffset.source)
		}
	})

	it('stroke width uses constant scaling (inversely proportional)', () => {
		const half = getEdgeScaledSizes(0.5)
		const double = getEdgeScaledSizes(2.0)

		// baseStrokeWidth = 2
		expect(half.strokeWidth).toBe(4)   // 2 / 0.5
		expect(double.strokeWidth).toBe(1) // 2 / 2.0
	})

	it('marker size uses adaptive scaling', () => {
		const low = getEdgeScaledSizes(0.25)
		const high = getEdgeScaledSizes(2.0)

		// Adaptive at low zoom: (16 * multiplier) / zoom
		// Should be different from constant: 16 / zoom
		const constantLow = 16 / 0.25 // 64
		expect(low.markerSize).toBeLessThan(constantLow)

		// At high zoom: marker grows relative to constant
		const constantHigh = 16 / 2.0 // 8
		expect(high.markerSize).toBeGreaterThan(constantHigh)
	})

	it('accepts custom base config', () => {
		const sizes = getEdgeScaledSizes(1, {
			baseStrokeWidth: 4,
			baseMarkerSize: 20,
			baseMarkerOffset: { source: 10, target: 10 },
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
		const sizes = getResizeHandleScaledSizes(1)
		expect(sizes.size).toBe(24)
		expect(sizes.offset).toBe(6)
	})

	it('uses constant (inverse) scaling', () => {
		const sizes = getResizeHandleScaledSizes(0.5)
		expect(sizes.size).toBe(48)  // 24 / 0.5
		expect(sizes.offset).toBe(12) // 6 / 0.5
	})

	it('enforces minimum size', () => {
		// At very high zoom, the scaled size would shrink. The default min is 10.
		const sizes = getResizeHandleScaledSizes(100)
		expect(sizes.size).toBeGreaterThanOrEqual(10)
	})

	it('handles near-zero zoom safely', () => {
		// Should not throw or produce Infinity
		const sizes = getResizeHandleScaledSizes(0.001)
		expect(Number.isFinite(sizes.size)).toBe(true)
		expect(Number.isFinite(sizes.offset)).toBe(true)
	})
})
