export type ZoomScalingMode =
    | 'constant' // Constant visual size at all zoom levels (size / zoom)
    | 'adaptive' // Shrinks at low zoom, constant at 100%, grows at high zoom

export type AdaptiveZoomScalingOptions = {
    lowZoomPower?: number // Generic adaptive power below 100% (default: 0.4; bounded canvas chrome adapts separately)
    highZoomGrowth?: number // Linear growth rate above 100% (default: 0.5)
    minMultiplier?: number // Lower visual-scale clamp for very low zoom
    maxMultiplier?: number // Upper visual-scale clamp for very high zoom
}

export type ZoomScalingOptions = AdaptiveZoomScalingOptions & {
    mode?: ZoomScalingMode
}

// Bounded zoom scaling is used for canvas chrome whose visual size must not be
// a direct function of node/world size. Examples include connector strokes,
// arrowheads, resize handles, bubble menus, and generated-media info chrome.
//
// `minZoom` is the lower compensation breakpoint, not the viewport's allowed
// minimum zoom. Above this breakpoint, plain bounded scaling can counteract the
// viewport transform. Below it, world-size scaling freezes and the rendered
// screen size continues to thin with the overview.
//
// `lowZoomPower` opts into perceptual low-zoom shrink. With this value omitted,
// the helper preserves the original bounded-constant behavior. With it present,
// the screen-size multiplier is `zoom ** lowZoomPower` between 100% and
// `minZoom`, so chrome gently shrinks as the canvas zooms out instead of
// staying mathematically constant and looking large relative to the content.
export type BoundedZoomScalingOptions = {
    minZoom: number
    lowZoomPower?: number
}

// Layout contract for DOM chrome mounted outside a CSS-transformed viewport.
// `viewport` is the live screen transform: screen = world * zoom + x/y.
// `worldPosition` and `worldDimensions` describe the node in canvas units.
// `baseGap` is the desired screen-space gap before applying bounded scaling.
// `zoomScaling` selects the bounded curve used for both the gap and chrome size.
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
    // Screen-space left edge of the unscaled chrome wrapper.
    left: number
    // Screen-space top edge of the unscaled chrome wrapper.
    top: number
    // CSS layout width before the wrapper's `transform: scale(screenScale)`.
    // This expands when low-zoom chrome shrinks so the transformed right edge
    // still lines up with the projected media-node right edge.
    layoutWidth: number
    // Final visual multiplier applied to the chrome wrapper. A 34px icon renders
    // as `34 * screenScale` screen pixels.
    screenScale: number
    // Final screen-space gap between the projected media node and the chrome.
    screenGap: number
    // Projected media width in screen pixels before chrome compensation.
    screenWidth: number
}

// Default exponent for canvas chrome that should shrink a little while zooming
// out. 0.45 is intentionally close to the older 0.4 adaptive curve, but gives a
// small extra reduction at overview zooms so fixed controls do not read larger
// than the media or connector geometry around them.
const defaultAdaptiveBoundedLowZoomPower = 0.45

const defaultOptions: Required<ZoomScalingOptions> = {
    mode: 'constant',
    lowZoomPower: 0.4,
    highZoomGrowth: 0.5,
    minMultiplier: 0,
    maxMultiplier: Number.POSITIVE_INFINITY,
}

const safeZoom = (zoom: number): number => (Number.isFinite(zoom) ? Math.max(zoom, 0.01) : 1)

const clamp = (
    value: number,
    min: number,
    max: number,
): number => {
    return Math.min(
        max,
        Math.max(min, value),
    )
}

const getBoundedChromeScreenMultiplier = (
    zoom: number,
    minZoom: number,
    lowZoomPower?: number,
): number => {
    const z = safeZoom(zoom)
    const effectiveMinZoom = safeZoom(minZoom)
    const boundedConstantMultiplier = z / Math.max(z, effectiveMinZoom)

    // Return a final screen-space multiplier. `1` means "render at the configured
    // base pixels"; `0.7` means "render at 70% of the configured pixels". World-
    // space helpers divide this value by zoom later, while screen-space helpers
    // use it directly.
    //
    // Compatibility path: without `lowZoomPower`, bounded scaling keeps the
    // rendered screen size constant from `minZoom` upward and thins only below
    // that lower breakpoint. Tests and older call sites rely on this behavior.
    if (lowZoomPower === undefined)
        return boundedConstantMultiplier

    // Adaptive path: at 100% and above, `Math.min(z, 1)` clamps the multiplier to
    // 1, so canvas chrome never grows larger than its configured base pixels.
    // Between 100% and `minZoom`, the power curve gently shrinks the chrome. This
    // fixes the perceptual problem where mathematically constant pixels look
    // larger as the underlying node/image shrinks on zoom-out.
    const lowZoomMultiplier = Math.pow(
        Math.min(z, 1),
        lowZoomPower,
    )

    if (z >= effectiveMinZoom)
        return lowZoomMultiplier

    // Below `minZoom`, freeze the world-size compensation at the value computed
    // for `minZoom`, then let the viewport keep reducing the final screen size.
    // This keeps overview zooms readable without oversized connector lines,
    // icon buttons, resize handles, or bubble menus.
    return Math.pow(
        Math.min(effectiveMinZoom, 1),
        lowZoomPower,
    ) * (z / effectiveMinZoom)
}

// Converts a plain `{ minZoom }` bounded config into the adaptive bounded curve
// used by canvas chrome. Keeping this as an explicit adapter makes call sites
// state their coordinate-space intent instead of silently changing every helper
// use in the codebase.
export const getAdaptiveBoundedZoomScalingOptions = (options: BoundedZoomScalingOptions): BoundedZoomScalingOptions => {
    return {
        ...options,
        lowZoomPower: options.lowZoomPower ?? defaultAdaptiveBoundedLowZoomPower,
    }
}

// Calculates the multiplier for adaptive zoom scaling.
// - Below 100% zoom: shrinks gently with a power curve
// - At 100% zoom: returns 1 (no change)
// - Above 100% zoom: grows linearly
// - Optional multiplier clamps stop chrome from becoming unusably small or large
// Examples: zoom=0.19→0.52, zoom=0.33→0.64, zoom=1.0→1.0, zoom=1.5→1.25, zoom=2.0→1.5
export const getAdaptiveZoomMultiplier = (
    zoom: number,
    options?: AdaptiveZoomScalingOptions,
): number => {
    const {
        lowZoomPower,
        highZoomGrowth,
        minMultiplier,
        maxMultiplier,
    } = {
        ...defaultOptions,
        ...options,
    }
    const z = safeZoom(zoom)

    const multiplier = z < 1
        ? Math.pow(z, lowZoomPower)
        : 1 + (z - 1) * highZoomGrowth

    return clamp(
        multiplier,
        minMultiplier,
        maxMultiplier,
    )
}

export const scaleCanvasChromeWorldSizeForZoom = (
    baseSize: number,
    zoom: number,
    options: BoundedZoomScalingOptions,
): number => {
    const z = safeZoom(zoom)
    const { minZoom } = options
    const screenMultiplier = getBoundedChromeScreenMultiplier(
        z,
        minZoom,
        options.lowZoomPower,
    )

    // Parameters:
    // `baseSize` is the configured pixel size at 100% zoom, before any viewport
    // compensation. `zoom` is the current viewport scale. `options` contains the
    // lower breakpoint and, optionally, the adaptive low-zoom exponent.
    //
    // World-space chrome lives inside a viewport that will be multiplied by
    // `zoom` later. Divide the desired final screen size by the current zoom so
    // the viewport transform produces the intended visible pixel size.
    return (baseSize * screenMultiplier) / z
}

export const scaleCanvasChromeScreenSizeForZoom = (
    baseSize: number,
    zoom: number,
    options: BoundedZoomScalingOptions,
): number => {
    const z = safeZoom(zoom)
    const { minZoom } = options

    // Parameters match `scaleCanvasChromeWorldSizeForZoom`, but the return value
    // is already a final CSS/screen pixel size. Use this for overlays that are not
    // children of the transformed viewport and for PIXI layers that project world
    // coordinates into screen coordinates before drawing.
    //
    // Screen-space chrome has already projected world coordinates into pixels.
    // Return the final pixel size directly; callers must not divide by zoom again.
    return baseSize * getBoundedChromeScreenMultiplier(
        z,
        minZoom,
        options.lowZoomPower,
    )
}

export const scaleCanvasChromeForZoom = (
    baseSize: number,
    zoom: number,
    options: BoundedZoomScalingOptions,
): number => {
    // Compatibility wrapper for older world-space call sites.
    return scaleCanvasChromeWorldSizeForZoom(
        baseSize,
        zoom,
        options,
    )
}

export const scaleCanvasChromeToScreenForZoom = (
    baseSize: number,
    zoom: number,
    options: BoundedZoomScalingOptions,
): number => {
    // Compatibility wrapper for older screen-space call sites.
    return scaleCanvasChromeScreenSizeForZoom(
        baseSize,
        zoom,
        options,
    )
}

// Geometry for floating DOM chrome mounted outside the transformed viewport.
// World coordinates are projected once into screen coordinates. The returned
// layout width expands when low-zoom chrome thins so the transformed right edge
// still matches the projected media right edge.
export const getCanvasChromeScreenLayout = (config: CanvasChromeScreenLayoutConfig): CanvasChromeScreenLayout => {
    const {
        viewport,
        worldPosition,
        worldDimensions,
        baseGap,
        zoomScaling,
    } = config
    const zoom = safeZoom(viewport.zoom)
    const screenScale = scaleCanvasChromeScreenSizeForZoom(
        1,
        zoom,
        zoomScaling,
    )
    const screenGap = scaleCanvasChromeScreenSizeForZoom(
        baseGap,
        zoom,
        zoomScaling,
    )
    const screenWidth = worldDimensions.width * zoom

    return {
        // Project the media node's left edge from world coordinates to screen
        // coordinates. This layer is not inside the viewport transform.
        left: viewport.x + worldPosition.x * zoom,
        // Project the media node's bottom edge, then add the bounded screen-space
        // gap. The gap follows the same curve as the chrome icons.
        top: viewport.y + (worldPosition.y + worldDimensions.height) * zoom + screenGap,
        // The wrapper is scaled after layout. Expanding the layout width by the
        // inverse scale preserves right-edge alignment with the media node.
        layoutWidth: screenWidth / screenScale,
        screenScale,
        screenGap,
        screenWidth,
    }
}

const getZoomScalingOptions = (options?: ZoomScalingOptions): Required<ZoomScalingOptions> => {
    return {
        ...defaultOptions,
        ...options,
    }
}

// Scales a base size for canvas coordinates based on zoom level.
// Handles inverse scaling so shapes appear at correct visual size regardless of zoom.
// Constant mode: always same visual size (e.g. scaleForZoom(2, 0.5) → 4)
// Adaptive mode: shrinks at low zoom, grows at high zoom
export const scaleForZoom = (
    baseSize: number,
    zoom: number,
    options?: ZoomScalingOptions,
): number => {
    const opts = getZoomScalingOptions(options)
    const z = safeZoom(zoom)

    if (opts.mode === 'constant')
        return baseSize / z

    const multiplier = getAdaptiveZoomMultiplier(zoom, opts)

    return (baseSize * multiplier) / z
}

export type EdgeScalingSizes = {
    strokeWidth: number
    markerSize: number
    markerOffset: {
        source: number
        target: number
    }
    clickAreaWidth: number
}

export type EdgeScalingConfig = {
    baseStrokeWidth?: number
    baseMarkerSize?: number
    baseMarkerOffset?: {
        source: number
        target: number
    }
    baseClickAreaWidth?: number
    zoomScaling: BoundedZoomScalingOptions
}

const defaultEdgeConfig = {
    baseStrokeWidth: 2,
    baseMarkerSize: 16,
    baseMarkerOffset: {
        source: 6,
        target: 19,
    },
    baseClickAreaWidth: 24,
}

// Calculates edge/connector sizes in viewport world units. Plain bounded
// options keep screen size constant above minZoom; adaptive bounded options
// shrink below 100%, then freeze world size below the lower threshold so
// overview zooms keep thinning chrome instead of making it dominate the canvas.
export const getEdgeScaledSizes = (
    zoom: number,
    config: EdgeScalingConfig,
): EdgeScalingSizes => {
    const {
        baseStrokeWidth,
        baseMarkerSize,
        baseMarkerOffset,
        baseClickAreaWidth,
    } = {
        ...defaultEdgeConfig,
        ...config,
    }
    const { zoomScaling } = config

    // Every returned value is in world units. That is correct for connector
    // geometry: marker offsets change where the path starts/ends, and click area
    // width is used by world-space hit testing. Screen-space renderers should
    // carry their configured base pixels separately and call
    // `scaleCanvasChromeScreenSizeForZoom` while painting.
    return {
        strokeWidth: scaleCanvasChromeWorldSizeForZoom(
            baseStrokeWidth,
            zoom,
            zoomScaling,
        ),
        markerSize: scaleCanvasChromeWorldSizeForZoom(
            baseMarkerSize,
            zoom,
            zoomScaling,
        ),
        markerOffset: {
            source: scaleCanvasChromeWorldSizeForZoom(
                baseMarkerOffset.source,
                zoom,
                zoomScaling,
            ),
            target: scaleCanvasChromeWorldSizeForZoom(
                baseMarkerOffset.target,
                zoom,
                zoomScaling,
            ),
        },
        clickAreaWidth: scaleCanvasChromeWorldSizeForZoom(
            baseClickAreaWidth,
            zoom,
            zoomScaling,
        ),
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
    minSize: 10,
}

// Calculates resize handle sizes scaled for the current zoom level.
// Both size and offset use the configured bounded chrome curve.
export const getResizeHandleScaledSizes = (
    zoom: number,
    config: ResizeHandleScalingConfig,
): ResizeHandleScalingSizes => {
    const {
        baseSize,
        baseOffset,
        minSize,
    } = {
        ...defaultResizeHandleConfig,
        ...config,
    }
    const { zoomScaling } = config

    // Resize handles are authored as screen-pixel design values but most handle
    // DOM is mounted inside transformed node chrome. Return world-unit CSS sizes
    // so the browser viewport transform produces the bounded adaptive screen
    // size. Pointer hit testing that uses `clientX/clientY` must multiply these
    // returned values by zoom before comparing screen coordinates.
    return {
        size: Math.max(
            minSize,
            scaleCanvasChromeWorldSizeForZoom(
                baseSize,
                zoom,
                zoomScaling,
            ),
        ),
        offset: scaleCanvasChromeWorldSizeForZoom(
            baseOffset,
            zoom,
            zoomScaling,
        ),
    }
}
