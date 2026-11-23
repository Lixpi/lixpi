import {
    AccessRecovery,
    type AuthClientInstance,
    type AuthClientSession,
} from '@lixpi/auth-client'
import { getNatsUserInboxPrefix } from '@lixpi/constants'
import NatsService from '@lixpi/nats-service'

export const beginWorkspaceConnection = (config: {
    auth: AuthClientInstance
    session: AuthClientSession
    onAuthRequired: () => void
}) => {
    let nats: NatsService | undefined
    let stopped = false

    const destroy = async (): Promise<void> => {
        stopped = true
        const connected = nats
        nats = undefined
        await connected?.disconnect()
    }
    let cleanup = destroy
    const recovery = new AccessRecovery(
        config.auth,
        () => cleanup(),
        config.onAuthRequired,
    )
    const ready = (async () => {
        const {
            auth,
            session,
        } = config
        const connected = await NatsService.init({
            servers: [import.meta.env.VITE_NATS_SERVER],
            webSocket: true,
            name: 'web-client',
            token: session.accessToken,
            inboxPrefix: getNatsUserInboxPrefix(session.userId),
            getToken: session.getToken,
            onAuthError: recovery.authError,
            onAccessDenied: recovery.deny,
        })

        if (stopped) {
            await connected.disconnect()

            throw new Error('Workspace startup was stopped')
        }

        nats = connected
        recovery.connected()
        connected.onReconnect(recovery.connected)

        if (import.meta.env.VITE_CLIENT_PERFORMANCE_DEBUG === 'true')
            performance.mark('startup:nats-connected')

        try {
            if (auth.features.currentUser)
                await auth.loadCurrentUser({ requestClient: connected })

            if (import.meta.env.VITE_CLIENT_PERFORMANCE_DEBUG === 'true')
                performance.mark('startup:user-loaded')

            return {
                auth,
                nats: connected,
            }
        } catch (error) {
            await destroy()

            throw error
        }
    })()

    // The connection can fail while the private view module is still loading.
    void (async () => {
        try {
            await ready
        } catch {}
    })()

    return {
        waitUntilReady: async () => {
            const dependencies = await ready

            if (stopped)
                throw new Error('Workspace startup was stopped')

            return dependencies
        },
        destroy,
        onAccessLoss: (callback: () => Promise<void>) => void (cleanup = callback),
    }
}

export type WorkspaceConnection = ReturnType<typeof beginWorkspaceConnection>
