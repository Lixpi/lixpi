import { Container, Graphics } from 'pixi.js'
import type { CanvasViewport } from '@lixpi/constants'
import {
    worldPointToScreenPoint,
    type PixiEdgeArrow,
    type PixiEdgeRenderDatum,
} from '$src/infographics/workspace/pixiMediaLayerLogic.ts'
import { scaleCanvasChromeToScreenForZoom } from '$src/infographics/utils/zoomScaling.ts'

export type PixiEdgeRenderer = {
    render: (edges: PixiEdgeRenderDatum[], viewport: CanvasViewport) => void
    destroy: () => void
}

const MAX_PIXI_RESOLUTION = 2

function getPixiScreenResolution(): number {
    if (typeof window === 'undefined') return 1
    return Math.min(window.devicePixelRatio || 1, MAX_PIXI_RESOLUTION)
}

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

// Replicates the arrowRightIcon shape (flaticon 9903638, 256×256 viewBox).
// refX=48, refY=128 is the path attachment point; tip extends rightward.
// Key vertices in icon space (relative to refX/refY), traced from the SVG path:
//   tipTop=(181,-19), tipBottom=(181,19),
//   lowerOuter=(1,122), lowerInner=(-31,96), notch=(4,0),
//   upperInner=(-31,-96), upperOuter=(1,-122)
function drawArrowhead(g: Graphics, arrow: PixiEdgeArrow, color: string, viewport: CanvasViewport): void {
    const point = worldPointToScreenPoint({ x: arrow.x, y: arrow.y }, viewport)
    const x = point.x
    const y = point.y
    const angle = arrow.angle
    const s = scaleCanvasChromeToScreenForZoom(arrow.size, viewport.zoom) / 256  // scale factor: markerWidth=size maps to 256px viewBox
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    // Transform icon-space (ix, iy) → screen space around the attachment point (x, y)
    function pt(ix: number, iy: number): [number, number] {
        return snapScreenPoint([x + ix * s * cos - iy * s * sin, y + ix * s * sin + iy * s * cos])
    }

    const verts = [
        pt(181, -19),   // tip top
        pt(181,  19),   // tip bottom
        pt(  1, 122),   // lower outer
        pt(-31,  96),   // lower inner (V-notch bottom)
        pt(  4,   0),   // notch center
        pt(-31, -96),   // upper inner (V-notch top)
        pt(  1, -122),  // upper outer
    ]

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
    const a = e.arrowEnd ? `${e.arrowEnd.x},${e.arrowEnd.y},${e.arrowEnd.angle},${e.arrowEnd.size}` : ''
    const b = e.arrowStart ? `${e.arrowStart.x},${e.arrowStart.y},${e.arrowStart.angle},${e.arrowStart.size}` : ''
    return `${viewport.x},${viewport.y},${viewport.zoom}|${e.svgPath}|${e.strokeColor}|${e.strokeWidth}|${e.isDashed ? 1 : 0}|${a}|${b}`
}

export function createPixiEdgeRenderer(container: Container): PixiEdgeRenderer {
    // Map of edgeId → { Graphics, last datum key }. Graphics are reused
    // across renders; geometry is only rebuilt when the datum fingerprint
    // changes. This avoids the original O(edges) destroy+alloc+GPU-upload
    // cycle on every `scheduleEdgesRender` call.
    const edgeGraphics = new Map<string, { g: Graphics; key: string }>()

    function destroyEntry(entry: { g: Graphics }): void {
        container.removeChild(entry.g)
        entry.g.destroy()
    }

    function paintEdge(g: Graphics, edge: PixiEdgeRenderDatum, viewport: CanvasViewport): void {
        const screenStrokeWidth = scaleCanvasChromeToScreenForZoom(edge.strokeWidth, viewport.zoom)
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

    function render(edges: PixiEdgeRenderDatum[], viewport: CanvasViewport): void {
        const incomingIds = new Set(edges.map((e) => e.id))

        // Remove Graphics for edges that no longer exist.
        for (const [id, entry] of edgeGraphics) {
            if (!incomingIds.has(id)) {
                destroyEntry(entry)
                edgeGraphics.delete(id)
            }
        }

        // Update or create Graphics for each incoming edge.
        for (const edge of edges) {
            const key = edgeDatumKey(edge, viewport)
            const existing = edgeGraphics.get(edge.id)

            if (existing) {
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

    function destroy(): void {
        for (const entry of edgeGraphics.values()) destroyEntry(entry)
        edgeGraphics.clear()
    }

    return { render, destroy }
}
