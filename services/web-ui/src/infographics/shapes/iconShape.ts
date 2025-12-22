// Icon shape factory
// Creates NodeConfig for an SVG icon within a foreignObject container

import type { IconShapeParams } from './types.ts'
import type { NodeConfig } from '../connectors/types.ts'

// Factory function that creates a properly configured NodeConfig for an icon
export function createIconShape(params: IconShapeParams): NodeConfig {
    const {
        id,
        x,
        y,
        size,
        icon,
        className = '',
        disabled = false
    } = params

    return {
        id,
        shape: 'foreignObject',
        x,
        y,
        width: size,
        height: size,
        className: `icon-shape ${className}`.trim(),
        content: {
            type: 'icon',
            icon,
            className: 'icon-content'
        },
        disabled
    }
}
