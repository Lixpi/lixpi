import {
    CanvasController,
    Lifetime,
    NodeRegistry,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type CanvasEnginePoint,
    type CanvasGraphEdgeKind,
    type CanvasGraphStage,
    type SceneSnapshot,
} from '@lixpi/canvas-engine/shared'
import {
    arrowRightMarkerBodyLengthFraction,
    createArrowRightMarker,
} from '@lixpi/ui-kit/svg'
import {
    createBranchMarkerEdge,
    createBranchMarkerGraphLayout,
    createBranchMarkerNode,
    type BranchMarkerNodeData,
} from '@lixpi/canvas-components/workspace/shared'
import { createBranchMarkerNodeRegistration } from '@lixpi/canvas-components/workspace/nodes'
import { createBranchMarkerConnectionPolicy } from '@lixpi/canvas-components/workspace/connectors'
import {
    applyWorkspaceCanvasTheme,
    createLixpiCanvasSettings,
    resolveLixpiCanvasTheme,
} from '@lixpi/canvas-components/workspace/settings'
import { ExampleFrame } from '../example-frame.ts'

const nodes: readonly (BranchMarkerNodeData & { id: string })[] = [
    {
        id: 'origin',
        prompt: 'Prepare the reference',
        response: 'The supplied Asset is ready.',
        role: 'origin',
    },
    {
        id: 'fork-a',
        prompt: 'Explore the first branch',
        response: 'A local candidate is ready.',
        role: 'fork',
    },
    {
        id: 'fork-b',
        prompt: 'Explore another branch',
        response: 'A second candidate is ready.',
        role: 'fork',
    },
    {
        id: 'continuation',
        prompt: 'Refine the selected candidate',
        response: 'The result retains its source relationship.',
        role: 'continuation',
    },
]

const stages: readonly CanvasGraphStage[] = [{
    trees: [{
        rootId: 'origin',
        children: {
            origin: ['fork-a', 'fork-b'],
            'fork-a': ['continuation'],
        },
    }],
}]

const edges: readonly {
    id: string
    source: string
    target: string
    kind: CanvasGraphEdgeKind
}[] = [
    {
        id: 'origin-a',
        source: 'origin',
        target: 'fork-a',
        kind: 'forward',
    },
    {
        id: 'origin-b',
        source: 'origin',
        target: 'fork-b',
        kind: 'forward',
    },
    {
        id: 'a-continuation',
        source: 'fork-a',
        target: 'continuation',
        kind: 'forward',
    },
    {
        id: 'b-continuation',
        source: 'fork-b',
        target: 'continuation',
        kind: 'relation',
    },
    {
        id: 'feedback',
        source: 'continuation',
        target: 'origin',
        kind: 'feedback',
    },
]

// Workspace branch markers on the ordinary canvas. The graph layout places
// the markers and routes relation and feedback edges; the canvas starts
// locked, fitted and inactive for page scrolling until clicked.
export class WorkspaceDiagramExample {
    private readonly lifetime = new Lifetime()
    readonly frame: ExampleFrame
    readonly canvas: CanvasController
    private readonly moved = new Map<string, CanvasEnginePoint>()
    private readonly layout = createBranchMarkerGraphLayout(stages)
    private prompt = 'Prepare the reference'
    private relations = true
    private feedback = true
    private revision = 0

    constructor(host: HTMLElement) {
        try {
            this.frame = new ExampleFrame(
                host,
                'Workspace branch markers drawn by the ordinary canvas. Auto layout places them with the tidy-tree and collision solvers and routes the relation and the feedback return around the markers. The canvas starts locked and fitted, and page scrolling passes through until you click inside. Turn Auto layout off to keep the current positions and move markers by hand on an unlocked canvas.',
            )
            this.lifetime.own(() => this.frame.destroy())
            const defaults = createLixpiCanvasSettings()
            const settings = resolveLixpiCanvasTheme(this.frame.theme.value, defaults)
            applyWorkspaceCanvasTheme(this.frame.stage, settings)
            this.canvas = new CanvasController({
                root: this.frame.stage,
                registry: new NodeRegistry().register(
                    createBranchMarkerNodeRegistration(),
                ),
                scene: this.scene(),
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                connectors: {
                    settings: settings.connector,
                    renderer: {
                        marker: createArrowRightMarker(),
                        zoomScaling: settings.connector.scaling.zoomScaling,
                    },
                    markerBodyLengthFraction: arrowRightMarkerBodyLengthFraction,
                    policy: createBranchMarkerConnectionPolicy(),
                },
                interaction: {},
                locked: true,
                autoFit: true,
                scrollCapture: 'on-activate',
                layout: this.layout,
                onNodeClick: nodeId => this.frame.report(`Clicked ${nodeId}.`),
                onIntent: intent => {
                    if (intent.kind !== 'geometry')
                        return

                    for (const change of intent.changes)
                        this.moved.set(change.nodeId, change.position)

                    this.update()
                },
                onError: this.frame.error,
            })
            this.lifetime.own(() => this.canvas.destroy())
            this.frame.onThemeChange(theme => {
                const next = resolveLixpiCanvasTheme(theme, defaults)
                applyWorkspaceCanvasTheme(this.frame.stage, next)
                this.canvas.setConnectionSettings(next.connector)
                this.update()
            })
            this.frame.attachCanvas(
                this.canvas,
                {
                    layout: {
                        canvas: this.canvas,
                        options: this.layout,
                    },
                },
            )
            this.frame.text(
                'Origin prompt',
                this.prompt,
                prompt => {
                    this.prompt = prompt
                    this.update()
                },
            )
            this.frame.toggle(
                'Relation edge',
                this.relations,
                relations => {
                    this.relations = relations
                    this.update()
                },
            )
            this.frame.toggle(
                'Feedback edge',
                this.feedback,
                feedback => {
                    this.feedback = feedback
                    this.update()
                },
            )
            this.frame.code(() => this.source())
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private scene(): SceneSnapshot {
        return {
            sceneKey: 'documentation-branch-diagram',
            revision: String(++this.revision),
            nodes: nodes.map(
                ({
                    id,
                    ...data
                }) => {
                    const node = createBranchMarkerNode(
                        id,
                        id === 'origin'
                            ? {
                                ...data,
                                prompt: this.prompt,
                            }
                            : data,
                    )

                    return {
                        ...node,
                        position: this.moved.get(id) ?? node.position,
                    }
                },
            ),
            edges: edges.filter(
                edge =>
                    (edge.kind !== 'relation' || this.relations)
                    && (edge.kind !== 'feedback' || this.feedback),
            ).map(
                edge => createBranchMarkerEdge(
                    edge.id,
                    edge.source,
                    edge.target,
                    edge.kind,
                ),
            ),
        }
    }

    private update(): void {
        if (this.canvas)
            this.canvas.setScene(
                this.scene(),
            )
    }

    private source(): string {
        return [
            "import { CanvasController, NodeRegistry } from '@lixpi/canvas-engine/frontend/runtime'",
            "import { createBranchMarkerEdge, createBranchMarkerGraphLayout, createBranchMarkerNode } from '@lixpi/canvas-components/workspace/shared'",
            "import { createBranchMarkerNodeRegistration } from '@lixpi/canvas-components/workspace/nodes'",
            "import { createBranchMarkerConnectionPolicy } from '@lixpi/canvas-components/workspace/connectors'",
            '',
            '// Node text and fan-out trees are the only inputs; the layout',
            '// computes positions, ports and connector routes.',
            'const canvas = new CanvasController({',
            '    root: host,',
            '    registry: new NodeRegistry().register(createBranchMarkerNodeRegistration()),',
            '    scene: {',
            "        sceneKey: 'branches',",
            `        revision: '${this.revision}',`,
            '        nodes: [',
            `            createBranchMarkerNode('origin', { prompt: ${JSON.stringify(this.prompt)}, role: 'origin' }),`,
            '            // ...',
            '        ],',
            '        edges: [',
            "            createBranchMarkerEdge('origin-a', 'origin', 'fork-a'),",
            ...this.relations ? ["            createBranchMarkerEdge('b-continuation', 'fork-b', 'continuation', 'relation'),"] : [],
            ...this.feedback ? ["            createBranchMarkerEdge('feedback', 'continuation', 'origin', 'feedback'),"] : [],
            '        ],',
            '    },',
            '    viewport: { x: 0, y: 0, zoom: 1 },',
            '    connectors: { settings, policy: createBranchMarkerConnectionPolicy() },',
            '    interaction: {},',
            `    locked: ${this.canvas.locked},`,
            `    autoFit: ${this.canvas.autoFit},`,
            `    scrollCapture: '${this.canvas.scrollCapture}',`,
            `    layout: ${this.canvas.layout ? 'createBranchMarkerGraphLayout(stages)' : 'false'},`,
            '    onIntent: acceptIntent,',
            '    onError: reportError,',
            '})',
        ].join('\n')
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
