// Thread/Document shape factory
// Renders a capsule with a chamfered left wedge directly via SVG path data

import type { ThreadShapeParams } from './types.ts'
import type { NodeConfig } from '../connectors/types.ts'

export function createThreadShape(params: ThreadShapeParams): NodeConfig {
    const {
        id,
        x,
        y,
        width,
        height,
        label,
        labelClassName,
        className = '',
        disabled = false
    } = params

    // const notchDepth = Math.max(11, Math.min(Math.min(width * 0.14, height * 0.82), width - 12))
    const notchDepth = 10
    const tipProtrusion = -3

    const controlOffset = 5

    const rightRadius = 4
    const rightSideBulge = 2
    const tipSharpness = 0.8
    const tipPointRoundness = 2

    const topY = y
    const bottomY = y + height
    const tipX = x
    const tipY = y + height / 2
    const bodyLeftX = x + notchDepth
    const rightArcStartX = x + width - rightRadius
    const rightX = x + width

    const pathData = [
        `M ${bodyLeftX} ${topY}`,
        `L ${rightArcStartX} ${topY}`,
        `A ${rightRadius} ${rightRadius} 0 0 1 ${rightX} ${topY + rightRadius}`,
        `Q ${rightX + rightSideBulge} ${tipY} ${rightX} ${bottomY - rightRadius}`,
        `A ${rightRadius} ${rightRadius} 0 0 1 ${rightArcStartX} ${bottomY}`,
        `L ${bodyLeftX} ${bottomY}`,
        `Q ${tipX + controlOffset * tipSharpness} ${bottomY} ${tipX + tipProtrusion} ${tipY + tipPointRoundness}`,
        `Q ${tipX + tipProtrusion - tipPointRoundness * 0.3} ${tipY} ${tipX + tipProtrusion} ${tipY - tipPointRoundness}`,
        `Q ${tipX + controlOffset * tipSharpness} ${topY} ${bodyLeftX} ${topY}`,
        'Z'
    ].join(' ')

    const content = label
        ? {
            type: 'text' as const,
            text: label,
            className: labelClassName ?? 'thread-chip-label',
            align: 'middle' as const,
            dx: 0,
            dy: 0
        }
        : undefined

    return {
        id,
        shape: 'path',
        x,
        y,
        width,
        height,
        className: `thread-shape thread-chip ${className}`.trim(),
        pathData,
        content,
        disabled,
        anchorOverrides: {
            left: { x: tipX + tipProtrusion + (notchDepth - tipProtrusion) * 0.4, y: tipY }
        }
    }
}
