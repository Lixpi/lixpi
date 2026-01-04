// Shapes System - Factory functions for common diagram shapes
// Returns NodeConfig objects for use with the connector system

import '$src/infographics/shapes/shapes.scss'

export { createThreadShape } from '$src/infographics/shapes/threadShape.ts'
export { createIconShape } from '$src/infographics/shapes/iconShape.ts'
export { createLabelShape } from '$src/infographics/shapes/labelShape.ts'
export { createContextShapeSVG, startContextSelectionAnimation, startThreadGradientAnimation } from '$src/infographics/shapes/documentShape/index.ts'

export type {
    ThreadShapeParams,
    IconShapeParams,
    LabelShapeParams,
    ShapeFactory
} from '$src/infographics/shapes/types.ts'
