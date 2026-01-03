'use strict'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { routerStore } from '$src/stores/routerStore.ts'

type RouteDefinition = {
    path: string
    load?: (params: Record<string, unknown>, query: Record<string, unknown>) => Promise<any>
}

export const routes: RouteDefinition[] = [
    {
        path: '/',
    },
    {
        path: '/workspace/:workspaceId',
        load: async (params: any) => {
            const workspaceId = params.workspaceId as string
            await servicesStore.getData('workspaceService').getWorkspace({ workspaceId })
            await servicesStore.getData('documentService').getWorkspaceDocuments({ workspaceId })
        },
    },
]

export type Router = {
    currentRoute: {
        path: string
        language: string
        hash: string
        routeParams: Record<string, any>
        routeQuery: Record<string, any>
        isInitializationStep: boolean
        shouldFetchData: boolean
    }
    history: any[]
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
            if (currentRoute.isInitializationStep) return
            if (this.shouldUpdateBrowserHistory(currentRoute)) {
                this.updateBrowserHistory(currentRoute)
            }
        })
    }

    private syncWithCurrentURL(): void {
        const url = new URL(window.location.href)
        const segments = url.pathname.split('/').filter(Boolean).join('/')
        const routeMatch = this.findRouteByURL(segments)

        if (!routeMatch) return

        const { route, params } = routeMatch

        this.navigateTo(route.path, {
            params,
            query: Object.fromEntries(url.searchParams),
            language: this.extractLanguage(url),
            hash: url.hash.slice(1),
            isInitializationStep: true,
            shouldFetchData: !!route.load,
        })
    }

    private findRouteByURL(urlPath: string): {
        route: RouteDefinition
        params: Record<string, unknown>
    } | null {
        const urlSegments = urlPath.replace(/\/$/, '').split('/').filter(Boolean)

        for (const route of this.routeDefinitions) {
            const routeSegments = route.path.replace(/\/$/, '').split('/').filter(Boolean)
            if (routeSegments.length !== urlSegments.length) continue

            const params: Record<string, unknown> = {}
            let matched = true

            for (let i = 0; i < routeSegments.length; i++) {
                if (routeSegments[i].startsWith(':')) {
                    const paramName = routeSegments[i].substring(1)
                    params[paramName] = decodeURIComponent(urlSegments[i])
                } else if (routeSegments[i] !== urlSegments[i]) {
                    matched = false
                    break
                }
            }

            if (matched) return { route, params }
        }

        return null
    }

    private runDataLoaderIfNeeded(routeDef: RouteDefinition, params: any, query: any): Promise<void> {
        if (typeof routeDef.load !== 'function') return Promise.resolve()

        return routeDef.load(params, query).then((result) => {
            this.markRouteDataFetched()
        })
    }

    private shouldUpdateBrowserHistory(route: Router['currentRoute']): boolean {
        const currentUrl = new URL(window.location.href)
        const targetPath = this.composePath(route.path, route.routeParams)
        const targetQuery = this.composeQuery(route.routeQuery)
        const targetHash = route.hash

        return (
            currentUrl.pathname !== targetPath ||
            currentUrl.search !== targetQuery ||
            currentUrl.hash.slice(1) !== targetHash
        )
    }

    private updateBrowserHistory(route: Router['currentRoute']): void {
        const newUrl = this.composeURL(route)
        history.pushState({}, '', newUrl)
    }

    private composeURL(route: Router['currentRoute']): string {
        const path = this.composePath(route.path, route.routeParams)
        const query = this.composeQuery(route.routeQuery)
        const hash = route.hash ? `#${route.hash}` : ''
        return `${path}${query}${hash}`
    }

    private composePath(routePath: string, params: Record<string, unknown>): string {
        let path = routePath
        Object.entries(params).forEach(([key, value]) => {
            path = path.replace(`:${key}`, encodeURIComponent(String(value)))
        })
        return path
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
            language = '',
            hash = '',
            isInitializationStep = false,
            shouldFetchData = true,
        } = {},
    ): void {
        const routerState = routerStore.getData()
        const history = routerState.history.slice()

        if (!isInitializationStep && routerState.currentRoute.path) {
            history.push(routerState.currentRoute)
        }

        routerStore.setDataValues({
            currentRoute: {
                path,
                language,
                hash,
                routeParams: params,
                routeQuery: query,
                isInitializationStep,
                shouldFetchData,
            },
            history,
        })

        const routeDef = this.routeDefinitions.find(route => route.path === path)
        if (routeDef && routeDef.load && shouldFetchData) {
            this.runDataLoaderIfNeeded(routeDef, params, query)
        }
    }

    // TODO do we even need it? What's the usecase when this can be used outside?
    public shouldFetchRouteData(): boolean {
        return routerStore.getData('currentRoute').shouldFetchData
    }

    // TODO does it reall need to be public? What's the usecase when this can be used outside?
    public markRouteDataFetched(): void {
        const currentRoute = routerStore.getData('currentRoute')
        routerStore.setDataValues({
            currentRoute: { ...currentRoute, shouldFetchData: false },
        })
    }

    public goBack(): void {
        const routerState = routerStore.getData()
        if (!routerState.history.length) return

        const history = routerState.history.slice()
        const previousRoute = history.pop()

        routerStore.setDataValues({
            currentRoute: previousRoute!,
            history,
        })
    }

    public extractLanguage(_url: URL): string {
        return ''
    }

    public getRouteParams(): Record<string, unknown> {
        return routerStore.getData('currentRoute').routeParams
    }

    public destroy(): void {
        window.removeEventListener('popstate', this.handlePopState)
        RouterService.instance = null
    }
}

export default RouterService.getInstance()
