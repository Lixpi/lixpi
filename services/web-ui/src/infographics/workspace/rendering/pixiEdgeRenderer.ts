import { Container, Graphics } from 'pixi.js'
import type { CanvasViewport } from '@lixpi/constants'
import {
    worldPointToScreenPoint,
    type PixiEdgeArrow,
    type PixiEdgeRenderDatum,
} from '$src/infographics/workspace/pixiMediaLayerLogic.ts'
import { getAdaptiveBoundedZoomScalingOptions, scaleCanvasChromeToScreenForZoom } from '@lixpi/canvas-engine'
import { settings } from '$src/settings.ts'

export type PixiEdgeRenderer = {
    render: (edges: PixiEdgeRenderDatum[], viewport: CanvasViewport) => void
    destroy: () => void
}

const MAX_PIXI_RESOLUTION = 2

// Mirrors the media-layer canvas resolution cap. Edge coordinates snap against
// this value so thin strokes stay crisp on retina displays without overfitting
// to devicePixelRatio values above the Pixi renderer cap.
function getPixiScreenResolution(): number {
    if (typeof window === 'undefined') return 1
    return Math.min(window.devicePixelRatio || 1, MAX_PIXI_RESOLUTION)
}

// PIXI edge graphics are drawn in screen coordinates on `edgeLayer`, not inside
// the world-scaled media container. Snapping to the renderer resolution keeps
// thin connector strokes from shimmering as the viewport pans by subpixels.
function snapScreenCoordinate(value: number): number {
    const resolution = getPixiScreenResolution()
    return Math.round(value * resolution) / resolution
}

function snapScreenPoint(point: [number, number]): [number, number] {
    return [snapScreenCoordinate(point[0]), snapScreenCoordinate(point[1])]
}

// Minimal SVG path parser that converts M/L/H/V/C/Q commands to PIXI Graphics
// draw calls. This avoids relying on Graphics.svg() which is not guaranteed to
// exist across all PIXI v8 minor versions.
function drawSvgPath(g: Graphics, svgPath: string, viewport: CanvasViewport): void {
    const cmdRegex = /([MmLlHhVvCcQqZz])([^MmLlHhVvCcQqZz]*)/g
    let match: RegExpExecArray | null
    let cx = 0
    let cy = 0

    function screen(x: number, y: number): [number, number] {
        const point = worldPointToScreenPoint({ x, y }, viewport)
        return snapScreenPoint([point.x, point.y])
    }

    while ((match = cmdRegex.exec(svgPath)) !== null) {
        const cmd = match[1]
        const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)

        switch (cmd) {
            case 'M': {
                cx = args[0]; cy = args[1]
                g.moveTo(...screen(cx, cy))
                for (let i = 2; i < args.length; i += 2) {
                    cx = args[i]; cy = args[i + 1]
                    g.lineTo(...screen(cx, cy))
                }
                break
            }
            case 'L': {
                for (let i = 0; i < args.length; i += 2) {
                    cx = args[i]; cy = args[i + 1]
                    g.lineTo(...screen(cx, cy))
                }
                break
            }
            case 'H': {
                cx = args[0]
                g.lineTo(...screen(cx, cy))
                break
            }
            case 'V': {
                cy = args[0]
                g.lineTo(...screen(cx, cy))
                break
            }
            case 'C': {
                for (let i = 0; i < args.length; i += 6) {
                    cx = args[i + 4]; cy = args[i + 5]
                    g.bezierCurveTo(...screen(args[i], args[i + 1]), ...screen(args[i + 2], args[i + 3]), ...screen(cx, cy))
                }
                break
            }
            case 'Q': {
                for (let i = 0; i < args.length; i += 4) {
                    cx = args[i + 2]; cy = args[i + 3]
                    g.quadraticCurveTo(...screen(args[i], args[i + 1]), ...screen(cx, cy))
                }
                break
            }
            case 'Z':
            case 'z': {
                g.closePath()
                break
            }
        }
    }
}

const ARROW_ICON_REF_X = 48
const ARROW_ICON_REF_Y = 128
const ARROWHEAD_CURVE_SEGMENTS = 8

// Replicates the arrowRightIcon shape (flaticon 9903638, 256×256 viewBox).
// refX=48, refY=128 is the path attachment point; tip extends rightward.
// The source icon uses cubic curves for the tip and tail, so sample those
// curves instead of flattening them to broad clipped polygon corners.
function drawArrowhead(g: Graphics, arrow: PixiEdgeArrow, color: string, viewport: CanvasViewport): void {
    const point = worldPointToScreenPoint({ x: arrow.x, y: arrow.y }, viewport)
    const x = point.x
    const y = point.y
    const angle = arrow.angle
    // `baseScreenSize` is the configured marker size in screen pixels. Apply the
    // adaptive bounded screen curve here, then map that final marker width onto
    // the 256px SVG icon coordinate system used by the polygon below.
    const s = scaleCanvasChromeToScreenForZoom(
        arrow.baseScreenSize,
        viewport.zoom,
        getAdaptiveBoundedZoomScalingOptions(settings.connector.scaling.zoomScaling),
    ) / 256
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    // Transform icon-space (ix, iy) -> screen space around the attachment point (x, y)
    function pt(iconX: number, iconY: number): [number, number] {
        const ix = iconX - ARROW_ICON_REF_X
        const iy = iconY - ARROW_ICON_REF_Y
        return snapScreenPoint([x + ix * s * cos - iy * s * sin, y + ix * s * sin + iy * s * cos])
    }

    const verts: Array<[number, number]> = []
    let currentIconX = 228.992
    let currentIconY = 146.827

    function addPoint(iconX: number, iconY: number): void {
        verts.push(pt(iconX, iconY))
        currentIconX = iconX
        currentIconY = iconY
    }

    function addCubicCurve(c1x: number, c1y: number, c2x: number, c2y: number, endX: number, endY: number): void {
        const startX = currentIconX
        const startY = currentIconY

        for (let step = 1; step <= ARROWHEAD_CURVE_SEGMENTS; step++) {
            const t = step / ARROWHEAD_CURVE_SEGMENTS
            const mt = 1 - t
            addPoint(
                mt * mt * mt * startX + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * endX,
                mt * mt * mt * startY + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * endY,
            )
        }
    }

    addPoint(228.992, 146.827)
    addPoint(48.594, 250.051)
    addCubicCurve(31.097, 260.049, 10.554, 242.787, 17.428, 223.845)
    addPoint(52.07, 128.003)
    addPoint(17.428, 32.16)
    addCubicCurve(10.554, 13.178, 31.097, -4.045, 48.594, 5.953)
    addPoint(228.992, 109.177)
    addCubicCurve(243.598, 117.496, 243.56, 138.508, 228.992, 146.827)

    const flat: number[] = []
    for (const [px, py] of verts) { flat.push(px, py) }
    g.beginPath()
    g.poly(flat)
    g.closePath()
    g.fill(color)
}

// Stable datum fingerprint used to detect when an edge actually changed.
// Only redraws the Graphics object when the path, color, base width, arrows,
// or current viewport differ.
function edgeDatumKey(e: PixiEdgeRenderDatum, viewport: CanvasViewport): string {
    const a = e.arrowEnd ? `${e.arrowEnd.x},${e.arrowEnd.y},${e.arrowEnd.angle},${e.arrowEnd.baseScreenSize}` : ''
    const b = e.arrowStart ? `${e.arrowStart.x},${e.arrowStart.y},${e.arrowStart.angle},${e.arrowStart.baseScreenSize}` : ''
    return `${viewport.x},${viewport.y},${viewport.zoom}|${e.svgPath}|${e.strokeColor}|${e.baseScreenStrokeWidth}|${e.isDashed ? 1 : 0}|${a}|${b}`
}

export function createPixiEdgeRenderer(container: Container): PixiEdgeRenderer {
    // Map of edgeId → { Graphics, last datum key }. Graphics are reused
    // across renders; geometry is only rebuilt when the datum fingerprint
    // changes. This avoids the original O(edges) destroy+alloc+GPU-upload
    // cycle on every `scheduleEdgesRender` call.
    const edgeGraphics = new Map<string, { g: Graphics; key: string }>()

    // Teardown-only destruction path. Normal render hides missing edges so Pixi
    // does not destroy Graphics buffers while WebGPU may still be submitting.
    function destroyEntry(entry: { g: Graphics }): void {
        container.removeChild(entry.g)
        entry.g.destroy()
    }

    // Keep the DisplayObject and GPU allocations around for reuse, but remove
    // it from drawing and hit-testing.
    function hideEntry(entry: { g: Graphics }): void {
        entry.g.renderable = false
    }

    // Rebuilds one edge Graphics object from the latest projected path. This is
    // only called when the stable datum key changes.
    function paintEdge(g: Graphics, edge: PixiEdgeRenderDatum, viewport: CanvasViewport): void {
        // `edgeLayer` is already screen-space. The SVG path points are projected
        // manually in `drawSvgPath`, so stroke width must be computed as a final
        // screen-pixel value. Do not pass a world-scaled stroke width here or the
        // connector will be compensated twice and drift against the arrowheads.
        const screenStrokeWidth = scaleCanvasChromeToScreenForZoom(
            edge.baseScreenStrokeWidth,
            viewport.zoom,
            getAdaptiveBoundedZoomScalingOptions(settings.connector.scaling.zoomScaling),
        )
        g.clear()
        g.beginPath()
        drawSvgPath(g, edge.svgPath, viewport)
        g.stroke({
            color: edge.strokeColor,
            width: screenStrokeWidth,
            cap: 'round',
            join: 'round',
        })
        if (edge.arrowEnd) drawArrowhead(g, edge.arrowEnd, edge.strokeColor, viewport)
        if (edge.arrowStart) drawArrowhead(g, edge.arrowStart, edge.strokeColor, viewport)
    }

    // Reconciles all visible edges. Existing Graphics objects are reused and
    // hidden when absent so edge sync remains cheap during drag/pan/zoom.
    function render(edges: PixiEdgeRenderDatum[], viewport: CanvasViewport): void {
        const incomingIds = new Set(edges.map((e) => e.id))

        // Hide Graphics for edges that no longer exist. Destroying PIXI
        // buffers during the same frame WebGPU is submitting can invalidate
        // queued command buffers, so normal sync keeps objects reusable.
        for (const [id, entry] of edgeGraphics) {
            if (!incomingIds.has(id)) hideEntry(entry)
        }

        // Update or create Graphics for each incoming edge.
        for (const edge of edges) {
            const key = edgeDatumKey(edge, viewport)
            const existing = edgeGraphics.get(edge.id)

            if (existing) {
                existing.g.renderable = true
                // Reuse Graphics object. Only repaint if the edge actually changed.
                if (existing.key !== key) {
                    paintEdge(existing.g, edge, viewport)
                    existing.key = key
                }
            } else {
                const g = new Graphics()
                container.addChild(g)
                paintEdge(g, edge, viewport)
                edgeGraphics.set(edge.id, { g, key })
            }
        }
    }

    // Releases every edge object when the whole renderer is torn down.
    function destroy(): void {
        for (const entry of edgeGraphics.values()) destroyEntry(entry)
        edgeGraphics.clear()
    }

    return { render, destroy }
}
