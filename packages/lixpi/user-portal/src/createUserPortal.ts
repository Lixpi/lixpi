import {
    createWebClientService,
    type WebClientServiceInstance,
} from '@lixpi/web-client-service-factory'

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
    onError?: (error: unknown) => void
}

export const createUserPortal = (config: UserPortalConfig): WebClientServiceInstance => {
    const catalog = new UserPortalModuleCatalog(config.modules)
    const contextFor = (
        dependencies: UserPortalDependencies,
        router: UserPortalModuleContext['router'],
    ): UserPortalModuleContext => ({
        router,
        userStore: dependencies.auth.userStore,
        getToken: () => dependencies.auth.getTokenSilently(),
        nats: dependencies.nats,
    })

    return createWebClientService<UserPortalDependencies>({
        createDependencies: config.createDependencies,
        routing: { routes: catalog.routes },
        initializeServices: ({
            dependencies,
            router,
        }) => catalog.initialize(
            contextFor(dependencies, router),
        ),
        createView: ({
            dependencies,
            router,
        }) => createLayout({
            context: contextFor(dependencies, router),
            routes: catalog.routes,
            navigationGroups: catalog.navigationGroups,
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
        shutdownServices: () => catalog.destroy(),
        destroyDependencies: async ({ nats }) => await nats.disconnect(),
        onError: config.onError,
    })
}
