import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    createWorkspaceDiagramCanvas,
    type WorkspaceDiagram,
} from '@lixpi/canvas-components/workspace/diagram'
import { ExampleFrame } from '../example-frame.ts'

const diagram: WorkspaceDiagram = {
    revision: 'fixture-diagram-1',
    nodes: [
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
    ],
    stages: [{
        trees: [{
            rootId: 'origin',
            children: {
                origin: ['fork-a', 'fork-b'],
                'fork-a': ['continuation'],
            },
        }],
    }],
    edges: [
        {
            id: 'origin-a',
            source: 'origin',
            target: 'fork-a',
        },
        {
            id: 'origin-b',
            source: 'origin',
            target: 'fork-b',
        },
        {
            id: 'a-continuation',
            source: 'fork-a',
            target: 'continuation',
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
    ],
}

export class WorkspaceDiagramExample {
    private readonly lifetime = new Lifetime()
    readonly frame: ExampleFrame
    private readonly canvas: ReturnType<typeof createWorkspaceDiagramCanvas>
    private prompt = 'Prepare the reference'
    private relations = true
    private feedback = true
    private state: 'ready' | 'loading' | 'error' = 'ready'
    private revision = 0

    constructor(host: HTMLElement) {
        try {
            this.frame = new ExampleFrame(
                host,
                'WorkspaceDiagramCanvas renders semantic branch graphs using the workspace marker, connector policy and native layout. The host supplies node text, fan-out trees, relations and feedback edges. setDiagram recalculates geometry when those inputs change.',
            )
            this.lifetime.own(() => this.frame.destroy())
            this.canvas = createWorkspaceDiagramCanvas({
                ariaLabel: 'Workspace branch diagram',
                sceneKey: 'component-library-workspace-diagram',
                theme: this.frame.theme,
                onError: this.frame.error,
            })
            this.lifetime.own(() => this.canvas.destroy())
            this.frame.stage.append(this.canvas.el)
            this.update()
            this.canvas.mount()
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
            this.frame.select(
                'Loading state',
                this.state,
                {
                    ready: 'Ready',
                    loading: 'Loading',
                    error: 'Error',
                },
                state => this.status(state as typeof this.state),
            )
            this.frame.button('Fit diagram', () => this.canvas.refit())
            this.frame.code(
                () => ["import {", "    createWorkspaceDiagramCanvas,", "    type WorkspaceDiagram,", "    type WorkspaceDiagramCanvasOptions,", "} from '@lixpi/canvas-components/workspace/diagram'", "", "// The host supplies semantic topology; the package computes marker geometry.", "// options.theme supplies the same CanvasThemeSource as the surrounding components.", "const mount=(", "    host: HTMLElement,", "    graph: WorkspaceDiagram,", "    options: WorkspaceDiagramCanvasOptions,", ") => {", "    const canvas=createWorkspaceDiagramCanvas({ ...options, theme: options.theme })", "    host.append(canvas.el)", "    canvas.setDiagram({", "        ...graph,", `        revision: '${  String(
                    (this.revision),
                )  }',`, "        nodes: graph.nodes.map(node => node.id==='origin'", `            ? { ...node, prompt: ${  String(
                    (JSON.stringify(this.prompt)),
                )  } }`, "            :node),", "        edges: graph.edges.filter(edge =>", `            (edge.kind!=='relation'||${  String(
                    (this.relations),
                )  })`, `            &&(edge.kind!=='feedback'||${  String((this.feedback))  }),`, "        ),", "    })", `    canvas.setLoading(${  String(
                    (this.state === 'loading'),
                )  })`, `    canvas.setError(${  String((this.state === 'error' ? "'Simulated diagram loading error.'" : 'null'))  })`, "    canvas.mount()", "    return () => canvas.destroy()", "}"].join('\n'),
            )
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private update(): void {
        this.revision += 1
        this.canvas.setDiagram({
            ...diagram,
            revision: String(this.revision),
            nodes: diagram.nodes.map(
                node => node.id === 'origin'
                    ? {
                        ...node,
                        prompt: this.prompt,
                    }
                    : node,
            ),
            edges: diagram.edges.filter(
                edge =>
                    (edge.kind !== 'relation' || this.relations)
                    && (edge.kind !== 'feedback' || this.feedback),
            ),
        })
    }

    private status(state: typeof this.state): void {
        this.state = state
        this.canvas.setLoading(state === 'loading')
        this.canvas.setError(state === 'error' ? 'Simulated diagram loading error.' : null)
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
