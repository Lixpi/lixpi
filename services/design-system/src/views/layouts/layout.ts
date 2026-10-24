// Root shell: the Gentelella sidebar plus the content pane that swaps between
// showcase pages on the active route. The design system has two modes, regular
// components and canvas items, and each mode has its own sidebar navigation.
// Switching modes replaces the shell and its route outlet together.
// Renderer: TypeScript `html` DOM, no framework runtime.

import {
    createGentelellaApplicationShell,
    type GentelellaApplicationShellInstance,
} from '@lixpi/ui-kit-gentelella/components/application-shell'
import {
    createGentelellaSegmentedControl,
    type GentelellaSegmentedControlInstance,
} from '@lixpi/ui-kit-gentelella/components/form-controls'
import { html } from '@lixpi/ui-primitives/dom'
import {
    createRouteViewOutlet,
    type RouteViewOutletInstance,
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'

import {
    DESIGN_SYSTEM_MODES,
    getRouteMode,
    routes,
    type DesignSystemMode,
} from '$src/routes.ts'
import '$src/views/layouts/layout.scss'

export type LayoutInstance = {
    el: HTMLElement
    destroy: () => void
}

export type LayoutConfig = {
    router: WebClientRouterService
}

type Theme = 'dark' | 'light'

type ModeShell = {
    destroy: () => void
    el: HTMLElement
    mode: DesignSystemMode
}

class Layout implements LayoutInstance {
    readonly el: HTMLElement

    private shell: ModeShell
    private destroyed = false
    private readonly unsubscribe: () => void

    constructor(private readonly config: LayoutConfig) {
        this.el = html`<div className="design-system-layout"></div>` as HTMLElement
        this.shell = this.createShell('components')
        this.el.append(this.shell.el)
        this.unsubscribe = config.router.subscribe(currentRoute => {
            const mode = getRouteMode(currentRoute.path)

            // The outlet of the current shell is notified by the same route change.
            // Replacing it inside that notification would detach a listener the router
            // is still iterating, so the swap waits for the notification to finish.
            if (
                mode
                && mode !== this.shell.mode
            )
                queueMicrotask(() => this.switchMode(mode))
        })
    }

    private switchMode(mode: DesignSystemMode): void {
        if (
            this.destroyed
            || mode === this.shell.mode
        )
            return

        const previous = this.shell
        this.shell = this.createShell(mode)
        previous.el.replaceWith(this.shell.el)
        previous.destroy()
    }

    private createShell(mode: DesignSystemMode): ModeShell {
        const modeRoutes = routes.filter(route => route.mode === mode)
        const groups = [...new Set(
            modeRoutes.map(route => route.group),
        )]
        const modeSwitch = this.createModeSwitch(mode)
        const themeSwitch = this.createThemeSwitch()
        const shell: GentelellaApplicationShellInstance = createGentelellaApplicationShell({
            brand: {
                mark: 'DS',
                name: 'Lixpi Design System',
            },
            navigationGroups: groups.map(
                group => ({
                    label: group,
                    items: modeRoutes.filter(route => route.group === group),
                }),
            ),
            footerContent: html`
                <div className="design-system-sidebar-controls">
                    <span className="design-system-sidebar-label">Mode</span>
                    ${modeSwitch.el}
                    <span className="design-system-sidebar-label">Theme</span>
                    ${themeSwitch.el}
                </div>
            `,
            onNavigate: path => this.config.router.navigateTo(path),
        })
        const outlet: RouteViewOutletInstance = createRouteViewOutlet({
            context: { router: this.config.router },
            onRouteChange: path => shell.setActivePath(path),
            routes: modeRoutes,
            target: shell.contentEl,
        })
        shell.el.classList.add(`design-system-shell-${mode}`)

        return {
            el: shell.el,
            mode,
            destroy: () => {
                outlet.destroy()
                modeSwitch.destroy()
                themeSwitch.destroy()
                shell.destroy()
            },
        }
    }

    private createModeSwitch(mode: DesignSystemMode): GentelellaSegmentedControlInstance {
        return createGentelellaSegmentedControl({
            ariaLabel: 'Design system mode',
            name: 'design-system-mode',
            options: DESIGN_SYSTEM_MODES.map(
                candidate => ({
                    label: candidate.label,
                    value: candidate.mode,
                }),
            ),
            value: mode,
            onChange: value => {
                const target = DESIGN_SYSTEM_MODES.find(candidate => candidate.mode === value)

                if (target)
                    this.config.router.navigateTo(target.homePath)
            },
        })
    }

    private createThemeSwitch(): GentelellaSegmentedControlInstance {
        const root = this.el.ownerDocument.documentElement
        const current: Theme = root.dataset.theme === 'dark' ? 'dark' : 'light'

        return createGentelellaSegmentedControl({
            ariaLabel: 'Color theme',
            name: 'design-system-theme',
            options: [{
                label: 'Light',
                value: 'light',
            }, {
                label: 'Dark',
                value: 'dark',
            }],
            value: current,
            onChange: value => void (root.dataset.theme = value),
        })
    }

    destroy(): void {
        this.destroyed = true
        this.unsubscribe()
        this.shell.destroy()
        this.el.remove()
    }
}

export const createLayout = (config: LayoutConfig): LayoutInstance => new Layout(config)
