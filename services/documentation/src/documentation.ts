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
    createButton,
    type ButtonInstance,
} from '@lixpi/ui-kit/components/button'
import {
    createApplicationPanel,
    type ApplicationPanelInstance,
} from '@lixpi/ui-kit/components/application-panel'
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
    documentationExamples,
    mountDocumentationExample,
    type DocumentationExample,
} from './catalog/catalog.ts'
import {
    documentationDomains,
    getDocumentationDomain,
    type DocumentationDomain,
} from './catalog/domains.ts'
import { canvasNodeExamples } from './catalog/nodes.ts'
import {
    buildDocumentationNavigationDocument,
    collapsibleEntryIds,
    nodesEntryId,
    sectionEntryId,
} from './catalog/navigation-document.ts'

type MountedExample = Awaited<ReturnType<typeof mountDocumentationExample>>
type ExampleOption = DropdownOption & { value: string }
type InspectorView = 'parameters' | 'code' | 'theme'

// Inspector tabs before the canvas theme gives the control height.
const INSPECTOR_TABS_HEIGHT = 28

// The documentation is the web UI's shell around a stage: the shared
// ApplicationPanel holds the navigation on the left and the inspector on the
// right, both pushed beside the stage, so they look and behave exactly like the
// web UI's panels.
export class Documentation {
    readonly el: HTMLElement
    private readonly navigation: HTMLElement
    private navigationList: NestedListHandle | null = null
    private readonly title: HTMLElement
    private readonly stage: HTMLElement
    private readonly inspector: HTMLElement
    private readonly inspectorContent: HTMLElement
    private readonly exampleInspector: HTMLElement
    private readonly exampleSelector: HTMLElement
    private readonly themeContent: HTMLElement
    private readonly tabsHost: HTMLDivElement
    private readonly inspectorTabs: SlidingTabsSwitchInstance<InspectorView>
    private readonly resetButton: ButtonInstance
    private navigationPanel: ApplicationPanelInstance | null = null
    private inspectorPanel: ApplicationPanelInstance | null = null
    private readonly resizeObserver: ResizeObserver
    private readonly selectedExamples = new Map<string, string>()
    private readonly expandedEntries = new Set<string>()
    private activeDomain: DocumentationDomain | null = null
    private activeExample: DocumentationExample | null = null
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

    constructor(private readonly router: WebClientRouterService) {
        this.navigation = html`
            <nav
                className="documentation-navigation"
                aria-label="Documentation sections"
            ></nav>
        ` as HTMLElement
        this.title = html`<h2 className="documentation-title"></h2>` as HTMLElement
        this.stage = html`
            <main
                className="documentation-stage"
                aria-label="Example"
            ></main>
        ` as HTMLElement
        this.exampleInspector = html`<div className="documentation-example-inspector"></div>` as HTMLElement
        this.themeContent = html`<div className="documentation-theme-content"></div>` as HTMLElement
        this.inspectorContent = html`
            <div
                className="documentation-inspector-content side-panel-document"
                data-view="parameters"
            >
                ${this.exampleInspector}
                ${this.themeContent}
            </div>
        ` as HTMLElement
        this.exampleSelector = html`<div className="documentation-example-selector"></div>` as HTMLElement
        this.tabsHost = html`<div className="documentation-inspector-tabs-host"></div>` as HTMLDivElement
        const tabs = select(this.tabsHost)
            .append('svg')
            .attr('class', 'documentation-inspector-tabs')
            .attr('aria-label', 'Inspector view')
        this.inspectorTabs = createSlidingTabsSwitch<InspectorView>(
            tabs,
            {
                id: 'documentation-inspector-view',
                x: 0,
                y: 0,
                width: 1,
                height: INSPECTOR_TABS_HEIGHT,
                tabs: [
                    {
                        label: 'Parameters',
                        value: 'parameters',
                    },
                    {
                        label: 'Code',
                        value: 'code',
                    },
                    {
                        label: 'Theme',
                        value: 'theme',
                    },
                ],
                selectedValue: 'parameters',
                onChange: value => void (this.inspectorContent.dataset.view = value),
            },
        )
        this.resetButton = createButton({
            label: 'Reset',
            onClick: this.resetExample,
        })
        this.inspector = html`
            <section
                className="documentation-inspector"
                aria-label="Example settings, code and theme"
            >
                <div className="documentation-inspector-heading">
                    ${this.title}
                    ${this.resetButton.element}
                </div>
                ${this.exampleSelector}
                ${this.tabsHost}
                ${this.inspectorContent}
            </section>
        ` as HTMLElement
        this.el = html`<div className="documentation">${this.stage}</div>` as HTMLElement
        this.resizeObserver = new ResizeObserver(this.resizeInspectorTabs)
    }

    // The panels mount once the root is in the document, so their maximum
    // width can be measured against it.
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
        this.navigationPanel = createApplicationPanel({
            container: this.el,
            content: this.stage,
            side: 'left',
            label: 'Navigation',
            open: true,
        })
        this.navigationPanel.body.append(this.navigation)
        this.inspectorPanel = createApplicationPanel({
            container: this.el,
            content: this.stage,
            side: 'right',
            label: 'Inspector',
            open: true,
            body: 'content',
            onResize: this.resizeInspectorTabs,
        })
        this.inspectorPanel.body.append(this.inspector)
        this.navigationList = mountNestedList({
            container: this.navigation,
            document: buildDocumentationNavigationDocument(),
            readOnly: true,
            collapsed: collapsibleEntryIds,
            onActivate: this.activateNavigationEntry,
            onCollapseChange: (entryId, collapsed) => {
                if (collapsed)
                    this.expandedEntries.delete(entryId)
                else
                    this.expandedEntries.add(entryId)
            },
        })
        this.resizeObserver.observe(this.tabsHost)
        this.resizeInspectorTabs()
        this.unsubscribeRouter = this.router.subscribe(this.onRouteChange)
    }

    // The tabs fill the inspector's width at the canvas control height.
    private resizeInspectorTabs = (): void => {
        const width = this.tabsHost.clientWidth

        if (width <= 0)
            return

        const computed = this.el.ownerDocument.defaultView?.getComputedStyle(this.el)
        const controlHeight = Number.parseFloat(computed?.getPropertyValue('--canvas-control-height') ?? '')
        const scale = Number.parseFloat(computed?.getPropertyValue('--canvas-lixpi-panel-switch-scale') ?? '')
        const height = Number.isFinite(controlHeight)
            && controlHeight > 0
            ? controlHeight * (Number.isFinite(scale)
                && scale > 0
                ? scale
                : 1)
            : INSPECTOR_TABS_HEIGHT
        this.inspectorTabs.resize(
            0,
            0,
            width,
            height,
        )
    }

    private navigateDomain(domain: DocumentationDomain): void {
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
        if (entryId.startsWith('section:')) {
            const sectionId = entryId.slice('section:'.length)

            // A package row opens its first page. On the package already open,
            // it folds or unfolds the package instead.
            if (this.activeDomain?.section === sectionId) {
                if (this.expandedEntries.has(entryId))
                    this.expandedEntries.delete(entryId)
                else
                    this.expandedEntries.add(entryId)

                this.renderNavigation()

                return
            }

            const domain = documentationDomains.find(candidate => candidate.section === sectionId)

            if (domain)
                this.navigateDomain(domain)

            return
        }

        if (entryId.startsWith('domain:')) {
            const domain = documentationDomains.find(candidate => candidate.id === entryId.slice('domain:'.length))

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

        this.navigationList.setCollapsed(
            collapsibleEntryIds.filter(entryId => !this.expandedEntries.has(entryId)),
        )
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
            this.navigateDomain(documentationDomains[0])

            return
        }

        const domainId = String(route.routeParams.domainId ?? '')
        const requestedId = String(route.routeParams.exampleId ?? '')
        const domain = domainId ? documentationDomains.find(candidate => candidate.id === domainId) : getDocumentationDomain(requestedId)
        const id = requestedId || (domain ? this.selectedExamples.get(domain.id) ?? domain.examples[0] : '')
        const example = documentationExamples.find(candidate => candidate.id === id)

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
                        className="documentation-error"
                        role="alert"
                    >No example is registered for this URL.</p>
                ` as HTMLElement,
            )
            this.renderNavigation()

            return
        }

        this.expandedEntries.add(
            sectionEntryId(domain.section),
        )

        if (domain.id === 'nodes')
            this.expandedEntries.add(nodesEntryId)

        if (this.activeExample?.id === example.id) {
            this.renderNavigation()

            return
        }

        this.activeDomain = domain
        this.activeExample = example
        this.selectedExamples.set(domain.id, example.id)
        this.title.textContent = canvasNodeExamples.some(candidate => candidate.id === example.id) ? example.title : domain.title
        this.stage.ariaLabel = `${domain.title}: ${example.title}`
        document.title = `${domain.title} | Documentation`
        this.renderNavigation()

        this.renderExampleSelector(domain, example)

        this.renderExample(example)
    }

    private renderExampleSelector(
        domain: DocumentationDomain,
        active: DocumentationExample,
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
            const example = documentationExamples.find(candidate => candidate.id === id)!

            return {
                title: example.title,
                value: id,
            }
        })

        if (options.length === 1)
            return

        this.exampleDropdown = createPureDropdown<ExampleOption>({
            id: 'documentation-domain-example',
            triggerLabel: `${domain.title} example`,
            selectedValue: {
                title: active.title,
                value: active.id,
            },
            options,
            mountToBody: true,
            popoverClassName: "application-panel-popover",
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

    private renderExample(example: DocumentationExample): void {
        this.releaseExample()
        this.stage.setAttribute('aria-busy', 'true')
        void this.loadExample(example, this.generation)
    }

    private async loadExample(
        example: DocumentationExample,
        generation: number,
    ): Promise<void> {
        const host = html`<div className="documentation-example-host"></div>` as HTMLElement
        this.stage.append(host)

        try {
            const instance = await mountDocumentationExample(host, example.id)

            if (
                this.destroyed
                || generation !== this.generation
            ) {
                instance.destroy()
                host.remove()

                return
            }

            this.mountedExample = instance
            const reference = html`<section className="documentation-reference"></section>` as HTMLElement
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
            this.exampleInspector.replaceChildren(...instance.frames.map(frame => frame.inspector), reference)
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
                        className="documentation-error"
                        role="alert"
                    >
                        <p>${error instanceof Error ? error.message : String(error)}</p>
                        ${createButton({
                            label: 'Retry',
                            variant: 'primary',
                            onClick: this.resetExample,
                        }).element}
                    </div>
                ` as HTMLElement,
            )
        }
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
        this.exampleInspector.replaceChildren()
        this.stage.replaceChildren()
    }

    destroy = (): void => {
        this.destroyed = true
        this.unsubscribeRouter?.()
        this.resizeObserver.disconnect()
        this.exampleDropdown?.destroy()
        this.navigationList?.destroy()
        this.inspectorTabs.destroy()
        this.resetButton.destroy()
        this.navigationPanel?.destroy()
        this.inspectorPanel?.destroy()
        this.themeEditor?.destroy()
        this.releaseTheme?.()
        this.releasePortalTheme?.()
        this.releaseWidgetTheme?.()
        this.releaseExample()
        this.el.remove()
    }
}
