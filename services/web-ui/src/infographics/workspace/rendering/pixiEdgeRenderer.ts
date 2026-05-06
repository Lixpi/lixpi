import { Container, Graphics } from 'pixi.js'
import type { PixiEdgeArrow, PixiEdgeRenderDatum } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

export type PixiEdgeRenderer = {
    render: (edges: PixiEdgeRenderDatum[]) => void
    destroy: () => void
}

// Minimal SVG path parser that converts M/L/H/V/C/Q commands to PIXI Graphics
// draw calls. This avoids relying on Graphics.svg() which is not guaranteed to
// exist across all PIXI v8 minor versions.
function drawSvgPath(g: Graphics, svgPath: string): void {
    const cmdRegex = /([MmLlHhVvCcQqZz])([^MmLlHhVvCcQqZz]*)/g
    let match: RegExpExecArray | null
    let cx = 0
    let cy = 0

    while ((match = cmdRegex.exec(svgPath)) !== null) {
        const cmd = match[1]
        const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)

        switch (cmd) {
            case 'M': {
                cx = args[0]; cy = args[1]
                g.moveTo(cx, cy)
                for (let i = 2; i < args.length; i += 2) {
                    cx = args[i]; cy = args[i + 1]
                    g.lineTo(cx, cy)
                }
                break
            }
            case 'L': {
                for (let i = 0; i < args.length; i += 2) {
                    cx = args[i]; cy = args[i + 1]
                    g.lineTo(cx, cy)
                }
                break
            }
            case 'H': {
                cx = args[0]
                g.lineTo(cx, cy)
                break
            }
            case 'V': {
                cy = args[0]
                g.lineTo(cx, cy)
                break
            }
            case 'C': {
                for (let i = 0; i < args.length; i += 6) {
                    cx = args[i + 4]; cy = args[i + 5]
                    g.bezierCurveTo(args[i], args[i + 1], args[i + 2], args[i + 3], cx, cy)
                }
                break
            }
            case 'Q': {
                for (let i = 0; i < args.length; i += 4) {
                    cx = args[i + 2]; cy = args[i + 3]
                    g.quadraticCurveTo(args[i], args[i + 1], cx, cy)
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
function drawArrowhead(g: Graphics, arrow: PixiEdgeArrow, color: string): void {
    const { x, y, angle, size } = arrow
    const s = size / 256  // scale factor: markerWidth=size maps to 256px viewBox
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    // Transform icon-space (ix, iy) → world space around the attachment point (x, y)
    function pt(ix: number, iy: number): [number, number] {
        return [x + ix * s * cos - iy * s * sin, y + ix * s * sin + iy * s * cos]
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
    g.poly(flat)
    g.fill(color)
}

export function createPixiEdgeRenderer(container: Container): PixiEdgeRenderer {
    const edgeGraphics = new Map<string, Graphics>()

    function clearAll(): void {
        for (const g of edgeGraphics.values()) {
            container.removeChild(g)
            g.destroy()
        }
        edgeGraphics.clear()
    }

    function render(edges: PixiEdgeRenderDatum[]): void {
        clearAll()

        for (const edge of edges) {
            const g = new Graphics()

            drawSvgPath(g, edge.svgPath)
            g.stroke({
                color: edge.strokeColor,
                width: edge.strokeWidth,
                cap: 'round',
                join: 'round',
            })

            if (edge.arrowEnd) {
                drawArrowhead(g, edge.arrowEnd, edge.strokeColor)
            }
            if (edge.arrowStart) {
                drawArrowhead(g, edge.arrowStart, edge.strokeColor)
            }

            container.addChild(g)
            edgeGraphics.set(edge.id, g)
        }
    }

    function destroy(): void {
        clearAll()
    }

    return { render, destroy }
}
