import { configureUiKit } from '@lixpi/ui-kit'
import { ApplicationThemeBinding } from '@lixpi/themes/browser'
import { AuthPanel } from '@lixpi/ui-kit/components/auth-panel'
import { lixpiLogo } from '@lixpi/ui-kit/svg'
import { createHelpTooltipProvider } from '@lixpi/ui-kit/components/help-tooltip'
import {
    createWebClientService,
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'
import { LoadingStatus } from '@lixpi/constants'
import {
    type LoadingLayer,
} from '@lixpi/canvas-components/loading'
import {
    createUserService,
    CurrentUserRefresh,
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
import { workspaceStore } from '$src/stores/workspaceStore.ts'

import {
    createLixpiCanvasThemeFromPreset,
    createLixpiUiSettings,
    settings,
} from '$src/settings.ts'
import { canvasThemeStore } from './canvas-adapters/canvas-theme.ts'
import '$src/sass/workspace.scss'
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
import '@lixpi/ui-kit/styles/action-panel'
import '@lixpi/ui-kit/styles/side-panel'
import '@lixpi/canvas-engine/styles/interaction'
import '@lixpi/web-client-service-factory/styles/foundation'

import {
    WORKSPACE_ROUTE_PATH,
    workspaceRouting,
} from '$src/routes.ts'
import { createLayout } from '$src/views/layouts/layout.ts'
import {
    beginWorkspaceConnection,
    type WorkspaceConnection,
} from './workspaceConnection.ts'

// Let route and canvas subscribers render before releasing the startup lease.
const keepStartupLoadingUntilFirstView = (
    router: WebClientRouterService,
    onReady: () => void,
) => {
    let listening = true
    const check = () =>
        queueMicrotask(() => {
            if (!listening)
                return

            const route = router.getCurrentRoute()

            if (!route.path)
                return

            if (route.path === WORKSPACE_ROUTE_PATH) {
                const {
                    data,
                    meta,
                } = workspaceStore.get()

                if (
                    data.workspaceId !== route.routeParams.workspaceId
                    || (meta.loadingStatus !== LoadingStatus.success && meta.loadingStatus !== LoadingStatus.error)
                )
                    return
            }

            destroy()

            if (import.meta.env.VITE_CLIENT_PERFORMANCE_DEBUG === 'true')
                performance.mark('startup:route-ready')

            onReady()
        })
    const unsubscribeRoute = router.subscribe(check)
    const unsubscribeWorkspace = workspaceStore.subscribe(check)
    const destroy = () => {
        listening = false
        unsubscribeRoute()
        unsubscribeWorkspace()
    }

    return { destroy }
}

export const createWorkspaceApplication = (
    config: {
        loadingLayer: LoadingLayer
        auth: AuthClientInstance
        session: AuthClientSession
        onAuthRequired: () => void
        onReady: () => void
        onError: (error: unknown) => void
    },
    preparedConnection?: WorkspaceConnection,
) => {
    let connection = preparedConnection
    const application = createWebClientService<Awaited<ReturnType<WorkspaceConnection['waitUntilReady']>>>({
        createDependencies: async () => {
            connection ??= beginWorkspaceConnection(config)
            connection.onAccessLoss(application.destroy)

            return await connection.waitUntilReady()
        },
        routing: workspaceRouting,
        createResources: [
            ({ router }) => keepStartupLoadingUntilFirstView(router, config.onReady),
            ({ dependencies: { auth } }) => new ApplicationThemeBinding({
                subscribePreference: listener => auth.userStore.subscribe(state => listener(state.data.preferences?.appearance)),
                onChange: preset => {
                    configureUiKit(
                        createLixpiUiSettings(preset),
                    )
                    canvasThemeStore.set(
                        createLixpiCanvasThemeFromPreset(preset),
                    )
                },
            }),
            ({ dependencies: {
                auth,
                nats,
            } }) => new CurrentUserRefresh({
                user: createUserService({
                    getToken: auth.getTokenSilently,
                    requestClient: nats,
                    store: auth.userStore,
                }),
                onReconnect: listener => nats.onReconnect(listener),
            }),
            () => createHelpTooltipProvider({
                showDelayMs: settings.helpTooltip.providerShowDelayMs,
                root: document,
                shouldShow: trigger => trigger.getAttribute('aria-expanded') !== 'true',
            }),
        ],
        createView: ({
            dependencies: { auth },
            router,
        }) => {
            if (import.meta.env.VITE_CLIENT_PERFORMANCE_DEBUG === 'true')
                performance.mark('startup:view')

            return createLayout({
                assetService: servicesStore.getData('assetService'),
                auth,
                router,
                userPortalUrl: import.meta.env.VITE_USER_PORTAL_URL,
                workspaceService: servicesStore.getData('workspaceService'),
            })
        },
        destroyDependencies: async () => await connection?.destroy(),
        initializeServices: ({
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
            servicesStore.getData('workspaceService')!.getUserWorkspaceTree()

            if (import.meta.env.VITE_CLIENT_PERFORMANCE_DEBUG === 'true')
                performance.mark('startup:services')
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

    return {
        start: application.start,
        destroy: async () => {
            try {
                await application.destroy()
            } finally {
                await connection?.destroy()
            }
        },
    }
}
