import { createAuthClient } from '@lixpi/auth-client'
import '@lixpi/web-client-service-factory/styles/foundation'
import '@lixpi/ui-kit/styles/auth-panel'
import '@lixpi/canvas-components/styles/loading-overlay'
import { WebUiStartup } from './startup.ts'

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
        const { createWorkspaceApplication } = await import('./workspaceApplication.ts')

        return createWorkspaceApplication(config)
    },
})

void startup.start()

export const shutdownApplication = (): Promise<void> => startup.destroy()
