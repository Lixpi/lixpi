// Root shell: the Gentelella sidebar plus the content pane that swaps between
// the parameter registry and the model catalog on the active route.
// Renderer: TypeScript `html` DOM, no framework runtime.

import { html } from '@lixpi/ui-primitives/dom'

import RouterService, {
    MODEL_CATALOG_ROUTE_PATH,
    MODEL_PARAMETERS_ROUTE_PATH,
} from '$src/services/router-service.ts'
import { routerStore } from '$src/stores/routerStore.ts'
import {
    catalogIcon,
    slidersIcon,
} from '$src/views/layouts/icons.ts'
import {
    createModelCatalogView,
    type ModelCatalogViewInstance,
} from '$src/views/modelCatalog/modelCatalogView.ts'
import {
    createModelParametersView,
    type ModelParametersViewInstance,
} from '$src/views/modelParameters/modelParametersView.ts'
import '$src/views/layouts/layout.scss'

type NavigationItem = {
    path: string
    label: string
    icon: string
}

const NAVIGATION_ITEMS: NavigationItem[] = [
    {
        path: MODEL_PARAMETERS_ROUTE_PATH,
        label: 'Model parameters',
        icon: slidersIcon,
    },
    {
        path: MODEL_CATALOG_ROUTE_PATH,
        label: 'Model catalog',
        icon: catalogIcon,
    },
]

export type LayoutInstance = {
    el: HTMLElement
    destroy: () => void
}

type MountedView = ModelCatalogViewInstance | ModelParametersViewInstance

class Layout implements LayoutInstance {
    readonly el: HTMLElement

    private readonly contentEl: HTMLDivElement
    private readonly navigationLinks = new Map<string, HTMLAnchorElement>()
    private readonly unsubscribeRouter: () => void

    private mountedPath: string | null = null
    private view: MountedView | null = null

    constructor() {
        this.contentEl = html`<div className="registry-content"></div>` as HTMLDivElement

        this.el = html`
            <div className="registry-shell">
                ${this.renderSidebar()}
                <main className="main">
                    ${this.contentEl}
                </main>
            </div>
        ` as HTMLElement

        this.unsubscribeRouter = routerStore.subscribe(
            ({ data }) => void this.renderRoute(data.currentRoute.path),
        )
    }

    private renderSidebar(): HTMLElement {
        const navigationEl = html`<nav className="sidebar-nav"></nav>` as HTMLElement
        const groupEl = html`
            <div className="nav-group">
                <div className="nav-label">Registry</div>
            </div>
        ` as HTMLDivElement

        for (const item of NAVIGATION_ITEMS) {
            const link = html`
                <a
                    className="nav-link"
                    href=${item.path}
                    onclick=${(event: Event) => this.handleNavigationClick(event, item.path)}
                >
                    <span innerHTML=${item.icon}></span>
                    <span className="nav-text">${item.label}</span>
                </a>
            ` as HTMLAnchorElement
            this.navigationLinks.set(item.path, link)
            groupEl.append(link)
        }

        navigationEl.append(groupEl)

        return html`
            <aside className="sidebar">
                <div className="sidebar-brand">
                    <span className="brand-icon">AI</span>
                    <span className="brand-name">Model Registry</span>
                </div>
                ${navigationEl}
                <div className="sidebar-footer">
                    <span className="registry-sidebar-note">Lixpi</span>
                </div>
            </aside>
        ` as HTMLElement
    }

    private handleNavigationClick(
        event: Event,
        path: string,
    ): void {
        event.preventDefault()
        RouterService.navigateTo(path)
    }

    private renderRoute(path: string): void {
        for (const [itemPath, link] of this.navigationLinks)
            link.classList.toggle('active', itemPath === path)

        if (path === this.mountedPath)
            return

        this.mountedPath = path
        this.view?.destroy()
        this.view = null

        if (!path)
            return

        this.view = path === MODEL_CATALOG_ROUTE_PATH
            ? createModelCatalogView()
            : createModelParametersView()
        this.contentEl.append(this.view.el)
        // Only now is the view in the document, which is what a view that reads
        // its own DOM back has been waiting for.
        this.view.mount()
    }

    destroy(): void {
        this.unsubscribeRouter()
        this.view?.destroy()
        this.view = null
        this.navigationLinks.clear()
        this.el.remove()
    }
}

export const createLayout = (): LayoutInstance => new Layout()
