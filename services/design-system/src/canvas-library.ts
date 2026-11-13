import { select } from 'd3-selection'
import {
    mountNestedList,
    type NestedListActivation,
    type NestedListHandle,
} from '@lixpi/prosemirror/frontend/nested-list'
import { bindCanvasTheme } from '@lixpi/canvas-components/theme'
import { createLixpiCanvasThemeFromPreset } from '@lixpi/canvas-components/workspace/settings'
import {
    lixpiLightTheme,
    oneDarkProMarianaTheme,
} from '@lixpi/themes'
import {
    CanvasLibraryLayout,
    canvasLibraryInspectorTabsGeometry,
    type CanvasLibraryPanel,
} from '@lixpi/ui-kit/canvas-library'
import {
    createSidePanel,
    type SidePanelInstance,
} from '@lixpi/ui-kit/components/side-panel'
import {
    createPureDropdown,
    type PureDropdownInstance,
    type DropdownOption,
} from '@lixpi/ui-kit/components/dropdown'
import {
    createSlidingTabsSwitch,
    type SlidingTabsSwitchInstance,
} from '@lixpi/ui-kit/components/sliding-tabs-switch'
import { html } from '@lixpi/ui-primitives/dom'
import { CanvasThemeEditor } from './canvas-theme-editor.ts'
import { getExampleTheme } from './examples/example-theme.ts'
import { FixtureEditor } from './examples/workspace/fixture-editor.ts'
import {
    type CurrentRoute,
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'
import {
    canvasExamples,
    mountCanvasExample,
    type CanvasExample,
} from './catalog/catalog.ts'
import {
    canvasDomains,
    getCanvasDomain,
    type CanvasDomain,
} from './catalog/domains.ts'
import { canvasNodeExamples } from './catalog/nodes.ts'
import { buildCanvasLibraryNavigationDocument } from './catalog/navigation-document.ts'

type MountedExample = Awaited<ReturnType<typeof mountCanvasExample>>
type ExampleOption = DropdownOption & { value: string }
type InspectorView = 'parameters' | 'code'
export class CanvasLibrary {
    readonly el: HTMLElement
    private readonly navigation: HTMLElement
    private navigationList: NestedListHandle | null = null
    private readonly search: HTMLInputElement
    private readonly title: HTMLElement
    private readonly stage: HTMLElement
    private readonly sidebar: HTMLElement
    private readonly inspector: HTMLElement
    private readonly inspectorContent: HTMLElement
    private readonly exampleSelector: HTMLElement
    private readonly themePanel: HTMLElement
    private readonly themeContent: HTMLElement
    private readonly leftPanel: SidePanelInstance
    private readonly paramsPanel: SidePanelInstance
    private readonly rightPanel: SidePanelInstance
    private readonly inspectorTabsSvg: SVGSVGElement
    private readonly inspectorTabs: SlidingTabsSwitchInstance<InspectorView>
    private readonly layout: CanvasLibraryLayout
    private readonly resizeObserver: ResizeObserver
    private readonly selectedExamples = new Map<string, string>()
    private readonly expandedDomains = new Set<string>()
    private activeDomain: CanvasDomain | null = null
    private activeExample: CanvasExample | null = null
    private exampleDropdown: PureDropdownInstance<ExampleOption> | null = null
    private mountedExample: MountedExample | null = null
    private referenceEditor: FixtureEditor | null = null
    private unsubscribeRouter: (() => void) | null = null
    private generation = 0
    private destroyed = false
    private themeEditor: CanvasThemeEditor | null = null
    private releaseTheme: (() => void) | null = null
    private releasePortalTheme: (() => void) | null = null
    private releaseWidgetTheme: (() => void) | null = null
    private themeOpen = false
    private navigationOpen = true
    private paramsOpen = true
    private resizingPanels = false

    constructor(private readonly router: WebClientRouterService) {
        this.navigation = html`
            <nav
                className="canvas-library-navigation navigation-side-panel-list"
                aria-label="Canvas domains"
            ></nav>
        ` as HTMLElement
        this.search = html`
            <input
                className="canvas-library-search"
                type="search"
                aria-label="Find a canvas component"
                placeholder="Find a component"
                autocomplete="off"
                oninput=${() => {
                    if (this.search.value.trim())
                        this.expandedDomains.add('nodes')

                    this.renderNavigation()
                }}
            />
        ` as HTMLInputElement
        this.title = html`<h1 className="canvas-library-title"></h1>` as HTMLElement
        this.stage = html`
            <main
                className="canvas-library-stage"
                aria-label="Canvas example"
            ></main>
        ` as HTMLElement
        this.inspectorContent = html`
            <div
                className="canvas-library-inspector-content side-panel-document"
                data-view="parameters"
            ></div>
        ` as HTMLElement
        this.exampleSelector = html`<div className="canvas-library-example-selector"></div>` as HTMLElement
        const tabsHost = html`<div className="canvas-library-inspector-tabs-host"></div>` as HTMLDivElement
        const tabs = select(tabsHost)
            .append("svg")
            .attr("class", "canvas-library-inspector-tabs")
            .attr("aria-label", "Example details")
            .node()

        if (!tabs)
            throw new Error('Inspector tab host must be an SVG element')

        this.inspectorTabsSvg = tabs
        this.inspectorTabs = createSlidingTabsSwitch<InspectorView>(
            select(tabs),
            {
                id: 'canvas-library-inspector-view',
                ...canvasLibraryInspectorTabsGeometry,
                tabs: [
                    {
                        label: 'Parameters',
                        value: 'parameters',
                    },
                    {
                        label: 'Code',
                        value: 'code',
                    },
                ],
                selectedValue: 'parameters',
                onChange: value => void (this.inspectorContent.dataset.view = value),
            },
        )
        this.sidebar = html`
            <aside
                className="canvas-library-sidebar navigation-side-panel"
                aria-label="Canvas library navigation"
            >
                <div className="canvas-library-navigation-pane">
                    <a
                        className="canvas-library-brand navigation-side-panel-row no-hover"
                        href="/"
                        onclick=${this.goHome}
                    ><span className="navigation-side-panel-row-title">Canvas</span></a>
                    ${this.search}
                    ${this.navigation}
                </div>
            </aside>
        ` as HTMLElement
        this.inspector = html`
            <aside
                id="canvas-library-parameters"
                className="canvas-library-inspector"
                aria-label="Example settings and code"
            >
                <div className="canvas-library-inspector-heading">
                    ${this.title}
                    <div className="canvas-library-panel-actions">
                        <button
                            type="button"
                            className="canvas-library-text-button navigation-side-panel-row"
                            onclick=${this.resetExample}
                        ><span className="navigation-side-panel-row-title">Reset</span></button>
                    </div>
                </div>
                ${this.exampleSelector}
                ${tabsHost}
                ${this.inspectorContent}
            </aside>
        ` as HTMLElement
        this.themeContent = html`<div className="canvas-library-theme-content"></div>` as HTMLElement
        this.themePanel = html`
            <aside
                id="canvas-library-theme"
                className="canvas-library-theme-panel"
                aria-label="Global canvas theme"
                hidden
            >
                <div className="canvas-library-theme-heading">
                    <h2>Canvas theme</h2>
                </div>
                ${this.themeContent}
            </aside>
        ` as HTMLElement
        this.el = html`
            <div className="canvas-library canvas-library-navigating canvas-library-inspecting">
                ${this.sidebar}
                ${this.stage}
                ${this.inspector}
                ${this.themePanel}
            </div>
        ` as HTMLElement
        // The library pushes the stage aside so examples stay fully visible
        // beside every open panel. The ui-kit default is overlay.
        this.layout = new CanvasLibraryLayout(
            this.el,
            {
                placements: {
                    navigation: 'push',
                    parameters: 'push',
                    theme: 'push',
                },
            },
        )
        this.leftPanel = createSidePanel(
            this.layout.panel(
                'navigation',
                {
                    onToggle: this.toggleNavigation,
                    getMaxWidth: () => this.getPanelMaximumWidth('navigation'),
                    onResize: width => this.layout.setWidth('navigation', width),
                },
            ),
        )
        this.paramsPanel = createSidePanel(
            this.layout.panel(
                'parameters',
                {
                    onToggle: this.toggleParameters,
                    getMaxWidth: () => this.getPanelMaximumWidth('parameters'),
                    onResize: width => this.layout.setWidth('parameters', width),
                },
            ),
        )
        this.rightPanel = createSidePanel(
            this.layout.panel(
                'theme',
                {
                    onToggle: this.toggleTheme,
                    getMaxWidth: () => this.getPanelMaximumWidth('theme'),
                    onResize: width => this.layout.setWidth('theme', width),
                },
            ),
        )
        this.layout.mountPanel(
            'navigation',
            this.sidebar,
            this.leftPanel,
        )
        this.layout.mountPanel(
            'parameters',
            this.inspector,
            this.paramsPanel,
        )
        this.layout.mountPanel(
            'theme',
            this.themePanel,
            this.rightPanel,
        )

        for (const panel of [this.leftPanel, this.paramsPanel, this.rightPanel])
            if (panel.toggleElement) {
                panel.toggleElement.dataset.sidePanelNoDrag = ''
                this.el.append(panel.toggleElement)
            }

        for (const pane of [this.sidebar, this.inspector, this.themePanel])
            pane.dataset.sidePanelNoDrag = ''

        this.resizeObserver = new ResizeObserver(this.resizePanels)
    }

    mount = (): void => {
        const theme = getExampleTheme(this.el)
        const mariana = createLixpiCanvasThemeFromPreset(oneDarkProMarianaTheme)
        const light = createLixpiCanvasThemeFromPreset(lixpiLightTheme)
        this.themeEditor = new CanvasThemeEditor(
            theme,
            mariana,
            light,
        )
        this.themeContent.append(this.themeEditor.el)
        this.releaseTheme = bindCanvasTheme(this.el, theme)
        this.releasePortalTheme = bindCanvasTheme(this.el.ownerDocument.body, theme)
        this.releaseWidgetTheme = theme.subscribe(this.resizeInspectorTabs)
        this.layout.mountOpen(
            'navigation',
            this.sidebar,
            this.leftPanel,
        )
        this.layout.mountOpen(
            'parameters',
            this.inspector,
            this.paramsPanel,
        )
        this.navigationList = mountNestedList({
            container: this.navigation,
            document: buildCanvasLibraryNavigationDocument(this.search.value),
            readOnly: true,
            collapsed: ['domain:nodes'],
            onActivate: this.activateNavigationEntry,
            onCollapseChange: (entryId, collapsed) => {
                if (entryId !== 'domain:nodes')
                    return

                if (collapsed)
                    this.expandedDomains.delete('nodes')
                else
                    this.expandedDomains.add('nodes')
            },
        })
        this.resizeObserver.observe(this.el)
        this.resizeObserver.observe(this.inspector)
        this.resizePanels()
        this.unsubscribeRouter = this.router.subscribe(this.onRouteChange)
    }

    private getPanelMaximumWidth(panel: CanvasLibraryPanel): number {
        const docks = [
            {
                id: "navigation",
                element: this.sidebar,
                open: this.navigationOpen,
            },
            {
                id: "parameters",
                element: this.inspector,
                open: this.paramsOpen,
            },
            {
                id: "theme",
                element: this.themePanel,
                open: this.themeOpen,
            },
        ]
        const occupied = docks.filter(dock => dock.id !== panel && dock.open).reduce(
            (width, dock) => width + dock.element.getBoundingClientRect().width,
            0,
        )
        const stageMinimumWidth = this.layout.stageMinimumWidth(this.paramsOpen)

        return Math.max(
            this.layout.minimumWidth(panel),
            this.el.clientWidth - occupied - stageMinimumWidth,
        )
    }

    private resizePanels = (): void => {
        if (this.resizingPanels)
            return

        this.resizingPanels = true

        try {
            const docks = [
                {
                    panel: this.leftPanel,
                    open: this.navigationOpen,
                    name: 'navigation' as const,
                },
                {
                    panel: this.paramsPanel,
                    open: this.paramsOpen,
                    name: 'parameters' as const,
                },
                {
                    panel: this.rightPanel,
                    open: this.themeOpen,
                    name: 'theme' as const,
                },
            ]

            for (const dock of docks) {
                if (!dock.open)
                    continue

                dock.panel.applyConstraints()
                this.layout.setWidth(
                    dock.name,
                    dock.panel.getWidth(),
                )
            }

            this.resizeInspectorTabs()
        } finally {
            this.resizingPanels = false
        }
    }

    private resizeInspectorTabs = (): void => {
        if (!this.paramsOpen)
            return

        const geometry = this.layout.inspectorTabs(this.inspectorTabsSvg)
        this.inspectorTabs.resize(
            geometry.x,
            geometry.y,
            geometry.width,
            geometry.height,
        )
    }

    private goHome = (event: MouseEvent): void => {
        if (
            event.metaKey
            || event.ctrlKey
            || event.shiftKey
            || event.altKey
        )
            return

        event.preventDefault()
        this.router.navigateTo('/')
    }

    private navigateDomain(domain: CanvasDomain): void {
        const exampleId = this.selectedExamples.get(domain.id)

        if (exampleId) {
            this.router.navigateTo(
                '/domains/:domainId/:exampleId',
                { params: {
                    domainId: domain.id,
                    exampleId,
                } },
            )

            return
        }

        this.router.navigateTo('/domains/:domainId', { params: { domainId: domain.id } })
    }

    private activateNavigationEntry = ({
        entryId,
        event,
    }: NestedListActivation): void => {
        if (entryId.startsWith('domain:')) {
            const domain = canvasDomains.find(candidate => candidate.id === entryId.slice('domain:'.length))

            if (!domain)
                return

            if (
                event instanceof MouseEvent
                && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            ) {
                const exampleId = this.selectedExamples.get(domain.id)
                const href = exampleId ? `/domains/${domain.id}/${exampleId}` : `/domains/${domain.id}`
                window.open(
                    href,
                    '_blank',
                    'noopener,noreferrer',
                )

                return
            }

            this.navigateDomain(domain)

            return
        }

        if (!entryId.startsWith('example:'))
            return

        const exampleId = entryId.slice('example:'.length)

        if (!canvasNodeExamples.some(example => example.id === exampleId))
            return

        if (
            event instanceof MouseEvent
            && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        ) {
            window.open(
                `/domains/nodes/${exampleId}`,
                '_blank',
                'noopener,noreferrer',
            )

            return
        }

        this.router.navigateTo(
            '/domains/:domainId/:exampleId',
            { params: {
                domainId: 'nodes',
                exampleId,
            } },
        )
    }

    private renderNavigation = (): void => {
        if (!this.navigationList)
            return

        this.navigationList.setDocument(
            buildCanvasLibraryNavigationDocument(this.search.value),
        )
        this.navigationList.setCollapsed(this.expandedDomains.has('nodes') ? [] : ['domain:nodes'])
        this.navigationList.setActive(
            this.activeDomain?.id === 'nodes'
                && this.activeExample
                ? `example:${this.activeExample.id}`
                : this.activeDomain
                    ? `domain:${this.activeDomain.id}`
                    : undefined,
        )
    }

    private onRouteChange = (route: CurrentRoute): void => {
        if (!route.path)
            return

        if (route.path === '/') {
            this.navigateDomain(canvasDomains[0])

            return
        }

        const domainId = String(route.routeParams.domainId ?? '')
        const requestedId = String(route.routeParams.exampleId ?? '')
        const domain = domainId ? canvasDomains.find(candidate => candidate.id === domainId) : getCanvasDomain(requestedId)
        const id = requestedId || (domain ? this.selectedExamples.get(domain.id) ?? domain.examples[0] : '')
        const example = canvasExamples.find(candidate => candidate.id === id)

        if (
            !domain
            || !example
            || !domain.examples.includes(example.id)
        ) {
            this.releaseExample()
            this.activeExample = null
            this.activeDomain = null
            this.exampleDropdown?.destroy()
            this.exampleDropdown = null
            this.exampleSelector.replaceChildren()
            this.title.textContent = 'Not found'
            this.stage.replaceChildren(
                html`
                    <p
                        className="canvas-library-error"
                        role="alert"
                    >No canvas example is registered for this URL.</p>
                ` as HTMLElement,
            )
            this.renderNavigation()

            return
        }

        this.expandedDomains.add(domain.id)

        if (this.activeExample?.id === example.id) {
            this.renderNavigation()

            return
        }

        this.activeDomain = domain
        this.activeExample = example
        this.selectedExamples.set(domain.id, example.id)
        this.title.textContent = canvasNodeExamples.some(candidate => candidate.id === example.id) ? example.title : domain.title
        this.stage.ariaLabel = `${domain.title}: ${example.title}`
        document.title = `${domain.title} | Canvas`
        this.renderNavigation()

        this.renderExampleSelector(domain, example)

        this.renderExample(example)
    }

    private renderExampleSelector(
        domain: CanvasDomain,
        active: CanvasExample,
    ): void {
        this.exampleDropdown?.destroy()
        this.exampleDropdown = null
        this.exampleSelector.replaceChildren()

        if (
            domain.id === 'nodes'
            && canvasNodeExamples.some(example => example.id === active.id)
        )
            return

        const options = domain.examples.map(id => {
            const example = canvasExamples.find(candidate => candidate.id === id)!

            return {
                title: example.title,
                value: id,
            }
        })

        if (options.length === 1)
            return

        this.exampleDropdown = createPureDropdown<ExampleOption>({
            id: 'canvas-library-domain-example',
            triggerLabel: `${domain.title} example`,
            selectedValue: {
                title: active.title,
                value: active.id,
            },
            options,
            mountToBody: true,
            popoverClassName: "canvas-library-dropdown-popover",
            renderIconForOptions: false,
            renderIconForSelectedValue: false,
            onSelect: option => this.router.navigateTo(
                '/domains/:domainId/:exampleId',
                { params: {
                    domainId: domain.id,
                    exampleId: option.value,
                } },
            ),
        })
        this.exampleSelector.append(this.exampleDropdown.dom)
    }

    private renderExample(example: CanvasExample): void {
        this.releaseExample()
        this.stage.setAttribute('aria-busy', 'true')
        void this.loadExample(example, this.generation)
    }

    private async loadExample(
        example: CanvasExample,
        generation: number,
    ): Promise<void> {
        const host = html`<div className="canvas-library-example-host"></div>` as HTMLElement
        this.stage.append(host)

        try {
            const instance = await mountCanvasExample(host, example.id)

            if (
                this.destroyed
                || generation !== this.generation
            ) {
                instance.destroy()
                host.remove()

                return
            }

            this.mountedExample = instance
            const reference = html`<section className="canvas-library-reference"></section>` as HTMLElement
            this.referenceEditor = FixtureEditor.readOnly(
                reference,
                html`
                    <section>
                        ${example.components?.length ? html`<h3>Components</h3><p>${example.components.join(", ")}</p>` : null}
                        ${example.nodes?.length ? html`<h3>Node types</h3><p>${example.nodes.join(', ')}</p>` : null}
                        <h3>Source</h3>
                        <p><code>${example.source}</code></p>
                    </section>
                ` as HTMLElement,
            )
            this.inspectorContent.replaceChildren(...instance.frames.map(frame => frame.inspector), reference)
            this.stage.removeAttribute('aria-busy')
        } catch (error) {
            if (
                this.destroyed
                || generation !== this.generation
            )
                return

            this.stage.removeAttribute('aria-busy')
            this.stage.replaceChildren(
                html`
                    <div
                        className="canvas-library-error"
                        role="alert"
                    >
                        <p>${error instanceof Error ? error.message : String(error)}</p>
                        <button
                            type="button"
                            className="navigation-side-panel-row"
                            onclick=${this.resetExample}
                        ><span className="navigation-side-panel-row-title">Retry</span></button>
                    </div>
                ` as HTMLElement,
            )
        }
    }

    private toggleNavigation = (): void => {
        this.navigationOpen = !this.navigationOpen
        void this.setPanelOpen(
            'navigation',
            this.sidebar,
            this.leftPanel,
            this.navigationOpen,
        )
    }

    private toggleParameters = (): void => {
        this.paramsOpen = !this.paramsOpen
        void this.setPanelOpen(
            'parameters',
            this.inspector,
            this.paramsPanel,
            this.paramsOpen,
        )
    }

    private toggleTheme = (): void => {
        this.themeOpen = !this.themeOpen
        void this.setPanelOpen(
            'theme',
            this.themePanel,
            this.rightPanel,
            this.themeOpen,
        )
    }

    private setPanelOpen = async (
        name: CanvasLibraryPanel,
        element: HTMLElement,
        panel: SidePanelInstance,
        open: boolean,
    ): Promise<void> => {
        const settled = this.layout.setOpen(
            name,
            element,
            panel,
            open,
        )
        this.resizePanels()
        await settled

        if (!this.destroyed)
            this.resizePanels()
    }

    private resetExample = (): void => {
        if (this.activeExample)
            this.renderExample(this.activeExample)
    }

    private releaseExample(): void {
        this.generation += 1
        this.mountedExample?.destroy()
        this.mountedExample = null
        this.referenceEditor?.destroy()
        this.referenceEditor = null
        this.inspectorContent.replaceChildren()
        this.stage.replaceChildren()
    }

    destroy = (): void => {
        this.destroyed = true
        this.unsubscribeRouter?.()
        this.resizeObserver.disconnect()
        this.exampleDropdown?.destroy()
        this.navigationList?.destroy()
        this.inspectorTabs.destroy()
        this.leftPanel.destroy()
        this.paramsPanel.destroy()
        this.rightPanel.destroy()
        this.themeEditor?.destroy()
        this.releaseTheme?.()
        this.releasePortalTheme?.()
        this.releaseWidgetTheme?.()
        this.releaseExample()
        this.el.remove()
    }
}
