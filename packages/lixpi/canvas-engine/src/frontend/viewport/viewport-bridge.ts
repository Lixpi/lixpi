'use strict'

import type { CanvasViewport } from '../../shared/index.ts'
import { applyStyle } from '@lixpi/ui-primitives/dom'

export type ViewportTarget = { setViewport: (viewport: CanvasViewport) => void }

export type ViewportBridgeOptions = {
    viewportEl: HTMLElement
    viewportOverlayEls?: readonly HTMLElement[]
    targets?: () => readonly (ViewportTarget | null | undefined)[]
}

export class ViewportBridge {
    constructor(private readonly options: ViewportBridgeOptions) {}

    applyViewport(viewport: CanvasViewport): void {
        const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
        applyStyle(this.options.viewportEl, { transform })
        for (const overlayEl of this.options.viewportOverlayEls ?? []) applyStyle(overlayEl, { transform })
        for (const target of this.options.targets?.() ?? []) target?.setViewport(viewport)
    }
}

export function createViewportBridge(options: ViewportBridgeOptions): ViewportBridge {
    return new ViewportBridge(options)
}
