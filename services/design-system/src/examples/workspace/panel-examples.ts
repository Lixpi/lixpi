import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    createArtifactLibraryPanel,
    createMediaLibraryPanel,
    createCapabilityLibraryPanel,
} from '@lixpi/canvas-components/workspace/library'
import {
    WorkspaceConversationController,
    WorkspaceConversationPanel,
    WorkspaceRightPanel,
    type WorkspacePromptEditorIntegration,
} from '@lixpi/canvas-components/workspace'
import {
    WorkspacePromptComposer,
    WorkspacePromptControlRail,
} from '@lixpi/canvas-components/workspace/composer'
import {
    WorkspaceContextTrays,
    createContextPreviewTile,
} from '@lixpi/canvas-components/workspace/context'
import { createMediaGenerationProgress } from '@lixpi/canvas-components/workspace/progress'
import {
    WorkspaceOutputDetails,
    createGeneratedOutputDetailsSidebar,
    WorkspaceGenerationHistory,
} from '@lixpi/canvas-components/workspace/review'
import {
    createDefaultMediaGenerationRunProgress,
    type CanvasAiChatPanelState,
    type CanvasRightSidePanelMode,
    type MediaGenerationProgressState,
    type MediaGenerationRunStatus,
    type ConversationSettings,
} from '@lixpi/constants'
import { createProseMirrorSchema } from '@lixpi/prosemirror/shared/schema-builder'
import { html } from '@lixpi/ui-primitives/dom'
import { ExampleFrame } from '../example-frame.ts'
import { FixtureWorkspaceHost } from './fixture-host.ts'
import {
    WorkspaceFixtures,
    conversationDocument,
    fixtureTime,
    organizationId,
    userId,
    workspaceId,
} from './fixtures.ts'
import {
    FixtureEditor,
    mountConversationEditor,
    mountPromptEditor,
    promptEditorIntegrationSource,
} from './fixture-editor.ts'
import { createCanvasFixture } from './node-fixtures.ts'
import { ensureArtifactStyles } from './artifact-fixtures.ts'
import { FixtureCapabilityCatalog } from './capability-fixtures.ts'

type SelectionControl = ReturnType<ExampleFrame["select"]>
type ToggleControl = ReturnType<ExampleFrame["toggle"]>

const libraryTitles = {
    artifacts: "Artifacts",
    media: "Media",
    capabilities: "Capabilities",
    empty: "Capabilities empty",
    error: "Capabilities load error",
}
const panelModeTitles = {
    capabilities: "Capabilities",
    artifacts: "Artifacts",
    media: "Media",
    aiThreads: "Conversations",
}

class PanelExample {
    readonly lifetime = new Lifetime()
    readonly frame: ExampleFrame
    readonly fixtures = new WorkspaceFixtures()
    readonly fixtureHost: FixtureWorkspaceHost

    constructor(
        host: HTMLElement,
        instructions: string,
    ) {
        this.lifetime.own(() => this.fixtures.destroy())

        try {
            this.frame = new ExampleFrame(host, instructions)
            this.frame.stage.classList.add('canvas-example-stage-scrollable')
            this.lifetime.own(() => this.frame.destroy())
            this.fixtureHost = new FixtureWorkspaceHost(
                this.fixtures,
                host.ownerDocument,
                this.frame.report,
            )
            this.lifetime.own(() => this.fixtureHost.destroy())
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    history(
        host: HTMLElement,
        content: object = conversationDocument,
    ): FixtureEditor {
        return new FixtureEditor(
            host,
            content,
            createProseMirrorSchema('assetConversation'),
            [],
            () => {},
            true,
        )
    }

    destroy = (): void => void this.lifetime.destroy()
}

export class LibrariesExample extends PanelExample {
    private scopeParameter?: SelectionControl
    private queryParameter?: HTMLInputElement
    private libraryParameter?: SelectionControl
    private content = new Lifetime()
    private readonly mount: HTMLElement
    private mode: 'artifacts' | 'media' | 'capabilities' | 'empty' | 'error' = 'artifacts'
    private scope = 'all'
    private query = ''

    constructor(host: HTMLElement) {
        super(
            host,
            'Artifact and Media panels browse Assets through revisioned host ports and mount registered module details. Scope and title filters run in the example Asset list port. Capability modes use an authorized Tool catalog port, with populated, empty and error fixtures.',
        )

        try {
            this.mount = html`<div className="canvas-workspace-library-stage"></div>` as HTMLElement
            this.frame.stage.append(this.mount)
            this.lifetime.own(() => this.content.destroy())
            this.render('artifacts')
            this.libraryParameter = this.frame.select(
                'Library',
                this.mode,
                {
                    artifacts: 'Artifacts',
                    media: 'Media',
                    capabilities: 'Capabilities',
                    empty: 'Capabilities empty',
                    error: 'Capabilities load error',
                },
                mode => this.render(mode as typeof this.mode),
            )
            this.scopeParameter = this.frame.select(
                'Asset scope',
                this.scope,
                {
                    all: 'All scopes',
                    workspace: 'Workspace',
                    user: 'User',
                    organization: 'Organization',
                },
                scope => {
                    this.scope = scope
                    this.render(this.mode)
                },
            )
            this.queryParameter = this.frame.text(
                'Asset title filter',
                this.query,
                query => {
                    this.query = query
                    this.render(this.mode)
                },
            )
            this.syncLibraryParameters()
            this.frame.code(
                () => this.mode === 'artifacts'
                    || this.mode === 'media'
                    ? ["import {", `    ${  String((this.mode === 'artifacts' ? 'createArtifactLibraryPanel' : 'createMediaLibraryPanel'))  },`, `    type ${  String(
                        (this.mode === 'artifacts' ? 'ArtifactLibraryPanelOptions' : 'MediaLibraryPanelOptions'),
                    )  },`, "} from '@lixpi/canvas-components/workspace/library'", "", "// Host Asset ports apply the scope/title filter and supply revisioned mutations.", "// Artifact options also receive the installed shared/frontend module registries.", "const mount=(", "    host: HTMLElement,", `    options: ${  String(
                        (this.mode === 'artifacts' ? 'ArtifactLibraryPanelOptions' : 'MediaLibraryPanelOptions'),
                    )  },`, ") => {", `    const panel=${  String(
                        (this.mode === 'artifacts' ? 'createArtifactLibraryPanel' : 'createMediaLibraryPanel'),
                    )  }({`, "        ...options,", "        assets: {", "            ...options.assets,", "            list: async query => {", "                const page=await options.assets.list(query)", "                return {", "                    ...page,", "                    items: page.items.filter(item =>", `                        ${  String(
                        (this.scope === 'all' ? 'true' : `item.scope === '${this.scope}'`),
                    )}`, `                        &&item.title.toLowerCase().includes(${  String(
                        (JSON.stringify(
                            this.query.toLowerCase(),
                        )),
                    )  }),`, "                    ),", "                }", "            },", "        },", "    })", "    panel.mountInto(host)", "    return () => panel.destroy()", "}"].join('\n')
                    : ["import {", "    createCapabilityLibraryPanel,", "    type CapabilityLibraryPanelConfig,", "} from '@lixpi/canvas-components/workspace/library'", "", `// The example catalog returns ${  String(
                        (this.mode === 'capabilities'
                            ? 'published Tools'
                            : this.mode === 'empty'
                                ? 'an empty list'
                                : 'a load error'),
                    )  }.`, "// Asset scope and title filters belong to the Artifact and Media host ports.", "const mount=(host: HTMLElement, options: CapabilityLibraryPanelConfig) => {", "    const panel=createCapabilityLibraryPanel(options)", "    host.append(panel.element)", "    void panel.load()", "    return () => panel.destroy()", "}"].join('\n'),
            )
            this.frame.button('Artifact library', () => this.render('artifacts'))
            this.frame.button('Media library', () => this.render('media'))
            this.frame.button('Capability library', () => this.render('capabilities'))
            this.frame.button('Capability library empty', () => this.render('empty'))
            this.frame.button('Capability load error', () => this.render('error'))
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private syncLibraryParameters(mode = this.mode): void {
        this.libraryParameter?.update({
            title: libraryTitles[mode],
            value: mode,
        })
        const assetLibrary = mode === 'artifacts' || mode === 'media'

        if (this.scopeParameter) {
            this.scopeParameter.dom.inert = !assetLibrary
            this.scopeParameter.dom.ariaDisabled = String(!assetLibrary)
        }

        if (this.queryParameter)
            this.queryParameter.disabled = !assetLibrary
    }

    render(mode: 'artifacts' | 'media' | 'capabilities' | 'empty' | 'error'): void {
        this.syncLibraryParameters(mode)
        this.mode = mode
        this.content.destroy()
        this.content = new Lifetime()
        this.mount.replaceChildren()
        const common = {
            document: this.mount.ownerDocument,
            workspaceId,
            userId,
            assets: {
                ...this.fixtures.libraryAssets,
                list: async query => {
                    const page = await this.fixtures.libraryAssets.list(query)

                    return {
                        ...page,
                        items: page.items.filter(
                            item =>
                                (this.scope === 'all' || item.scope === this.scope)
                                && item.title.toLowerCase().includes(
                                    this.query.toLowerCase(),
                                ),
                        ),
                    }
                },
            },
            onError: this.frame.error,
        } satisfies Parameters<typeof createArtifactLibraryPanel>[0] extends infer T ? Omit<T, 'frontendRegistry' | 'sharedRegistry' | 'ensureStyles'> : never

        if (mode === 'artifacts') {
            const view = createArtifactLibraryPanel({
                ...common,
                frontendRegistry: this.fixtures.artifacts.frontend,
                sharedRegistry: this.fixtures.artifacts.shared,
                ensureStyles: ensureArtifactStyles,
                onInsertAsset: async item => {
                    this.frame.report(`Added ${item.title} through the local library port.`)

                    return true
                },
                onAcceptAsset: async asset => {
                    this.fixtures.updateAsset(asset.assetId, { generatedOutputReview: { status: 'accepted' } })
                    this.frame.report(`Accepted local Artifact ${asset.title}.`)

                    return true
                },
            })
            this.content.own(() => view.destroy())
            view.mountInto(this.mount)
        } else if (mode === 'media') {
            const view = createMediaLibraryPanel({
                ...common,
                tooltipHideDelayMs: 120,
                prepareRenditionUrls: async () => this.fixtures.renditionUrl,
                mountEditor: this.fixtureHost.assetDetails.mountEditor,
                attestSubjectIdentity: this.fixtureHost.assetDetails.attestSubjectIdentity,
                removeFromLibrary: async assetId => {
                    this.fixtures.assets.delete(assetId)
                    this.frame.report('Removed the Asset from the local fixture catalog.')

                    return {}
                },
                onInsertAsset: async item => {
                    this.frame.report(`Added ${item.title} through the local library port.`)

                    return true
                },
            })
            this.content.own(() => view.destroy())
            view.mountInto(this.mount)
        } else {
            const view = createCapabilityLibraryPanel({
                document: this.mount.ownerDocument,
                client: new FixtureCapabilityCatalog(mode === 'capabilities'
                    ? 'populated'
                    : mode === 'empty'
                        ? 'empty'
                        : 'error'),
                onAttach: reference => this.frame.report(`Selected local Tool reference ${reference.displayName}.`),
            })
            this.content.own(() => view.destroy())
            this.mount.append(view.element)
            void view.load()
        }

        this.frame.report(`Showing ${mode}. All mutations use memory.`)
    }
}

export class ConversationExample extends PanelExample {
    private draftParameter?: HTMLInputElement
    private contextParameter?: SelectionControl
    private readonly panel: WorkspaceConversationPanel
    private readonly controller: WorkspaceConversationController
    private readonly composer: WorkspacePromptComposer
    private readonly trays: WorkspaceContextTrays
    private contextNodeIds = ['node-image', 'node-document']
    private draft = ''
    private contextMode: ConversationSettings['contextMode'] = 'explicit'
    private midRunPolicy: ConversationSettings['midRunPolicy'] = 'steer'

    constructor(host: HTMLElement) {
        super(
            host,
            'WorkspaceConversationPanel uses a host-mounted transcript editor and a versioned conversation controller. WorkspacePromptComposer keeps private drafts by user, workspace and conversation. Context and mid-run policies update through controller settings; explicit context chips come from a host-owned node list.',
        )

        try {
            const stage = html`<div className="workspace-canvas canvas-workspace-composer-stage"></div>` as HTMLDivElement
            this.frame.stage.append(stage)
            const nodes = createCanvasFixture(this.fixtures).nodes
            const rail = new WorkspacePromptControlRail({
                document: host.ownerDocument,
                modelMenuHoverBackground: 'var(--canvas-surface-hover)',
            })
            this.lifetime.own(() => rail.destroy())
            stage.append(rail.element)
            const integration: WorkspacePromptEditorIntegration = {
                submitOnEnter: true,
                mountMediaModeSwitch: rail.mountMediaModeSwitch,
                mountModelMenuControl: rail.mountModelMenuControl,
                promptReferenceCatalog: this.fixtureHost.host.capabilities.promptCatalog(workspaceId, organizationId),
                promptReferencePreviewRenderer: {
                    getNode: reference => nodes.find(node => 'assetId' in node && node.assetId === reference.assetId),
                    environment: this.fixtureHost.contextEnvironment(),
                    inlinePopover: true,
                },
            }
            this.trays = new WorkspaceContextTrays({
                document: host.ownerDocument,
                getNode: nodeId => nodes.find(node => node.nodeId === nodeId),
                getContextNodeIds: () => this.contextNodeIds,
                getEnvironment: () => this.fixtureHost.contextEnvironment(),
                onRemove: nodeId => {
                    this.contextNodeIds = this.contextNodeIds.filter(id => id !== nodeId)
                    this.trays.refresh()
                    this.syncContextParameter()
                    this.frame.report('Removed the explicit local context chip.')
                },
                requestFrame: callback => requestAnimationFrame(callback),
                cancelFrame: handle => cancelAnimationFrame(handle),
            })
            this.lifetime.own(() => this.trays.destroy())
            this.composer = new WorkspacePromptComposer({
                document: host.ownerDocument,
                workspaceId,
                userId,
                storage: this.fixtures.storage,
                appearance: {
                    popoverBoxShadow: this.fixtureHost.appearance.dropdown.styles.popoverBoxShadow,
                    useShiftingGradientBackground: this.fixtureHost.appearance.aiPromptInput.useShiftingGradientBackground,
                    gradientColors: this.fixtureHost.appearance.gradient.styles.shiftingColors,
                },
                mountEditor: request => mountPromptEditor(
                    request,
                    integration,
                    this.frame.theme,
                    this.frame.report,
                ),
                mountContextTray: () => {
                    const element = this.trays.create('canvas')

                    return {
                        element,
                        destroy: () => this.trays.release(element),
                    }
                },
                onSubmit: () => this.frame.report('Submitted the local composer fixture. No provider call was made.'),
            })
            this.lifetime.own(() => this.composer.destroy())
            this.controller = new WorkspaceConversationController(
                workspaceId,
                userId,
                this.fixtureHost.conversations,
                this.fixtures.storage,
                this.fixtures.createId,
            )
            this.lifetime.own(() => this.controller.destroy())
            this.panel = new WorkspaceConversationPanel(
                this.controller,
                host.ownerDocument,
                selected => {
                    this.composer.selectConversation(selected)
                    this.frame.report(`Selected local conversation ${selected}.`)
                },
                {
                    resolve: async assetId => ({ title: this.fixtures.requireAsset(assetId).title }),
                    open: async assetId => this.frame.report(`Opened output ${assetId} in the local fixture.`),
                },
                {
                    load: async conversationAssetId => ({
                        threadId: conversationAssetId,
                        organizationId: 'component-library-organization',
                        content: this.fixtures.readDocument(conversationAssetId, 'conversation')?.doc ?? {
                            type: 'doc',
                            content: [{
                                type: 'aiChatThread',
                                attrs: { threadId: conversationAssetId },
                                content: [],
                            }],
                        },
                        proseMirrorVersion: 1,
                    }),
                    mount: mountConversationEditor,
                },
            )
            this.lifetime.own(() => this.panel.destroy())
            this.lifetime.own(
                this.composer.mountConversation(this.panel.element),
            )
            stage.append(this.composer.element)
            this.trays.refresh()
            void this.initialize()
            this.draftParameter = this.frame.text(
                'Composer draft',
                this.draft,
                value => this.setDraft(value),
            )
            this.frame.select(
                'Conversation context policy',
                this.contextMode,
                {
                    explicit: 'Explicit references',
                    discovery: 'Discover context',
                    mixed: 'Explicit and discovery',
                },
                value => {
                    this.contextMode = value as ConversationSettings['contextMode']
                    void this.applySettings()
                },
            )
            this.frame.select(
                'Messages during a run',
                this.midRunPolicy,
                {
                    steer: 'Steer current run',
                    'stop-first': 'Stop before sending',
                    queue: 'Queue message',
                },
                value => {
                    this.midRunPolicy = value as ConversationSettings['midRunPolicy']
                    void this.applySettings()
                },
            )
            this.contextParameter = this.frame.select(
                'Explicit canvas references',
                'both',
                {
                    both: 'Image and document',
                    image: 'Image only',
                    document: 'Document only',
                    none: 'None',
                },
                value => {
                    this.contextNodeIds = value === 'both'
                        ? ['node-image', 'node-document']
                        : value === 'none'
                            ? []
                            : [`node-${value}`]
                    this.trays.refresh()
                    this.syncContextParameter()
                },
            )
            this.frame.code(
                () => [
                    ...promptEditorIntegrationSource,
                    "import { WorkspacePromptComposer, WorkspacePromptControlRail, type WorkspacePromptComposerOptions } from '@lixpi/canvas-components/workspace/composer'",
                    "import { type WorkspaceConversationController } from '@lixpi/canvas-components/workspace'",
                    '',
                    '// Native workspace layout styles position both the composer and its responsive rail.',
                    'const mount = (',
                    '    host: HTMLElement,',
                    '    options: WorkspacePromptComposerOptions,',
                    '    integration: Omit<WorkspacePromptEditorIntegration, "mountMediaModeSwitch" | "mountModelMenuControl">,',
                    '    conversation: HTMLElement,',
                    '    theme: CanvasThemeSource,',
                    ') => {',
                    '    host.classList.add("workspace-canvas")',
                    '    const rail = new WorkspacePromptControlRail({ document: host.ownerDocument })',
                    '    const composer = new WorkspacePromptComposer({',
                    '        ...options,',
                    '        mountEditor: request => new FixturePromptEditor(request, {',
                    '            ...integration, submitOnEnter: true,',
                    '            mountMediaModeSwitch: rail.mountMediaModeSwitch,',
                    '            mountModelMenuControl: rail.mountModelMenuControl,',
                    '        }, theme),',
                    '    })',
                    '    const unmountConversation = composer.mountConversation(conversation)',
                    '    host.append(rail.element, composer.element)',
                    `    composer.input.restoreContent(${JSON.stringify(
                        this.draftDocument(),
                        null,
                        4,
                    )})`,
                    '    return () => {',
                    '        unmountConversation()',
                    '        composer.destroy()',
                    '        rail.destroy()',
                    '    }',
                    '}',
                    '// The caller still owns the conversation panel/controller and its transport ports.',
                    `const referenceNodeIds = ${JSON.stringify(this.contextNodeIds)}`,
                    'const configureConversation = (controller: WorkspaceConversationController) => controller.changeSettings({',
                    `    contextMode: '${this.contextMode}', midRunPolicy: '${this.midRunPolicy}',`,
                    '})',
                ].join('\n'),
            )

            this.frame.button('Restore context chips', () => {
                this.contextNodeIds = ['node-image', 'node-document']
                this.trays.refresh()
                this.syncContextParameter()
            })
            this.frame.button('Focus composer', () => this.composer.input.focus())
            this.frame.button('Load fixture draft', () => void this.setDraft('Prepare a sequence using the explicit references.'))
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private syncContextParameter(): void {
        const value = this.contextNodeIds.length === 2 ? 'both' : (this.contextNodeIds[0]?.replace('node-', '') ?? 'none')
        const titles: Record<string, string> = {
            both: "Image and document",
            image: "Image only",
            document: "Document only",
            none: "None",
        }
        this.contextParameter?.update({
            title: titles[value],
            value,
        })
    }

    private draftDocument(): object {
        return {
            type: 'doc',
            content: [{
                type: 'aiPromptInput',
                content: [{
                    type: 'paragraph',
                    content: this.draft ? [{
                        type: 'text',
                        text: this.draft,
                    }] : [],
                }],
            }],
        }
    }

    private setDraft(text: string): void {
        if (this.draftParameter)
            this.draftParameter.value = text

        this.draft = text
        this.composer.input.restoreContent(
            this.draftDocument(),
        )
    }

    private async initialize(): Promise<void> {
        await this.controller.initialize('fixture-conversation')

        if (!this.lifetime.signal.aborted)
            await this.applySettings()
    }

    private async applySettings(): Promise<void> {
        try {
            await this.controller.changeSettings({
                contextMode: this.contextMode,
                midRunPolicy: this.midRunPolicy,
            })
        } catch (error) {
            this.frame.error(error)
        }
    }
}

export class ContextExample extends PanelExample {
    private readonly stage: HTMLElement
    private content = new Lifetime()
    private kind = 'all'
    private placement: NonNullable<Parameters<typeof createContextPreviewTile>[0]['preferredPlacement']> = 'bottom'
    private hideDelay = 120

    constructor(host: HTMLElement) {
        super(
            host,
            'ContextPreviewTile resolves canonical Asset titles, module icons, document text and authorized renditions. Hover or focus a tile to inspect its shared preview. Placement, hide delay and the host node list are public inputs; changing them remounts the tiles.',
        )

        try {
            this.stage = html`<div className="canvas-workspace-context-stage"></div>` as HTMLElement
            this.frame.stage.append(this.stage)
            this.lifetime.own(() => this.content.destroy())
            this.render()
            this.frame.select(
                'Asset kind',
                this.kind,
                {
                    all: 'All Asset nodes',
                    image: 'Image',
                    video: 'Video',
                    audio: 'Audio',
                    document: 'Document',
                    mediaDocument: 'Media document',
                    capabilityArtifact: 'Capability Artifact',
                },
                kind => {
                    this.kind = kind
                    this.render()
                },
            )
            this.frame.select(
                'Preferred placement',
                this.placement,
                {
                    top: 'Top',
                    bottom: 'Bottom',
                    left: 'Left',
                    right: 'Right',
                },
                placement => {
                    this.placement = placement as typeof this.placement
                    this.render()
                },
            )
            this.frame.number(
                'Hide delay (ms)',
                {
                    value: this.hideDelay,
                },
                hideDelay => {
                    this.hideDelay = hideDelay
                    this.render()
                },
            )
            this.frame.code(
                () => ["import {", "    createContextPreviewTile,", "    type ContextPreviewEnvironment,", "} from '@lixpi/canvas-components/workspace/context'", "import { type CanvasNode } from '@lixpi/constants'", "", "// Environment supplies Asset/document reads and authorized rendition URLs.", `// Host list filter: ${  String(
                    (this.kind),
                )  }.`, "const mount=(", "    host: HTMLElement,", "    node: CanvasNode,", "    environment: ContextPreviewEnvironment,", ") => {", "    const tile=createContextPreviewTile({", "        node,", `        environment: { ...environment, tooltipHideDelayMs: ${  String(
                    (this.hideDelay),
                )  } },`, `        preferredPlacement: '${  String((this.placement))  }',`, "    })", "    host.append(tile.dom)", "    return () => tile.destroy()", "}"].join('\n'),
            )
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private render(): void {
        this.content.destroy()
        this.content = new Lifetime()
        this.stage.replaceChildren()

        for (const node of createCanvasFixture(this.fixtures).nodes) {
            if (
                !('assetId' in node)
                || !node.assetId
                || (this.kind !== 'all' && node.type !== this.kind)
            )
                continue

            const preview = createContextPreviewTile({
                node,
                environment: {
                    ...this.fixtureHost.contextEnvironment(),
                    tooltipHideDelayMs: this.hideDelay,
                },
                preferredPlacement: this.placement,
            })
            this.content.own(() => preview.destroy())
            const item = html`<div className="canvas-workspace-context-item"><strong>${node.type}</strong>${preview.dom}</div>` as HTMLElement
            this.stage.append(item)
        }
    }
}

const progressState = (status: MediaGenerationRunStatus): MediaGenerationProgressState => ({
    generationRequestId: 'fixture-progress',
    status,
    message: `Simulated ${status} pipeline state.`,
    progress: createDefaultMediaGenerationRunProgress(status, `Simulated ${status} pipeline state.`),
    updatedAt: fixtureTime,
})

export class ProgressReviewExample extends PanelExample {
    private statusParameter?: SelectionControl
    private detailsParameter?: SelectionControl
    private readonly progress: ReturnType<typeof createMediaGenerationProgress>
    private details = new Lifetime()
    private readonly detailsHost: HTMLElement
    private state = progressState('running')
    private message = 'Preparing the supplied references.'
    private detailsType: 'image' | 'capabilityArtifact' = 'image'

    constructor(host: HTMLElement) {
        super(
            host,
            'MediaGenerationProgress updates the shared timeline from supplied pipeline state. WorkspaceOutputDetails composes revisioned Asset metadata, subject identity, scope, registered Artifact details. The example updates the timeline and remounts details from the same local state.',
        )

        try {
            const stage = html`<div className="canvas-workspace-inspector-stage"></div>` as HTMLElement
            this.detailsHost = html`<div className="canvas-workspace-output-details-host"></div>` as HTMLElement
            this.frame.stage.append(stage)
            this.progress = createMediaGenerationProgress({
                id: 'fixture-live-progress',
                state: this.state,
                defaultExpanded: true,
            })
            this.lifetime.own(() => this.progress.destroy())
            this.lifetime.own(() => this.details.destroy())
            stage.append(this.progress.element, this.detailsHost)
            this.setProgress('running')
            this.statusParameter = this.frame.select(
                'Pipeline status',
                this.state.status,
                {
                    pending: 'Pending',
                    running: 'Running',
                    completed: 'Completed',
                    failed: 'Failed',
                    cancelled: 'Cancelled',
                },
                status => this.setProgress(status as MediaGenerationRunStatus),
            )
            this.frame.text(
                'Pipeline message',
                this.message,
                message => {
                    this.message = message
                    this.setProgress(this.state.status)
                },
            )
            this.detailsParameter = this.frame.select(
                'Output details',
                this.detailsType,
                {
                    image: 'Image',
                    capabilityArtifact: 'Capability Artifact',
                },
                type => this.showDetails(type as typeof this.detailsType),
            )
            this.frame.code(
                () => ["import { createMediaGenerationProgress } from '@lixpi/canvas-components/workspace/progress'", "import {", "    WorkspaceOutputDetails,", "    createGeneratedOutputDetailsSidebar,", "} from '@lixpi/canvas-components/workspace/review'", "import { createDefaultMediaGenerationRunProgress } from '@lixpi/constants'", "", "// Host detail ports supply Asset edits, installed module definitions and history.", `// Selected output: ${  String(
                    (this.detailsType),
                )  }.`, "const mount=(", "    host: HTMLElement,", "    node: ConstructorParameters<typeof WorkspaceOutputDetails>[1],", "    ports: ConstructorParameters<typeof WorkspaceOutputDetails>[2],", ") => {", "    const state={", "        generationRequestId: 'example-run',", `        status: '${  String(
                    (this.state.status),
                )  }' as const,`, `        message: ${  String(
                    (JSON.stringify(this.message)),
                )  },`, `        progress: createDefaultMediaGenerationRunProgress('${  String((this.state.status))  }', ${  String(
                    (JSON.stringify(this.message)),
                )  }),`, "        updatedAt: Date.now(),", "    }", "    const progress=createMediaGenerationProgress({ id: 'example-run', state, defaultExpanded: true })", "    const sidebar=createGeneratedOutputDetailsSidebar({", "        onClose: () => sidebar.element.remove(),", "        renderContent: body => new WorkspaceOutputDetails(body, node, {", "            ...ports,", "            getProgress: () => state,", "        }),", "    })", "    host.append(progress.element, sidebar.element)", "    progress.update(state)", "    return () => {", "        sidebar.destroy()", "        progress.destroy()", "    }", "}"].join('\n'),
            )

            for (const status of ['pending', 'running', 'completed', 'failed', 'cancelled'] as const)
                this.frame.button(status, () => void this.setProgress(status))

            this.frame.button('Image details', () => this.showDetails('image'))
            this.frame.button('Artifact details', () => this.showDetails('capabilityArtifact'))
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private setProgress(status: MediaGenerationRunStatus): void {
        this.statusParameter?.update({
            title: `${status.charAt(0).toUpperCase()}${status.slice(1)}`,
            value: status,
        })
        this.state = {
            ...progressState(status),
            message: this.message,
            progress: createDefaultMediaGenerationRunProgress(status, this.message),
        }
        this.progress.update(this.state)
        this.showDetails(this.detailsType)
        this.frame.report(`Pipeline updated to ${status}.`)
    }

    private showDetails(type: 'image' | 'capabilityArtifact'): void {
        this.detailsParameter?.update({
            title: type === "image" ? "Image" : "Capability Artifact",
            value: type,
        })
        this.detailsType = type
        this.details.destroy()
        this.details = new Lifetime()
        this.detailsHost.replaceChildren()
        const node = createCanvasFixture(this.fixtures).nodes.find(candidate => candidate.type === type)

        if (
            !node
            || (node.type !== 'image' && node.type !== 'capabilityArtifact')
        )
            return

        const sidebar = createGeneratedOutputDetailsSidebar({
            onClose: () => this.detailsHost.replaceChildren(),
            renderContent: body => new WorkspaceOutputDetails(
                body,
                node,
                {
                    assets: this.fixtureHost.assetDetails,
                    getDescriptor: mediaNode => this.fixtures.getAsset(mediaNode.assetId)?.descriptor,
                    getArtifactDefinition: artifactTypeId => this.fixtures.artifacts.frontend.require(artifactTypeId),
                    getArtifactDocument: assetId => this.fixtures.readDocument(assetId, 'capabilityArtifact')?.doc,
                    getBranchMediaTarget: () => null,
                    getMediaBranchTarget: () => null,
                    mountMediaHistory: () => null,
                    mountBranchHistory: () => null,
                    mountArtifactHistory: () => null,
                    getProgress: () => this.state,
                    progressDetails: {},
                    now: () => fixtureTime,
                },
            ),
        })
        this.details.own(() => sidebar.destroy())
        this.detailsHost.append(sidebar.element)
    }
}

export class RightPanelExample extends PanelExample {
    private widthParameter?: HTMLInputElement
    private openParameter?: ToggleControl
    private modeParameter?: SelectionControl
    private readonly panel: WorkspaceRightPanel
    private state: CanvasAiChatPanelState = {
        isOpen: true,
        topLevelMode: 'artifacts',
        width: 520,
        contextChips: [],
    }

    constructor(host: HTMLElement) {
        super(
            host,
            'WorkspaceRightPanel composes the resizable drawer and Capabilities, Artifacts, Media and Conversations switch. The host owns width, open state and mode. syncState applies width changes; render replaces scoped content and releases its previous view.',
        )

        try {
            const pane = html`<div className="canvas-workspace-surface"></div>` as HTMLDivElement
            this.frame.stage.append(pane)
            this.panel = new WorkspaceRightPanel({
                pane,
                widthHost: pane,
                settings: this.fixtureHost.appearance.rightSidePanel,
                switchSettings: this.fixtureHost.appearance.aiChatThread.panelSwitch,
                cssProperties: {},
                getState: () => this.state,
                onWidthChange: width => {
                    this.state = {
                        ...this.state,
                        width,
                    }
                    this.frame.report(`Panel width: ${width ?? 'default'} px`)
                },
                onModeChange: mode => this.mode(mode),
                onOpenChange: isOpen => {
                    this.state = {
                        ...this.state,
                        isOpen,
                    }
                    this.panel.render()
                    this.syncParameters()
                    this.frame.report(isOpen ? "Panel open" : "Panel closed")
                },
                mountContent: (mount, mode) => this.mountContent(mount, mode),
                acquirePanLock: () => () => {},
                requestFrame: callback => requestAnimationFrame(callback),
                cancelFrame: handle => cancelAnimationFrame(handle),
                setTimer: (callback, delay) => window.setTimeout(callback, delay),
                clearTimer: handle => window.clearTimeout(handle),
                onError: this.frame.error,
            })
            this.lifetime.own(() => this.panel.destroy())
            this.panel.render()
            this.panel.applyConstraints()
            this.lifetime.own(
                this.panel.ensure().subscribe(width => {
                    this.state = {
                        ...this.state,
                        width,
                    }
                    this.frame.report(`Panel width: ${width} px`)
                }),
            )
            this.frame.onThemeChange(() => this.panel.applyConstraints())
            const resize = new ResizeObserver(() => this.panel.applyConstraints())
            resize.observe(pane)
            this.lifetime.own(() => resize.disconnect())
            this.widthParameter = this.frame.number(
                'Panel width',
                {
                    value: this.state.width ?? 520,
                },
                width => {
                    this.state = {
                        ...this.state,
                        width,
                    }
                    this.panel.syncState()
                    this.syncParameters()
                },
            )
            this.openParameter = this.frame.toggle(
                'Open',
                this.state.isOpen,
                isOpen => {
                    this.state = {
                        ...this.state,
                        isOpen,
                    }
                    this.panel.render()
                    this.panel.syncState()
                    this.syncParameters()
                },
            )
            this.modeParameter = this.frame.select(
                'Panel mode',
                this.state.topLevelMode,
                {
                    capabilities: 'Capabilities',
                    artifacts: 'Artifacts',
                    media: 'Media',
                    aiThreads: 'Conversations',
                },
                mode => this.mode(mode as CanvasRightSidePanelMode),
            )
            this.syncParameters()
            this.frame.code(
                () => ["import {", "    WorkspaceRightPanel,", "    type WorkspaceRightPanelOptions,", "} from '@lixpi/canvas-components/workspace'", "import { type CanvasAiChatPanelState } from '@lixpi/constants'", "", "// mountContent owns a scoped library or conversation view and returns its disposer.", "const mount=(options: WorkspaceRightPanelOptions) => {", `    let state: CanvasAiChatPanelState=${  String(
                    (JSON.stringify(
                        this.state,
                        null,
                        4,
                    )),
                )}`, "    const panel=new WorkspaceRightPanel({", "        ...options,", "        getState: () => state,", "        onWidthChange: width => { state={ ...state, width } },", "        onModeChange: topLevelMode => {", "            state={ ...state, topLevelMode, isOpen: true }", "            panel.render()", "        },", "        onOpenChange: isOpen => {", "            state={ ...state, isOpen }", "            panel.render()", "        },", "    })", "    panel.render()", "    panel.syncState()", "    panel.applyConstraints()", "    const resize=new ResizeObserver(() => panel.applyConstraints())", "    resize.observe(options.pane)", "    return () => {", "        resize.disconnect()", "        panel.destroy()", "    }", "}"].join('\n'),
            )

            for (const mode of ['capabilities', 'artifacts', 'media', 'aiThreads'] as const)
                this.frame.button(mode, () => this.mode(mode))

            this.frame.button('Close / open', () => {
                this.state = {
                    ...this.state,
                    isOpen: !this.state.isOpen,
                }
                this.panel.render()
                this.syncParameters()
                this.panel.syncState()
            })
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private syncParameters(): void {
        this.state = {
            ...this.state,
            width: this.panel.ensure().getWidth(),
        }

        if (this.widthParameter) {
            this.widthParameter.value = String(
                this.panel.ensure().getWidth(),
            )
        }

        this.openParameter?.setChecked(this.state.isOpen)
        this.modeParameter?.update({
            title: panelModeTitles[this.state.topLevelMode],
            value: this.state.topLevelMode,
        })
    }

    private mode(topLevelMode: CanvasRightSidePanelMode): void {
        this.state = {
            ...this.state,
            isOpen: true,
            topLevelMode,
        }
        this.panel.render()
        this.syncParameters()
        this.frame.report(`Panel mode: ${topLevelMode}`)
    }

    private mountContent(
        mount: HTMLElement,
        mode: CanvasRightSidePanelMode,
    ): () => void {
        if (mode === 'aiThreads') {
            const conversation = new ConversationExample(mount)

            return () => conversation.destroy()
        }

        const fixture = new LibrariesExample(mount)

        try {
            fixture.render(mode)

            return () => fixture.destroy()
        } catch (error) {
            fixture.destroy()

            throw error
        }
    }
}

export class GenerationHistoryExample extends PanelExample {
    constructor(host: HTMLElement) {
        super(host, 'WorkspaceGenerationHistory renders a read-only conversation projection with referenced Assets and supplied progress.')

        try {
            const mount = html`<div className="canvas-workspace-history-host"></div>` as HTMLDivElement
            this.frame.stage.append(mount)
            const history = new WorkspaceGenerationHistory(
                {
                    host: mount,
                    projection: {
                        threadId: 'fixture-conversation',
                        content: conversationDocument,
                    },
                },
                {
                    getNode: nodeId => createCanvasFixture(this.fixtures).nodes.find(node => node.nodeId === nodeId),
                    getContextEnvironment: () => this.fixtureHost.contextEnvironment(),
                    renditionPath: this.fixtures.renditionUrl,
                    getMediaContent: () => conversationDocument,
                    getProgress: () => progressState('completed'),
                    mountEditor: request => this.history(request.mount, request.content),
                    createReasoningBadge: () => null,
                    styleReasoningHeader: () => {},
                    progressDetails: {},
                    onError: this.frame.error,
                },
            )
            this.lifetime.own(() => history.destroy())
            this.frame.code(
                () => [
                    "import { WorkspaceGenerationHistory } from '@lixpi/canvas-components/workspace/review'",
                    '',
                    'const history = new WorkspaceGenerationHistory({',
                    '    host,',
                    '    projection: { threadId, content },',
                    '}, ports)',
                    '',
                    '// The editor port mounts the read-only conversation projection.',
                    '// Context, rendition and progress ports keep their existing authority.',
                    'history.destroy()',
                ].join('\n'),
            )
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }
}
