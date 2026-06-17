import {
    createCanvasMediaNodeLifecycleTracker,
    videoCanvasMediaNodeLifecycleConfig,
} from '$src/infographics/workspace/canvasMediaNodeLifecycle.ts'

export function createCanvasVideoLifecycleTracker() {
    return createCanvasMediaNodeLifecycleTracker([videoCanvasMediaNodeLifecycleConfig])
}
