import { createAuthClient } from '@lixpi/auth-client'
import { acquireDocumentScrollbars } from '@lixpi/ui-primitives/scrollbars'
import '@lixpi/web-client-service-factory/styles/foundation'
import '$src/sass/styles.scss'
import '@lixpi/ui-kit/styles/auth-panel'
import '@lixpi/canvas-components/styles/loading-overlay'
import { WebUiStartup } from './startup.ts'
import { mountWindowTitleBar } from '$src/components/windowTitleBar/windowTitleBar.ts'

// Opt-in development profiling. See documentation/platform/DEVELOPMENT.md.
if (
    import.meta.env.VITE_CLIENT_PERFORMANCE_DEBUG === 'true'
    && import.meta.hot
) {
    const hot = import.meta.hot
    void (async () => {
        const { reportClientPerformance } = await import('@lixpi/web-client-service-factory/client-performance')
        reportClientPerformance(hot)
        const { PanelPerformanceScenario } = await import('./profiling/panel-performance-scenario.ts')
        const panelScenario = new PanelPerformanceScenario()
        hot.dispose(() => panelScenario.destroy())
    })()
}

// The sign-in and loading screens appear before the workspace service starts,
// so the page holds its own scrollbar lease for its whole lifetime.
const scrollbars = acquireDocumentScrollbars(document)

// The desktop app's title bar row lives for the whole page, through sign-in
// and every workspace, so it mounts before anything else.
mountWindowTitleBar(document.body)

// The workspace modules start loading now, alongside authentication, so a
// signed-in visit does not wait for them after the session is ready. A
// visit that never needs them still fetches them, which costs nothing it
// waits on; the failure, if any, is reported where the module is used.
const workspaceModule = import('./workspaceApplication.ts')
void (async () => {
    try {
        await workspaceModule
    } catch {}
})()

const auth = createAuthClient({
    auth: {
        domain: import.meta.env.VITE_AUTH0_DOMAIN,
        clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        redirectUri: import.meta.env.VITE_AUTH0_REDIRECT_URI,
        logoutReturnTo: import.meta.env.VITE_AUTH0_LOGIN_URL,
        mock: {
            domain: import.meta.env.VITE_MOCK_AUTH0_DOMAIN,
            enabled: import.meta.env.VITE_MOCK_AUTH === 'true',
        },
    },
})

const startup = new WebUiStartup({
    auth,
    target: document.getElementById('app')!,
    loadWorkspace: async config => {
        const { createWorkspaceApplication } = await workspaceModule

        return createWorkspaceApplication(config)
    },
})

void startup.start()

export const shutdownApplication = async (): Promise<void> => {
    try {
        await startup.destroy()
    } finally {
        scrollbars.release()
    }
}
