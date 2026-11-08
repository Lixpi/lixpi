import { createLibraryDiagramAppearance } from '@lixpi/canvas-components/library'
import {
    createDiagramCanvas,
    createDiagramNodeRegistration,
    type DiagramCanvasInstance,
} from '@lixpi/canvas-components/diagram'
import {
    type SceneSnapshot,
} from '@lixpi/canvas-engine/shared'
import { ExampleFrame } from './example-frame.ts'

type DiagramData = {
    title: string
    lines: string[]
    shape: 'circle' | 'rounded-rectangle'
    metric?: boolean
}

export class DiagramExample {
    readonly frame: ExampleFrame
    private readonly diagram: DiagramCanvasInstance
    private selected = ''
    private gap = 270
    private metric = true
    private middleShape: DiagramData['shape'] = 'circle'
    private revision = 0

    constructor(host: HTMLElement) {
        this.frame = new ExampleFrame(
            host,
            'The same fixed diagram surface used by the experiment workbench. Drag to pan, click to arm trackpad input, pinch to zoom, and press Escape to release. Select a node, change its shape and heading, or adjust node spacing.',
        )
        this.diagram = createDiagramCanvas({
            ariaLabel: 'Interactive fixed diagram example',
            theme: this.frame.theme,
            sceneKey: 'library-diagram',
            registerNodes: registry => registry.register(
                createDiagramNodeRegistration<DiagramData>({
                    type: 'diagram',
                    theme: this.frame.theme,
                    getContent: node => ({
                        title: node.data.title,
                        lines: node.data.lines,
                        tag: node.data.metric ? 'metric' : undefined,
                    }),
                    getAppearance: node => createLibraryDiagramAppearance(
                        this.frame.theme.value,
                        {
                            shape: node.data.shape,
                            heading: node.data.metric ? 'metric' : 'title',
                            selected: node.nodeId === this.selected,
                        },
                    ),
                    onActivate: this.select,
                }),
            ),
            onNodeClick: this.select,
            onError: this.frame.error,
        })
        this.frame.stage.append(this.diagram.el)
        this.diagram.setScene(
            this.scene(),
            {
                size: {
                    width: 820,
                    height: 380,
                },
                fitKey: 'normal',
            },
        )
        this.diagram.mount()
        this.frame.onThemeChange(() => this.update())
        this.frame.button('Refit', () => this.diagram.refit())
        this.frame.number(
            'Node spacing',
            {
                value: this.gap,
            },
            value => {
                this.gap = value
                this.update()
            },
        )
        this.frame.select(
            'Middle shape',
            this.middleShape,
            {
                circle: 'Circle',
                'rounded-rectangle': 'Rounded rectangle',
            },
            value => {
                this.middleShape = value === 'circle' ? 'circle' : 'rounded-rectangle'
                this.update()
            },
        )
        this.frame.toggle(
            'Metric heading',
            this.metric,
            value => {
                this.metric = value
                this.update()
            },
        )
        this.frame.code(
            () => [
                "import { createDiagramCanvas, createDiagramNodeRegistration, createDiagramNodeAppearance } from '@lixpi/canvas-components/diagram'",
                '',
                'const diagram = createDiagramCanvas({',
                "    sceneKey: 'embedded-diagram',",
                "    ariaLabel: 'Pipeline',",
                '    theme, // CanvasThemeSource shared by this canvas and its node registrations.',
                '    registerNodes: registry => registry.register(',
                '        createDiagramNodeRegistration({',
                "            type: 'diagram',",
                '            theme,',
                '            getContent: node => node.data,',
                '            getAppearance: node => ({',
                `                ...createDiagramNodeAppearance('${this.middleShape}', theme.value),`,
                `                heading: '${this.metric ? 'metric' : 'title'}',`,
                '            }),',
                '        }),',
                '    ),',
                '    onNodeClick: selectNode,',
                '    onError: reportError,',
                '})',
                'host.append(diagram.el)',
                `diagram.setScene(scene, { size: { width: ${250 + this.gap * 2}, height: 380 } })`,
                'diagram.mount()',
                '// Update the scene after changing node data or positions.',
                'diagram.destroy()',
            ].join('\n'),
        )
        this.frame.button('Loading', () => this.diagram.setLoading(true))
        this.frame.button('Error', () => this.diagram.setError('A simulated diagram error. Choose Recover.'))
        this.frame.button('Recover', () => {
            this.diagram.setLoading(false)
            this.diagram.setError(null)
        })
    }

    private select = (id: string): void => {
        this.selected = id
        this.update()
        this.frame.report(`Selected ${id}. Pointer and keyboard activation share the host callback.`)
    }

    private scene(): SceneSnapshot<DiagramData> {
        const gap = this.gap
        const data: DiagramData[] = [
            {
                title: 'Input',
                lines: ['Host supplies data'],
                shape: 'rounded-rectangle',
            },
            {
                title: '12.5',
                lines: ['Metric heading'],
                shape: this.middleShape,
                metric: this.metric,
            },
            {
                title: 'Output',
                lines: ['Engine owns rendering', 'Host owns the scene'],
                shape: 'rounded-rectangle',
            },
        ]

        return {
            sceneKey: 'library-diagram',
            revision: String(++this.revision),
            nodes: data.map(
                (value, index) => ({
                    nodeId: `node-${index}`,
                    type: 'diagram',
                    position: {
                        x: 30 + index * gap,
                        y: index === 1 ? 90 : 120,
                    },
                    dimensions: {
                        width: 220,
                        height: index === 1 ? 220 : 150,
                    },
                    ports: [
                        {
                            id: 'in',
                            role: 'input',
                            direction: 'left',
                            anchor: {
                                x: 0,
                                y: index === 1 ? 110 : 75,
                            },
                        },
                        {
                            id: 'out',
                            role: 'output',
                            direction: 'right',
                            anchor: {
                                x: 220,
                                y: index === 1 ? 110 : 75,
                            },
                        },
                    ],
                    data: value,
                }),
            ),
            edges: [0, 1].map(
                index => ({
                    edgeId: `edge-${index}`,
                    source: {
                        nodeId: `node-${index}`,
                        portId: 'out',
                    },
                    target: {
                        nodeId: `node-${index + 1}`,
                        portId: 'in',
                    },
                    path: this.frame.theme.value.connectors.lineCurve,
                    data: null,
                }),
            ),
        }
    }

    private update(): void {
        this.diagram.setScene(
            this.scene(),
            {
                size: {
                    width: 250 + this.gap * 2,
                    height: 380,
                },
                fitKey: String(this.gap),
            },
        )
    }

    destroy(): void {
        this.diagram.destroy()
        this.frame.destroy()
    }
}
