import {
    createWebClientService,
    type WebClientServiceInstance,
    type WebClientView,
} from '@lixpi/web-client-service-factory'
import { createWorkspaceLoadingLayer } from '@lixpi/canvas-components-lixpi-specific/frontend/loading'
import { createLixpiCanvasSettings } from '@lixpi/canvas-components-lixpi-specific/frontend/settings'
import {
    type LoadingLayer,
} from '@lixpi/canvas-components/loading/layer'

import { UserPortalModuleCatalog } from './moduleCatalog.ts'
import { createLayout } from './layout.ts'
import {
    type UserPortalDependencies,
    type UserPortalModule,
    type UserPortalModuleContext,
} from './types.ts'

export type UserPortalConfig = {
    modules: UserPortalModule[]
    createDependencies: () => Promise<UserPortalDependencies>
    createView?: (context: UserPortalModuleContext) => WebClientView | undefined
    onError?: (error: unknown) => void
    isRedirecting?: () => boolean
    workspaceUrl?: string
}

class UserPortal implements WebClientServiceInstance {
    private readonly catalog: UserPortalModuleCatalog
    private readonly loadingLayer: LoadingLayer
    private readonly application: WebClientServiceInstance
    private startup?: Promise<void>
    private destruction?: Promise<void>

    constructor(private readonly config: UserPortalConfig) {
        this.catalog = new UserPortalModuleCatalog(config.modules)
        this.loadingLayer = createWorkspaceLoadingLayer({
            paneEl: document.body,
            settings: createLixpiCanvasSettings(),
        })
        this.application = this.createApplication()
    }

    start(): Promise<void> {
        this.startup ??= this.initialize()

        return this.startup
    }

    private async initialize(): Promise<void> {
        const loading = this.loadingLayer.acquire({
            label: 'Loading profile',
            visible: true,
        })

        try {
            await this.application.start()
        } finally {
            if (!this.config.isRedirecting?.())
                loading.destroy()
        }
    }

    destroy(): Promise<void> {
        this.destruction ??= this.dispose()

        return this.destruction
    }

    private async dispose(): Promise<void> {
        try {
            await this.application.destroy()
        } finally {
            this.loadingLayer.destroy()
        }
    }

    private contextFor(
        dependencies: UserPortalDependencies,
        router: UserPortalModuleContext['router'],
    ): UserPortalModuleContext {
        return {
            router,
            loadingLayer: this.loadingLayer,
            userStore: dependencies.auth.userStore,
            getToken: () => dependencies.auth.getTokenSilently(),
            createSessionHandoffUrl: dependencies.auth.createSessionHandoffUrl,
            nats: dependencies.nats,
        }
    }

    private createApplication(): WebClientServiceInstance {
        return createWebClientService<UserPortalDependencies>({
            createDependencies: this.config.createDependencies,
            routing: { routes: this.catalog.routes },
            initializeServices: ({
                dependencies,
                router,
            }) => this.catalog.initialize(
                this.contextFor(dependencies, router),
            ),
            createView: ({
                dependencies,
                router,
            }) => this.config.createView?.(
                this.contextFor(dependencies, router),
            ) ?? createLayout({
                context: this.contextFor(dependencies, router),
                routes: this.catalog.routes,
                navigationGroups: this.catalog.navigationGroups,
                workspaceUrl: this.config.workspaceUrl,
            }),
            startServices: async ({ dependencies: {
                auth,
                nats,
            } }) => {
                if (auth.features.currentUser)
                    await auth.loadCurrentUser({
                        requestClient: {
                            request: (subject, payload) => nats.request(subject, payload),
                        },
                    })
            },
            shutdownServices: () => this.catalog.destroy(),
            destroyDependencies: async ({ nats }) => await nats.disconnect(),
            onError: this.config.onError,
        })
    }
}

export const createUserPortal = (config: UserPortalConfig): WebClientServiceInstance => new UserPortal(config)
