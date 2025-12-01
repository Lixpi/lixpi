// Document thread shape - white rounded border with centered text

// @ts-ignore - runtime import
import { select } from 'd3-selection'

type ThreadShapeConfig = {
    text: string
    gradientId?: string
    colors?: string[]
}

// Custom easing matching cubic-bezier(0.19, 1, 0.22, 1)
function customEase(t: number): number {
    const t2 = t * t
    const t3 = t2 * t
    const mt = 1 - t
    const mt2 = mt * mt
    return 3 * mt2 * t + 3 * mt * t2 + t3
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

    // Create smooth gradient with more blue, less purple
    const extendedColors = [
        '#60a5fa',  // blue
        '#7c9ff9',  // blue-purple transition
        '#a0afe8ff',  // purple
        '#7c9ff9',  // purple-blue transition
        '#60a5fa'   // blue
    ]

    const numRepeats = 2
    for (let i = 0; i <= numRepeats * extendedColors.length; i++) {
        const colorIndex = i % extendedColors.length
        const offset = (i / (numRepeats * extendedColors.length)) * 100
        threadGradient.append('stop')
            .attr('offset', `${offset}%`)
            .style('stop-color', extendedColors[colorIndex])
    }
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

    const threadLoop = () => {
        if (!running || !threadGradient) return

        // Get current angle and calculate new position for rotation effect
        const centerX = 256
        const centerY = 256
        const radius = 300

        let angle = 0

        const animate = () => {
            if (!running) return

            // Calculate gradient endpoints based on rotating angle
            const x1 = centerX + radius * Math.cos(angle)
            const y1 = centerY + radius * Math.sin(angle)
            const x2 = centerX + radius * Math.cos(angle + Math.PI)
            const y2 = centerY + radius * Math.sin(angle + Math.PI)

            threadGradient
                .transition()
                .duration(duration)  // Small steps for smooth rotation
                .ease(customEase)
                .attr('x1', x1)
                .attr('y1', y1)
                .attr('x2', x2)
                .attr('y2', y2)
                .on('end', () => {
                    angle -= 0.1  // Negative for counterclockwise
                    if (running) animate()
                })
        }

        animate()
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
            threadGradient?.interrupt()
        }
    }
}
