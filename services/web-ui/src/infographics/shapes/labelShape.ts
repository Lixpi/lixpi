// Label shape factory
// Creates NodeConfig for text content in a rounded rectangle container

import type { LabelShapeParams } from './types.ts'
import type { NodeConfig } from '../connectors/types.ts'

// Factory function that creates a properly configured NodeConfig for a label
export function createLabelShape(params: LabelShapeParams): NodeConfig {
    const {
        id,
        x,
        y,
        width,
        height,
        radius = 16,
        text,
        className = '',
        disabled = false
    } = params

    return {
        id,
        shape: 'rect',
        x,
        y,
        width,
        height,
        radius,
        className: `label-shape ${className}`.trim(),
        content: {
            type: 'text',
            text,
            className: 'label-text'
        },
        disabled
    }
}
