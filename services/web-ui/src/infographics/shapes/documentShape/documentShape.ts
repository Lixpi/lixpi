// Context document visualization - composed from modular document shape primitives
// Built entirely with D3 using reusable components

// @ts-ignore - runtime import
import { select } from 'd3-selection'
import { setupContextGradient, drawContextSelection } from '$src/infographics/shapes/documentShape/documentContextSelection.ts'
import { drawDocumentThreadShape, setupThreadGradient } from '$src/infographics/shapes/documentShape/documentThreadShape.ts'
import { drawDocumentContentBlock } from '$src/infographics/shapes/documentShape/documentContentBlock.ts'

// Creates the context shape SVG from scratch using modular primitives
// Returns complete SVG string with gradient and all shapes
export function createContextShapeSVG({
    withGradient = true,
    withBackgroundAnimatedGradient = true,
    instanceId = 'default'
}: {
    withGradient?: boolean
    withBackgroundAnimatedGradient?: boolean
    instanceId?: string
} = {}): string {
    const gradientId = `ctx-grad-${instanceId}`
    const threadGradientId = `ctx-thread-grad-${instanceId}`
    const container = select(document.createElement('div'))

    const svg = container.append('svg')
        .attr('xmlns', 'http://www.w3.org/2000/svg')
        .attr('viewBox', '-30 -30 572 572')
        .attr('width', '512')
        .attr('height', '512')

    const defs = svg.append('defs')
    const g = svg.append('g')

    // Setup gradient definitions
    const colors = ['#a78bfa', '#60a5fa', '#a78bfa']
    if (withGradient) {
        setupContextGradient(defs, { gradientId, colors })
        // Setup thread gradient using its own module
        setupThreadGradient(defs, { gradientId: threadGradientId })
    }

    // Draw top content block (square + lines above context box)
    drawDocumentContentBlock(g, { variant: 'top' })

    // Draw gradient background selection
    if (withBackgroundAnimatedGradient) {
        drawContextSelection(g, { gradientId })
    }

    // Draw thread shape with text (with optional gradient stroke)
    drawDocumentThreadShape(g, {
        text: 'THREAD',
        gradientId: withGradient ? threadGradientId : undefined,
        colors
    })

    // Draw bottom content block (lines + squares below context box)
    drawDocumentContentBlock(g, { variant: 'bottom' })

    return container.html()
}
