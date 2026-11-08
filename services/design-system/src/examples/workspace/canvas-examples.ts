import { LoadingOverlay } from '@lixpi/canvas-components/loading'
import { createLibraryWorkspaceChromeSettings } from '@lixpi/canvas-components/library'
import { unionRectangles } from '@lixpi/canvas-engine/shared'
import { getWorkspaceLoadingPresentation } from '@lixpi/canvas-components/workspace/loading'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    LixpiWorkspaceCanvas,
    WorkspaceCanvasChrome,
} from '@lixpi/canvas-components/workspace'
import {
    WorkspaceNodeShells,
    WorkspaceDocumentNodes,
    WorkspaceCapabilityNode,
    OperationStatusNode,
    BranchMarkerContent,
    BranchMarkerActions,
    createBranchReferenceResolution,
} from '@lixpi/canvas-components/workspace/nodes'
import {
    createCanvasPromptReferenceRenderer,
    createContextPreviewTile,
} from '@lixpi/canvas-components/workspace/context'
import {
    type CanvasState,
    type DocumentCanvasNode,
    type CapabilityArtifactCanvasNode,
} from '@lixpi/constants'
import { createProseMirrorSchema } from '@lixpi/prosemirror/shared/schema-builder'
import {
    applyStyle,
    html,
} from '@lixpi/ui-primitives/dom'
import { ExampleFrame } from '../example-frame.ts'
import { FixtureWorkspaceHost } from './fixture-host.ts'
import {
    WorkspaceFixtures,
    workspaceId,
    organizationId,
} from './fixtures.ts'
import {
    FixtureEditor,
    paragraphDocument,
    promptEditorIntegrationSource,
} from './fixture-editor.ts'
import {
    createCanvasFixture,
    createOperationFixture,
} from './node-fixtures.ts'
import { ensureArtifactStyles } from './artifact-fixtures.ts'

export type FullWorkspaceExampleOptions = {
    fitOnMount?: boolean
    workspaceControls?: boolean
    nodeType?: CanvasState["nodes"][number]["type"]
    nodeTypes?: readonly CanvasState["nodes"][number]["type"][]
    // Shown instead of the shared fixture's nodes of the isolated type, at
    // their own positions.
    nodes?: readonly CanvasState["nodes"][number][]
}

export class FullWorkspaceExample {
    private isolateNodeType(initial = false): void {
        const types = this.options.nodeTypes ?? (this.options.nodeType ? [this.options.nodeType] : undefined)

        if (!types)
            return

        const explicit = initial ? this.options.nodes : undefined
        const nodes = (explicit ?? this.state.nodes.filter(node => types.includes(node.type))).map(
            (node, index) => ({
                ...node,
                position: initial
                    && !this.options.nodeTypes
                    && !explicit
                    ? {
                        x: 60,
                        y: 80 + index * (node.dimensions.height + 60),
                    }
                    : node.position,
            }),
        )
        const ids = new Set(
            nodes.map(node => node.nodeId),
        )
        this.state = {
            ...this.state,
            nodes,
            edges: this.state.edges.filter(edge => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId)),
            ...(initial ? { viewport: {
                x: 30,
                y: 40,
                zoom: 0.8,
            } } : {}),
        }
    }

    private readonly lifetime = new Lifetime()
    readonly frame: ExampleFrame
    private readonly fixtures = new WorkspaceFixtures()
    private readonly renderer: LixpiWorkspaceCanvas
    private readonly chrome: WorkspaceCanvasChrome
    private initialFitActive = false
    private initialFitFrame: number | null = null
    private initialFitGeometry = ''
    private zoomParameter?: HTMLInputElement
    private viewportXParameter?: HTMLInputElement
    private viewportYParameter?: HTMLInputElement
    private nodeWidthParameter?: HTMLInputElement
    private nodeHeightParameter?: HTMLInputElement
    private state: CanvasState

    constructor(
        host: HTMLElement,
        private readonly options: FullWorkspaceExampleOptions = {},
    ) {
        const workspaceControls = options.workspaceControls ?? false
        const isolated = Boolean(options.nodeType || options.nodeTypes)
        const branches = options.nodeTypes?.every(type => ['branchOrigin', 'branchFork', 'branchLine'].includes(type))
        this.frame = new ExampleFrame(
            host,
            branches
                ? 'The origin starts a branch. Continuation keeps that branch; the fork starts an alternative from the same origin. Native parent edges enter from the left and omit arrowheads into fork and continuation markers.'
                : options.nodeTypes
                    ? 'Workspace-specific node types use the package-owned renderer and their original views. Shared Image, Video and Audio nodes appear in the Canvas nodes section. Editor, Asset and persistence ports use local fixture state.'
                    : options.nodeType
                        ? `The ${options.nodeType} node uses the workspace renderer and its original view. Adjust its geometry or interact with its content; editor, Asset and persistence ports use local fixture state.`
                        : 'LixpiWorkspaceCanvas composes every current workspace node kind with pan, zoom, selection, connections and resizable nodes. The host supplies Asset, editor, catalog and persistence ports; this example keeps those ports in memory.',
        )
        this.lifetime.own(() => this.frame.destroy())
        this.lifetime.own(() => this.fixtures.destroy())

        try {
            this.state = createCanvasFixture(this.fixtures)
            this.isolateNodeType(true)

            if (
                isolated
                || options.fitOnMount
            )
                this.beginInitialFit()

            const fixtureHost = new FixtureWorkspaceHost(
                this.fixtures,
                host.ownerDocument,
                this.frame.report,
                () => this.state,
            )
            this.lifetime.own(() => fixtureHost.destroy())
            const surface = html`<div className="canvas-workspace-surface"></div>` as HTMLDivElement
            this.frame.stage.append(surface)
            this.chrome = new WorkspaceCanvasChrome(
                createLibraryWorkspaceChromeSettings(fixtureHost.appearance),
                {
                    document: host.ownerDocument,
                    createDocument: async () => this.insertDocument(),
                    uploadFile: async () =>
                        this.frame.report('File conversion is simulated. Use the operation states example to inspect its presentation.'),
                    importUrl: async () => this.frame.report('URL ingestion is simulated in this local example.'),
                    reportError: this.frame.error,
                },
                { controls: workspaceControls },
            )
            surface.append(this.chrome.element)
            this.lifetime.own(() => this.chrome.destroy())
            this.renderer = new LixpiWorkspaceCanvas(
                {
                    composer: workspaceControls,
                    conversationPanel: workspaceControls,
                    sidePanel: workspaceControls,
                    paneEl: this.chrome.pane,
                    viewportEl: this.chrome.viewportMount,
                    mediaModeSwitchMountEl: this.chrome.mediaModeSwitchMount,
                    modelMenuControlMountEl: this.chrome.modelMenuControlMount,
                    glassTargets: this.chrome.glassTargets,
                    workspaceId,
                    canvasState: this.state,
                    documents: this.fixtures.documents,
                    aiChatThreads: this.fixtures.threads,
                    onViewportChange: viewport => {
                        this.state = {
                            ...this.state,
                            viewport,
                        }
                        this.chrome.setZoom(viewport.zoom)
                        this.syncViewportParameters()
                    },
                    onCanvasStateChange: state => {
                        this.state = state
                        this.syncNodeParameters()
                        this.queueInitialFit()
                        this.frame.report(`${state.nodes.length} canvas nodes. Changes are retained in memory.`)
                    },
                    onDocumentContentChange: request => {
                        this.fixtures.setDocument(
                            request.documentId,
                            'content',
                            request.content,
                        )
                        this.frame.report('Saved the local document content.')
                    },
                    onAssetAttach: async request => request.canvasState,
                    onAssetDetach: async request => request.canvasState,
                },
                fixtureHost.host,
            )
            this.lifetime.own(() => this.renderer.destroy())
            this.frame.button('Fit all', this.fit)

            if (isolated) {
                const first = this.state.nodes[0]
                this.nodeWidthParameter = this.frame.number(
                    options.nodeTypes
                        ? branches
                            ? 'All branch widths'
                            : 'All node widths'
                        : 'Node width',
                    {
                        value: first?.dimensions.width ?? 320,
                    },
                    width => {
                        this.state = {
                            ...this.state,
                            nodes: this.state.nodes.map(
                                node => ({
                                    ...node,
                                    dimensions: {
                                        ...node.dimensions,
                                        width,
                                    },
                                }),
                            ),
                        }
                        this.render()
                    },
                )
                this.nodeHeightParameter = this.frame.number(
                    options.nodeTypes
                        ? branches
                            ? 'All branch heights'
                            : 'All node heights'
                        : 'Node height',
                    {
                        value: first?.dimensions.height ?? 200,
                    },
                    height => {
                        this.state = {
                            ...this.state,
                            nodes: this.state.nodes.map(
                                node => ({
                                    ...node,
                                    dimensions: {
                                        ...node.dimensions,
                                        height,
                                    },
                                }),
                            ),
                        }
                        this.render()
                    },
                )
            }

            this.render()

            if (
                isolated
                || options.fitOnMount
            )
                this.fit()

            this.zoomParameter = this.frame.number(
                'Zoom',
                {
                    value: this.state.viewport.zoom,
                },
                zoom => this.viewport(
                    this.state.viewport.x,
                    this.state.viewport.y,
                    zoom,
                ),
            )
            this.viewportXParameter = this.frame.number(
                'Viewport X',
                {
                    value: this.state.viewport.x,
                },
                x => this.viewport(
                    x,
                    this.state.viewport.y,
                    this.state.viewport.zoom,
                ),
            )
            this.viewportYParameter = this.frame.number(
                'Viewport Y',
                {
                    value: this.state.viewport.y,
                },
                y => this.viewport(
                    this.state.viewport.x,
                    y,
                    this.state.viewport.zoom,
                ),
            )

            if (
                workspaceControls
                && !isolated
            ) {
                this.frame.select(
                    'Right panel',
                    'closed',
                    {
                        closed: 'Closed',
                        artifacts: 'Artifacts',
                        media: 'Media',
                        aiThreads: 'Conversations',
                    },
                    mode => {
                        if (mode === 'closed') {
                            this.state = {
                                ...(this.renderer.getCanvasState() ?? this.state),
                                aiChatPanel: {
                                    ...this.state.aiChatPanel!,
                                    isOpen: false,
                                },
                            }
                            this.render()
                        } else
                            this.panel(mode as 'artifacts' | 'media' | 'aiThreads')
                    },
                )
            }

            this.frame.code(
                () => [
                    ...(workspaceControls ? promptEditorIntegrationSource : []),
                    "import { LixpiWorkspaceCanvas, type WorkspaceCanvasHost } from '@lixpi/canvas-components/workspace'",
                    '',
                    ...(branches ? [
                        '// Each marker references its own generation and persisted conversation document.',
                        '// Continuation shares the origin branchId; the fork has a distinct branchId.',
                        "// Parent edges match WorkspaceLineageProjection: sourceHandle 'right', targetHandle 'left'.",
                        '// The native forward-connection policy omits arrowheads into fork/continuation markers.',
                    ] : []),
                    'const mount = (options: ConstructorParameters<typeof LixpiWorkspaceCanvas>[0], host: WorkspaceCanvasHost) => {',
                    `    const presentation = { composer: ${workspaceControls}, conversationPanel: ${workspaceControls}, sidePanel: ${workspaceControls} }`,
                    ...(workspaceControls ? ["    host.editors.createPrompt = integration => request =>", "        new FixturePromptEditor(request, integration, host.theme)"] : []),
                    isolated ? `    const canvas = new LixpiWorkspaceCanvas({ ...options, ...presentation, canvasState: ${JSON.stringify(
                        this.state,
                        null,
                        4,
                    )} }, host)` : "    const canvas = new LixpiWorkspaceCanvas({ ...options, ...presentation }, host)",
                    `    canvas.setViewport(${JSON.stringify(
                        this.state.viewport,
                        null,
                        4,
                    )})`,
                    '    return () => canvas.destroy()',
                    '}',
                    ...(workspaceControls ? ["// Both editor integration ports mount actual controls in the native workspace rail."] : []),
                ].join('\n'),
            )

            if (
                workspaceControls
                && !isolated
            ) {
                this.frame.button(
                    'Overview',
                    () => this.viewport(
                        30,
                        40,
                        0.42,
                    ),
                )
                this.frame.button(
                    'Documents and media',
                    () => this.viewport(
                        30,
                        40,
                        0.7,
                    ),
                )
                this.frame.button(
                    'Branch markers',
                    () => this.viewport(
                        30,
                        -300,
                        0.65,
                    ),
                )
                this.frame.button(
                    'Capability Artifacts',
                    () => this.viewport(
                        30,
                        -540,
                        0.7,
                    ),
                )
                this.frame.button('Artifact library', () => this.panel('artifacts'))
                this.frame.button('Media library', () => this.panel('media'))
                this.frame.button('Conversation history', () => this.panel('aiThreads'))
                this.frame.button('New document', () => this.insertDocument())
            }
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private beginInitialFit(): void {
        this.initialFitActive = true
        const document = this.frame.stage.ownerDocument

        document.addEventListener(
            'pointerdown',
            this.stopInitialFit,
            true,
        )
        document.addEventListener(
            'keydown',
            this.stopInitialFit,
            true,
        )
        document.addEventListener(
            'wheel',
            this.stopInitialFit,
            {
                capture: true,
                passive: true,
            },
        )
        this.lifetime.own(() => {
            this.stopInitialFit()
            document.removeEventListener(
                'pointerdown',
                this.stopInitialFit,
                true,
            )
            document.removeEventListener(
                'keydown',
                this.stopInitialFit,
                true,
            )
            document.removeEventListener(
                'wheel',
                this.stopInitialFit,
                true,
            )
        })
    }

    private stopInitialFit = (): void => {
        this.initialFitActive = false

        if (this.initialFitFrame !== null) {
            this.frame.stage.ownerDocument.defaultView?.cancelAnimationFrame(this.initialFitFrame)
            this.initialFitFrame = null
        }
    }

    private queueInitialFit(): void {
        if (!this.initialFitActive)
            return

        const geometry = JSON.stringify(
            this.state.nodes.map(
                node => [
                    node.nodeId,
                    ...[node.position.x, node.position.y, node.dimensions.width, node.dimensions.height],
                ],
            ),
        )

        if (geometry === this.initialFitGeometry)
            return

        this.initialFitGeometry = geometry
        const view = this.frame.stage.ownerDocument.defaultView

        if (!view)
            return

        if (this.initialFitFrame !== null)
            view.cancelAnimationFrame(this.initialFitFrame)

        // Follow committed measurements while the initial scene settles. Any user
        // interaction ends this ownership so later layout updates cannot move their viewport.
        this.initialFitFrame = view.requestAnimationFrame(() => {
            this.initialFitFrame = null

            if (this.initialFitActive)
                this.fit()
        })
    }

    private syncNodeParameters(): void {
        for (const [input, dimension] of [
            [this.nodeWidthParameter, 'width'],
            [this.nodeHeightParameter, 'height'],
        ] as const) {
            if (!input)
                continue

            const values = new Set(
                this.state.nodes.map(node => node.dimensions[dimension]),
            )
            input.disabled = values.size === 0
            input.value = values.size === 1 ? String([...values][0]) : ''
            input.placeholder = values.size > 1 ? 'Mixed' : ''
        }
    }

    private syncViewportParameters(): void {
        for (const [input, value] of [
            [this.zoomParameter, this.state.viewport.zoom],
            [this.viewportXParameter, this.state.viewport.x],
            [this.viewportYParameter, this.state.viewport.y],
        ] as const)
            if (
                input
                && input !== input.ownerDocument.activeElement
            )
                input.value = String(value)

        this.frame.refreshCode()
    }

    private render(): void {
        this.isolateNodeType()
        this.renderer.render(
            this.state,
            this.fixtures.documents,
            this.fixtures.threads,
            workspaceId,
        )
        this.syncNodeParameters()
    }

    fit = (): void => {
        const state = this.renderer.getCanvasState() ?? this.state
        const bounds = unionRectangles(
            state.nodes.map(
                node => ({
                    ...node.position,
                    ...node.dimensions,
                }),
            ),
            40,
        )
        const size = this.chrome.viewportMount.getBoundingClientRect()

        if (
            !bounds
            || size.width <= 0
            || size.height <= 0
        )
            return

        const zoom = Math.min(
            1,
            size.width / bounds.width,
            size.height / bounds.height,
        )
        this.state = state
        this.viewport(
            (size.width - bounds.width * zoom) / 2 - bounds.x * zoom,
            (size.height - bounds.height * zoom) / 2 - bounds.y * zoom,
            zoom,
        )
    }

    private viewport(
        x: number,
        y: number,
        zoom: number,
    ): void {
        this.state = {
            ...this.state,
            viewport: {
                x,
                y,
                zoom,
            },
        }
        this.renderer.setViewport({
            x,
            y,
            zoom,
        })
        this.chrome.setZoom(zoom)
        this.syncViewportParameters()
    }

    private panel(mode: 'artifacts' | 'media' | 'aiThreads'): void {
        this.state = {
            ...(this.renderer.getCanvasState() ?? this.state),
            aiChatPanel: {
                isOpen: true,
                topLevelMode: mode,
                contextChips: [],
            },
        }
        this.render()
    }

    private insertDocument(): void {
        if (
            this.options.nodeType
            && this.options.nodeType !== 'document'
        )
            return

        const assetId = this.fixtures.createId()
        this.fixtures.addAsset(
            assetId,
            'Local canvas document',
            'document',
            paragraphDocument('This document was created through the live workspace toolbar.'),
        )
        const next = this.renderer.insertNodeAtViewportCenter({
            nodeId: `node-${assetId}`,
            type: 'document',
            assetId,
            dimensions: {
                width: 390,
                height: 240,
            },
        })

        if (next)
            this.state = next

        this.renderer.render(
            this.state,
            this.fixtures.documents,
            this.fixtures.threads,
            workspaceId,
        )
        this.frame.report('Created a document in the local workspace.')
    }

    destroy = (): void => void this.lifetime.destroy()
}

class NodeExample {
    readonly lifetime = new Lifetime()
    readonly frame: ExampleFrame
    readonly stage: HTMLDivElement
    readonly fixtures = new WorkspaceFixtures()
    readonly fixtureHost: FixtureWorkspaceHost
    readonly shells: WorkspaceNodeShells

    constructor(
        host: HTMLElement,
        instructions: string,
    ) {
        this.lifetime.own(() => this.fixtures.destroy())

        try {
            this.frame = new ExampleFrame(host, instructions)
            this.frame.stage.classList.add('canvas-example-stage-scrollable')
            this.lifetime.own(() => this.frame.destroy())
            this.stage = html`<div className="canvas-workspace-node-stage"></div>` as HTMLDivElement
            this.frame.stage.append(this.stage)
            this.fixtureHost = new FixtureWorkspaceHost(
                this.fixtures,
                host.ownerDocument,
                this.frame.report,
            )
            this.lifetime.own(() => this.fixtureHost.destroy())
            this.shells = new WorkspaceNodeShells({
                document: host.ownerDocument,
                getBounds: node => ({
                    x: node.position.x,
                    y: node.position.y,
                    ...node.dimensions,
                }),
                getLayer: () => 1,
                getZoom: () => 1,
                getResizeSettings: () => ({
                    ...this.fixtureHost.appearance.mediaNode.resizeHandle,
                    useZoomCompensatedScaling: true,
                }),
                consumeSuppressedClick: () => false,
                select: nodeId => this.frame.report(`Selected ${nodeId}. Drag and resize gestures are demonstrated in the full workspace.`),
                toggleSelection: nodeId => this.frame.report(`Toggled selection for ${nodeId}.`),
                startDrag: () => {},
                startResize: () => {},
                onCreate: () => {},
                togglePlayback: nodeId => this.frame.report(`Playback toggled for ${nodeId}.`),
            })
            this.lifetime.own(() => this.shells.destroy())
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    destroy = (): void => void this.lifetime.destroy()
}

export class DocumentNodesExample extends NodeExample {
    private stateParameter?: ReturnType<ExampleFrame["select"]>
    private view: WorkspaceDocumentNodes | null = null
    private mode: 'editable' | 'leased' | 'loading' | 'error' = 'editable'
    private width = 500
    private height = 360

    constructor(host: HTMLElement) {
        super(
            host,
            'WorkspaceDocumentNodes mounts the host ProseMirror editor inside a workspace node shell. Geometry and editor-state changes remount this example; the editor port owns read-only lease enforcement and content persistence.',
        )

        try {
            this.lifetime.own(() => this.view?.destroy())
            this.render('editable')
            this.frame.onThemeChange(() => this.render(this.mode))
            this.stateParameter = this.frame.select(
                'Editor state',
                this.mode,
                {
                    editable: 'Editable',
                    leased: 'Read-only lease',
                    loading: 'Content loading',
                    error: 'Mount error',
                },
                mode => this.render(mode as typeof this.mode),
            )
            this.frame.number(
                'Node width',
                {
                    value: this.width,
                },
                width => {
                    this.width = width
                    this.render(this.mode)
                },
            )
            this.frame.number(
                'Node height',
                {
                    value: this.height,
                },
                height => {
                    this.height = height
                    this.render(this.mode)
                },
            )
            this.frame.code(
                () => ["import {", "    WorkspaceDocumentNodes,", "    type WorkspaceDocument,", "    type WorkspaceDocumentNodesOptions,", "    type WorkspaceNodeShells,", "} from '@lixpi/canvas-components/workspace/nodes'", "", "// The editor port owns ProseMirror and its edit lease.", "// This example remounts the node when geometry or lease state changes.", "const mount=(", "    host: HTMLElement,", "    shells: WorkspaceNodeShells,", "    ports: WorkspaceDocumentNodesOptions,", "    snapshot: WorkspaceDocument,", ") => {", "    const documents=new WorkspaceDocumentNodes(shells, ports)", "    host.append(documents.create({", "        nodeId: 'document-fixture-node',", "        type: 'document',", "        assetId: snapshot.documentId,", "        position: { x: 48, y: 42 },", `        dimensions: { width: ${  String(
                    (this.width),
                )  }, height: ${  String((this.height))  } },`, `    }, ${  String((this.mode === 'loading' ? 'undefined' : 'snapshot'))  }))`, `    // Editor port reports readOnly: ${  String(
                    (this.mode === 'leased'),
                )  } through onLeaseStateChange.`, "    return () => documents.destroy()", "}"].join('\n'),
            )
            this.frame.button('Editable', () => this.render('editable'))
            this.frame.button('Read-only lease', () => this.render('leased'))
            this.frame.button('Content loading', () => this.render('loading'))
            this.frame.button('Mount error and retry', () => this.render('error'))
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private render(mode: 'editable' | 'leased' | 'loading' | 'error'): void {
        const titles = {
            editable: "Editable",
            leased: "Read-only lease",
            loading: "Content loading",
            error: "Mount error",
        }
        this.stateParameter?.update({
            title: titles[mode],
            value: mode,
        })
        this.mode = mode
        this.view?.destroy()
        this.shells.clear()
        let failOnce = mode === 'error'
        const node: DocumentCanvasNode = {
            nodeId: 'document-fixture-node',
            type: 'document',
            assetId: 'fixture-document',
            position: {
                x: 48,
                y: 42,
            },
            dimensions: {
                width: this.width,
                height: this.height,
            },
        }
        this.view = new WorkspaceDocumentNodes(
            this.shells,
            {
                beginLoading: () => {
                    this.frame.report('The document snapshot is missing. Choose Editable to complete hydration.')

                    const overlay = new LoadingOverlay({
                        root: this.frame.stage,
                        ...getWorkspaceLoadingPresentation(this.fixtureHost.appearance),
                        onError: this.frame.error,
                    })
                    overlay.setVisible(true)

                    return { destroy: () => overlay.destroy() }
                },
                mountEditor: request => {
                    if (failOnce) {
                        failOnce = false

                        throw new Error('Simulated editor mount failure. Retry mounts the editor.')
                    }

                    request.onLeaseStateChange({
                        readOnly: mode === 'leased',
                        holderWorkspaceId: mode === 'leased' ? 'another-workspace' : undefined,
                    })

                    return new FixtureEditor(
                        request.container,
                        request.document.content ?? {},
                        createProseMirrorSchema('assetContent'),
                        [],
                        content => this.fixtures.setDocument(
                            node.assetId,
                            'content',
                            content,
                        ),
                        mode === 'leased',
                    )
                },
                onError: error => this.frame.report(
                    String(error),
                ),
            },
        )
        this.stage.replaceChildren(
            this.view.create(
                node,
                mode === 'loading' ? undefined : {
                    documentId: 'fixture-document',
                    organizationId,
                    title: 'Canvas notes',
                    content: this.fixtures.readDocument('fixture-document', 'content')?.doc,
                },
            ),
        )

        if (
            mode !== 'error'
            && mode !== 'loading'
        )
            this.frame.report(mode === 'leased' ? 'Edit lease held by another workspace.' : 'Editable document.')
    }
}

export class ArtifactNodesExample extends NodeExample {
    private readOnlyParameter?: ReturnType<ExampleFrame["toggle"]>
    private views: WorkspaceCapabilityNode[] = []
    private artifactType = 'all'
    private width = 520
    private readOnly = false

    constructor(host: HTMLElement) {
        super(
            host,
            'WorkspaceCapabilityNode mounts the installed Artifact module view. Action Timeline supplies its editor, schema and plugins; Media Pipeline and Media Sequence supply summary cards. The editor lease applies to editable module views.',
        )

        try {
            this.lifetime.own(() => this.clearViews())
            this.render()
            this.frame.select(
                'Artifact module',
                this.artifactType,
                {
                    all: 'All registered modules',
                    'action-timeline': 'Action Timeline editor',
                    'media-pipeline': 'Media Pipeline summary',
                    'media-sequence': 'Media Sequence summary',
                },
                artifactType => {
                    this.artifactType = artifactType
                    this.render()
                },
            )
            this.frame.number(
                'Node width',
                {
                    value: this.width,
                },
                width => {
                    this.width = width
                    this.render()
                },
            )
            this.readOnlyParameter = this.frame.toggle(
                'Editor read-only lease',
                this.readOnly,
                readOnly => {
                    this.readOnly = readOnly
                    this.render()
                },
            )
            this.frame.code(
                () => ["import {", "    WorkspaceCapabilityNode,", "    type WorkspaceCapabilityNodePorts,", "    type WorkspaceNodeShells,", "} from '@lixpi/canvas-components/workspace/nodes'", "import { type CapabilityArtifactCanvasNode } from '@lixpi/constants'", "", "// Ports resolve the installed module's schema, node view and editor plugins.", `// Selected module: ${  String(
                    (this.artifactType),
                )  }. Editor lease readOnly: ${  String((this.readOnly))  }.`, "const mount=(", "    host: HTMLElement,", "    node: CapabilityArtifactCanvasNode,", "    shells: WorkspaceNodeShells,", "    ports: WorkspaceCapabilityNodePorts,", ") => {", "    const view=new WorkspaceCapabilityNode({", "        ...node,", `        dimensions: { ...node.dimensions, width: ${  String(
                    (this.width),
                )  } },`, "    }, shells, ports)", "    host.append(view.element)", "    return () => view.destroy()", "}"].join('\n'),
            )
            this.frame.button('Reset fixture documents', () => this.render(true))
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private clearViews(): void {
        for (const view of this.views)
            view.destroy()

        this.views = []
        this.shells.clear()
    }

    private render(reset = false): void {
        this.readOnlyParameter?.setDisabled(this.artifactType !== 'all' && this.artifactType !== 'action-timeline')
        this.clearViews()
        this.stage.replaceChildren()
        ensureArtifactStyles(this.stage.ownerDocument)

        for (const [index, [assetId, doc]] of [...this.fixtures.artifacts.documents].entries()) {
            const asset = this.fixtures.requireAsset(assetId)
            const artifactTypeId = asset.artifact!.artifactTypeId
            const definition = this.fixtures.artifacts.frontend.require(artifactTypeId)

            if (
                this.artifactType !== 'all'
                && artifactTypeId !== this.artifactType
            )
                continue

            const node: CapabilityArtifactCanvasNode = {
                nodeId: `artifact-${artifactTypeId}`,
                type: 'capabilityArtifact',
                assetId,
                artifactTypeId,
                position: {
                    x: 32 + (this.artifactType === 'all' ? index : 0) * (this.width + 40),
                    y: 40,
                },
                dimensions: {
                    ...definition.initialCanvasDimensions,
                    width: this.width,
                },
            }

            if (reset)
                this.fixtures.setDocument(
                    assetId,
                    'capabilityArtifact',
                    doc,
                )

            const view = new WorkspaceCapabilityNode(
                node,
                this.shells,
                {
                    beginLoading: () => ({ destroy: () => {} }),
                    ensureStyles: ensureArtifactStyles,
                    getAsset: this.fixtures.getAsset,
                    getDocument: id => this.fixtures.readDocument(id, 'capabilityArtifact'),
                    refreshAsset: async id => this.fixtures.requireAsset(id),
                    ensureAssetsLoaded: async ids => ids.map(this.fixtures.requireAsset),
                    getDefinitions: id => ({
                        frontend: this.fixtures.artifacts.frontend.require(id),
                        shared: this.fixtures.artifacts.shared.require(id),
                    }),
                    createAssetReferenceView: request => {
                        const reference = createCanvasFixture(this.fixtures).nodes.find(item => 'assetId' in item && item.assetId === request.assetId)

                        if (!reference)
                            return undefined

                        return createContextPreviewTile({
                            node: reference,
                            environment: this.fixtureHost.contextEnvironment(),
                            titleOverride: request.displayName,
                        })
                    },
                    mountEditor: request => {
                        request.onLeaseStateChange({ readOnly: this.readOnly })

                        return new FixtureEditor(
                            request.container,
                            request.document,
                            request.schema,
                            request.plugins,
                            content => this.fixtures.setDocument(
                                assetId,
                                'capabilityArtifact',
                                content,
                            ),
                            this.readOnly,
                        )
                    },
                    onHeightChange: (_nodeId, height) => void (view.element.style.height = `${height}px`),
                    onError: this.frame.error,
                },
            )
            this.views.push(view)
            this.stage.append(view.element)
        }

        this.frame.report('Registered Artifact types: action-timeline, media-pipeline, media-sequence.')
    }
}

export class OperationNodesExample extends NodeExample {
    private stateParameter?: ReturnType<ExampleFrame["select"]>
    private content = new Lifetime()
    private mode: 'in-progress' | 'failed' | 'action-required' | 'reference' | 'review' = 'in-progress'
    private message = 'Waiting for the next operation update.'
    private width = 340

    constructor(
        host: HTMLElement,
        family: "operations" | "branches" = 'operations',
    ) {
        super(
            host,
            'OperationStatusNode presents upload conversion, generation failures and required actions. BranchMarkerContent and its action ports present review and reference resolution. State changes remount this example because these views have constructor-owned presentation.',
        )

        try {
            this.lifetime.own(() => this.content.destroy())
            this.mode = family === 'branches' ? 'reference' : 'in-progress'
            const presentations: Readonly<Record<string, string>> = family === "branches"
                ? {
                    reference: "Resolve Asset reference",
                    review: "Branch review controls",
                }
                : {
                    "in-progress": "In progress",
                    failed: "Failed",
                    "action-required": "Verification required",
                }
            this.render(this.mode)
            this.stateParameter = this.frame.select(
                "Presentation",
                this.mode,
                presentations,
                mode => this.render(mode as typeof this.mode),
            )
            this.frame.text(
                'Operation message',
                this.message,
                message => {
                    this.message = message
                    this.render(this.mode)
                },
            )
            this.frame.number(
                'Node width',
                {
                    value: this.width,
                },
                width => {
                    this.width = width
                    this.render(this.mode)
                },
            )
            this.frame.code(
                () => this.mode === 'reference'
                    || this.mode === 'review'
                    ? ["import {", "    BranchMarkerContent,", "    type BranchMarkerContentOptions,", "} from '@lixpi/canvas-components/workspace/nodes'", "", "// The host supplies prompt references and optional reference-resolution controls.", "const mount=(host: HTMLElement, options: BranchMarkerContentOptions) => {", "    const content=new BranchMarkerContent({", "        ...options,", `        responseText: ${  String(
                        (JSON.stringify(this.message)),
                    )  },`, "        showResponseLine: true,", "    })", "    host.append(content.element)", "    return () => content.destroy()", "}", `// Branch shell width: ${  String(
                        (this.width),
                    )  }px. Mode: ${  String((this.mode))  }.`].join('\n')
                    : ["import {", "    OperationStatusNode,", "    type OperationStatusNodeActions,", "    type WorkspaceNodeShells,", "} from '@lixpi/canvas-components/workspace/nodes'", "import { type OperationStatusCanvasNode } from '@lixpi/constants'", "", "// The host implements authorized verify, cancel, edit and dismiss operations.", "// The example remounts because OperationStatusNode has no update method.", "const mount=(", "    host: HTMLElement,", "    node: OperationStatusCanvasNode,", "    shells: WorkspaceNodeShells,", "    actions: OperationStatusNodeActions,", ") => {", "    const view=new OperationStatusNode({", "        ...node,", `        status: '${  String(
                        (this.mode),
                    )  }',`, `        message: ${  String(
                        (JSON.stringify(this.message)),
                    )  },`, `        dimensions: { ...node.dimensions, width: ${  String((this.width))  } },`, "    }, shells, actions)", "    host.append(view.element)", "    return () => view.destroy()", "}"].join('\n'),
            )

            for (const [mode, title] of Object.entries(presentations))
                this.frame.button(title, () => this.render(mode as typeof this.mode))
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private render(mode: 'in-progress' | 'failed' | 'action-required' | 'reference' | 'review'): void {
        const titles = {
            "in-progress": "In progress",
            failed: "Failed",
            "action-required": "Verification required",
            reference: "Resolve Asset reference",
            review: "Branch review controls",
        }
        this.stateParameter?.update({
            title: titles[mode],
            value: mode,
        })
        this.mode = mode
        this.content.destroy()
        this.content = new Lifetime()
        this.shells.clear()
        this.stage.replaceChildren()
        const renderReference = createCanvasPromptReferenceRenderer({
            document: this.stage.ownerDocument,
        })

        if (
            mode === 'reference'
            || mode === 'review'
        ) {
            const marker = createCanvasFixture(this.fixtures).nodes.find(node => node.type === 'branchOrigin')!

            if (marker.type !== 'branchOrigin')
                return

            marker.position = {
                x: 42,
                y: 50,
            }
            marker.dimensions = {
                width: this.width,
                height: 190,
            }
            const shell = this.shells.createBranchMarker(marker, () => this.frame.report('Opened simulated branch details.'))
            const referenceResolution = mode === 'reference'
                ? createBranchReferenceResolution({
                    document: this.stage.ownerDocument,
                    operation: {
                        ...createOperationFixture('action-required'),
                        unresolvedBindingId: 'fixture-binding',
                        candidateAssetIds: ['fixture-image', 'fixture-video'],
                    },
                    candidates: [
                        {
                            referenceType: 'media',
                            assetId: 'fixture-image',
                            mediaKind: 'image',
                            displayName: 'Canvas study',
                        },
                        {
                            referenceType: 'media',
                            assetId: 'fixture-video',
                            mediaKind: 'video',
                            displayName: 'Motion study',
                        },
                    ],
                    renderReference,
                    resolveReference: async request => this.frame.report(`Selected local Asset ${request.assetId}.`),
                })
                : null
            const content = new BranchMarkerContent({
                document: this.stage.ownerDocument,
                label: 'Fixture branch',
                headerHeight: 64,
                promptParts: [{
                    type: 'text',
                    text: 'Prepare a sequence from the canvas study.',
                }],
                renderReference,
                reasoningModel: null,
                mediaModels: [],
                modelSummary: 'No provider is selected in this fixture.',
                responseText: this.message,
                responsePhase: 'done',
                responseIsReceiving: false,
                showResponseLine: true,
                pending: false,
                active: false,
                tooltipHideDelayMs: 120,
                referenceResolution,
            })
            this.content.own(() => content.destroy())
            shell.nodeEl.append(content.element)
            const actions = new BranchMarkerActions({
                document: this.stage.ownerDocument,
                key: marker.nodeId,
                active: false,
                hasReviewOutputs: mode === 'review',
                canAcceptAll: true,
                onStop: () => this.frame.report('Stopped the local branch.'),
                onAcceptAll: () => this.frame.report('Accepted every local branch output.'),
                onRegenerate: value => this.frame.report(`Selected regeneration mode ${value}; execution is simulated.`),
            })
            this.content.own(() => actions.destroy())

            if (actions.reviewControls)
                shell.nodeEl.append(actions.reviewControls)

            this.stage.append(shell.nodeEl)
            const footprint = [shell.nodeEl, content.element, referenceResolution?.element, actions.reviewControls]
                .filter((element): element is HTMLElement => Boolean(element))
            const fitFootprint = (): void => {
                if (!shell.nodeEl.isConnected)
                    return

                const stageBounds = this.stage.getBoundingClientRect()
                const bounds = unionRectangles(
                    footprint.map(element => element.getBoundingClientRect()),
                )

                if (!bounds)
                    return

                const padding = 42
                const offsetX = Math.max(0, stageBounds.left - this.stage.scrollLeft + padding - bounds.x)
                const offsetY = Math.max(0, stageBounds.top - this.stage.scrollTop + padding - bounds.y)

                if (
                    !offsetX
                    && !offsetY
                )
                    return

                marker.position = {
                    x: marker.position.x + offsetX,
                    y: marker.position.y + offsetY,
                }
                applyStyle(
                    shell.nodeEl,
                    {
                        left: `${marker.position.x}px`,
                        top: `${marker.position.y}px`,
                    },
                )
            }
            const resize = new ResizeObserver(fitFootprint)
            this.content.own(() => resize.disconnect())

            for (const element of footprint)
                resize.observe(element)

            fitFootprint()
        } else {
            for (const [index, operation] of ['upload', 'media-generation'].entries()) {
                const node = createOperationFixture(mode, operation as 'upload' | 'media-generation')
                node.message = this.message
                node.dimensions = {
                    ...node.dimensions,
                    width: this.width,
                }
                node.position = {
                    x: 42 + index * (this.width + 80),
                    y: 50,
                }
                const view = new OperationStatusNode(
                    node,
                    this.shells,
                    {
                        verify: async () => this.frame.report('Provider verification selected; external navigation is simulated.'),
                        cancel: async () => this.frame.report('Cancelled the simulated operation.'),
                        edit: async () => this.frame.report('Edit request selected; use the composer example to edit a draft.'),
                        dismissUpload: () => this.shells.remove(node.nodeId),
                    },
                )
                this.content.own(() => view.destroy())
                this.stage.append(view.element)
            }
        }

        this.frame.report(`Showing ${mode} presentation.`)
    }
}
