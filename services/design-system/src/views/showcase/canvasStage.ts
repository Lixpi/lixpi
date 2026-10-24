// A positioned, explicitly sized host for a canvas. The engine measures its
// root, so canvases are created after the page is mounted.

import { html } from '@lixpi/ui-primitives/dom'

export type CanvasStageConfig = {
    height: number
    surface?: 'dark' | 'light'
}

export const createCanvasStage = (config: CanvasStageConfig): HTMLDivElement => {
    const stage = html`
        <div className=${`design-system-canvas-stage design-system-canvas-stage-${config.surface ?? 'light'}`}></div>
    ` as HTMLDivElement
    stage.style.height = `${config.height}px`

    return stage
}
