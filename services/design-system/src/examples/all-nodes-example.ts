import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { workspaceCanvasNodeTypes } from '../catalog/nodes.ts'
import { EngineExample } from './engine-example.ts'
import {
    type ExampleFrame,
} from './example-frame.ts'
import { FullWorkspaceExample } from './workspace/canvas-examples.ts'
import { WorkspaceDiagramExample } from './workspace/diagram-example.ts'

// Each composition keeps its registration and host ports. All surfaces share
// the library theme, and each owns its viewport and resource lifetime.
export class AllNodesExample {
    readonly frames: readonly ExampleFrame[]
    private readonly lifetime = new Lifetime()

    constructor(host: HTMLElement) {
        const html = createDocumentHtml(host.ownerDocument)
        const basicHost = html`<div className="canvas-all-nodes-surface"></div>` as HTMLDivElement
        const workspaceHost = html`<div className="canvas-all-nodes-surface"></div>` as HTMLDivElement
        const diagramHost = html`<div className="canvas-all-nodes-surface canvas-all-nodes-diagram"></div>` as HTMLDivElement
        const root = html`
            <div className="canvas-all-nodes">
                <section aria-label="Basic nodes">
                    <h2>Basic nodes</h2>
                    ${basicHost}
                </section>
                <section aria-label="Composite nodes">
                    <h2>Composite nodes</h2>
                    ${workspaceHost}
                </section>
                <section aria-label="Diagram branches">
                    <h2>Diagram branches</h2>
                    ${diagramHost}
                </section>
            </div>
        ` as HTMLDivElement
        host.append(root)
        this.lifetime.own(() => root.remove())

        try {
            const basic = new EngineExample(basicHost, 'nodes-all-basic')
            this.lifetime.own(() => basic.destroy())
            const workspace = new FullWorkspaceExample(
                workspaceHost,
                {
                    fitOnMount: true,
                    workspaceControls: false,
                    nodeTypes: workspaceCanvasNodeTypes,
                },
            )
            this.lifetime.own(() => workspace.destroy())
            const diagram = new WorkspaceDiagramExample(diagramHost)
            this.lifetime.own(() => diagram.destroy())
            this.frames = [basic.frame, workspace.frame, diagram.frame]

            for (const [index, label] of ['Basic nodes', 'Composite nodes', 'Diagram branches'].entries()) {
                const title = html`<h3 className="canvas-all-nodes-parameter-title">${label}</h3>` as HTMLHeadingElement
                this.frames[index].inspector.prepend(title)
            }
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
