// Path-based router for the registry's two pages. Same shape as the web-ui
// router: route definitions with an optional data loader, the active route in a
// store, and the address bar written from that store rather than the other way
// around.

import { routerStore } from '$src/stores/routerStore.ts'
import { modelCatalogService } from '$src/services/model-catalog-service.ts'

type RouteDefinition = {
    path: string
    title: string
    load?: (
        params: Record<string, unknown>,
        query: Record<string, unknown>,
    ) => Promise<void>
}

export const MODEL_PARAMETERS_ROUTE_PATH = '/model-parameters'
export const MODEL_CATALOG_ROUTE_PATH = '/model-catalog'

export const routes: RouteDefinition[] = [
    {
        path: MODEL_PARAMETERS_ROUTE_PATH,
        title: 'Model parameters',
    },
    {
        path: MODEL_CATALOG_ROUTE_PATH,
        title: 'Model catalog',
        load: async () => await modelCatalogService.load(),
    },
]

export type Router = {
    currentRoute: {
        path: string
        hash: string
        routeParams: Record<string, any>
        routeQuery: Record<string, any>
        isInitializationStep: boolean
    }
    history: Router['currentRoute'][]
}

class RouterService {
    private static instance: RouterService | null
    private routeDefinitions: RouteDefinition[] = routes

    private constructor() {
        this.handlePopState = this.handlePopState.bind(this)
    }

    static getInstance(): RouterService {
        return RouterService.instance ?? (RouterService.instance = new RouterService())
    }

    private handlePopState(): void {
        this.syncWithCurrentURL()
    }

    private subscribeToRouter(): void {
        routerStore.subscribe(({ data }) => {
            const { currentRoute } = data

            if (currentRoute.isInitializationStep)
                return

            if (this.shouldUpdateBrowserHistory(currentRoute))
                this.updateBrowserHistory(currentRoute)
        })
    }

    // An unknown path, `/` included, opens the parameter registry, which is the
    // page this service has always served.
    private syncWithCurrentURL(): void {
        const url = new URL(window.location.href)
        const matched = this.findRouteByURL(url.pathname)
        const route = matched ?? this.routeDefinitions[0]!

        this.navigateTo(
            route.path,
            {
                query: Object.fromEntries(url.searchParams),
                hash: url.hash.slice(1),
                // A matched path is already in the address bar, so it is not written
                // back. An unmatched one falls through to the parameter registry and
                // has to replace what the address bar holds.
                isInitializationStep: matched !== null,
            },
        )
    }

    private findRouteByURL(urlPath: string): RouteDefinition | null {
        const normalized = `/${urlPath.replace(/\/$/u, '').split('/').filter(Boolean).join('/')}`

        return this.routeDefinitions.find(route => route.path === normalized) ?? null
    }

    private shouldUpdateBrowserHistory(route: Router['currentRoute']): boolean {
        const currentUrl = new URL(window.location.href)

        return currentUrl.pathname !== route.path
            || currentUrl.search !== this.composeQuery(route.routeQuery)
            || currentUrl.hash.slice(1) !== route.hash
    }

    private updateBrowserHistory(route: Router['currentRoute']): void {
        history.pushState(
            {},
            '',
            this.composeURL(route),
        )
    }

    private composeURL(route: Router['currentRoute']): string {
        const query = this.composeQuery(route.routeQuery)
        const hash = route.hash ? `#${route.hash}` : ''

        return `${route.path}${query}${hash}`
    }

    private composeQuery(query: Record<string, unknown>): string {
        const queryString = new URLSearchParams(query as Record<string, string>).toString()

        return queryString ? `?${queryString}` : ''
    }

    public init(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.syncWithCurrentURL()
                this.subscribeToRouter()
                window.addEventListener('popstate', this.handlePopState)
                resolve()
            } catch (error) {
                reject(error)
            }
        })
    }

    public navigateTo(
        path: string,
        {
            params = {},
            query = {},
            hash = '',
            isInitializationStep = false,
        } = {},
    ): void {
        const routerState = routerStore.getData()
        const history = routerState.history.slice()

        if (
            !isInitializationStep
            && routerState.currentRoute.path
        )
            history.push(routerState.currentRoute)

        routerStore.setDataValues({
            currentRoute: {
                path,
                hash,
                routeParams: params,
                routeQuery: query,
                isInitializationStep,
            },
            history,
        })

        const routeDef = this.routeDefinitions.find(route => route.path === path)

        if (routeDef?.load)
            void routeDef.load(params, query)

        document.title = routeDef
            ? `${routeDef.title} · AI Model Registry`
            : 'AI Model Registry'
    }

    public goBack(): void {
        const routerState = routerStore.getData()

        if (!routerState.history.length)
            return

        const history = routerState.history.slice()
        const previousRoute = history.pop()

        routerStore.setDataValues({
            currentRoute: previousRoute!,
            history,
        })
    }

    public destroy(): void {
        window.removeEventListener('popstate', this.handlePopState)
        RouterService.instance = null
    }
}

export default RouterService.getInstance()
