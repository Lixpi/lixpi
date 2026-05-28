// Document thread shape - white rounded border with centered text

import { select } from 'd3-selection'
import {
    SvgGradientRenderer,
    type SvgGradientAnimation,
} from '$src/utils/animations/gradients/svgGradient.ts'
import { settings } from '$src/settings.ts'

type ThreadShapeConfig = {
    text: string
    gradientId?: string
    colors?: string[]
}

// Draws the white rounded border rectangle with centered text
// If gradientId is provided, uses gradient stroke instead of solid white
export function drawDocumentThreadShape(parent: any, config: ThreadShapeConfig) {
    const strokeColor = config.gradientId ? `url(#${config.gradientId})` : 'white'

    // White rounded border (two path segments - left and right)
    parent.append('path')
        .attr('d', 'M109.583,179.95H17.5c-5.523,0-10,4.477-10,10V322.05c0,5.523,4.477,10,10,10H417')
        .attr('fill', 'none')
        .attr('stroke', strokeColor)
        .attr('stroke-width', 15)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')

    parent.append('path')
        .attr('d', 'M452,332.05h42.5c5.523,0,10-4.477,10-10V189.95c0-5.523-4.477-10-10-10H144.583')
        .attr('fill', 'none')
        .attr('stroke', strokeColor)
        .attr('stroke-width', 15)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')

    // Centered text label
    parent.append('text')
        .attr('x', 256)
        .attr('y', 265)
        .attr('fill', 'white')
        .attr('font-family', 'Söhne, sans-serif')
        .attr('font-size', '70px')
        .attr('font-weight', 'bold')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .text(config.text)
}

// Setup the gradient definition for thread stroke
export function setupThreadGradient(defs: any, config: { gradientId: string }) {
    const threadGradient = defs.append('linearGradient')
        .attr('id', config.gradientId)
        .attr('gradientUnits', 'userSpaceOnUse')
        .attr('x1', '0').attr('y1', '256')  // Center of the shape
        .attr('x2', '512').attr('y2', '256')

    SvgGradientRenderer.appendRepeatingLinearGradientStops(threadGradient, settings.gradient.shiftingColors)
}

// Animation controller for thread gradient
// Starts animation once SVG content is detected in the DOM
export function startThreadGradientAnimation(
    container: HTMLElement,
    nodeId: string = 'context',
    duration: number = 50,
    threadGradientId: string = 'ctx-thread-grad'
): { stop: () => void } {
    let running = true
    let threadGradient: any = null
    let gradientAnimation: SvgGradientAnimation | null = null

    const threadLoop = () => {
        if (!running || !threadGradient) return

        gradientAnimation = SvgGradientRenderer.startRotatingLinearGradient(threadGradient, {
            center: { x: 256, y: 256 },
            radius: 300,
            duration,
        })
    }

    const foreignObj = select(container)
        .select(`foreignObject#node-${nodeId}`)
        .node() as SVGForeignObjectElement | null

    // Try immediate selection
    if (foreignObj?.children.length) {
        const svg = foreignObj.querySelector('.connector-icon svg')
        if (svg) {
            threadGradient = select(svg).select(`#${threadGradientId}`)
            if (threadGradient && !threadGradient.empty()) {
                threadLoop()
                return {
                    stop: () => {
                        running = false
                        gradientAnimation?.stop()
                        threadGradient?.interrupt()
                    }
                }
            }
        }
    }

    // Watch for content insertion
    if (foreignObj) {
        const observer = new MutationObserver(() => {
            const svg = foreignObj.querySelector('.connector-icon svg')
            if (svg) {
                threadGradient = select(svg).select(`#${threadGradientId}`)
                if (threadGradient && !threadGradient.empty()) {
                    observer.disconnect()
                    threadLoop()
                }
            }
        })

        observer.observe(foreignObj, { childList: true, subtree: true })
    }

    return {
        stop: () => {
            running = false
            gradientAnimation?.stop()
            threadGradient?.interrupt()
        }
    }
}
