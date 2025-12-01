// Shapes System - Factory functions for common diagram shapes
// Returns NodeConfig objects for use with the connector system

import './shapes.scss'

export { createThreadShape } from './threadShape.ts'
export { createIconShape } from './iconShape.ts'
export { createLabelShape } from './labelShape.ts'
export { createContextShapeSVG, startContextSelectionAnimation, startThreadGradientAnimation } from './documentShape/index.ts'

export type {
    ThreadShapeParams,
    IconShapeParams,
    LabelShapeParams,
    ShapeFactory
} from './types.ts'
