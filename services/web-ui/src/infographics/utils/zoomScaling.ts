export type ZoomScalingMode =
	| 'constant'    // Constant visual size at all zoom levels (size / zoom)
	| 'adaptive'    // Shrinks at low zoom, constant at 100%, grows at high zoom

export type AdaptiveZoomScalingOptions = {
	lowZoomPower?: number   // Power curve for shrinking below 100% (default: 0.4)
	highZoomGrowth?: number // Linear growth rate above 100% (default: 0.5)
	minMultiplier?: number  // Lower visual-scale clamp for very low zoom
	maxMultiplier?: number  // Upper visual-scale clamp for very high zoom
}

export type ZoomScalingOptions = AdaptiveZoomScalingOptions & {
	mode?: ZoomScalingMode
}

export type BoundedZoomScalingOptions = {
	minZoom: number
	lowZoomPower?: number
}

export type CanvasChromeScreenLayoutConfig = {
	viewport: {
		x: number
		y: number
		zoom: number
	}
	worldPosition: {
		x: number
		y: number
	}
	worldDimensions: {
		width: number
		height: number
	}
	baseGap: number
	zoomScaling: BoundedZoomScalingOptions
}

export type CanvasChromeScreenLayout = {
	left: number
	top: number
	layoutWidth: number
	screenScale: number
	screenGap: number
	screenWidth: number
}

const defaultOptions: Required<ZoomScalingOptions> = {
	mode: 'constant',
	lowZoomPower: 0.4,
	highZoomGrowth: 0.5,
	minMultiplier: 0,
	maxMultiplier: Number.POSITIVE_INFINITY
}

function safeZoom(zoom: number): number {
	return Number.isFinite(zoom) ? Math.max(zoom, 0.01) : 1
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

function getBoundedChromeScreenMultiplier(zoom: number, minZoom: number, lowZoomPower?: number): number {
	const z = safeZoom(zoom)
	const effectiveMinZoom = safeZoom(minZoom)
	const boundedConstantMultiplier = z / Math.max(z, effectiveMinZoom)

	if (lowZoomPower === undefined) return boundedConstantMultiplier

	const lowZoomMultiplier = Math.pow(Math.min(z, 1), lowZoomPower)

	if (z >= effectiveMinZoom) return lowZoomMultiplier

	return Math.pow(Math.min(effectiveMinZoom, 1), lowZoomPower) * (z / effectiveMinZoom)
}

export function getAdaptiveBoundedZoomScalingOptions(options: BoundedZoomScalingOptions): BoundedZoomScalingOptions {
	return {
		...options,
		lowZoomPower: options.lowZoomPower ?? defaultOptions.lowZoomPower,
	}
}

// Calculates the multiplier for adaptive zoom scaling.
// - Below 100% zoom: shrinks gently with a power curve
// - At 100% zoom: returns 1 (no change)
// - Above 100% zoom: grows linearly
// - Optional multiplier clamps stop chrome from becoming unusably small or large
// Examples: zoom=0.19→0.52, zoom=0.33→0.64, zoom=1.0→1.0, zoom=1.5→1.25, zoom=2.0→1.5
export function getAdaptiveZoomMultiplier(
	zoom: number,
	options?: AdaptiveZoomScalingOptions
): number {
	const { lowZoomPower, highZoomGrowth, minMultiplier, maxMultiplier } = { ...defaultOptions, ...options }
	const z = safeZoom(zoom)

	const multiplier = z < 1
		? Math.pow(z, lowZoomPower)
		: 1 + (z - 1) * highZoomGrowth

	return clamp(multiplier, minMultiplier, maxMultiplier)
}

export function scaleCanvasChromeWorldSizeForZoom(
	baseSize: number,
	zoom: number,
	options: BoundedZoomScalingOptions
): number {
	const z = safeZoom(zoom)
	const { minZoom } = options
	const screenMultiplier = getBoundedChromeScreenMultiplier(z, minZoom, options.lowZoomPower)
	return (baseSize * screenMultiplier) / z
}

export function scaleCanvasChromeScreenSizeForZoom(
	baseSize: number,
	zoom: number,
	options: BoundedZoomScalingOptions
): number {
	const z = safeZoom(zoom)
	const { minZoom } = options
	return baseSize * getBoundedChromeScreenMultiplier(z, minZoom, options.lowZoomPower)
}

export function scaleCanvasChromeForZoom(
	baseSize: number,
	zoom: number,
	options: BoundedZoomScalingOptions
): number {
	return scaleCanvasChromeWorldSizeForZoom(baseSize, zoom, options)
}

export function scaleCanvasChromeToScreenForZoom(
	baseSize: number,
	zoom: number,
	options: BoundedZoomScalingOptions
): number {
	return scaleCanvasChromeScreenSizeForZoom(baseSize, zoom, options)
}

// Geometry for floating DOM chrome mounted outside the transformed viewport.
// World coordinates are projected once into screen coordinates. The returned
// layout width expands when low-zoom chrome thins so the transformed right edge
// still matches the projected media right edge.
export function getCanvasChromeScreenLayout(
	config: CanvasChromeScreenLayoutConfig
): CanvasChromeScreenLayout {
	const { viewport, worldPosition, worldDimensions, baseGap, zoomScaling } = config
	const zoom = safeZoom(viewport.zoom)
	const screenScale = scaleCanvasChromeScreenSizeForZoom(1, zoom, zoomScaling)
	const screenGap = scaleCanvasChromeScreenSizeForZoom(baseGap, zoom, zoomScaling)
	const screenWidth = worldDimensions.width * zoom

	return {
		left: viewport.x + worldPosition.x * zoom,
		top: viewport.y + (worldPosition.y + worldDimensions.height) * zoom + screenGap,
		layoutWidth: screenWidth / screenScale,
		screenScale,
		screenGap,
		screenWidth,
	}
}

function getZoomScalingOptions(options?: ZoomScalingOptions): Required<ZoomScalingOptions> {
	return {
		...defaultOptions,
		...options
	}
}

// Scales a base size for canvas coordinates based on zoom level.
// Handles inverse scaling so shapes appear at correct visual size regardless of zoom.
// Constant mode: always same visual size (e.g. scaleForZoom(2, 0.5) → 4)
// Adaptive mode: shrinks at low zoom, grows at high zoom
export function scaleForZoom(
	baseSize: number,
	zoom: number,
	options?: ZoomScalingOptions
): number {
	const opts = getZoomScalingOptions(options)
	const z = safeZoom(zoom)

	if (opts.mode === 'constant') {
		return baseSize / z
	}

	const multiplier = getAdaptiveZoomMultiplier(zoom, opts)
	return (baseSize * multiplier) / z
}

export type EdgeScalingSizes = {
	strokeWidth: number
	markerSize: number
	markerOffset: { source: number; target: number }
	clickAreaWidth: number
}

export type EdgeScalingConfig = {
	baseStrokeWidth?: number
	baseMarkerSize?: number
	baseMarkerOffset?: { source: number; target: number }
	baseClickAreaWidth?: number
	zoomScaling: BoundedZoomScalingOptions
}

const defaultEdgeConfig = {
	baseStrokeWidth: 2,
	baseMarkerSize: 16,
	baseMarkerOffset: { source: 6, target: 19 },
	baseClickAreaWidth: 24
}

// Calculates edge/connector sizes in viewport world units. Plain bounded
// options keep screen size constant above minZoom; adaptive bounded options
// shrink below 100%, then freeze world size below the lower threshold so
// overview zooms keep thinning chrome instead of making it dominate the canvas.
export function getEdgeScaledSizes(
	zoom: number,
	config: EdgeScalingConfig
): EdgeScalingSizes {
	const { baseStrokeWidth, baseMarkerSize, baseMarkerOffset, baseClickAreaWidth } = {
		...defaultEdgeConfig,
		...config
	}
	const { zoomScaling } = config

	return {
		strokeWidth: scaleCanvasChromeWorldSizeForZoom(baseStrokeWidth, zoom, zoomScaling),
		markerSize: scaleCanvasChromeWorldSizeForZoom(baseMarkerSize, zoom, zoomScaling),
		markerOffset: {
			source: scaleCanvasChromeWorldSizeForZoom(baseMarkerOffset.source, zoom, zoomScaling),
			target: scaleCanvasChromeWorldSizeForZoom(baseMarkerOffset.target, zoom, zoomScaling)
		},
		clickAreaWidth: scaleCanvasChromeWorldSizeForZoom(baseClickAreaWidth, zoom, zoomScaling)
	}
}

export type ResizeHandleScalingSizes = {
	size: number
	offset: number
}

export type ResizeHandleScalingConfig = {
	baseSize?: number
	baseOffset?: number
	minSize?: number
	zoomScaling: BoundedZoomScalingOptions
}

const defaultResizeHandleConfig = {
	baseSize: 24,
	baseOffset: 6,
	minSize: 10
}

// Calculates resize handle sizes scaled for the current zoom level.
// Both size and offset use the configured bounded chrome curve.
export function getResizeHandleScaledSizes(
	zoom: number,
	config: ResizeHandleScalingConfig
): ResizeHandleScalingSizes {
	const { baseSize, baseOffset, minSize } = {
		...defaultResizeHandleConfig,
		...config
	}
	const { zoomScaling } = config

	return {
		size: Math.max(minSize, scaleCanvasChromeWorldSizeForZoom(baseSize, zoom, zoomScaling)),
		offset: scaleCanvasChromeWorldSizeForZoom(baseOffset, zoom, zoomScaling)
	}
}
