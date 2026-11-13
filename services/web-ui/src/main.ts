import { createAuthClient } from '@lixpi/auth-client'
import { reportClientPerformance } from '@lixpi/web-client-service-factory'
import '@lixpi/web-client-service-factory/styles/foundation'
import '$src/sass/styles.scss'
import '@lixpi/ui-kit/styles/auth-panel'
import '@lixpi/canvas-components/styles/loading-overlay'
import { WebUiStartup } from './startup.ts'

// Opt-in development profiling; see documentation/platform/DEVELOPMENT.md.
if (import.meta.env.VITE_CLIENT_PERFORMANCE_DEBUG === 'true')
    reportClientPerformance(import.meta.hot)

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

export const shutdownApplication = (): Promise<void> => startup.destroy()
