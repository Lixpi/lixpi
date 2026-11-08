import '@lixpi/web-client-service-factory/styles/foundation'
import '@lixpi/themes/dist/scss/lixpi-light/theme'
import '@lixpi/themes/dist/scss/one-dark-pro-mariana/theme'
import '@lixpi/ui-kit/styles/typography'
import '@lixpi/canvas-components/styles/workspace/editor'
import '@lixpi/prosemirror/styles/code-mirror'
import '@lixpi/ui-kit/styles/side-panel'
import '@lixpi/ui-kit/styles/navigation-side-panel'
import '@lixpi/ui-kit/styles/dropdown'
import '@lixpi/ui-kit/styles/info-bubble'
import '@lixpi/ui-kit/styles/help-tooltip'
import '@lixpi/ui-kit/styles/canvas-library'
import '@lixpi/canvas-engine/styles/interaction'
import '@lixpi/canvas-components/styles/diagram-canvas'
import '@lixpi/canvas-components/styles/loading-overlay'
import '@lixpi/canvas-components/styles/library-examples'
import '@lixpi/ui-kit/styles/progress-timeline'
import '@lixpi/ui-kit/styles/preview'
import '@lixpi/ui-kit/styles/loading-placeholder'
import '@lixpi/ui-kit/styles/canvas-node-footer'
import '@lixpi/ui-kit/styles/bubble-menu'
import '@lixpi/canvas-components/styles/workspace'
import '@lixpi/canvas-components/styles/workspace/canvas-chrome'
import '@lixpi/canvas-components/styles/workspace/output-details-content'
import '@lixpi/canvas-components/styles/workspace/right-panel'
import '@lixpi/canvas-components/styles/workspace/workspace-composer'
import '@lixpi/canvas-components/styles/workspace/native-prompt-controls'
import '@lixpi/canvas-components/styles/workspace/context-preview'
import '@lixpi/canvas-components/styles/workspace/library-panels'
import '@lixpi/canvas-components/styles/workspace/document-node'
import '@lixpi/canvas-components/styles/workspace/branch-marker'
import '@lixpi/canvas-components/styles/workspace/operation-status'
import '@lixpi/canvas-components/styles/workspace/progress'
import '@lixpi/canvas-components/styles/workspace/output-details'
import '@lixpi/canvas-components/styles/workspace/workspace-layer'
import '@lixpi/canvas-components/styles/workspace/video-chrome'
import '@lixpi/canvas-components/styles/workspace/asset-views'
import '@lixpi/canvas-components/styles/workspace/output-chrome'
import '@lixpi/canvas-components/styles/workspace/nodes'
import '@lixpi/canvas-components/styles/workspace/diagram'
import { createWebClientService } from '@lixpi/web-client-service-factory'
import { html } from '@lixpi/ui-primitives/dom'
import { CanvasLibrary } from './canvas-library.ts'
import { createHelpTooltipProvider } from '@lixpi/ui-kit/components/help-tooltip'
import { configureUiKit } from '@lixpi/ui-kit'
import { createLixpiUiSettings } from '@lixpi/canvas-components/workspace/settings'
import { lixpiLightTheme } from '@lixpi/themes'

document.documentElement.dataset.colorTheme = lixpiLightTheme.name
document.documentElement.dataset.theme = lixpiLightTheme.colorScheme
configureUiKit(
    createLixpiUiSettings(),
)

const application = createWebClientService({
    routing: {
        routes: [
            { path: '/' },
            { path: '/examples/:exampleId' },
            { path: '/domains/:domainId' },
            { path: '/domains/:domainId/:exampleId' },
        ],
        fallbackPath: '/',
    },
    createResources: [() => createHelpTooltipProvider({
        root: document,
        shouldShow: trigger => trigger.getAttribute('aria-expanded') !== 'true',
    })],
    createView: ({ router }) => new CanvasLibrary(router),
    onError: error => {
        const target = document.getElementById('app')
        const message = error instanceof Error ? error.message : String(error)
        target?.replaceChildren(
            html`
                <main className="canvas-library-startup-error">
                    <h1>Canvas library could not start</h1>
                    <p role="alert">${message}</p>
                    <a href="/">Reload the library</a>
                </main>
            ` as HTMLElement,
        )
    },
})

void application.start()

if (import.meta.hot)
    import.meta.hot.dispose(() => void application.destroy())
