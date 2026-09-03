import NatsService from '@lixpi/nats-service'
import { configureUiKit } from '@lixpi/ui-kit'

import RouterService from '$src/services/router-service.ts'
import AuthService from '$src/services/auth-service.ts'
import UserService from '$src/services/user-service.ts'
import SubscriptionService from '$src/services/subscription-service.ts'
import OrganizationService from '$src/services/organization-service.ts'
import AiModelService from '$src/services/ai-model-service.ts'
import WorkspaceService from '$src/services/workspace-service.ts'
import AssetService from '$src/services/asset-service.ts'

import {
    mountApp,
    type AppInstance,
} from '$src/app.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { authStore } from '$src/stores/authStore.ts'
import { settings } from '$src/settings.ts'

const VITE_NATS_SERVER = import.meta.env.VITE_NATS_SERVER

configureUiKit(settings)

// Init services and then start the app
async function initializeServicesSequentially() {
    try {
        await AuthService.init()
        const authToken = await AuthService.getTokenSilently()

        if (!authToken) {
            throw new Error('No auth token')
        }

        console.log('import.meta.env.VITE_NATS_SERVER:', {
            natsServer: VITE_NATS_SERVER,
            fullEnv: import.meta.env,
        })

        const natsInstance = await NatsService.init({
            servers: [VITE_NATS_SERVER],
            webSocket: true,
            name: 'web-client',
            token: authToken,
            // Re-fetch a valid token before every (re)connect so the client recovers
            // from token expiry or a signing-key rotation (e.g. after the auth/API
            // service restarts) without needing the user to clear cookies/localStorage.
            getToken: () => AuthService.getTokenSilently(),
            // When the server rejects our credentials, force a fresh token so the
            // subsequent getToken() no longer returns the stale, cached one.
            onAuthError: () => AuthService.getTokenSilently(true),
        })
        const aiModelService = new AiModelService(natsInstance)

        servicesStore.setDataValues({
            nats: natsInstance,
            userService: new UserService(),
            subscriptionService: new SubscriptionService(),
            aiModelService,
            assetService: new AssetService(),
            workspaceService: new WorkspaceService(),
            organizationService: new OrganizationService(),
        })

        // Fetch registered user
        servicesStore.getData('userService')!.getUser()

        // Fetch organization details
        servicesStore.getData('organizationService')!.getOrganization({
            organizationId: userStore.getData('organizations')[0],
        })

        // Fetch available AI models
        aiModelService.getAvailableAiModels()

        // Fetch user workspaces
        servicesStore.getData('workspaceService')!.getUserWorkspaces()

        await RouterService.init()
    } catch (error) {
        console.error('Error during service initialization', error)
        throw error // Re-throw to handle it in the caller
    }
}

export async function shutdownApplication(): Promise<void> {
    const mounted = await application
    await mounted?.destroy()
}

async function initializeApplication(): Promise<AppInstance | null> {
    try {
        await initializeServicesSequentially()
        const target = document.getElementById('app')
        if (!target) throw new Error('Application mount target #app not found')
        const workspaceService = servicesStore.getData('workspaceService')!
        return mountApp(target, async () => await workspaceService.canvasSessions.close())
    } catch (error) {
        console.error('Application failed to start', error)
        try {
            await servicesStore.getData('workspaceService')?.canvasSessions.close()
        } catch (closeError) {
            console.error('Canvas session shutdown after startup failure failed', closeError)
        }
        return null
    }
}

const application = initializeApplication()
