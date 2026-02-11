export type ZoomScalingMode =
	| 'constant'    // Constant visual size at all zoom levels (size / zoom)
	| 'adaptive'    // Shrinks at low zoom, constant at 100%, grows at high zoom

export type ZoomScalingOptions = {
	mode?: ZoomScalingMode
	lowZoomPower?: number   // Power curve for shrinking below 100% (default: 0.4)
	highZoomGrowth?: number // Linear growth rate above 100% (default: 0.5)
}

const defaultOptions: Required<ZoomScalingOptions> = {
	mode: 'constant',
	lowZoomPower: 0.4,
	highZoomGrowth: 0.5
}

// Calculates the multiplier for adaptive zoom scaling.
// - Below 100% zoom: shrinks gently with a power curve
// - At 100% zoom: returns 1 (no change)
// - Above 100% zoom: grows linearly
// Examples: zoom=0.19→0.52, zoom=0.33→0.64, zoom=1.0→1.0, zoom=1.5→1.25, zoom=2.0→1.5
export function getAdaptiveZoomMultiplier(
	zoom: number,
	options?: Pick<ZoomScalingOptions, 'lowZoomPower' | 'highZoomGrowth'>
): number {
	const { lowZoomPower, highZoomGrowth } = { ...defaultOptions, ...options }

	if (zoom < 1) {
		return Math.pow(zoom, lowZoomPower)
	}
	return 1 + (zoom - 1) * highZoomGrowth
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
	const opts = { ...defaultOptions, ...options }

	if (opts.mode === 'constant') {
		return baseSize / zoom
	}

	const multiplier = getAdaptiveZoomMultiplier(zoom, opts)
	return (baseSize * multiplier) / zoom
}

export type EdgeScalingSizes = {
	strokeWidth: number
	markerSize: number
	markerOffset: { source: number; target: number }
}

export type EdgeScalingConfig = {
	baseStrokeWidth?: number
	baseMarkerSize?: number
	baseMarkerOffset?: { source: number; target: number }
}

const defaultEdgeConfig: Required<EdgeScalingConfig> = {
	baseStrokeWidth: 2,
	baseMarkerSize: 16,
	baseMarkerOffset: { source: 6, target: 19 }
}

// Calculates edge/connector sizes scaled for the current zoom level.
// Stroke width: constant visual size (inversely scaled)
// Marker size/offset: adaptive scaling (shrinks at low zoom, grows at high)
export function getEdgeScaledSizes(
	zoom: number,
	config?: EdgeScalingConfig
): EdgeScalingSizes {
	const { baseStrokeWidth, baseMarkerSize, baseMarkerOffset } = {
		...defaultEdgeConfig,
		...config
	}

	return {
		strokeWidth: scaleForZoom(baseStrokeWidth, zoom, { mode: 'constant' }),
		markerSize: scaleForZoom(baseMarkerSize, zoom, { mode: 'adaptive' }),
		markerOffset: {
			source: scaleForZoom(baseMarkerOffset.source, zoom, { mode: 'adaptive' }),
			target: scaleForZoom(baseMarkerOffset.target, zoom, { mode: 'adaptive' })
		}
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
}

const defaultResizeHandleConfig: Required<ResizeHandleScalingConfig> = {
	baseSize: 24,
	baseOffset: 6,
	minSize: 10
}

// Calculates resize handle sizes scaled for the current zoom level.
// Both size and offset use constant visual size (inversely scaled).
export function getResizeHandleScaledSizes(
	zoom: number,
	config?: ResizeHandleScalingConfig
): ResizeHandleScalingSizes {
	const { baseSize, baseOffset, minSize } = {
		...defaultResizeHandleConfig,
		...config
	}

	const safeZoom = Math.max(zoom, 0.01)

	return {
		size: Math.max(minSize, scaleForZoom(baseSize, safeZoom, { mode: 'constant' })),
		offset: scaleForZoom(baseOffset, safeZoom, { mode: 'constant' })
	}
}
