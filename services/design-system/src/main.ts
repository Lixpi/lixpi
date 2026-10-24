import {
    configureUiKit,
    uiKitSettings,
} from '@lixpi/ui-kit'
import { createHelpTooltipProvider } from '@lixpi/ui-kit/components/help-tooltip'
import { createWebClientService } from '@lixpi/web-client-service-factory'

import {
    OVERVIEW_ROUTE_PATH,
    routes,
} from '$src/routes.ts'
import { createLayout } from '$src/views/layouts/layout.ts'
import '@lixpi/web-client-service-factory/styles/foundation'
import '@lixpi/ui-kit/styles/auth-panel'
import '@lixpi/ui-kit/styles/block-card-tiles-list'
import '@lixpi/ui-kit/styles/bubble-menu'
import '@lixpi/ui-kit/styles/canvas-node-footer'
import '@lixpi/ui-kit/styles/dropdown'
import '@lixpi/ui-kit/styles/help-tooltip'
import '@lixpi/ui-kit/styles/info-bubble'
import '@lixpi/ui-kit/styles/loading-placeholder'
import '@lixpi/ui-kit/styles/media-model-badge'
import '@lixpi/ui-kit/styles/preview'
import '@lixpi/ui-kit/styles/progress-ripple'
import '@lixpi/ui-kit/styles/progress-timeline'
import '@lixpi/ui-kit/styles/side-panel'
import '@lixpi/canvas-engine/styles/interaction'
import '@lixpi/canvas-components-lixpi-specific/styles/workspace'
import '$src/sass/styles.scss'

// web-ui passes its application settings here. The design system shows the
// package defaults, so it passes them back unchanged.
configureUiKit(uiKitSettings)

const application = createWebClientService({
    createResources: [() => createHelpTooltipProvider({
        root: document,
        shouldShow: trigger => trigger.getAttribute('aria-expanded') !== 'true',
    })],
    createView: ({ router }) => createLayout({ router }),
    onError: error => console.error('Design system failed to start', error),
    routing: {
        fallbackPath: OVERVIEW_ROUTE_PATH,
        onRouteChange: currentRoute => {
            const route = routes.find(candidate => candidate.path === currentRoute.path)
            document.title = route
                ? `${route.title} · Lixpi Design System`
                : 'Lixpi Design System'
        },
        routes,
    },
})

void application.start()

export const shutdownApplication = (): Promise<void> => application.destroy()
