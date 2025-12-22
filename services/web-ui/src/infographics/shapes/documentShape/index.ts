// Document shape primitives - reusable components for building document visualizations

export { drawDocumentContentBlock } from './documentContentBlock.ts'
export { drawDocumentThreadShape, setupThreadGradient, startThreadGradientAnimation } from './documentThreadShape.ts'
export { setupContextGradient, drawContextSelection, startContextSelectionAnimation } from './documentContextSelection.ts'
export { createContextShapeSVG } from './documentShape.ts'
