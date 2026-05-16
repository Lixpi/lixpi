import type { CanvasViewport } from '@lixpi/constants'
import type { PixiMediaLayer } from '$src/infographics/workspace/pixiMediaLayer.ts'
import { applyStyle } from '$src/utils/domTemplates.ts'

export type ViewportBridge = {
    applyViewport: (viewport: CanvasViewport) => void
    destroy: () => void
}

type ViewportBridgeOptions = {
    viewportEl: HTMLDivElement
    getPixiLayer: () => PixiMediaLayer | null
}

// Applies a viewport change to both the DOM CSS transform and the PIXI world
// in a single call so they can never fall out of sync between call sites.
export function createViewportBridge(options: ViewportBridgeOptions): ViewportBridge {
    const { viewportEl, getPixiLayer } = options

    function applyViewport(viewport: CanvasViewport): void {
        applyStyle(viewportEl, { transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` })
        getPixiLayer()?.setViewport(viewport)
    }

    function destroy(): void {
        // No owned resources; provided for lifecycle symmetry with other modules.
    }

    return { applyViewport, destroy }
}
