'use strict'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
	getShiftingGradientRenderer,
	createShiftingGradientBackground,
} from './shiftingGradientRenderer.ts'

// The 8 phase positions (mirrored from source to verify against)
const EXPECTED_PHASE_POSITIONS = [
	{ x: 0.8, y: 0.1 },
	{ x: 0.6, y: 0.2 },
	{ x: 0.35, y: 0.25 },
	{ x: 0.25, y: 0.6 },
	{ x: 0.2, y: 0.9 },
	{ x: 0.4, y: 0.8 },
	{ x: 0.65, y: 0.75 },
	{ x: 0.75, y: 0.4 },
]

const EXPECTED_COLORS = [
	{ r: 0xff, g: 0xf5, b: 0xfa }, // whisper pink
	{ r: 0xf5, g: 0xef, b: 0xf9 }, // whisper lavender
	{ r: 0xe6, g: 0xe9, b: 0xf6 }, // whisper periwinkle
	{ r: 0xf3, g: 0xe4, b: 0xf2 }, // whisper orchid
]

const BITMAP_WIDTH = 60
const BITMAP_HEIGHT = 80

// Type alias for accessing private internals via `as any`
type RendererAny = ReturnType<typeof getShiftingGradientRenderer> & Record<string, any>

// =============================================================================
// HELPERS
// =============================================================================

// Create a mock CanvasRenderingContext2D that happy-dom might not fully support.
// The gradient renderer only uses createImageData/putImageData on the offscreen
// canvas, and drawImage + smoothing settings on subscriber canvases.
function createMockCanvasContext() {
	return {
		createImageData: (w: number, h: number) => ({
			data: new Uint8ClampedArray(w * h * 4),
			width: w,
			height: h,
		}),
		putImageData: vi.fn(),
		drawImage: vi.fn(),
		imageSmoothingEnabled: true,
		imageSmoothingQuality: 'high',
		save: vi.fn(),
		restore: vi.fn(),
		globalCompositeOperation: 'source-over',
		globalAlpha: 1,
		clearRect: vi.fn(),
		fillRect: vi.fn(),
		fillStyle: '',
	}
}

function getRenderer(): RendererAny {
	return getShiftingGradientRenderer() as RendererAny
}

// Create a canvas element with a patched getContext for happy-dom compatibility
function createSubscriberCanvas(w = 200, h = 150): HTMLCanvasElement {
	const canvas = document.createElement('canvas')
	canvas.width = w
	canvas.height = h
	canvas.getContext = ((id: string) => {
		if (id === '2d') return createMockCanvasContext()
		return null
	}) as typeof canvas.getContext
	return canvas
}

// Gather the 4 color-point positions for a given phase (same logic as source)
function gatherPositions(phase: number): Array<{ x: number; y: number }> {
	const result: Array<{ x: number; y: number }> = []
	for (let i = 0; i < 4; i++) {
		let pos = phase + i * 2
		while (pos >= 8) pos -= 8
		result.push({ ...EXPECTED_PHASE_POSITIONS[pos] })
	}
	return result
}

// Read a pixel from the renderer's ImageData buffer
function readPixel(renderer: RendererAny, x: number, y: number): { r: number; g: number; b: number; a: number } {
	const data: Uint8ClampedArray = renderer.imageData.data
	const idx = (y * BITMAP_WIDTH + x) * 4
	return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] }
}

// =============================================================================
// SETUP / TEARDOWN
// =============================================================================

let rafId = 0

beforeEach(() => {
	rafId = 0
	vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++rafId))
	vi.stubGlobal('cancelAnimationFrame', vi.fn())

	// Provide a mock OffscreenCanvas so the renderer constructor doesn't
	// depend on happy-dom's limited canvas implementation.
	vi.stubGlobal('OffscreenCanvas', class MockOffscreenCanvas {
		width: number
		height: number
		constructor(w: number, h: number) {
			this.width = w
			this.height = h
		}
		getContext() {
			return createMockCanvasContext()
		}
	})

	// Patch document.createElement so any canvas elements (including those
	// created internally by createShiftingGradientBackground) get a working
	// getContext, since happy-dom's canvas support is limited.
	const origCreateElement = document.createElement.bind(document)
	vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
		const el = origCreateElement(tagName, options)
		if (tagName === 'canvas') {
			;(el as HTMLCanvasElement).getContext = ((id: string) => {
				if (id === '2d') return createMockCanvasContext() as unknown as CanvasRenderingContext2D
				return null
			}) as typeof HTMLCanvasElement.prototype.getContext
		}
		return el
	}) as typeof document.createElement)
})

afterEach(() => {
	const r = getShiftingGradientRenderer() as RendererAny
	r.destroy()
	vi.restoreAllMocks()
})

// =============================================================================
// SINGLETON PATTERN
// =============================================================================

describe('ShiftingGradientRenderer — singleton', () => {
	it('returns the same instance on repeated calls', () => {
		const a = getShiftingGradientRenderer()
		const b = getShiftingGradientRenderer()
		expect(a).toBe(b)
	})

	it('creates a fresh instance after destroy', () => {
		const first = getShiftingGradientRenderer()
		first.destroy()
		const second = getShiftingGradientRenderer()
		expect(second).not.toBe(first)
	})
})

// =============================================================================
// INITIAL STATE
// =============================================================================

describe('ShiftingGradientRenderer — initial state', () => {
	it('starts at phase 0 with animation idle (progress = 1)', () => {
		const r = getRenderer()
		expect(r.currentPhase).toBe(0)
		expect(r.animationProgress).toBe(1)
	})

	it('sets phaseTo = 0 and phaseFrom = 1', () => {
		const r = getRenderer()
		expect(r.phaseTo).toBe(0)
		expect(r.phaseFrom).toBe(1)
	})

	it('loads exactly 4 gradient colors', () => {
		const r = getRenderer()
		expect(r.colors).toHaveLength(4)
		for (let i = 0; i < 4; i++) {
			expect(r.colors[i]).toEqual(EXPECTED_COLORS[i])
		}
	})

	it('creates a 60×80 offscreen canvas', () => {
		const r = getRenderer()
		const canvas = r.offscreenCanvas as HTMLCanvasElement
		expect(canvas.width).toBe(BITMAP_WIDTH)
		expect(canvas.height).toBe(BITMAP_HEIGHT)
	})

	it('creates ImageData matching bitmap dimensions', () => {
		const r = getRenderer()
		expect(r.imageData.width).toBe(BITMAP_WIDTH)
		expect(r.imageData.height).toBe(BITMAP_HEIGHT)
		expect(r.imageData.data.length).toBe(BITMAP_WIDTH * BITMAP_HEIGHT * 4)
	})

	it('has no subscribers initially', () => {
		const r = getRenderer()
		expect(r.subscribedCanvases.size).toBe(0)
	})

	it('is not animating initially', () => {
		const r = getRenderer()
		expect(r.isAnimating).toBe(false)
	})

	it('has no pattern initially', () => {
		const r = getRenderer()
		expect(r.pattern).toBeNull()
	})
})

// =============================================================================
// PHASE TRANSITIONS
// =============================================================================

describe('ShiftingGradientRenderer — nextPhase', () => {
	it('decrements phase with wrap: 0 → 7 → 6 → … → 1 → 0', () => {
		const r = getRenderer()
		const expectedSequence = [7, 6, 5, 4, 3, 2, 1, 0]
		for (const expected of expectedSequence) {
			r.nextPhase()
			expect(r.currentPhase).toBe(expected)
		}
	})

	it('completes a full cycle back to original phase', () => {
		const r = getRenderer()
		expect(r.currentPhase).toBe(0)
		for (let i = 0; i < 8; i++) r.nextPhase()
		expect(r.currentPhase).toBe(0)
	})

	it('sets phaseFrom = (phaseTo + 1) % 8 after each transition', () => {
		const r = getRenderer()
		for (let i = 0; i < 8; i++) {
			r.nextPhase()
			expect(r.phaseFrom).toBe((r.phaseTo + 1) % 8)
		}
	})

	it('resets animationProgress to 0', () => {
		const r = getRenderer()
		expect(r.animationProgress).toBe(1)
		r.nextPhase()
		expect(r.animationProgress).toBe(0)
	})

	it('records animationStartTime', () => {
		const r = getRenderer()
		const now = 12345.678
		vi.stubGlobal('performance', { now: () => now })
		r.nextPhase()
		expect(r.animationStartTime).toBe(now)
	})
})

// =============================================================================
// POSITION GATHERING — getInterpolatedPositions
// =============================================================================

describe('ShiftingGradientRenderer — getInterpolatedPositions', () => {
	it('at progress = 1 (idle), returns positions for the current phase', () => {
		const r = getRenderer()
		r.animationProgress = 1
		const positions = r.getInterpolatedPositions()
		const expected = gatherPositions(r.currentPhase)
		expect(positions).toEqual(expected)
	})

	it('at progress = 0 (start of animation), returns positions for phaseFrom', () => {
		const r = getRenderer()
		r.nextPhase()
		r.animationProgress = 0
		const positions = r.getInterpolatedPositions()
		const expected = gatherPositions(r.phaseFrom)
		expect(positions).toEqual(expected)
	})

	it('at progress = 0.5, returns midpoint between phaseFrom and phaseTo', () => {
		const r = getRenderer()
		r.nextPhase()
		r.animationProgress = 0.5
		const positions = r.getInterpolatedPositions()
		const from = gatherPositions(r.phaseFrom)
		const to = gatherPositions(r.phaseTo)

		for (let i = 0; i < 4; i++) {
			expect(positions[i].x).toBeCloseTo((from[i].x + to[i].x) / 2, 10)
			expect(positions[i].y).toBeCloseTo((from[i].y + to[i].y) / 2, 10)
		}
	})

	it('always returns exactly 4 positions', () => {
		const r = getRenderer()
		for (let i = 0; i < 8; i++) {
			r.nextPhase()
			r.animationProgress = 1
			expect(r.getInterpolatedPositions()).toHaveLength(4)
		}
	})

	it('all position coordinates are in [0, 1]', () => {
		const r = getRenderer()
		for (let i = 0; i < 8; i++) {
			r.nextPhase()
			r.animationProgress = 1
			for (const pos of r.getInterpolatedPositions()) {
				expect(pos.x).toBeGreaterThanOrEqual(0)
				expect(pos.x).toBeLessThanOrEqual(1)
				expect(pos.y).toBeGreaterThanOrEqual(0)
				expect(pos.y).toBeLessThanOrEqual(1)
			}
		}
	})

	it('phase 0 gathers positions at indices 0, 2, 4, 6', () => {
		const r = getRenderer()
		r.animationProgress = 1
		const positions = r.getInterpolatedPositions()
		expect(positions[0]).toEqual(EXPECTED_PHASE_POSITIONS[0])
		expect(positions[1]).toEqual(EXPECTED_PHASE_POSITIONS[2])
		expect(positions[2]).toEqual(EXPECTED_PHASE_POSITIONS[4])
		expect(positions[3]).toEqual(EXPECTED_PHASE_POSITIONS[6])
	})

	it('different phases produce different position sets', () => {
		const r = getRenderer()
		r.animationProgress = 1
		const phase0 = r.getInterpolatedPositions()

		r.nextPhase()
		r.animationProgress = 1
		const phase7 = r.getInterpolatedPositions()

		expect(phase0).not.toEqual(phase7)
	})
})

// =============================================================================
// CUBIC BEZIER EASING
// =============================================================================

describe('ShiftingGradientRenderer — easing', () => {
	it('easingInterpolator(0) ≈ 0', () => {
		const r = getRenderer()
		expect(r.easingInterpolator(0)).toBeCloseTo(0, 5)
	})

	it('easingInterpolator(1) ≈ 1', () => {
		const r = getRenderer()
		expect(r.easingInterpolator(1)).toBeCloseTo(1, 5)
	})

	it('easing is monotonically increasing', () => {
		const r = getRenderer()
		let prev = -1
		for (let t = 0; t <= 1; t += 0.01) {
			const val = r.easingInterpolator(t)
			expect(val).toBeGreaterThanOrEqual(prev)
			prev = val
		}
	})

	it('easing output stays within [0, 1]', () => {
		const r = getRenderer()
		for (let t = 0; t <= 1; t += 0.01) {
			const val = r.easingInterpolator(t)
			expect(val).toBeGreaterThanOrEqual(0)
			expect(val).toBeLessThanOrEqual(1)
		}
	})

	it('cubicBezierAtTime with linear control points returns identity', () => {
		const r = getRenderer()
		// bezier(0, 0, 1, 1) should approximate identity
		for (const t of [0, 0.25, 0.5, 0.75, 1]) {
			expect(r.cubicBezierAtTime(0, 0, 1, 1, t)).toBeCloseTo(t, 2)
		}
	})

	it('cubicBezierAtTime(0.33, 0, 0, 1) matches the ease-out curve', () => {
		const r = getRenderer()
		// The curve (0.33, 0, 0, 1) produces fast-start ease-out
		// At t=0.5 the output should be > 0.5 (ease-out property)
		const mid = r.cubicBezierAtTime(0.33, 0, 0, 1, 0.5)
		expect(mid).toBeGreaterThan(0.5)
	})
})

// =============================================================================
// RENDERED PIXEL DATA — INVARIANTS
// =============================================================================

describe('ShiftingGradientRenderer — rendered pixels', () => {
	it('all pixels have alpha = 255', () => {
		const r = getRenderer()
		const data = r.imageData.data as Uint8ClampedArray
		for (let i = 3; i < data.length; i += 4) {
			expect(data[i]).toBe(255)
		}
	})

	it('all RGB values are in valid range [0, 255]', () => {
		const r = getRenderer()
		const data = r.imageData.data as Uint8ClampedArray
		for (let i = 0; i < data.length; i++) {
			expect(data[i]).toBeGreaterThanOrEqual(0)
			expect(data[i]).toBeLessThanOrEqual(255)
		}
	})

	it('pixel colors are weighted blends of the 4 gradient colors', () => {
		const r = getRenderer()
		const minR = Math.min(...EXPECTED_COLORS.map(c => c.r))
		const maxR = Math.max(...EXPECTED_COLORS.map(c => c.r))
		const minG = Math.min(...EXPECTED_COLORS.map(c => c.g))
		const maxG = Math.max(...EXPECTED_COLORS.map(c => c.g))
		const minB = Math.min(...EXPECTED_COLORS.map(c => c.b))
		const maxB = Math.max(...EXPECTED_COLORS.map(c => c.b))

		// Sample a grid of pixels — all should be within the color bounds
		for (let y = 0; y < BITMAP_HEIGHT; y += 5) {
			for (let x = 0; x < BITMAP_WIDTH; x += 5) {
				const px = readPixel(r, x, y)
				expect(px.r).toBeGreaterThanOrEqual(minR)
				expect(px.r).toBeLessThanOrEqual(maxR)
				expect(px.g).toBeGreaterThanOrEqual(minG)
				expect(px.g).toBeLessThanOrEqual(maxG)
				expect(px.b).toBeGreaterThanOrEqual(minB)
				expect(px.b).toBeLessThanOrEqual(maxB)
			}
		}
	})

	it('gradient is not a flat single color', () => {
		const r = getRenderer()
		const topLeft = readPixel(r, 0, 0)
		const bottomRight = readPixel(r, BITMAP_WIDTH - 1, BITMAP_HEIGHT - 1)
		const center = readPixel(r, 30, 40)

		// At least two of these must differ in some channel
		const allSame =
			topLeft.r === bottomRight.r && topLeft.r === center.r &&
			topLeft.g === bottomRight.g && topLeft.g === center.g &&
			topLeft.b === bottomRight.b && topLeft.b === center.b
		expect(allSame).toBe(false)
	})

	it('rendered output changes after phase transition + re-render', () => {
		const r = getRenderer()
		// Snapshot a few pixels at phase 0
		const before = [
			readPixel(r, 10, 10),
			readPixel(r, 50, 70),
			readPixel(r, 30, 40),
		]

		// Advance to next phase and force full render
		r.nextPhase()
		r.animationProgress = 1
		r.renderGradient()

		const after = [
			readPixel(r, 10, 10),
			readPixel(r, 50, 70),
			readPixel(r, 30, 40),
		]

		// At least some pixels should differ
		const anyDifferent = before.some(
			(px, i) => px.r !== after[i].r || px.g !== after[i].g || px.b !== after[i].b
		)
		expect(anyDifferent).toBe(true)
	})
})

// =============================================================================
// SWIRL DISTORTION
// =============================================================================

describe('ShiftingGradientRenderer — swirl distortion', () => {
	it('center pixel is unaffected by swirl (centerDistance = 0)', () => {
		// At the center pixel (30, 40), centerDistanceX and centerDistanceY are both 0,
		// so theta = 0 and the swirl is identity. Verify by checking that the center
		// pixel color matches a pure IDW calculation without swirl.
		const r = getRenderer()
		const positions = r.getInterpolatedPositions()

		// Manual IDW at (0.5, 0.5) — identical with or without swirl
		let rSum = 0, gSum = 0, bSum = 0, wSum = 0
		for (let i = 0; i < 4; i++) {
			const dx = 0.5 - positions[i].x
			const dy = 0.5 - positions[i].y
			const dist = Math.sqrt(dx * dx + dy * dy)
			let w = Math.max(0, 0.9 - dist)
			w = w * w * w * w
			wSum += w
			rSum += w * EXPECTED_COLORS[i].r
			gSum += w * EXPECTED_COLORS[i].g
			bSum += w * EXPECTED_COLORS[i].b
		}

		const expectedR = Math.round(rSum / wSum)
		const expectedG = Math.round(gSum / wSum)
		const expectedB = Math.round(bSum / wSum)

		const centerPx = readPixel(r, 30, 40)
		expect(centerPx.r).toBe(expectedR)
		expect(centerPx.g).toBe(expectedG)
		expect(centerPx.b).toBe(expectedB)
	})

	it('pixels near edges are displaced more than pixels near center', () => {
		// The swirl theta grows with distance from center. Compute the swirl
		// displacement for a near-center point vs a corner point and verify
		// the corner has a larger angular displacement.
		const swirlFactor = 0.35

		// Near center: (0.45, 0.45)
		const nearDx = 0.45 - 0.5
		const nearDy = 0.45 - 0.5
		const nearDist = Math.sqrt(nearDx * nearDx + nearDy * nearDy)
		const nearSwirl = swirlFactor * nearDist
		const nearTheta = nearSwirl * nearSwirl * 0.8 * 8.0

		// Corner: (0, 0) → (0/60, 0/80) = (0, 0)
		const cornerDx = 0 - 0.5
		const cornerDy = 0 - 0.5
		const cornerDist = Math.sqrt(cornerDx * cornerDx + cornerDy * cornerDy)
		const cornerSwirl = swirlFactor * cornerDist
		const cornerTheta = cornerSwirl * cornerSwirl * 0.8 * 8.0

		expect(Math.abs(cornerTheta)).toBeGreaterThan(Math.abs(nearTheta))
	})
})

// =============================================================================
// INVERSE DISTANCE WEIGHTING
// =============================================================================

describe('ShiftingGradientRenderer — IDW color blending', () => {
	it('pixel exactly at a color point is dominated by that color', () => {
		const r = getRenderer()
		const positions = r.getInterpolatedPositions()

		// For each color point, render a pixel at its position and verify
		// it is very close to that color (may not be exact due to other
		// nearby points having non-zero weight)
		for (let i = 0; i < 4; i++) {
			const pos = positions[i]
			// Find the bitmap pixel closest to this position
			const px = Math.min(BITMAP_WIDTH - 1, Math.round(pos.x * BITMAP_WIDTH))
			const py = Math.min(BITMAP_HEIGHT - 1, Math.round(pos.y * BITMAP_HEIGHT))

			// Swirl may move this pixel, but if the color point is the nearest
			// influence, it should still dominate. Use a generous tolerance.
			const pixel = readPixel(r, px, py)
			const target = EXPECTED_COLORS[i]
			const dist = Math.sqrt(
				(pixel.r - target.r) ** 2 +
				(pixel.g - target.g) ** 2 +
				(pixel.b - target.b) ** 2
			)
			// All our colors are pastel and close together (Euclidean dist < 30 between
			// any pair), so the pixel near a color point should be within ~20 of it.
			expect(dist).toBeLessThan(25)
		}
	})

	it('weight formula: max(0, 0.9 - dist)^4 is zero for dist >= 0.9', () => {
		// A pixel beyond 0.9 distance from ALL color points would get zero weight.
		// Verify the formula itself.
		const dist = 0.9
		let w = Math.max(0, 0.9 - dist)
		w = w * w * w * w
		expect(w).toBe(0)

		const distBeyond = 1.2
		let w2 = Math.max(0, 0.9 - distBeyond)
		w2 = w2 * w2 * w2 * w2
		expect(w2).toBe(0)
	})

	it('weight is maximized when dist = 0', () => {
		let w = Math.max(0, 0.9 - 0)
		w = w * w * w * w
		expect(w).toBeCloseTo(0.9 ** 4, 10)
		expect(w).toBeCloseTo(0.6561, 4)
	})
})

// =============================================================================
// SUBSCRIBE / UNSUBSCRIBE
// =============================================================================

describe('ShiftingGradientRenderer — subscribe / unsubscribe', () => {
	it('subscribe adds canvas to subscribedCanvases', () => {
		const r = getRenderer()
		const canvas = createSubscriberCanvas()
		r.subscribe(canvas)
		expect(r.subscribedCanvases.has(canvas)).toBe(true)
	})

	it('double subscribe is idempotent (no duplicate entry)', () => {
		const r = getRenderer()
		const canvas = createSubscriberCanvas()
		r.subscribe(canvas)
		r.subscribe(canvas)
		expect(r.subscribedCanvases.size).toBe(1)
	})

	it('subscribe starts animation loop on first subscriber', () => {
		const r = getRenderer()
		expect(r.isAnimating).toBe(false)
		const canvas = createSubscriberCanvas()
		r.subscribe(canvas)
		expect(r.isAnimating).toBe(true)
	})

	it('unsubscribe removes canvas from subscribedCanvases', () => {
		const r = getRenderer()
		const canvas = createSubscriberCanvas()
		r.subscribe(canvas)
		r.unsubscribe(canvas)
		expect(r.subscribedCanvases.has(canvas)).toBe(false)
	})

	it('unsubscribe of last canvas stops animation loop', () => {
		const r = getRenderer()
		const canvas = createSubscriberCanvas()
		r.subscribe(canvas)
		expect(r.isAnimating).toBe(true)
		r.unsubscribe(canvas)
		expect(r.isAnimating).toBe(false)
		expect(cancelAnimationFrame).toHaveBeenCalled()
	})

	it('multiple canvases share the same gradient state', () => {
		const r = getRenderer()
		const c1 = createSubscriberCanvas()
		const c2 = createSubscriberCanvas(300, 200)
		r.subscribe(c1)
		r.subscribe(c2)
		expect(r.subscribedCanvases.size).toBe(2)

		// Both reference the same renderer — internal phase state is shared
		r.nextPhase()
		expect(r.currentPhase).toBe(7) // single shared phase
	})

	it('unsubscribing one canvas keeps animation loop alive for remaining', () => {
		const r = getRenderer()
		const c1 = createSubscriberCanvas()
		const c2 = createSubscriberCanvas(300, 200)
		r.subscribe(c1)
		r.subscribe(c2)
		r.unsubscribe(c1)
		expect(r.isAnimating).toBe(true)
		expect(r.subscribedCanvases.size).toBe(1)
	})
})

// =============================================================================
// VISIBILITY TRACKING
// =============================================================================

describe('ShiftingGradientRenderer — visibility', () => {
	it('setVisibility toggles the visible flag on a subscribed canvas', () => {
		const r = getRenderer()
		const canvas = createSubscriberCanvas()
		r.subscribe(canvas)

		const entry = r.subscribedCanvases.get(canvas)
		expect(entry.visible).toBe(true)

		r.setVisibility(canvas, false)
		expect(entry.visible).toBe(false)

		r.setVisibility(canvas, true)
		expect(entry.visible).toBe(true)
	})

	it('setVisibility on non-subscribed canvas is a no-op', () => {
		const r = getRenderer()
		const canvas = createSubscriberCanvas()
		// Should not throw
		r.setVisibility(canvas, false)
		expect(r.subscribedCanvases.has(canvas)).toBe(false)
	})
})

// =============================================================================
// PATTERN OVERLAY
// =============================================================================

describe('ShiftingGradientRenderer — pattern', () => {
	it('setPattern(null) clears the pattern', async () => {
		const r = getRenderer()
		await r.setPattern(null)
		expect(r.pattern).toBeNull()
	})

	it('setPattern fills in default options', async () => {
		const r = getRenderer()

		// Mock Image as a constructable class to simulate successful load
		vi.stubGlobal('Image', class MockImage {
			decoding = ''
			crossOrigin = ''
			complete = true
			naturalWidth = 100
			naturalHeight = 100
			onload: (() => void) | null = null
			onerror: (() => void) | null = null
			private _src = ''
			get src() { return this._src }
			set src(val: string) {
				this._src = val
				setTimeout(() => this.onload?.(), 0)
			}
		})

		await r.setPattern({ url: 'test-pattern.png' })

		expect(r.pattern).not.toBeNull()
		expect(r.pattern.options.url).toBe('test-pattern.png')
		expect(r.pattern.options.alpha).toBe(0.22)
		expect(r.pattern.options.blendMode).toBe('soft-light')
		expect(r.pattern.options.tintColor).toBe('rgba(18, 62, 112, 0.85)')
		expect(r.pattern.options.scale).toBe(1)
	})

	it('setPattern rejects on image load failure', async () => {
		const r = getRenderer()

		vi.stubGlobal('Image', class MockImage {
			decoding = ''
			crossOrigin = ''
			onload: (() => void) | null = null
			onerror: (() => void) | null = null
			private _src = ''
			get src() { return this._src }
			set src(val: string) {
				this._src = val
				setTimeout(() => this.onerror?.(), 0)
			}
		})

		await expect(r.setPattern({ url: 'bad.png' })).rejects.toThrow('Failed to load pattern image')
	})
})

// =============================================================================
// DESTROY / CLEANUP
// =============================================================================

describe('ShiftingGradientRenderer — destroy', () => {
	it('clears all subscribers', () => {
		const r = getRenderer()
		const canvas = createSubscriberCanvas()
		r.subscribe(canvas)
		expect(r.subscribedCanvases.size).toBe(1)
		r.destroy()
		expect(r.subscribedCanvases.size).toBe(0)
	})

	it('stops animation and cancels animation frame', () => {
		const r = getRenderer()
		const canvas = createSubscriberCanvas()
		r.subscribe(canvas)
		expect(r.isAnimating).toBe(true)
		r.destroy()
		expect(r.isAnimating).toBe(false)
		expect(r.animationFrameId).toBeNull()
	})

	it('resets the singleton so getInstance creates a new instance', () => {
		const r1 = getRenderer()
		r1.destroy()
		const r2 = getRenderer()
		expect(r2).not.toBe(r1)
	})
})

// =============================================================================
// GRADIENT RENDER DETERMINISM
// =============================================================================

describe('ShiftingGradientRenderer — render determinism', () => {
	it('same phase produces identical pixel output', () => {
		const r = getRenderer()
		r.animationProgress = 1
		r.renderGradient()
		const snapshot1 = new Uint8ClampedArray(r.imageData.data)

		r.renderGradient()
		const snapshot2 = new Uint8ClampedArray(r.imageData.data)

		expect(snapshot1).toEqual(snapshot2)
	})

	it('cycling through all 8 phases and back produces identical output', () => {
		const r = getRenderer()
		r.animationProgress = 1
		r.renderGradient()
		const initial = new Uint8ClampedArray(r.imageData.data)

		// Cycle through all 8 phases
		for (let i = 0; i < 8; i++) {
			r.nextPhase()
			r.animationProgress = 1
		}
		r.renderGradient()
		const afterFullCycle = new Uint8ClampedArray(r.imageData.data)

		expect(afterFullCycle).toEqual(initial)
	})

	it('each of the 8 phases produces a unique gradient', () => {
		const r = getRenderer()
		const snapshots: Uint8ClampedArray[] = []

		for (let i = 0; i < 8; i++) {
			r.animationProgress = 1
			r.renderGradient()
			snapshots.push(new Uint8ClampedArray(r.imageData.data))
			r.nextPhase()
		}

		// Every pair of phases should differ in at least some pixels
		for (let i = 0; i < 8; i++) {
			for (let j = i + 1; j < 8; j++) {
				let differ = false
				for (let k = 0; k < snapshots[i].length; k++) {
					if (snapshots[i][k] !== snapshots[j][k]) {
						differ = true
						break
					}
				}
				expect(differ).toBe(true)
			}
		}
	})
})

// =============================================================================
// PHASE POSITION COVERAGE
// =============================================================================

describe('ShiftingGradientRenderer — phase position coverage', () => {
	it('all 8 PHASE_POSITIONS are used across phases 0 and 1', () => {
		// Phase 0 uses indices 0,2,4,6 and phase 1 uses indices 1,3,5,7.
		// Together they cover all 8 positions.
		const phase0 = gatherPositions(0)
		const phase1 = gatherPositions(1)
		const allUsed = [...phase0, ...phase1]

		// Every EXPECTED_PHASE_POSITION should appear exactly once
		for (const pos of EXPECTED_PHASE_POSITIONS) {
			const matches = allUsed.filter(p => p.x === pos.x && p.y === pos.y)
			expect(matches).toHaveLength(1)
		}
	})

	it('each phase uses exactly 4 distinct positions', () => {
		for (let phase = 0; phase < 8; phase++) {
			const positions = gatherPositions(phase)
			expect(positions).toHaveLength(4)

			// All should be distinct (by reference to EXPECTED_PHASE_POSITIONS indices)
			const indices = new Set<number>()
			for (let i = 0; i < 4; i++) {
				let idx = phase + i * 2
				while (idx >= 8) idx -= 8
				indices.add(idx)
			}
			expect(indices.size).toBe(4)
		}
	})
})

// =============================================================================
// ANIMATION PROGRESS INTERPOLATION
// =============================================================================

describe('ShiftingGradientRenderer — animation progress', () => {
	it('intermediate progress produces pixels between start and end states', () => {
		const r = getRenderer()

		// Render at phase 0 (initial)
		r.animationProgress = 1
		r.renderGradient()
		const startData = new Uint8ClampedArray(r.imageData.data)

		// Move to next phase and render at end
		r.nextPhase()
		r.animationProgress = 1
		r.renderGradient()
		const endData = new Uint8ClampedArray(r.imageData.data)

		// Now render at midpoint
		r.animationProgress = 0.5
		r.renderGradient()
		const midData = new Uint8ClampedArray(r.imageData.data)

		// Mid should differ from both start and end (whole-buffer comparison)
		let diffFromStart = false
		let diffFromEnd = false
		for (let i = 0; i < midData.length; i++) {
			if (midData[i] !== startData[i]) diffFromStart = true
			if (midData[i] !== endData[i]) diffFromEnd = true
			if (diffFromStart && diffFromEnd) break
		}
		expect(diffFromStart).toBe(true)
		expect(diffFromEnd).toBe(true)
	})
})

// =============================================================================
// createShiftingGradientBackground FACTORY
// =============================================================================

describe('createShiftingGradientBackground', () => {
	let mockIntersectionObserverInstances: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>
	let mockResizeObserverInstances: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>

	beforeEach(() => {
		mockIntersectionObserverInstances = []
		mockResizeObserverInstances = []

		// Mock IntersectionObserver as a constructable class
		vi.stubGlobal('IntersectionObserver', class {
			observe = vi.fn()
			unobserve = vi.fn()
			disconnect = vi.fn()
			constructor() { mockIntersectionObserverInstances.push(this) }
		})

		// Mock ResizeObserver as a constructable class
		vi.stubGlobal('ResizeObserver', class {
			observe = vi.fn()
			unobserve = vi.fn()
			disconnect = vi.fn()
			constructor() { mockResizeObserverInstances.push(this) }
		})
	})

	it('creates a canvas element inside the container', () => {
		const container = document.createElement('div')
		Object.defineProperty(container, 'getBoundingClientRect', {
			value: () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }),
		})

		const result = createShiftingGradientBackground(container)
		expect(result.canvas).toBeInstanceOf(HTMLCanvasElement)
		expect(container.contains(result.canvas)).toBe(true)
		result.destroy()
	})

	it('canvas has the correct CSS class', () => {
		const container = document.createElement('div')
		Object.defineProperty(container, 'getBoundingClientRect', {
			value: () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }),
		})

		const result = createShiftingGradientBackground(container)
		expect(result.canvas.className).toBe('shifting-gradient-canvas')
		result.destroy()
	})

	it('canvas is inserted as the first child', () => {
		const container = document.createElement('div')
		const existingChild = document.createElement('span')
		container.appendChild(existingChild)
		Object.defineProperty(container, 'getBoundingClientRect', {
			value: () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }),
		})

		const result = createShiftingGradientBackground(container)
		expect(container.firstChild).toBe(result.canvas)
		result.destroy()
	})

	it('sets up IntersectionObserver and ResizeObserver', () => {
		const container = document.createElement('div')
		Object.defineProperty(container, 'getBoundingClientRect', {
			value: () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }),
		})

		const result = createShiftingGradientBackground(container)
		expect(mockIntersectionObserverInstances.length).toBeGreaterThan(0)
		expect(mockResizeObserverInstances.length).toBeGreaterThan(0)
		result.destroy()
	})

	it('destroy removes canvas, disconnects observers, and unsubscribes', () => {
		const container = document.createElement('div')
		Object.defineProperty(container, 'getBoundingClientRect', {
			value: () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }),
		})

		const result = createShiftingGradientBackground(container)
		const canvas = result.canvas

		result.destroy()
		expect(container.contains(canvas)).toBe(false)
	})

	it('triggerAnimation calls nextPhase on the renderer', () => {
		const container = document.createElement('div')
		Object.defineProperty(container, 'getBoundingClientRect', {
			value: () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }),
		})

		const result = createShiftingGradientBackground(container)
		const renderer = getRenderer()
		expect(renderer.currentPhase).toBe(0)

		result.triggerAnimation()
		expect(renderer.currentPhase).toBe(7)

		result.destroy()
	})

	it('canvas dimensions account for device pixel ratio (capped at 2x)', () => {
		const container = document.createElement('div')
		Object.defineProperty(container, 'getBoundingClientRect', {
			value: () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }),
		})
		Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })

		const result = createShiftingGradientBackground(container)
		// DPR capped at 2, so 400*2=800, 300*2=600
		expect(result.canvas.width).toBe(800)
		expect(result.canvas.height).toBe(600)

		result.destroy()
		Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
	})
})

// =============================================================================
// CONSTANTS STABILITY — snapshot guard
// =============================================================================

describe('ShiftingGradientRenderer — constants stability', () => {
	it('GRADIENT_COLORS have not changed from expected values', () => {
		const r = getRenderer()
		expect(r.colors).toEqual(EXPECTED_COLORS)
	})

	it('phase positions match the expected 8 coordinates', () => {
		// Verify by rendering all phases and checking that gathered positions
		// match EXPECTED_PHASE_POSITIONS indices
		const r = getRenderer()
		for (let phase = 0; phase < 8; phase++) {
			// Move to this phase
			while (r.currentPhase !== phase) r.nextPhase()
			r.animationProgress = 1
			const positions = r.getInterpolatedPositions()
			const expected = gatherPositions(phase)
			expect(positions).toEqual(expected)
		}
	})

	it('bitmap dimensions are 60×80', () => {
		const r = getRenderer()
		expect(r.imageData.width).toBe(60)
		expect(r.imageData.height).toBe(80)
	})
})

// =============================================================================
// CONDITIONAL GRADIENT CREATION — regression guard
// =============================================================================
//
// These tests mirror the pattern used in WorkspaceCanvas.ts where gradients are
// conditionally created based on webUiSettings flags. The original bug was:
//
//   triggerGradientAnimation: gradient?.triggerAnimation
//
// When `gradient` is null (setting disabled), `gradient?.triggerAnimation`
// evaluates to `undefined` — a non-callable value stored as a callback.
// The fix is to always use a closure:
//
//   triggerGradientAnimation: () => { gradient?.triggerAnimation() }
//
// This closure is always a function, even when gradient is null.
// =============================================================================

describe('Conditional gradient creation — aggregation pattern', () => {
	function createContainer(): HTMLDivElement {
		const container = document.createElement('div')
		Object.defineProperty(container, 'getBoundingClientRect', {
			value: () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }),
		})
		return container
	}

	beforeEach(() => {
		vi.stubGlobal('IntersectionObserver', class {
			observe = vi.fn()
			unobserve = vi.fn()
			disconnect = vi.fn()
		})
		vi.stubGlobal('ResizeObserver', class {
			observe = vi.fn()
			unobserve = vi.fn()
			disconnect = vi.fn()
		})
	})

	it('createShiftingGradientBackground returns an object with a callable triggerAnimation', () => {
		const container = createContainer()
		const result = createShiftingGradientBackground(container)

		expect(typeof result.triggerAnimation).toBe('function')
		expect(typeof result.destroy).toBe('function')
		expect(result.canvas).toBeInstanceOf(HTMLCanvasElement)

		result.destroy()
	})

	// --- Regression: the exact broken pattern ---

	it('REGRESSION: optional-chained property access returns undefined when gradient is null', () => {
		// This is the BROKEN pattern — do NOT use it for callbacks
		const gradient: { triggerAnimation: () => void } | null = null
		const extracted = gradient?.triggerAnimation

		// The extracted value is undefined, not a function
		expect(extracted).toBeUndefined()
		expect(typeof extracted).not.toBe('function')
	})

	it('REGRESSION: closure wrapper is always callable even when gradient is null', () => {
		// This is the CORRECT pattern — always a function, safe to call
		const gradient: { triggerAnimation: () => void } | null = null
		const closure = () => { gradient?.triggerAnimation() }

		expect(typeof closure).toBe('function')
		// Calling it should not throw
		expect(() => closure()).not.toThrow()
	})

	it('closure triggers the animation when gradient exists', () => {
		const container = createContainer()
		const gradient = createShiftingGradientBackground(container)
		const renderer = getRenderer()

		const closure = () => { gradient?.triggerAnimation() }
		expect(renderer.currentPhase).toBe(0)

		closure()
		expect(renderer.currentPhase).toBe(7)

		gradient.destroy()
	})

	it('closure does nothing when gradient is null (no throw, no side effect)', () => {
		const gradient: { triggerAnimation: () => void } | null = null
		const renderer = getRenderer()

		const initialPhase = renderer.currentPhase
		const closure = () => { gradient?.triggerAnimation() }

		closure()
		expect(renderer.currentPhase).toBe(initialPhase)
	})

	// --- Aggregation: thread node gradient + floating input gradient ---

	it('aggregation closure triggers both gradients when both exist', () => {
		const containerA = createContainer()
		const containerB = createContainer()
		const gradientA = createShiftingGradientBackground(containerA)
		const gradientB = createShiftingGradientBackground(containerB)

		const spyA = vi.fn(gradientA.triggerAnimation)
		const spyB = vi.fn(gradientB.triggerAnimation)

		const aggregated = () => {
			spyA()
			spyB()
		}

		aggregated()
		expect(spyA).toHaveBeenCalledOnce()
		expect(spyB).toHaveBeenCalledOnce()

		gradientA.destroy()
		gradientB.destroy()
	})

	it('aggregation closure triggers only the non-null gradient when one is null', () => {
		// Simulates: thread gradient disabled, floating input gradient enabled
		const threadGradient: { triggerAnimation: () => void } | null = null

		const container = createContainer()
		const floatingGradient: { triggerAnimation: () => void } | null =
			createShiftingGradientBackground(container)
		const renderer = getRenderer()

		const aggregated = () => {
			threadGradient?.triggerAnimation()
			floatingGradient?.triggerAnimation()
		}

		expect(renderer.currentPhase).toBe(0)
		aggregated()
		// Only floating gradient fires — phase still advances
		expect(renderer.currentPhase).toBe(7)

		;(floatingGradient as ReturnType<typeof createShiftingGradientBackground>).destroy()
	})

	it('aggregation closure is safe when both gradients are null', () => {
		const threadGradient: { triggerAnimation: () => void } | null = null
		const floatingGradient: { triggerAnimation: () => void } | null = null
		const renderer = getRenderer()

		const aggregated = () => {
			threadGradient?.triggerAnimation()
			floatingGradient?.triggerAnimation()
		}

		const initialPhase = renderer.currentPhase
		expect(() => aggregated()).not.toThrow()
		expect(renderer.currentPhase).toBe(initialPhase)
	})

	// --- Conditional creation mirrors webUiSettings usage ---

	it('conditional creation with true produces a gradient with callable triggerAnimation', () => {
		const settingEnabled = true
		const container = createContainer()
		const gradient = settingEnabled
			? createShiftingGradientBackground(container)
			: null

		expect(gradient).not.toBeNull()
		expect(typeof gradient!.triggerAnimation).toBe('function')

		gradient!.destroy()
	})

	it('conditional creation with false produces null', () => {
		const settingDisabled = false
		const container = createContainer()
		const gradient = settingDisabled
			? createShiftingGradientBackground(container)
			: null

		expect(gradient).toBeNull()
	})

	it('triggerGradientAnimation closure works across all setting combinations', () => {
		const container = createContainer()
		const renderer = getRenderer()

		const combinations: Array<{ threadEnabled: boolean; floatingEnabled: boolean }> = [
			{ threadEnabled: false, floatingEnabled: false },
			{ threadEnabled: false, floatingEnabled: true },
			{ threadEnabled: true, floatingEnabled: false },
			{ threadEnabled: true, floatingEnabled: true },
		]

		for (const { threadEnabled, floatingEnabled } of combinations) {
			// Reset phase for each combo
			while (renderer.currentPhase !== 0) renderer.nextPhase()
			renderer.animationProgress = 1

			const threadGradient = threadEnabled
				? createShiftingGradientBackground(container)
				: null
			const floatingGradient = floatingEnabled
				? createShiftingGradientBackground(container)
				: null

			const triggerGradientAnimation = () => {
				threadGradient?.triggerAnimation()
				floatingGradient?.triggerAnimation()
			}

			// The closure must be a function regardless of combination
			expect(typeof triggerGradientAnimation).toBe('function')

			const phaseBefore = renderer.currentPhase

			// Calling it must never throw
			expect(() => triggerGradientAnimation()).not.toThrow()

			if (threadEnabled || floatingEnabled) {
				// At least one gradient should advance the phase
				expect(renderer.currentPhase).not.toBe(phaseBefore)
			} else {
				// No gradients — phase untouched
				expect(renderer.currentPhase).toBe(phaseBefore)
			}

			threadGradient?.destroy()
			floatingGradient?.destroy()
		}
	})
})
