import {
    type CanvasEngineRect,
    type CanvasViewport,
    type EngineNode,
    type NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import {
    type ComponentContext,
    type NodeRegistration,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import {
    BRANCH_MARKER_NODE_TYPE,
    type BranchMarkerNodeData,
} from '../../shared/branch-tree-layout/branch-marker-node.ts'
import { BranchMarkerContent } from './branch-marker-content.ts'

// Draws the workspace branch shell and content from a prompt and an optional
// response line, without generation, conversation, model or lineage state.
export class BranchMarkerNodeView implements NodeView<BranchMarkerNodeData> {
    private readonly shell: HTMLDivElement
    private content: BranchMarkerContent | null = null
    private data: BranchMarkerNodeData | null = null

    constructor(
        node: EngineNode<BranchMarkerNodeData>,
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

    update(node: EngineNode<BranchMarkerNodeData>): void {
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
                throw new Error('Branch marker nodes do not contain prompt references')
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

// A marker's footprint is its scene rectangle. Markers move unless the canvas
// locks its content or a graph layout owns their positions.
const branchMarkerGeometry: NodeGeometryPolicy<BranchMarkerNodeData> = {
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
    resize: {
        min: {
            width: 1,
            height: 1,
        },
        preserveAspectRatio: true,
    },
    movable: true,
}

export const createBranchMarkerNodeRegistration = (): NodeRegistration<BranchMarkerNodeData> => ({
    type: BRANCH_MARKER_NODE_TYPE,
    geometry: branchMarkerGeometry,
    mount: (node, context) => new BranchMarkerNodeView(node, context),
})
