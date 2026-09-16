import {
    createGentelellaApplicationShell,
    type GentelellaApplicationShellInstance,
} from '@lixpi/ui-kit-gentelella/components/application-shell'
import {
    createRouteViewOutlet,
    type RouteViewOutletInstance,
} from '@lixpi/web-client-service-factory'

import {
    type UserPortalModuleContext,
    type UserPortalNavigationGroup,
    type UserPortalRouteDefinition,
} from './types.ts'

export type LayoutInstance = {
    readonly el: HTMLDivElement
    destroy: () => void
}

export type LayoutConfig = {
    context: UserPortalModuleContext
    routes: UserPortalRouteDefinition[]
    navigationGroups: UserPortalNavigationGroup[]
}

class Layout implements LayoutInstance {
    readonly el: HTMLDivElement

    private readonly shell: GentelellaApplicationShellInstance
    private readonly viewOutlet: RouteViewOutletInstance

    constructor(config: LayoutConfig) {
        this.shell = createGentelellaApplicationShell({
            brand: {
                mark: 'L',
                name: 'Lixpi Portal',
            },
            navigationGroups: config.navigationGroups,
            onNavigate: path => config.context.router.navigateTo(path),
        })

        try {
            this.viewOutlet = createRouteViewOutlet({
                context: config.context,
                onRouteChange: path => this.shell.setActivePath(path),
                target: this.shell.contentEl,
                routes: config.routes,
            })
        } catch (error) {
            this.shell.destroy()

            throw error
        }

        this.el = this.shell.el
    }

    destroy(): void {
        try {
            this.viewOutlet.destroy()
        } finally {
            this.shell.destroy()
        }
    }
}

export const createLayout = (config: LayoutConfig): LayoutInstance => new Layout(config)
