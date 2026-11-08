import { html } from '@lixpi/ui-primitives/dom'
import { getExampleTheme } from './example-theme.ts'
import {
    applyNodeGeometry,
    computeGeometryChanges,
    buildNodesById,
    unionRectangles,
    type CanvasIntent,
    type CanvasViewport,
    type EngineNode,
    type NodeGeometryPolicy,
    type SceneSnapshot,
    type ConnectorPathType,
    type BoundedZoomScalingOptions,
} from '@lixpi/canvas-engine/shared'
import {
    CanvasController,
    NodeRegistry,
    type NodeRegistration,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import { DiagramNodeView } from '@lixpi/canvas-components/diagram'
import {
    createLibraryDiagramAppearance,
    createLibraryMediaStyle,
} from '@lixpi/canvas-components/library'
import {
    createImageNodeRegistration,
    createPlaybackNodeRegistration,
} from '@lixpi/canvas-components/media'
import {
    canvasThemeConnectorSettings,
    type CanvasTheme,
} from '@lixpi/canvas-components/theme'
import {
    type ConnectionSettings,
} from '@lixpi/canvas-engine/frontend/connectors'
import { ExampleFrame } from './example-frame.ts'
import { EnginePlaybackChrome } from './engine-playback-chrome.ts'
import { withNodeShell } from '@lixpi/canvas-components/nodes/shell'
import { createEngineNodeShellOptions } from './engine-node-shell.ts'
import shellSlotSource from './engine-node-shell.ts?raw'

type ExampleNodeData = {
    title: string
    detail: string
    fit?: 'contain' | 'cover' | 'stretch'
    shape?: 'circle' | 'rounded-rectangle'
    media?: MediaDescriptor
}

const geometry: NodeGeometryPolicy = {
    measure: node => {
        const bounds = {
            ...node.position,
            ...node.dimensions,
        }

        return {
            visualBounds: bounds,
            hitBounds: bounds,
            selectionBounds: bounds,
            collisionBounds: bounds,
            connectorBounds: bounds,
        }
    },
    movable: true,
    resize: {
        min: {
            width: 120,
            height: 80,
        },
        preserveAspectRatio: false,
    },
}

const ports = (
    width: number,
    height: number,
): EngineNode['ports'] => [
    {
        id: 'in',
        role: 'input',
        direction: 'left',
        anchor: {
            x: 0,
            y: height / 2,
        },
    },
    {
        id: 'out',
        role: 'output',
        direction: 'right',
        anchor: {
            x: width,
            y: height / 2,
        },
    },
    {
        id: 'top',
        role: 'input',
        direction: 'top',
        anchor: {
            x: width / 2,
            y: 0,
        },
    },
    {
        id: 'bottom',
        role: 'output',
        direction: 'bottom',
        anchor: {
            x: width / 2,
            y: height,
        },
    },
]

const node = (
    nodeId: string,
    title: string,
    x: number,
    y: number,
    overrides: Partial<EngineNode<ExampleNodeData>> = {},
): EngineNode<ExampleNodeData> => ({
    nodeId,
    type: 'diagram',
    position: {
        x,
        y,
    },
    dimensions: {
        width: 220,
        height: 100,
    },
    ports: ports(220, 100),
    data: {
        title,
        detail: nodeId === "source"
            ? "Reference input"
            : nodeId === "result"
                ? "Processed output"
                : nodeId === "alternate"
                    ? "Alternative route"
                    : "",
    },
    ...overrides,
})

const media = (
    key: string,
    kind: MediaDescriptor['kind'],
): MediaDescriptor => ({
    key,
    kind,
    version: '1',
    renditions: kind === 'image'
        ? [{
            id: 'original',
            mimeType: 'image/png',
            width: 640,
            height: 360,
        }]
        : [
            {
                id: 'playback',
                mimeType: kind === 'video' ? 'video/webm' : 'audio/wav',
            },
            {
                id: 'poster',
                mimeType: 'image/png',
                width: 640,
                height: 360,
            },
        ],
})

const createStressNodes = (count: number): EngineNode<ExampleNodeData>[] => {
    if (
        !Number.isSafeInteger(count)
        || count < 0
    )
        throw new RangeError('Node count must be a non-negative safe integer.')

    const columns = Math.ceil(
        Math.sqrt(count),
    )

    return Array.from(
        { length: count },
        (_, index) => node(
            `tile-${index}`,
            `Node ${index + 1}`,
            (index % columns) * 270 + 30,
            Math.floor(index / columns) * 150 + 30,
        ),
    )
}

const initialScene = (
    mode: string,
    nodeCount = 1000,
): SceneSnapshot<ExampleNodeData> => {
    let nodes = [
        node(
            'source',
            'Source',
            40,
            70,
        ),
        node(
            'result',
            'Result',
            mode === 'engine-routing' ? 620 : 420,
            70,
        ),
        node(
            'alternate',
            'Alternate',
            mode === 'engine-routing' ? 620 : 420,
            mode === 'engine-routing' ? 330 : 280,
        ),
    ]
    let edges: SceneSnapshot['edges'] = [{
        edgeId: 'source-result',
        source: {
            nodeId: 'source',
            portId: 'out',
        },
        target: {
            nodeId: 'result',
            portId: 'in',
        },
        path: mode === 'engine-routing' ? 'orthogonal' : 'bezier',
        data: null,
    }]

    if (mode === 'engine-parenting') {
        nodes = [
            node(
                'group',
                'Parent',
                40,
                40,
                {
                    dimensions: {
                        width: 560,
                        height: 300,
                    },
                    ports: ports(560, 300),
                    data: {
                        title: 'Parent with relative children',
                        detail: 'Moving this parent moves its children',
                    },
                },
            ),
            node(
                'child-a',
                'Child A',
                35,
                100,
                { parentId: 'group' },
            ),
            node(
                'child-b',
                'Child B',
                300,
                100,
                { parentId: 'group' },
            ),
            node(
                'outside',
                'Collision target',
                650,
                150,
            ),
        ]
        edges = [{
            edgeId: 'child-link',
            source: {
                nodeId: 'child-a',
                portId: 'out',
            },
            target: {
                nodeId: 'child-b',
                portId: 'in',
            },
            path: 'bezier',
            data: null,
        }]
    }

    if (mode === 'engine-routing') {
        nodes.push(
            node(
                'obstacle',
                'Route obstacle',
                400,
                100,
                {
                    dimensions: {
                        width: 130,
                        height: 160,
                    },
                    ports: [],
                    data: {
                        title: 'Obstacle',
                        detail: 'Move me',
                    },
                },
            ),
        )
        edges = [...edges, {
            edgeId: 'vertical-link',
            source: {
                nodeId: 'result',
                portId: 'bottom',
            },
            target: {
                nodeId: 'alternate',
                portId: 'top',
            },
            path: 'orthogonal',
            data: null,
        }]
    }

    if (mode === 'engine-large-scene') {
        nodes = createStressNodes(nodeCount)
        edges = []
    }

    if (mode === 'media-images') {
        nodes = [
            node(
                'image',
                'Image',
                30,
                80,
                {
                    type: 'image',
                    dimensions: {
                        width: 320,
                        height: 220,
                    },
                    ports: ports(320, 220),
                    data: {
                        fit: 'contain',
                        title: 'Image',
                        detail: 'Image fit',
                        media: media('image', 'image'),
                    },
                },
            ),
        ]
        edges = []
    }

    if (mode === 'media-playback') {
        nodes = [
            node(
                'video',
                'Native video',
                40,
                40,
                {
                    type: 'video',
                    dimensions: {
                        width: 480,
                        height: 270,
                    },
                    ports: ports(480, 270),
                    data: {
                        title: 'Video',
                        detail: 'Native playback',
                        media: media('video', 'video'),
                    },
                },
            ),
            node(
                'audio',
                'Native audio',
                40,
                360,
                {
                    type: 'audio',
                    dimensions: {
                        width: 480,
                        height: 90,
                    },
                    ports: ports(480, 90),
                    data: {
                        title: 'Audio',
                        detail: 'Native playback',
                        media: media('audio', 'audio'),
                    },
                },
            ),
        ]
        edges = []
    }

    if (mode === 'engine-theme') {
        nodes = [
            node(
                'theme-diagram',
                'Diagram node',
                30,
                110,
                {
                    dimensions: {
                        width: 240,
                        height: 150,
                    },
                    ports: ports(240, 150),
                    data: {
                        title: 'Shared canvas theme',
                        detail: 'Edit the global theme controls',
                    },
                },
            ),
            node(
                'theme-image',
                'Image',
                340,
                70,
                {
                    type: 'image',
                    dimensions: {
                        width: 250,
                        height: 230,
                    },
                    ports: ports(250, 230),
                    data: {
                        title: 'Image',
                        detail: 'Retained image surface',
                        media: media('image', 'image'),
                    },
                },
            ),
            node(
                'theme-video',
                'Video',
                660,
                100,
                {
                    type: 'video',
                    dimensions: {
                        width: 280,
                        height: 170,
                    },
                    ports: ports(280, 170),
                    data: {
                        title: 'Video',
                        detail: 'Native playback keeps its state',
                        media: media('video', 'video'),
                    },
                },
            ),
        ]
        edges = [
            {
                edgeId: 'theme-diagram-image',
                source: {
                    nodeId: 'theme-diagram',
                    portId: 'out',
                },
                target: {
                    nodeId: 'theme-image',
                    portId: 'in',
                },
                path: 'horizontal-bezier',
                data: null,
            },
            {
                edgeId: 'theme-image-video',
                source: {
                    nodeId: 'theme-image',
                    portId: 'out',
                },
                target: {
                    nodeId: 'theme-video',
                    portId: 'in',
                },
                path: 'horizontal-bezier',
                data: null,
            },
        ]
    }

    if (mode === 'node-shell-empty') {
        nodes = [
            node(
                'empty-shell',
                'Empty shell',
                50,
                60,
                {
                    type: 'empty',
                    dimensions: {
                        width: 320,
                        height: 180,
                    },
                    ports: ports(320, 180),
                },
            ),
        ]
        edges = []
    }

    if (mode === 'node-shell') {
        const examples = [
            initialScene('node-shell-empty').nodes[0],
            initialScene('engine-theme').nodes.find(node => node.type === 'diagram')!,
            initialScene('media-images').nodes[0],
            ...initialScene('media-playback').nodes,
        ]
        const positions = [
            {
                x: 80,
                y: 100,
            },
            {
                x: 500,
                y: 100,
            },
            {
                x: 920,
                y: 100,
            },
            {
                x: 80,
                y: 460,
            },
            {
                x: 760,
                y: 460,
            },
        ]
        const titles = ['Empty shell', 'Diagram inside shell', 'Image inside shell', 'Video inside shell', 'Audio inside shell']
        nodes = examples.map((example, index) => {
            const dimensions = index < 3 ? {
                width: 320,
                height: 180,
            } : example.dimensions

            return {
                ...example,
                position: positions[index],
                dimensions,
                ports: ports(dimensions.width, dimensions.height),
                data: {
                    ...example.data,
                    title: titles[index],
                },
            }
        })
        edges = []
    }

    return {
        sceneKey: `library-${mode}`,
        revision: '0',
        nodes,
        edges,
    }
}

export type EngineExampleOptions = {
    nodeType?: string
    controls?: boolean
    metadata?: boolean
}

export class EngineExample {
    private createInitialScene(): SceneSnapshot<ExampleNodeData> {
        const snapshot = initialScene(this.mode, this.nodeCount)

        if (!this.options.nodeType)
            return snapshot

        const nodes = snapshot.nodes.filter(node => node.type === this.options.nodeType).map(
            (node, index) => ({
                ...node,
                position: {
                    x: 50 + index * (node.dimensions.width + (node.type === "diagram" ? 160 : 30)),
                    y: 60,
                },
            }),
        )
        const ids = new Set(
            nodes.map(node => node.nodeId),
        )

        return {
            ...snapshot,
            nodes,
            edges: snapshot.edges.filter(edge => ids.has(edge.source.nodeId) && ids.has(edge.target.nodeId)),
        }
    }

    readonly frame: ExampleFrame
    readonly canvas: CanvasController
    private snapshot: SceneSnapshot<ExampleNodeData>
    private acceptedSnapshot: SceneSnapshot<ExampleNodeData>
    private nodeCount = 1000
    private nodeCountParameter?: HTMLInputElement
    private stressMetrics?: HTMLOutputElement
    private releaseStressMetrics?: () => void
    private revision = 0
    private disposed = false
    private failMedia = false
    private metadata = false
    private loop = true
    private muted = true
    private playbackRate = 1
    private readonly playbackElements = new Map<string, HTMLVideoElement | HTMLAudioElement>()
    private playbackChrome: EnginePlaybackChrome | null = null
    private volume = 1
    private readonly connectionSettings: ConnectionSettings
    private readonly connectorZoomScaling: BoundedZoomScalingOptions
    private pathOverride: ConnectorPathType | null = null
    private zoomParameter?: HTMLInputElement
    private nodeWidthParameter?: HTMLInputElement
    private nodeHeightParameter?: HTMLInputElement
    private fitObserver?: ResizeObserver

    constructor(
        host: HTMLElement,
        private readonly mode: string,
        private readonly options: EngineExampleOptions = {},
    ) {
        this.frame = new ExampleFrame(
            host,
            mode === "engine-large-scene"
                ? "Node count regenerates the full scene. Pan and zoom to inspect engine visibility and retained off-screen data."
                : mode === 'media-images'
                    ? 'Change the fit or resize the image to see how it fills the node. Use Fail media and Recover media to exercise the resolver.'
                    : mode === 'media-playback'
                        ? 'Video and audio use native playback through the engine media resolver. Play, seek and resize; moving a source out of view pauses playback.'
                        : 'Drag nodes, Ctrl/Cmd-click for multiple selection, drag the background for a marquee, and resize from edges and corners, and connect named ports. Delete removes selected items; Escape cancels a gesture.',
        )
        this.connectionSettings = canvasThemeConnectorSettings(this.frame.theme.value)
        this.connectorZoomScaling = { ...this.connectionSettings.scaling.zoomScaling }
        this.metadata = options.metadata ?? false
        this.snapshot = this.createInitialScene()
        this.acceptedSnapshot = this.snapshot
        const registry = new NodeRegistry().register<ExampleNodeData>(
            this.decorateRegistration({
                type: 'diagram',
                geometry,
                mount: (value, context) => new DiagramNodeView(
                    value,
                    context,
                    {
                        getContent: current => ({
                            title: current.data.title,
                            tag: current.parentId ? 'child' : undefined,
                            lines: [current.data.detail],
                        }),
                        getAppearance: current => createLibraryDiagramAppearance(
                            this.frame.theme.value,
                            {
                                shape: current.data.shape,
                                raised: current.nodeId === 'group',
                            },
                        ),
                    },
                ),
            }),
        )

        registry.register<ExampleNodeData>(
            this.decorateRegistration({
                type: 'empty',
                geometry,
                mount: () => ({
                    update: () => {},
                    setGeometry: () => {},
                    setSelected: () => {},
                    setVisible: () => {},
                    destroy: () => {},
                }),
            }),
        )

        registry.register(
            this.decorateRegistration(
                createImageNodeRegistration<ExampleNodeData>({
                    type: 'image',
                    geometry,
                    fit: 'cover',
                    getMedia: value => value.data.media ?? null,
                    getStyle: node => ({
                        ...createLibraryMediaStyle(this.frame.theme.value),
                        fit: node.data.fit,
                    }),
                    onImageLoaded: value => this.frame.report(`Loaded ${value.data.title} image from the current media version.`),
                    onError: error => {
                        if (this.failMedia)
                            this.frame.report('The simulated media request failed. Choose Recover media to retry with a new content version.')
                        else
                            this.frame.error(error)
                    },
                }),
            ),
        )

        for (const kind of ['video', 'audio'] as const)
            registry.register(
                this.decorateRegistration(
                    createPlaybackNodeRegistration<ExampleNodeData>({
                        type: kind,
                        kind,
                        geometry,
                        getContent: value => value.data.media ? {
                            media: value.data.media,
                            playbackRenditionId: 'playback',
                            posterRenditionId: kind === 'video' ? 'poster' : undefined,
                        } : null,
                        getImageStyle: () => createLibraryMediaStyle(this.frame.theme.value),
                        onElement: (value, element) => {
                            if (element) {
                                element.loop = this.loop
                                element.muted = this.muted
                                element.playbackRate = this.playbackRate
                                element.volume = this.volume
                                this.playbackElements.set(value.nodeId, element)
                            } else
                                this.playbackElements.delete(value.nodeId)
                        },
                        playback: {
                            controls: false,
                            preload: 'metadata',
                            muted: true,
                            loop: true,
                        },
                        onReady: () => {
                            this.playbackChrome?.sync()

                            if (
                                this.metadata
                                && !this.disposed
                            )
                                this.publish()
                        },
                        pauseWhenHidden: true,
                        onError: this.frame.error,
                    }),
                ),
            )

        this.canvas = new CanvasController({
            root: this.frame.stage,
            registry,
            scene: this.snapshot,
            viewport: {
                x: 12,
                y: 12,
                zoom: Math.round(Math.min(
                    1,
                    Math.max(0.2, host.clientWidth / 920),
                ) * 100) / 100,
            },
            collisions: mode === 'engine-parenting' ? { margin: 20 } : undefined,
            visibilityMargin: 80,
            prefetchBatchSize: 8,
            connectors: {
                settings: this.connectionSettings,
                renderer: { zoomScaling: this.connectorZoomScaling },
                policy: { targetMarker: () => 'none' },
            },
            interaction: {
                isInteractiveTarget: element => Boolean(
                    element.closest(".workspace-video-chrome, .canvas-node-shell-actions"),
                ),
                onSelectionChange: selected => {
                    if (selected.size)
                        this.frame.report(`Selected: ${[...selected].join(', ')}`)
                },
            },
            mediaResolver: {
                resolve: async (
                    descriptor,
                    rendition,
                    signal,
                ) => {
                    signal.throwIfAborted()

                    if (this.failMedia)
                        throw new Error('Simulated media failure')

                    const extension = rendition === 'poster'
                        || descriptor.kind === 'image'
                        ? 'png'
                        : descriptor.kind === 'video'
                            ? 'webm'
                            : 'wav'

                    return {
                        url: `/fixtures/canvas-sample.${extension}`,
                        release: () => {},
                    }
                },
            },
            onIntent: this.accept,
            onError: this.frame.error,
            onDiagnostic: diagnostic => this.frame.report(`Diagnostic: ${JSON.stringify(diagnostic)}`),
        })

        if (this.snapshot.nodes.some(node => node.type === 'video' || node.type === 'audio')) {
            this.playbackChrome = new EnginePlaybackChrome({
                root: this.frame.stage,
                canvas: this.canvas,
                theme: this.frame.theme,
                geometry,
                elements: this.playbackElements,
                commit: bounds => {
                    const byId = buildNodesById(this.snapshot.nodes)
                    const changes = computeGeometryChanges(
                        this.snapshot.nodes,
                        bounds,
                        {
                            geometry: () => geometry,
                            worldBounds: node => this.canvas.geometry.worldBounds(node, byId),
                        },
                    )
                    this.accept({
                        kind: "geometry",
                        sceneKey: this.snapshot.sceneKey,
                        revision: this.snapshot.revision,
                        changes,
                    })
                },
                onError: this.frame.error,
            })
        }

        this.frame.onThemeChange(this.refreshTheme)

        if (
            options.nodeType
            || mode === 'node-shell'
        )
            this.fit()

        if (mode === 'node-shell') {
            this.fitObserver = new ResizeObserver(() => {
                if (!this.disposed)
                    this.fit()
            })
            this.fitObserver.observe(this.frame.stage)
            void this.fitSceneAfterReady()
        }

        if (options.controls === false)
            return

        if (mode === 'engine-large-scene')
            this.nodeCountParameter = this.frame.number(
                "Node count",
                { value: this.nodeCount },
                count => {
                    const nodes = createStressNodes(count)
                    this.snapshot = {
                        ...this.snapshot,
                        nodes,
                        edges: [],
                    }
                    this.publish()
                    this.fit()
                    this.frame.report(`${nodes.length} nodes generated.`)
                },
            )

        this.zoomParameter = this.frame.number(
            'Zoom',
            {
                value: this.canvas.scene.viewport.zoom,
            },
            value => void this.setViewport({
                ...this.canvas.scene.viewport,
                zoom: value,
            }),
        )
        this.nodeWidthParameter = this.frame.number(
            this.snapshot.nodes.length > 1 ? "All node widths" : "Node width",
            {
                value: this.snapshot.nodes[0].dimensions.width,
            },
            value => this.resizeNodes('width', value),
        )
        this.nodeHeightParameter = this.frame.number(
            this.snapshot.nodes.length > 1 ? "All node heights" : "Node height",
            {
                value: this.snapshot.nodes[0].dimensions.height,
            },
            value => this.resizeNodes('height', value),
        )

        if (this.snapshot.edges.length)
            this.frame.select(
                'Connector path',
                this.snapshot.edges[0].path ?? 'bezier',
                {
                    bezier: 'Bezier',
                    straight: 'Straight',
                    smoothstep: 'Smooth step',
                    'horizontal-bezier': 'Horizontal Bezier',
                    orthogonal: 'Orthogonal',
                },
                value => {
                    this.pathOverride = value as ConnectorPathType
                    this.snapshot = {
                        ...this.snapshot,
                        edges: this.snapshot.edges.map(
                            edge => ({
                                ...edge,
                                path: value as ConnectorPathType,
                            }),
                        ),
                    }
                    this.publish()
                },
            )

        if (mode === 'media-images')
            this.frame.select(
                'Image fit',
                'contain',
                {
                    contain: 'Contain',
                    cover: 'Cover',
                    stretch: 'Stretch',
                },
                value => {
                    this.snapshot = {
                        ...this.snapshot,
                        nodes: this.snapshot.nodes.map(
                            (node, index) => index === 0 ? {
                                ...node,
                                data: {
                                    ...node.data,
                                    fit: value as ExampleNodeData['fit'],
                                },
                            } : node,
                        ),
                    }
                    this.publish()
                },
            )

        if (mode === 'media-playback') {
            const playerHeightInput = this.frame.number(
                "Player control height",
                {
                    value: this.playbackChrome?.getControlHeight() ?? 40,
                },
                height => {
                    const theme = getExampleTheme(this.frame.stage)
                    const currentHeight = this.playbackChrome?.getControlHeight()

                    if (
                        !currentHeight
                        || theme.value.controls.height <= 0
                    )
                        throw new Error("The current player and shared control heights must be positive before scaling.")

                    const ratio = currentHeight / theme.value.controls.height
                    theme.update({ controls: { height: height / ratio } })
                },
            )
            this.frame.onThemeChange(() => {
                const height = this.playbackChrome?.getControlHeight() ?? 40
                playerHeightInput.value = String(height)
            })
            this.frame.number(
                "Volume",
                {
                    value: this.volume,
                },
                volume => {
                    if (!this.playbackElements.size)
                        throw new Error("No playback node is mounted.")

                    for (const element of this.playbackElements.values())
                        element.volume = volume

                    this.volume = volume
                },
            )
            this.frame.toggle(
                'Loop',
                this.loop,
                value => {
                    this.loop = value

                    for (const element of this.playbackElements.values())
                        element.loop = value
                },
            )
            this.frame.toggle(
                'Muted',
                this.muted,
                value => {
                    this.muted = value

                    for (const element of this.playbackElements.values())
                        element.muted = value
                },
            )
            this.frame.number(
                'Playback speed',
                {
                    value: 1,
                },
                value => {
                    if (!this.playbackElements.size)
                        throw new Error("No playback node is mounted.")

                    for (const element of this.playbackElements.values())
                        element.playbackRate = value

                    this.playbackRate = value
                },
            )
        }

        this.frame.code(() => this.sourceCode())

        this.frame.button(
            'Reset viewport',
            () => this.setViewport({
                x: 12,
                y: 12,
                zoom: Math.round(Math.min(1, host.clientWidth / 920) * 100) / 100,
            }),
        )
        this.frame.button('Fit all', this.fit)
        this.frame.button('Zoom in', () => this.zoom(1.25))
        this.frame.button('Zoom out', () => this.zoom(0.8))
        this.frame.button('Add node', () => {
            this.snapshot = {
                ...this.snapshot,
                nodes: [...this.snapshot.nodes, this.createAdditionalNode(
                    `added-${++this.revision}`,
                    'New node',
                    80 + this.revision * 20,
                    340,
                )],
            }
            this.publish()
        })
        this.frame.button('Switch scene', () => {
            this.snapshot = {
                ...this.createInitialScene(),
                sceneKey: `library-scene-${++this.revision}`,
            }
            this.refreshTheme(this.frame.theme.value)
            this.frame.report('Scene replaced. Selection, active gestures and node scopes were released.')
        })

        if (mode === 'engine-routing')
            this.frame.button('Toggle connector routing', () => {
                this.pathOverride = this.snapshot.edges[0]?.path === 'orthogonal' ? 'bezier' : 'orthogonal'
                this.snapshot = {
                    ...this.snapshot,
                    edges: this.snapshot.edges.map(
                        edge => ({
                            ...edge,
                            path: edge.path === 'orthogonal' ? 'bezier' : 'orthogonal',
                        }),
                    ),
                }
                this.publish()
            })

        if (mode === 'engine-validation') {
            this.frame.button('Reject invalid geometry', () => {
                try {
                    this.canvas.setScene({
                        ...this.snapshot,
                        nodes: [{
                            ...this.snapshot.nodes[0],
                            position: {
                                x: Number.NaN,
                                y: 0,
                            },
                        }],
                        edges: [],
                    })
                    this.frame.error(
                        new Error('Invalid scene was unexpectedly accepted'),
                    )
                } catch (error) {
                    this.frame.report(`Rejected invalid scene; previous scene retained. ${error instanceof Error ? error.message : String(error)}`)
                }
            })
            this.frame.button('Show unknown node', () => {
                this.snapshot = {
                    ...this.snapshot,
                    nodes: [...this.snapshot.nodes, node(
                        `unknown-${++this.revision}`,
                        'Unknown',
                        60,
                        350,
                        { type: 'unregistered' },
                    )],
                }
                this.publish()
            })
        }

        this.syncParameters()

        if (mode === 'engine-large-scene') {
            this.stressMetrics = html`
                <output
                    className="canvas-example-status"
                    aria-live="polite"
                ></output>
            ` as HTMLOutputElement
            this.frame.parameters.before(this.stressMetrics)
            const releaseScene = this.canvas.scene.subscribeScene(this.updateStressMetrics)
            const releaseView = this.canvas.scene.subscribeView(this.updateStressMetrics)
            this.releaseStressMetrics = () => {
                releaseScene()
                releaseView()
            }
            this.updateStressMetrics()
            void this.fitSceneAfterReady()
        }

        if (mode === 'media-images') {
            this.frame.button('Fail media', () => this.replaceMedia(true))
            this.frame.button('Recover media', () => this.replaceMedia(false))
        }
    }

    setMetadata(enabled: boolean): void {
        if (this.metadata === enabled)
            return

        this.metadata = enabled
        this.publish()
    }

    private decorateRegistration(registration: NodeRegistration<ExampleNodeData>): NodeRegistration<ExampleNodeData> {
        if (this.options.metadata === undefined)
            return registration

        return withNodeShell(
            registration,
            createEngineNodeShellOptions<ExampleNodeData>({
                theme: this.frame.theme,
                enabled: () => this.metadata,
                footerOffset: (nodeId, viewport) => this.playbackChrome?.getFooterOffsetScreen(nodeId, viewport) ?? 0,
                select: nodeId => this.canvas.setSelected([nodeId]),
                remove: nodeId => this.accept({
                    kind: 'delete',
                    sceneKey: this.snapshot.sceneKey,
                    nodeIds: [nodeId],
                    edgeIds: [],
                }),
            }),
        )
    }

    private updateStressMetrics = (): void => {
        if (
            !this.stressMetrics
            || this.disposed
        )
            return

        const stats = this.canvas.scene.getStatistics()
        this.stressMetrics.textContent = `Scene nodes: ${stats.nodes}; mounted views: ${stats.mountedViews}; visible nodes: ${stats.visibleNodes}`
    }

    private fitSceneAfterReady = async (): Promise<void> => {
        const ready = await this.canvas.ready

        if (
            ready
            && !this.disposed
        ) {
            this.fit()
            this.updateStressMetrics()
        }
    }

    private syncParameters(): void {
        if (!this.canvas)
            return

        if (
            this.nodeCountParameter
            && this.nodeCount !== this.snapshot.nodes.length
        ) {
            this.nodeCount = this.snapshot.nodes.length
            this.nodeCountParameter.value = String(this.nodeCount)
        }

        if (
            this.zoomParameter
            && this.zoomParameter !== this.zoomParameter.ownerDocument.activeElement
        )
            this.zoomParameter.value = String(this.canvas.scene.viewport.zoom)

        for (const [input, dimension] of [
            [this.nodeWidthParameter, 'width'],
            [this.nodeHeightParameter, 'height'],
        ] as const) {
            if (
                !input
                || input === input.ownerDocument.activeElement
            )
                continue

            const values = new Set(
                this.snapshot.nodes.map(node => node.dimensions[dimension]),
            )
            input.disabled = values.size === 0
            input.value = values.size === 1 ? String([...values][0]) : ''
            input.placeholder = values.size > 1 ? 'Mixed' : ''
        }

        this.frame.refreshCode()
    }

    private refreshTheme = (theme: CanvasTheme): void => {
        const settings = canvasThemeConnectorSettings(theme)

        for (const key of Object.keys(settings) as Array<keyof ConnectionSettings>)
            Reflect.set(
                this.connectionSettings,
                key,
                settings[key],
            )

        this.connectorZoomScaling.minZoom = settings.scaling.zoomScaling.minZoom
        this.connectorZoomScaling.lowZoomPower = settings.scaling.zoomScaling.lowZoomPower
        this.connectionSettings.scaling.zoomScaling = this.connectorZoomScaling
        this.canvas.setConnectionSettings(this.connectionSettings)
        this.snapshot = {
            ...this.snapshot,
            edges: this.snapshot.edges.map(
                edge => ({
                    ...edge,
                    path: this.pathOverride ?? settings.lineCurve,
                }),
            ),
        }
        this.publish()
    }

    private resizeNodes(
        dimension: 'width' | 'height',
        value: number,
    ): void {
        this.snapshot = {
            ...this.snapshot,
            nodes: this.snapshot.nodes.map(node => {
                const dimensions = {
                    ...node.dimensions,
                    [dimension]: value,
                }

                return {
                    ...node,
                    dimensions,
                    ports: node.ports.length ? ports(dimensions.width, dimensions.height) : [],
                }
            }),
        }
        this.publish()
    }

    private createAdditionalNode(
        nodeId: string,
        title: string,
        x: number,
        y: number,
    ): EngineNode<ExampleNodeData> {
        const template = this.options.nodeType ? (this.snapshot.nodes[0] ?? this.createInitialScene().nodes[0]) : undefined

        return template ? {
            ...template,
            nodeId,
            position: {
                x,
                y,
            },
            data: { ...template.data },
        } : node(
            nodeId,
            title,
            x,
            y,
        )
    }

    private sourceCode(): string {
        const source = this.componentSourceCode()

        if (this.options.metadata === undefined)
            return source

        return [
            "import { withNodeShell } from '@lixpi/canvas-components/nodes/shell'",
            shellSlotSource.trimEnd(),
            '',
            `let metadataEnabled = ${this.metadata}`,
            ...(this.playbackChrome ? ['let chrome = null'] : []),
            'const shell = createEngineNodeShellOptions({',
            '    theme,',
            '    enabled: () => metadataEnabled,',
            this.playbackChrome
                ? '    footerOffset: (id, viewport) => chrome?.outsideOffsetScreen(id, viewport) ?? 0,'
                : '    footerOffset: () => 0,',
            '    select: id => canvas.setSelected([id]),',
            '    remove: id => onIntent({ kind: "delete", sceneKey: scene.sceneKey, nodeIds: [id], edgeIds: [] }),',
            '})',
            'const withMetadataShell = registration => withNodeShell(registration, shell)',
            'const setMetadata = enabled => {',
            '    metadataEnabled = enabled',
            '    canvas.setScene({ ...scene, revision: String(++revision) })',
            '}',
            '',
            source,
        ].join('\\n')
    }

    private componentSourceCode(): string {
        const registrationStart = this.options.metadata !== undefined ? 'withMetadataShell(' : ''
        const registrationEnd = this.options.metadata !== undefined ? ')' : ''

        if (this.mode === 'node-shell')
            return [
                "import { CanvasController, NodeRegistry } from '@lixpi/canvas-engine/frontend/runtime'",
                "import { createImageNodeRegistration, createPlaybackNodeRegistration, PlaybackChrome } from '@lixpi/canvas-components/media'",
                '',
                '// The same decorator wraps every registration in this scene.',
                'const registry = new NodeRegistry()',
                'registry.register(withMetadataShell({',
                "    type: 'empty', geometry,",
                '    mount: () => ({',
                '        update: () => {}, setGeometry: () => {},',
                '        setSelected: () => {}, setVisible: () => {}, destroy: () => {},',
                '    }),',
                '}))',
                'registry.register(withMetadataShell(diagramRegistration))',
                'registry.register(withMetadataShell(createImageNodeRegistration({',
                "    type: 'image', geometry, fit: 'cover',",
                '    getMedia: node => node.data.media,',
                '    onError: reportError,',
                '})))',
                "for (const kind of ['video', 'audio'])",
                '    registry.register(withMetadataShell(createPlaybackNodeRegistration({',
                '        type: kind, kind, geometry,',
                '        getContent: node => ({ media: node.data.media, playbackRenditionId: "playback" }),',
                '        playback: { controls: false },',
                '        onError: reportError,',
                '    })))',
                '',
                `let scene = ${JSON.stringify(
                    this.snapshot,
                    null,
                    4,
                )}`,
                'const canvas = new CanvasController({ root, registry, scene, ...mediaPorts, onIntent })',
                'chrome = new PlaybackChrome({ ...playbackPorts })',
                'chrome.sync(scene.nodes.filter(node => node.type === "video" || node.type === "audio"))',
                `canvas.setViewport(${JSON.stringify(this.canvas.scene.viewport)})`,
                '// Fit includes screen space for titles, player controls, metadata and actions.',
                '// Dispose playback controls before the canvas releases its native elements and shell slots.',
                'chrome.destroy()',
                'canvas.destroy()',
            ].join('\n')

        if (this.mode === 'node-shell-empty')
            return [
                '// Empty content uses the same geometry contract as any wrapped node.',
                'registry.register(withMetadataShell({',
                "    type: 'empty',",
                '    geometry,',
                '    mount: () => ({',
                '        update: () => {},',
                '        setGeometry: () => {},',
                '        setSelected: () => {},',
                '        setVisible: () => {},',
                '        destroy: () => {},',
                '    }),',
                '}))',
                '// Replace this registration with a diagram or media registration to supply content.',
            ].join('\n')

        if (this.mode === 'engine-large-scene')
            return [
                "import { type SceneSnapshot } from '@lixpi/canvas-engine/shared'",
                '',
                `const count = ${this.snapshot.nodes.length}`,
                `const ports = ${JSON.stringify(
                    ports(220, 100),
                    null,
                    4,
                )}`,
                'const createScene = (count: number): SceneSnapshot => {',
                '    if (!Number.isSafeInteger(count) || count < 0)',
                "        throw new RangeError('Node count must be a non-negative safe integer.')",
                '    const columns = Math.ceil(Math.sqrt(count))',
                '    return {',
                "        sceneKey: 'stress-scene', revision: '0', edges: [],",
                '        nodes: Array.from({ length: count }, (_, index) => ({',
                '            nodeId: `tile-${index}`, type: "diagram",',
                '            position: { x: index % columns * 270 + 30, y: Math.floor(index / columns) * 150 + 30 },',
                '            dimensions: { width: 220, height: 100 },',
                '            ports: structuredClone(ports),',
                '            data: { title: `Node ${index + 1}`, detail: "" },',
                '        })),',
                '    }',
                '}',
                '// Keep the registered controller; visibility updates presentation while mounted views stay retained.',
                'canvas.setScene(createScene(count))',
            ].join('\n')

        if (this.mode === 'engine-theme')
            return [
                "import { CanvasThemeStore, createCanvasTheme, bindCanvasTheme, canvasThemeConnectorSettings } from '@lixpi/canvas-components/theme'",
                '',
                '// Share one source across diagram, image, playback, connector and DOM components.',
                `const theme = new CanvasThemeStore(createCanvasTheme(${JSON.stringify(
                    {
                        colors: this.frame.theme.value.colors,
                        shape: this.frame.theme.value.shape,
                        typography: this.frame.theme.value.typography,
                    },
                    null,
                    4,
                )}))`,
                'const releaseTheme = bindCanvasTheme(root, theme)',
                'const connectionSettings = canvasThemeConnectorSettings(theme.value)',
                '// Pass theme to createDiagramCanvas and createDiagramNodeRegistration.',
                '// Media registrations read theme.value in getStyle/getImageStyle.',
                'const unsubscribe = theme.subscribe(current => {',
                '    const next = canvasThemeConnectorSettings(current)',
                '    for (const key of Object.keys(next)) Reflect.set(connectionSettings, key, next[key])',
                '    canvas.setScene({ ...scene, revision: String(++revision) })',
                '})',
                '// Change any deep field. Retained resources repaint through their public APIs.',
                `theme.update({ shape: { nodeRadius: ${this.frame.theme.value.shape.nodeRadius} } })`,
                '// Unmount cleanup:',
                'unsubscribe()',
                'releaseTheme()',
                'canvas.destroy()',
            ].join('\n')

        if (this.mode === 'media-images')
            return [
                "import { createImageNodeRegistration } from '@lixpi/canvas-components/media'",
                '',
                `registry.register(${registrationStart}createImageNodeRegistration({`,
                "    type: 'image',",
                '    geometry,',
                "    getStyle: node => ({ fit: node.data.fit }),",
                '    getMedia: node => node.data.media,',
                '    onError: reportError,',
                `})${registrationEnd})`,
                '',
                '// Resolve renditions through CanvasController.mediaResolver.',
                '// Change media.version to invalidate and load a new source.',
            ].join('\n')

        if (this.mode === 'media-playback')
            return [
                "import { createPlaybackNodeRegistration } from '@lixpi/canvas-components/media'",
                "import { PlaybackChrome } from '@lixpi/canvas-components/media'",
                "import { createLixpiUiSettings } from '@lixpi/canvas-components/workspace/settings'",
                "import { createViewportBridge } from '@lixpi/canvas-engine/frontend/viewport'",
                '',
                `registry.register(${registrationStart}createPlaybackNodeRegistration({`,
                `    type: '${this.snapshot.nodes[0]?.type ?? this.options.nodeType ?? "video"}',`,
                `    kind: '${this.snapshot.nodes[0]?.data.media?.kind ?? this.options.nodeType ?? "video"}',`,
                '    geometry,',
                '    getContent: node => ({',
                '        media: node.data.media,',
                "        playbackRenditionId: 'playback',",
                `        posterRenditionId: ${this.snapshot.nodes[0]?.data.media?.kind === "video" ? "'poster'" : "undefined"},`,
                '    }),',
                `    playback: { controls: false, muted: ${this.muted}, loop: ${this.loop} },`,
                '    pauseWhenHidden: true,',
                '    onElement: (_node, element) => {',
                `        if (element) element.playbackRate = ${this.playbackRate}`,
                `        if (element) element.volume = ${this.volume}`,
                '    },',
                '    onError: reportError,',
                `})${registrationEnd})`,
                "",
                "const playerSettings = createLixpiUiSettings().videoControls",
                `playerSettings.height = ${this.playbackChrome?.getControlHeight() ?? 40}`,
                `${this.options.metadata !== undefined ? "chrome" : "const chrome"} = new PlaybackChrome({`,
                "    ...ports, settings: playerSettings,",
                "    // Ports supply native elements, node bounds, viewport and engine gestures.",
                "})",
                "host.append(chrome.element)",
                "createViewportBridge({ viewportEl: chrome.element }).applyViewport(viewport)",
                "chrome.sync(videoAndAudioNodes)",
                "// Release controls before the canvas releases its borrowed native elements.",
                "chrome.destroy()",
            ].join('\n')

        const viewport = this.canvas.scene.viewport

        return [
            "import { CanvasController, NodeRegistry } from '@lixpi/canvas-engine/frontend/runtime'",
            "import { createCanvasConnectorSettings } from '@lixpi/canvas-components/connectors'",
            '',
            '// Register a view and geometry policy for every node type.',
            `const registry = new NodeRegistry().register(${registrationStart}diagramRegistration${registrationEnd})`,
            '// The host owns scene data and applies the emitted intents.',
            'scene = {',
            '    ...scene,',
            '    edges: scene.edges.map(edge => ({',
            '        ...edge,',
            `        path: '${this.snapshot.edges[0]?.path ?? 'bezier'}',`,
            '    })),',
            '}',
            'const canvas = new CanvasController({',
            '    root, registry, scene,',
            `    viewport: ${JSON.stringify(viewport)},`,
            '    connectors: { settings: createCanvasConnectorSettings() },',
            '    onIntent: intent => {',
            '        scene = applyIntentToScene(scene, intent)',
            '        canvas.setScene(scene)',
            '    },',
            '    onError: reportError,',
            '})',
            '',
            `// Current node dimensions: ${JSON.stringify(this.snapshot.nodes[0]?.dimensions)}`,
            `// ${this.snapshot.nodes.length} nodes, ${this.snapshot.edges.length} edges.`,
            '// Release the renderer and input owners when unmounting.',
            'canvas.destroy()',
        ].join('\n')
    }

    private setViewport(viewport: CanvasViewport): void {
        this.canvas.setViewport(viewport)
        this.syncParameters()
    }

    fit = (): void => {
        const bounds = unionRectangles(
            this.snapshot.nodes.map(
                node => ({
                    ...node.position,
                    ...node.dimensions,
                }),
            ),
            36,
        )
        const size = this.frame.stage.getBoundingClientRect()

        if (
            !bounds
            || size.width <= 0
            || size.height <= 0
        )
            return

        const shellPadding = this.mode === 'node-shell' ? 100 : 0
        const availableWidth = Math.max(1, size.width - shellPadding * 2)
        const availableHeight = Math.max(1, size.height - shellPadding * 2)
        const zoom = Math.min(
            1,
            availableWidth / bounds.width,
            availableHeight / bounds.height,
        )
        this.setViewport({
            x: (size.width - bounds.width * zoom) / 2 - bounds.x * zoom,
            y: (size.height - bounds.height * zoom) / 2 - bounds.y * zoom,
            zoom,
        })
    }

    private zoom(factor: number): void {
        const viewport = this.canvas.scene.viewport
        this.setViewport({
            ...viewport,
            zoom: viewport.zoom * factor,
        })
        this.frame.report(`Zoom ${Math.round(this.canvas.scene.viewport.zoom * 100)}%`)
    }

    private replaceMedia(fail: boolean): void {
        this.failMedia = fail
        this.snapshot = {
            ...this.snapshot,
            nodes: this.snapshot.nodes.map(
                value => ({
                    ...value,
                    data: {
                        ...value.data,
                        media: value.data.media ? {
                            ...value.data.media,
                            version: String(++this.revision),
                        } : undefined,
                    },
                }),
            ),
        }
        this.publish()
    }

    private accept = (intent: CanvasIntent): void => {
        if (
            this.disposed
            || intent.sceneKey !== this.snapshot.sceneKey
        )
            return

        if (intent.kind === 'viewport') {
            this.syncParameters()
            this.frame.report(`Viewport: ${JSON.stringify(intent)}`)

            return
        }

        if (intent.kind === 'geometry') {
            const changes = new Map(
                intent.changes.map(change => [change.nodeId, change]),
            )
            this.snapshot = {
                ...this.snapshot,
                nodes: this.snapshot.nodes.map(value => {
                    const change = changes.get(value.nodeId)

                    if (!change)
                        return value

                    const updated = applyNodeGeometry(value, change).node

                    return {
                        ...updated,
                        ports: value.ports.length ? ports(updated.dimensions.width, updated.dimensions.height) : [],
                    }
                }),
            }
        } else if (intent.kind === 'delete') {
            const removed = new Set(intent.nodeIds)
            let changed = true

            while (changed) {
                changed = false

                for (const value of this.snapshot.nodes)
                    if (
                        value.parentId
                        && removed.has(value.parentId)
                        && !removed.has(value.nodeId)
                    ) {
                        removed.add(value.nodeId)
                        changed = true
                    }
            }

            this.snapshot = {
                ...this.snapshot,
                nodes: this.snapshot.nodes.filter(value => !removed.has(value.nodeId)),
                edges: this.snapshot.edges.filter(
                    edge => !intent.edgeIds.includes(edge.edgeId) && !removed.has(edge.source.nodeId) && !removed.has(edge.target.nodeId),
                ),
            }
        } else if (intent.kind === 'connect')
            this.snapshot = {
                ...this.snapshot,
                edges: [...this.snapshot.edges, {
                    edgeId: crypto.randomUUID(),
                    source: intent.source,
                    target: intent.target,
                    path: this.pathOverride ?? this.connectionSettings.lineCurve,
                    data: null,
                }],
            }
        else if (intent.kind === 'reconnect')
            this.snapshot = {
                ...this.snapshot,
                edges: this.snapshot.edges.map(
                    edge => edge.edgeId === intent.edgeId ? {
                        ...edge,
                        source: intent.source,
                        target: intent.target,
                    } : edge,
                ),
            }

        this.publish()
        this.frame.report(`${intent.kind}: ${this.snapshot.nodes.length} nodes, ${this.snapshot.edges.length} connections; revision ${this.revision}`)
    }

    private publish(): void {
        const next = {
            ...this.snapshot,
            revision: String(++this.revision),
        }

        try {
            this.canvas.setScene(next)
        } catch (error) {
            this.snapshot = this.acceptedSnapshot

            throw error
        }

        this.snapshot = next
        this.acceptedSnapshot = next
        this.syncParameters()
    }

    destroy(): void {
        this.disposed = true
        this.fitObserver?.disconnect()
        this.releaseStressMetrics?.()
        this.playbackChrome?.destroy()
        this.playbackChrome = null
        this.canvas.destroy()
        this.frame.destroy()
    }
}
