import {
    createCanvasMediaNodeLifecycleTracker,
    imageCanvasMediaNodeLifecycleConfig,
} from '$src/infographics/workspace/canvasMediaNodeLifecycle.ts'

export function createCanvasImageLifecycleTracker() {
    return createCanvasMediaNodeLifecycleTracker([imageCanvasMediaNodeLifecycleConfig])
}
