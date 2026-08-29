'use strict'

// App entry component. Wires the global help-tooltip provider and mounts the
// root layout. Renderer: TypeScript DOM, no framework runtime.

import { createHelpTooltipProvider } from '@lixpi/ui-kit/components/help-tooltip'
import '@lixpi/ui-kit/styles/bubble-menu'
import '@lixpi/ui-kit/styles/canvas-node-footer'
import '@lixpi/ui-kit/styles/dropdown'
import '@lixpi/ui-kit/styles/help-tooltip'
import '@lixpi/ui-kit/styles/info-bubble'
import '@lixpi/ui-kit/styles/media-model-badge'
import '@lixpi/ui-kit/styles/progress-timeline'
import '@lixpi/ui-kit/styles/side-panel'

import { createLayout, type LayoutInstance } from '$src/views/layouts/layout.ts'
import '$src/sass/styles.scss'

export type AppInstance = {
    destroy: () => void
}

export const mountApp = (target: HTMLElement): AppInstance => {
    const helpTooltipProvider = createHelpTooltipProvider({
        root: document,
        shouldShow: trigger => trigger.getAttribute('aria-expanded') !== 'true',
    })

    const layout: LayoutInstance = createLayout()
    target.append(layout.el)

    return {
        destroy: () => {
            layout.destroy()
            helpTooltipProvider.destroy()
        },
    }
}
