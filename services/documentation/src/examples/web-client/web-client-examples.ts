import {
    createRouteViewOutlet,
    createRouterService,
    createStore,
    mountWebClientApplication,
    type CurrentRoute,
    type RouteViewContext,
    type WebClientApplicationInstance,
    type WebClientRouterService,
    type WebClientView,
} from '@lixpi/web-client-service-factory'
import { html } from '@lixpi/ui-primitives/dom'
import { createButton } from '@lixpi/ui-kit/components/button'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { UiExample } from '../ui-example.ts'

const MEMORY_ORIGIN = 'https://example.lixpi.test'

// The router reads location.href, pushes history entries and listens for
// popstate. This window keeps all three in memory, so an example router never
// changes the documentation page's own address.
class MemoryBrowserWindow {
    private readonly entries: string[]
    private index = 0
    private readonly listeners = new Set<EventListener>()
    readonly location = { href: '' }
    readonly history = {
        pushState: (
            _state: unknown,
            _title: string,
            url: string,
        ): void => {
            this.entries.splice(this.index + 1)
            this.entries.push(new URL(url, MEMORY_ORIGIN).href)
            this.index = this.entries.length - 1
            this.location.href = this.entries[this.index]
            this.onChange()
        },
    }

    constructor(
        initialPath: string,
        private readonly onChange: () => void,
    ) {
        this.entries = [new URL(initialPath, MEMORY_ORIGIN).href]
        this.location.href = this.entries[0]
    }

    addEventListener(
        type: string,
        listener: EventListener,
    ): void {
        if (type === 'popstate')
            this.listeners.add(listener)
    }

    removeEventListener(
        type: string,
        listener: EventListener,
    ): void {
        if (type === 'popstate')
            this.listeners.delete(listener)
    }

    get path(): string {
        const url = new URL(this.location.href)

        return `${url.pathname}${url.search}${url.hash}`
    }

    // Moves through history like the browser buttons and fires popstate.
    traverse(delta: number): void {
        const next = this.index + delta

        if (
            next < 0
            || next >= this.entries.length
        )
            throw new Error(delta < 0 ? 'There is no earlier entry.' : 'There is no later entry.')

        this.index = next
        this.location.href = this.entries[next]
        this.onChange()
        const event = new PopStateEvent('popstate')

        for (const listener of this.listeners)
            listener(event)
    }

    asWindow(): Window {
        // The router uses only location, history.pushState and popstate
        // listeners, which this class implements.
        return this as unknown as Window
    }
}

const routes = [
    { path: '/' },
    { path: '/workspaces/:workspaceId' },
    {
        path: '/workspaces/:workspaceId/assets/:assetId',
        load: async (
            params: Record<string, unknown>,
            _query: Record<string, unknown>,
            signal: AbortSignal,
        ): Promise<void> => {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, 900)
                signal.addEventListener('abort', () => {
                    clearTimeout(timer)
                    reject(
                        new DOMException(`Loading ${String(params.assetId)} was cancelled`, 'AbortError'),
                    )
                })
            })
        },
    },
    { path: '/not-found' },
]

const describeRoute = (route: CurrentRoute): string =>
    JSON.stringify(
        {
            path: route.path,
            params: route.routeParams,
            query: route.routeQuery,
            hash: route.hash,
            shouldFetchData: route.shouldFetchData,
        },
        null,
        2,
    )

const createRouterExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createRouterService matches paths against parameterised routes, keeps the current route in a store, pushes history entries and follows back and forward navigation. Here it runs against an in-memory window. The asset route has a slow data loader: navigating away before it finishes cancels it through its AbortSignal.',
    )
    const address = html`<pre className="documentation-ui-output"></pre>` as HTMLElement
    const state = html`<pre className="documentation-ui-output"></pre>` as HTMLElement
    example.specimen('Address', address)
    example.specimen('Current route', state)
    const memoryWindow = new MemoryBrowserWindow('/workspaces/autumn', () => void (address.textContent = memoryWindow.path))
    address.textContent = memoryWindow.path
    const router = createRouterService({
        routes,
        fallbackPath: '/not-found',
        window: memoryWindow.asWindow(),
    })
    example.own(() => router.destroy())
    const unsubscribe = router.subscribe(route => void (state.textContent = describeRoute(route)))
    example.own(unsubscribe)
    void router.init()
    let workspaceId = 'autumn'
    let assetId = 'poster'
    example.frame.text(
        'Workspace',
        workspaceId,
        value => void (workspaceId = value),
    )
    example.frame.text(
        'Asset',
        assetId,
        value => void (assetId = value),
    )
    example.frame.button('Open the workspace', () => router.navigateTo('/workspaces/:workspaceId', { params: { workspaceId } }))
    example.frame.button(
        'Open the asset',
        () => router.navigateTo(
            '/workspaces/:workspaceId/assets/:assetId',
            {
                params: {
                    workspaceId,
                    assetId,
                },
                query: { view: 'details' },
                hash: 'history',
            },
        ),
    )
    example.frame.button('Mark data fetched', () => router.markRouteDataFetched())
    example.frame.button('Back in router history', () => router.goBack())
    example.frame.button('Browser back', () => memoryWindow.traverse(-1))
    example.frame.button('Browser forward', () => memoryWindow.traverse(1))
    example.frame.code(
        () => [
            "import { createRouterService } from '@lixpi/web-client-service-factory'",
            '',
            'const router = createRouterService({',
            '    routes: [',
            "        { path: '/workspaces/:workspaceId' },",
            "        { path: '/workspaces/:workspaceId/assets/:assetId', load: (params, query, signal) => assets.load(params.assetId, { signal }) },",
            "        { path: '/not-found' },",
            '    ],',
            "    fallbackPath: '/not-found',",
            '})',
            'await router.init()',
            '',
            "router.navigateTo('/workspaces/:workspaceId/assets/:assetId', {",
            `    params: { workspaceId: '${workspaceId}', assetId: '${assetId}' },`,
            "    query: { view: 'details' },",
            '})',
        ].join('\n'),
    )

    return example
}

// A route view: the outlet creates one when its path becomes current and
// destroys it when the path changes.
class RoutePage implements WebClientView {
    readonly el: HTMLElement

    constructor(
        private readonly title: string,
        context: RouteViewContext,
        private readonly log: (message: string) => void,
    ) {
        const params = JSON.stringify(
            context.router.getRouteParams(),
        )
        this.el = html`
            <section className="documentation-ui-route-view documentation-ui-card">
                <strong>${title}</strong>
                <span>Route parameters: ${params}</span>
            </section>
        ` as HTMLElement
    }

    mount = (): void => void this.log(`Mounted the ${this.title} view.`)

    destroy = (): void => {
        this.log(`Destroyed the ${this.title} view.`)
        this.el.remove()
    }
}

const createRouteViewsExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createRouteViewOutlet renders the view registered for the current route path into a target element. A new path destroys the previous view and mounts the next one. A change of parameters on the same path keeps the mounted view.',
    )
    const target = html`<div className="documentation-ui-wide"></div>` as HTMLElement
    const log = html`<pre className="documentation-ui-output"></pre>` as HTMLElement
    example.specimen('Outlet', target)
    example.specimen('Lifecycle', log)
    const write = (message: string): void => void (log.textContent = `${log.textContent ?? ''}${message}\n`)
    const memoryWindow = new MemoryBrowserWindow('/', () => {})
    const router: WebClientRouterService = createRouterService({
        routes: [
            { path: '/' },
            { path: '/workspaces/:workspaceId' },
            { path: '/settings' },
        ],
        fallbackPath: '/',
        window: memoryWindow.asWindow(),
    })
    const outlet = createRouteViewOutlet({
        context: { router },
        target,
        routes: [
            {
                path: '/',
                createView: context => new RoutePage(
                    'Home',
                    context,
                    write,
                ),
            },
            {
                path: '/workspaces/:workspaceId',
                createView: context => new RoutePage(
                    'Workspace',
                    context,
                    write,
                ),
            },
            {
                path: '/settings',
                createView: context => new RoutePage(
                    'Settings',
                    context,
                    write,
                ),
            },
        ],
        onRouteChange: path => write(`Route changed to ${path}.`),
    })
    example.own(() => router.destroy())
    example.own(() => outlet.destroy())
    void router.init()
    example.frame.button('Home', () => router.navigateTo('/'))
    example.frame.button('Workspace autumn', () => router.navigateTo('/workspaces/:workspaceId', { params: { workspaceId: 'autumn' } }))
    example.frame.button('Workspace winter', () => router.navigateTo('/workspaces/:workspaceId', { params: { workspaceId: 'winter' } }))
    example.frame.button('Settings', () => router.navigateTo('/settings'))
    example.frame.code(
        () => [
            "import { createRouteViewOutlet } from '@lixpi/web-client-service-factory'",
            '',
            'const outlet = createRouteViewOutlet({',
            '    context: { router },',
            '    target: main,',
            '    routes: [',
            "        { path: '/', createView: context => new HomePage(context) },",
            "        { path: '/settings', createView: context => new SettingsPage(context) },",
            '    ],',
            '})',
        ].join('\n'),
    )

    return example
}

type DraftMeta = {
    saving: boolean
}

type DraftData = {
    title: string
    tags: string[]
}

const createStoresExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createStore wraps a Nano Store. A state with meta and data gets typed getters and partial setters, and createMethods composes domain methods onto the public store without replacing the base methods its own implementation uses. resetStore returns to a copy of the initial state.',
    )
    const output = html`<pre className="documentation-ui-output"></pre>` as HTMLElement
    example.specimen('Store state', output)
    const store = createStore({
        initialState: {
            meta: { saving: false } as DraftMeta,
            data: {
                title: 'Autumn launch',
                tags: ['poster'],
            } as DraftData,
        },
        createMethods: base => ({
            rename: (title: string): void => void base.setDataValues({ title }),
            addTag: (tag: string): void => void base.setDataValues({ tags: [...base.getData('tags'), tag] }),
            setSaving: (saving: boolean): void => void base.setMetaValues({ saving }),
        }),
    })
    const unsubscribe = store.subscribe(
        state => void (output.textContent = JSON.stringify(
            state,
            null,
            2,
        )),
    )
    example.own(unsubscribe)
    let tag = 'video'
    example.frame.text(
        'Title',
        store.getData('title'),
        value => store.rename(value),
    )
    example.frame.text(
        'Tag',
        tag,
        value => void (tag = value),
    )
    example.frame.button('Add the tag', () => {
        if (!tag.trim())
            throw new Error('Enter a tag first.')

        store.addTag(
            tag.trim(),
        )
    })
    example.frame.toggle(
        'Saving',
        false,
        saving => store.setSaving(saving),
    )
    example.frame.button('Reset the store', () => store.resetStore())
    example.frame.code(
        () => [
            "import { createStore } from '@lixpi/web-client-service-factory'",
            '',
            'const draft = createStore({',
            `    initialState: { meta: { saving: false }, data: { title: '', tags: [] } },`,
            '    createMethods: base => ({',
            '        rename: title => base.setDataValues({ title }),',
            "        addTag: tag => base.setDataValues({ tags: [...base.getData('tags'), tag] }),",
            '    }),',
            '})',
            '',
            `draft.rename(${JSON.stringify(
                store.getData('title'),
            )})`,
            'draft.subscribe(({ data }) => render(data))',
        ].join('\n'),
    )

    return example
}

class CounterView implements WebClientView {
    readonly el: HTMLElement
    private count = 0
    private readonly button = createButton({
        label: 'Count 0',
        onClick: () => this.increment(),
    })

    constructor(private readonly log: (message: string) => void) {
        this.el = html`
            <section className="documentation-ui-route-view documentation-ui-card">
                <strong>Mounted application</strong>
                ${this.button.element}
            </section>
        ` as HTMLElement
    }

    private increment = (): void => {
        this.count += 1
        this.button.setLabel(`Count ${this.count}`)
    }

    mount = (): void => void this.log('The view mounted.')

    destroy = (): void => {
        this.log('The view was destroyed.')
        this.el.remove()
    }
}

const createApplicationExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'mountWebClientApplication creates resources, then the root view, appends the view to the target and calls its mount hook. destroy releases the view and then the resources in reverse order, runs the shutdown hook and reports every failure together. createWebClientService adds routing, dependencies and scrollbars on top of it.',
    )
    const target = html`<div className="documentation-ui-wide"></div>` as HTMLElement
    const log = html`<pre className="documentation-ui-output"></pre>` as HTMLElement
    example.specimen('Target', target)
    example.specimen('Lifecycle', log)
    const write = (message: string): void => void (log.textContent = `${log.textContent ?? ''}${message}\n`)
    let failResource = false
    let application: WebClientApplicationInstance | null = null
    const resource = (name: string) => () => {
        write(`Created ${name}.`)

        return {
            destroy: () => {
                write(`Destroyed ${name}.`)

                if (
                    failResource
                    && name === 'tooltips'
                )
                    throw new Error('The tooltips resource failed to shut down.')
            },
        }
    }
    const start = (): void => {
        if (application)
            throw new Error('The application is already mounted.')

        application = mountWebClientApplication({
            target,
            createResources: [resource('tooltips'), resource('keyboard shortcuts')],
            createView: () => new CounterView(write),
            shutdown: async () => write('Shutdown hook ran.'),
        })
        example.frame.report('Mounted.')
    }
    const stop = async (): Promise<void> => {
        const current = application
        application = null

        if (!current) {
            example.frame.report('Nothing is mounted.')

            return
        }

        try {
            await current.destroy()
            example.frame.report('Destroyed without errors.')
        } catch (error) {
            example.frame.error(error)
        }
    }
    // Closing the page releases a mounted application. Its shutdown errors
    // have no page left to report on.
    const release = async (): Promise<void> => {
        const current = application
        application = null

        try {
            await current?.destroy()
        } catch {
            return
        }
    }
    example.own(() => void release())
    example.frame.toggle(
        'Fail a resource on destroy',
        failResource,
        value => void (failResource = value),
    )
    example.frame.button('Mount', start)
    example.frame.button('Destroy', () => void stop())
    example.frame.button('Clear the log', () => void (log.textContent = ''))
    start()
    example.frame.code(
        () => [
            "import { mountWebClientApplication } from '@lixpi/web-client-service-factory'",
            '',
            'const application = mountWebClientApplication({',
            '    target: document.getElementById(\'app\'),',
            '    createResources: [() => createHelpTooltipProvider({ root: document })],',
            '    createView: () => new RootLayout(),',
            '    shutdown: async () => connection.close(),',
            '})',
            '',
            'await application.destroy()',
        ].join('\n'),
    )

    return example
}

const factories: Record<string, (host: HTMLElement) => UiExample> = {
    'web-client-router': createRouterExample,
    'web-client-route-views': createRouteViewsExample,
    'web-client-stores': createStoresExample,
    'web-client-application': createApplicationExample,
}

export const createExample = (
    host: HTMLElement,
    id: string,
): ExampleOwner => {
    const factory = factories[id]

    if (!factory)
        throw new Error(`Unknown web client example: ${id}`)

    return factory(host)
}
