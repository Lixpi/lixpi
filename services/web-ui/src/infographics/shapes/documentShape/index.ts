// Document shape primitives - reusable components for building document visualizations

export { drawDocumentContentBlock } from '$src/infographics/shapes/documentShape/documentContentBlock.ts'
export { drawDocumentThreadShape, setupThreadGradient, startThreadGradientAnimation } from '$src/infographics/shapes/documentShape/documentThreadShape.ts'
export { setupContextGradient, drawContextSelection, startContextSelectionAnimation } from '$src/infographics/shapes/documentShape/documentContextSelection.ts'
export { createContextShapeSVG } from '$src/infographics/shapes/documentShape/documentShape.ts'
