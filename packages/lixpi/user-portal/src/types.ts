import {
    type AuthClientInstance,
    type UserStateStore,
} from '@lixpi/auth-client'
import {
    type RouteViewDefinition,
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'
import type NatsService from '@lixpi/nats-service'

export const USER_PORTAL_MODULE_API_VERSION = 1

export type UserPortalNavigationGroup = {
    label: string
    items: Array<{
        label: string
        path: string
        iconHtml?: string
    }>
}

export type UserPortalModuleContext = {
    router: WebClientRouterService
    userStore: UserStateStore
    getToken: () => Promise<string | false>
    nats: Pick<NatsService, 'request' | 'subscribe' | 'onReconnect'>
}

export type UserPortalRouteDefinition = RouteViewDefinition<UserPortalModuleContext>

export type UserPortalModule = {
    id: string
    apiVersion: typeof USER_PORTAL_MODULE_API_VERSION
    navigationGroups: UserPortalNavigationGroup[]
    routes: UserPortalRouteDefinition[]
    initialize?: (context: UserPortalModuleContext) => Promise<void>
    destroy?: () => Promise<void>
}

export type UserPortalDependencies = {
    auth: AuthClientInstance
    nats: NatsService
}
