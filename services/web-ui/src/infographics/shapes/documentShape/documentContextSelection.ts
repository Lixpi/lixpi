// Document context selection - animated gradient background

// @ts-ignore - runtime import
import { select } from 'd3-selection'

type ContextSelectionConfig = {
    gradientId: string
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

// Sets up the gradient definition in SVG defs
export function setupContextGradient(defs: any, config: ContextSelectionConfig) {
    const colors = config.colors || ['#a78bfa', '#60a5fa', '#a78bfa']

    const gradient = defs.append('linearGradient')
        .attr('id', config.gradientId)
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '100%').attr('y2', '100%')

    colors.forEach((color, i) => {
        gradient.append('stop')
            .attr('offset', `${i * 50}%`)
            .attr('id', `${config.gradientId}-stop-${i}`)
            .style('stop-color', color)
    })
}

// Draws the gradient-filled background rectangle for context selection
export function drawContextSelection(parent: any, config: ContextSelectionConfig) {
    parent.append('rect')
        .attr('x', -25)
        .attr('y', 147.45)
        .attr('width', 562)
        .attr('height', 217.1)
        .attr('rx', 17)
        .attr('ry', 17)
        .attr('fill', `url(#${config.gradientId})`)
}

// Animation controller for context selection gradient
// Starts animation once SVG content is detected in the DOM
export function startContextSelectionAnimation(
    container: HTMLElement,
    nodeId: string = 'context',
    duration: number = 1500,
    gradientId: string = 'ctx-grad'
): { stop: () => void } {
    let running = true
    let gradient: any = null

    const loop = () => {
        if (!running || !gradient) return

        gradient
            .transition().duration(duration).ease(customEase)
            .attr('x1', '-50%').attr('x2', '50%')
            .transition().duration(duration).ease(customEase)
            .attr('x1', '0%').attr('x2', '100%')
            .on('end', () => running && loop())
    }

    const foreignObj = select(container)
        .select(`foreignObject#node-${nodeId}`)
        .node() as SVGForeignObjectElement | null

    // Try immediate selection
    if (foreignObj?.children.length) {
        const svg = foreignObj.querySelector('.connector-icon svg')
        if (svg) {
            gradient = select(svg).select(`#${gradientId}`)
            if (gradient && !gradient.empty()) {
                loop()
                return {
                    stop: () => {
                        running = false
                        gradient?.interrupt()
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
                gradient = select(svg).select(`#${gradientId}`)
                if (gradient && !gradient.empty()) {
                    observer.disconnect()
                    loop()
                }
            }
        })

        observer.observe(foreignObj, { childList: true, subtree: true })
    }

    return {
        stop: () => {
            running = false
            gradient?.interrupt()
        }
    }
}
