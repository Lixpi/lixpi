'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadSource(): string {
    return readFileSync(resolve(__dirname, 'pixiEdgeRenderer.ts'), 'utf-8')
}

function expectSourceToContain(source: string, snippet: string, label = 'source excerpt'): void {
    expect(
        source.includes(snippet),
        `${label} should contain:\n${snippet}`
    ).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string, label = 'source excerpt'): void {
    expect(
        source.includes(snippet),
        `${label} should not contain:\n${snippet}`
    ).toBe(false)
}

function extractTopLevelFunction(source: string, functionName: string): string {
    const start = source.indexOf(`function ${functionName}`)
    expect(start, `${functionName} should exist`).toBeGreaterThanOrEqual(0)

    const bodyStart = source.indexOf('{', start)
    expect(bodyStart, `${functionName} should have a function body`).toBeGreaterThan(start)

    let depth = 0
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === '{') depth++
        if (source[index] === '}') depth--
        if (depth === 0) return source.slice(start, index + 1)
    }

    throw new Error(`${functionName} function body did not close`)
}

// =============================================================================
// PIXI edge path regression guards
// =============================================================================

describe('pixiEdgeRenderer — path isolation regression guards', () => {
    const source = loadSource()

    it('starts a fresh path before stroking the SVG edge path', () => {
        const paintEdge = extractTopLevelFunction(source, 'paintEdge')

        const clearIndex = paintEdge.indexOf('g.clear()')
        const beginPathIndex = paintEdge.indexOf('g.beginPath()')
        const drawPathIndex = paintEdge.indexOf('drawSvgPath(g, edge.svgPath, viewport)')
        const strokeIndex = paintEdge.indexOf('g.stroke({')

        expect(beginPathIndex).toBeGreaterThan(clearIndex)
        expect(drawPathIndex).toBeGreaterThan(beginPathIndex)
        expect(strokeIndex).toBeGreaterThan(drawPathIndex)
    })

    it('strokes edges in screen pixels using the current viewport', () => {
        const paintEdge = extractTopLevelFunction(source, 'paintEdge')
        const drawArrowhead = extractTopLevelFunction(source, 'drawArrowhead')
        const edgeDatumKey = extractTopLevelFunction(source, 'edgeDatumKey')

        expectSourceToContain(paintEdge, 'width: screenStrokeWidth', 'paintEdge')
        expectSourceToContain(paintEdge, 'scaleCanvasChromeToScreenForZoom(', 'paintEdge')
        expectSourceToContain(paintEdge, 'edge.baseScreenStrokeWidth', 'paintEdge')
        expectSourceToContain(paintEdge, 'getAdaptiveBoundedZoomScalingOptions(settings.connector.scaling.zoomScaling)', 'paintEdge')
        expectSourceToContain(drawArrowhead, 'scaleCanvasChromeToScreenForZoom(', 'drawArrowhead')
        expectSourceToContain(drawArrowhead, 'arrow.baseScreenSize', 'drawArrowhead')
        expectSourceToContain(drawArrowhead, 'getAdaptiveBoundedZoomScalingOptions(settings.connector.scaling.zoomScaling)', 'drawArrowhead')
        expectSourceToContain(paintEdge, 'drawArrowhead(g, edge.arrowEnd, edge.strokeColor, viewport)', 'paintEdge')
        expectSourceToContain(edgeDatumKey, '${viewport.x},${viewport.y},${viewport.zoom}', 'edgeDatumKey')
    })

    it('does not draw from pre-scaled world-width aliases or debug probes', () => {
        const paintEdge = extractTopLevelFunction(source, 'paintEdge')
        const drawArrowhead = extractTopLevelFunction(source, 'drawArrowhead')

        expectSourceNotToContain(paintEdge, 'edge.strokeWidth', 'paintEdge')
        expectSourceNotToContain(drawArrowhead, 'arrow.size', 'drawArrowhead')
        expectSourceNotToContain(source, 'LIXPI_ZOOM_SCALING_DEBUG', 'pixiEdgeRenderer.ts')
        expectSourceNotToContain(source, 'logPixiEdgeDebug', 'pixiEdgeRenderer.ts')
        expectSourceNotToContain(source, 'roundDebugNumber', 'pixiEdgeRenderer.ts')
    })

    it('draws arrowheads as closed independent paths', () => {
        const drawArrowhead = extractTopLevelFunction(source, 'drawArrowhead')

        const beginPathIndex = drawArrowhead.indexOf('g.beginPath()')
        const polyIndex = drawArrowhead.indexOf('g.poly(flat)')
        const closePathIndex = drawArrowhead.indexOf('g.closePath()')
        const fillIndex = drawArrowhead.indexOf('g.fill(color)')

        expect(polyIndex).toBeGreaterThan(beginPathIndex)
        expect(closePathIndex).toBeGreaterThan(polyIndex)
        expect(fillIndex).toBeGreaterThan(closePathIndex)
    })
})
