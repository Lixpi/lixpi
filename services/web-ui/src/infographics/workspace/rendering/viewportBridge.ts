import type { CanvasViewport } from '@lixpi/constants'
import { applyStyle } from '$src/utils/domTemplates.ts'

export type ViewportBridge = {
    applyViewport: (viewport: CanvasViewport) => void
}

type ViewportAwarePixiLayer = {
    setViewport: (viewport: CanvasViewport) => void
}

type ViewportBridgeOptions = {
    viewportEl: HTMLDivElement
    viewportOverlayEls?: HTMLElement[]
    getPixiLayer?: () => ViewportAwarePixiLayer | null
    getPixiLayers?: () => Array<ViewportAwarePixiLayer | null | undefined>
}

// Applies a viewport change to both the DOM CSS transform and the PIXI world
// in a single call so they can never fall out of sync between call sites.
export function createViewportBridge(options: ViewportBridgeOptions): ViewportBridge {
    const { viewportEl, viewportOverlayEls = [], getPixiLayer, getPixiLayers } = options

    function applyViewport(viewport: CanvasViewport): void {
        const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
        applyStyle(viewportEl, { transform })
        for (const overlayEl of viewportOverlayEls) {
            applyStyle(overlayEl, { transform })
        }
        const pixiLayers = [
            getPixiLayer?.(),
            ...(getPixiLayers?.() ?? []),
        ].filter((layer): layer is ViewportAwarePixiLayer => Boolean(layer))
        for (const layer of pixiLayers) {
            layer.setViewport(viewport)
        }
    }

    return { applyViewport }
}
