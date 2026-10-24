import {
    AuthenticationFailure,
    createAuthClient,
    type AuthClientInstance,
} from '@lixpi/auth-client'
import { getNatsUserInboxPrefix } from '@lixpi/constants'
import {
    accountPortalModule,
    createUserPortal,
} from '@lixpi/user-portal'
import NatsService from '@lixpi/nats-service'

import '@lixpi/web-client-service-factory/styles/foundation'
import '@lixpi/user-portal/styles'
import '@lixpi/ui-kit/styles/auth-panel'

const portalUrl = import.meta.env.VITE_USER_PORTAL_URL
let auth: AuthClientInstance | undefined
const authenticationFailure = new AuthenticationFailure(async () => void (await auth?.login(true)))
const application = createUserPortal({
    modules: [accountPortalModule],
    isRedirecting: () => auth?.authStore.getMeta('isRedirecting') ?? false,
    createDependencies: async () => {
        auth = createAuthClient({
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
    onError: () => {
        if (auth?.authStore.getMeta('isRedirecting'))
            return

        const target = document.getElementById('app')

        if (target)
            authenticationFailure.show(target)
    },
})

void application.start()

export const shutdownApplication = (): Promise<void> => application.destroy()
