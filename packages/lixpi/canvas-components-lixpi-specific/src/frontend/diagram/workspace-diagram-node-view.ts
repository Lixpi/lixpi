import {
    type CanvasEngineRect,
    type CanvasViewport,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    type ComponentContext,
    type NodeRegistration,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import { createFixedDiagramNodeGeometry } from '@lixpi/canvas-components/diagram'
import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import {
    WORKSPACE_DIAGRAM_NODE_TYPE,
    type WorkspaceDiagramNode,
} from '../../shared/diagram/workspace-diagram.ts'
import { BranchMarkerContent } from '../nodes/branch-marker-content.ts'

// Presentation only: native shell/content receive labels, without fabricated
// generation, conversation, model or persisted lineage state.
export class WorkspaceDiagramNodeView implements NodeView<WorkspaceDiagramNode> {
    private readonly shell: HTMLDivElement
    private content: BranchMarkerContent | null = null
    private data: WorkspaceDiagramNode | null = null

    constructor(
        node: EngineNode<WorkspaceDiagramNode>,
        context: ComponentContext,
    ) {
        const html = createDocumentHtml(context.contentRoot.ownerDocument)
        this.shell = html`<div></div>` as HTMLDivElement
        context.contentRoot.append(this.shell)

        try {
            this.update(node)
            this.setGeometry(
                {
                    ...node.position,
                    ...node.dimensions,
                },
                {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
            )
        } catch (error) {
            this.destroy()

            throw error
        }
    }

    update(node: EngineNode<WorkspaceDiagramNode>): void {
        const data = node.data
        const role = data.role === 'continuation' ? 'line' : data.role
        this.shell.className = `workspace-branch-${role}-node`

        if (
            this.data?.prompt === data.prompt
            && this.data?.response === data.response
            && this.data?.role === data.role
        )
            return

        const content = new BranchMarkerContent({
            document: this.shell.ownerDocument,
            label: data.prompt,
            headerHeight: node.dimensions.height,
            promptParts: [{
                type: 'text',
                text: data.prompt,
            }],
            renderReference: () => {
                throw new Error('Workspace diagram labels do not contain prompt references')
            },
            reasoningModel: null,
            mediaModels: [],
            modelSummary: '',
            responseText: data.response ?? '',
            responsePhase: '',
            responseIsReceiving: false,
            showResponseLine: Boolean(data.response),
            pending: false,
            active: false,
            tooltipHideDelayMs: 0,
        })
        this.content?.destroy()
        this.content = content
        this.data = data
        this.shell.append(content.element)
    }

    setGeometry(
        bounds: CanvasEngineRect,
        _viewport: CanvasViewport,
    ): void {
        applyStyle(
            this.shell,
            {
                width: `${bounds.width}px`,
                height: `${bounds.height}px`,
            },
        )
    }

    setSelected(selected: boolean): void {
        this.shell.classList.toggle('is-selected', selected)
    }

    setVisible(visible: boolean): void {
        this.shell.hidden = !visible
    }

    destroy(): void {
        this.content?.destroy()
        this.content = null
        this.shell.remove()
    }
}

export const createWorkspaceDiagramNodeRegistration = (): NodeRegistration<WorkspaceDiagramNode> => ({
    type: WORKSPACE_DIAGRAM_NODE_TYPE,
    geometry: createFixedDiagramNodeGeometry<WorkspaceDiagramNode>(),
    mount: (node, context) => new WorkspaceDiagramNodeView(node, context),
})
