import type { CanvasViewport } from '@lixpi/constants'
import type { PixiMediaLayer } from '$src/infographics/workspace/pixiMediaLayer.ts'
import type { PixiContextRegionLayer } from '$src/infographics/workspace/rendering/pixiContextRegionLayer.ts'
import { applyStyle } from '$src/utils/domTemplates.ts'

export type ViewportBridge = {
    applyViewport: (viewport: CanvasViewport) => void
}

type ViewportBridgeOptions = {
    viewportEl: HTMLDivElement
    viewportOverlayEls?: HTMLElement[]
    getPixiLayer: () => PixiMediaLayer | null
    getContextRegionLayer?: () => PixiContextRegionLayer | null
}

// Applies a viewport change to both the DOM CSS transform and the PIXI world
// in a single call so they can never fall out of sync between call sites.
export function createViewportBridge(options: ViewportBridgeOptions): ViewportBridge {
    const { viewportEl, viewportOverlayEls = [], getPixiLayer, getContextRegionLayer } = options

    function applyViewport(viewport: CanvasViewport): void {
        const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
        applyStyle(viewportEl, { transform })
        for (const overlayEl of viewportOverlayEls) {
            applyStyle(overlayEl, { transform })
        }
        getPixiLayer()?.setViewport(viewport)
        getContextRegionLayer?.()?.setViewport(viewport)
    }

    return { applyViewport }
}
