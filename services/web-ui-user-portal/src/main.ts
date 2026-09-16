import { createAuthClient } from '@lixpi/auth-client'
import { getNatsUserInboxPrefix } from '@lixpi/constants'
import {
    accountPortalModule,
    createUserPortal,
} from '@lixpi/user-portal'
import NatsService from '@lixpi/nats-service'

import '@lixpi/web-client-service-factory/styles/foundation'
import '@lixpi/user-portal/styles'

const portalUrl = import.meta.env.VITE_USER_PORTAL_URL
const application = createUserPortal({
    modules: [accountPortalModule],
    createDependencies: async () => {
        const auth = createAuthClient({
            auth: {
                audience: import.meta.env.VITE_AUTH0_AUDIENCE,
                clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
                domain: import.meta.env.VITE_AUTH0_DOMAIN,
                redirectUri: portalUrl,
                logoutReturnTo: portalUrl,
                mock: {
                    domain: import.meta.env.VITE_MOCK_AUTH0_DOMAIN,
                    enabled: import.meta.env.VITE_MOCK_AUTH === 'true',
                },
            },
        })
        const session = await auth.initializeSession()

        if (
            auth.features.currentUser
            && !session
        )
            throw new Error('Current-user loading requires authentication')

        const nats = await NatsService.init({
            servers: [import.meta.env.VITE_NATS_SERVER],
            webSocket: true,
            name: 'web-client-user-portal',
            token: session?.accessToken,
            inboxPrefix: session ? getNatsUserInboxPrefix(session.userId) : undefined,
            getToken: session?.getToken,
            onAuthError: session
                ? async () => void (await session.refreshToken())
                : undefined,
        })

        return {
            auth,
            nats,
        }
    },
    onError: error => console.error('User portal failed to start', error),
})

void application.start()

export const shutdownApplication = (): Promise<void> => application.destroy()
