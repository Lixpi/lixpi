import { configureUiKit } from '@lixpi/ui-kit'
import { AuthPanel } from '@lixpi/ui-kit/components/auth-panel'
import { lixpiLogo } from '@lixpi/ui-kit/svg'
import { createHelpTooltipProvider } from '@lixpi/ui-kit/components/help-tooltip'
import { createWebClientService } from '@lixpi/web-client-service-factory'
import NatsService from '@lixpi/nats-service'
import { getNatsUserInboxPrefix } from '@lixpi/constants'
import {
    type LoadingLayer,
} from '@lixpi/canvas-components/loading'
import {
    AccessRecovery,
    type AuthClientInstance,
    type AuthClientSession,
} from '@lixpi/auth-client'

import OrganizationService from '$src/services/organization-service.ts'
import AiModelService from '$src/services/ai-model-service.ts'
import WorkspaceService from '$src/services/workspace-service.ts'
import AssetService from '$src/services/asset-service.ts'
import {
    OnboardingService,
    OnboardingUnavailable,
} from '$src/services/onboarding-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'

import { settings } from '$src/settings.ts'
import '@lixpi/ui-kit/styles/auth-panel'
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
import '@lixpi/web-client-service-factory/styles/foundation'

import { workspaceRouting } from '$src/routes.ts'
import { createLayout } from '$src/views/layouts/layout.ts'
import '$src/sass/styles.scss'

const VITE_NATS_SERVER = import.meta.env.VITE_NATS_SERVER

type WebUiDependencies = {
    auth: AuthClientInstance
    nats: NatsService
}

export const createWorkspaceApplication = (config: {
    loadingLayer: LoadingLayer
    auth: AuthClientInstance
    session: AuthClientSession
    onAuthRequired: () => void
    onReady: () => void
    onError: (error: unknown) => void
}) => {
    configureUiKit(settings)
    const application = createWebClientService<WebUiDependencies>({
        createDependencies: async () => {
            const {
                auth,
                session,
            } = config

            const recovery = new AccessRecovery(
                auth,
                async () => await application.destroy(),
                config.onAuthRequired,
            )
            const nats = await NatsService.init({
                servers: [VITE_NATS_SERVER],
                webSocket: true,
                name: 'web-client',
                token: session?.accessToken,
                inboxPrefix: session ? getNatsUserInboxPrefix(session.userId) : undefined,
                getToken: session?.getToken,
                onAuthError: session
                ? recovery.authError
                : undefined,
                onAccessDenied: recovery.deny,
            })
            nats.onReconnect(recovery.connected)

            return {
                auth,
                nats,
            }
        },
        routing: workspaceRouting,
        createResources: [() => createHelpTooltipProvider({
            showDelayMs: settings.helpTooltip.providerShowDelayMs,
            root: document,
            shouldShow: trigger => trigger.getAttribute('aria-expanded') !== 'true',
        })],
        createView: ({
            dependencies: { auth },
            router,
        }) => {
            config.onReady()

            return createLayout({
                assetService: servicesStore.getData('assetService'),
                auth,
                router,
                userPortalUrl: import.meta.env.VITE_USER_PORTAL_URL,
                workspaceService: servicesStore.getData('workspaceService'),
            })
        },
        destroyDependencies: async ({ nats }) => await nats.disconnect(),
        initializeServices: async ({
            dependencies: {
                auth,
                nats,
            },
            router,
        }) => {
            const assetService = new AssetService({
                auth,
                userStore: auth.userStore,
            })
            const aiModelService = new AiModelService({
                auth,
                nats,
            })
            servicesStore.setDataValues({
                loadingLayer: config.loadingLayer,
                nats,
                aiModelService,
                assetService,
                workspaceService: new WorkspaceService({
                    auth,
                    router,
                }),
                organizationService: new OrganizationService(),
            })

            if (auth.features.currentUser)
                await auth.loadCurrentUser({
                    requestClient: {
                        request: (subject, payload) => nats.request(subject, payload),
                    },
                })
        },
        startServices: async ({ dependencies: {
            auth,
            nats,
        } }) => {
            if (
                import.meta.env.VITE_ACCOUNT_ONBOARDING_ENABLED === 'true'
                && import.meta.env.VITE_MOCK_AUTH !== 'true'
            ) {
                const onboarding = new OnboardingService(
                    auth,
                    nats,
                    import.meta.env.VITE_USER_PORTAL_URL,
                )

                if (!await onboarding.enterWorkspace())
                    return
            }

            servicesStore.getData('organizationService')!.getOrganization({
                organizationId: auth.userStore.getData('organizations')[0],
            })
            servicesStore.getData('aiModelService')!.getAvailableAiModels()
            servicesStore.getData('workspaceService')!.getUserWorkspaces()
        },
        shutdownServices: async () => {
            await servicesStore.getData('workspaceService')?.canvasSessions.close()
            servicesStore.resetStore()
        },
        onError: error => {
            config.onReady()

            if (error instanceof OnboardingUnavailable) {
                const target = document.getElementById('app')
                const view = new AuthPanel({
                    brand: 'Lixpi',
                    logo: lixpiLogo,
                    title: 'Your setup needs another moment.',
                    description: 'We could not load your account options. Please try again.',
                    actions: [{
                        label: 'Try again',
                        onClick: () => window.location.reload(),
                    }],
                })
                target?.replaceChildren(view.dom)
            } else
                config.onError(error)
        },
    })

    return application
}
