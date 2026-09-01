import type { CanvasNode } from '@lixpi/constants'
import { applyStyle } from '@lixpi/ui-primitives/dom'
import type {
    CanvasEngineRect,
    CanvasViewport,
    EngineNode,
    NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import type { MediaDescriptor } from '@lixpi/canvas-engine/frontend/media'
import {
    Lifetime,
    NodeRegistry,
    type ComponentContext,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    isWorkspaceMediaNode,
    type WorkspaceMediaNodes,
    type WorkspaceMediaNodeData,
} from '../media/workspace-media-nodes.ts'

export type WorkspaceRegisteredNodeData = {
    node: CanvasNode
    media: MediaDescriptor | null
    framePending: boolean
}

export type WorkspaceDomNodeView = {
    element: HTMLElement
    update: (node: CanvasNode) => void
    setGeometry?: (localBounds: CanvasEngineRect, viewport: CanvasViewport) => void
    setSelected?: (selected: boolean) => void
    setVisible?: (visible: boolean) => void
    destroy: () => void
}

export type WorkspaceNodeRegistryOptions = {
    media: Pick<WorkspaceMediaNodes, 'registry' | 'project'>
    geometry: (type: CanvasNode['type']) => NodeGeometryPolicy<WorkspaceRegisteredNodeData>
    mountDom: (node: CanvasNode, context: ComponentContext) => WorkspaceDomNodeView
}

const nodeTypes = ['document', 'mediaDocument', 'image', 'video', 'audio', 'operationStatus', 'branchOrigin', 'branchFork', 'branchLine', 'capabilityArtifact'] as const satisfies readonly CanvasNode['type'][]

export function isWorkspaceNodeType(type: string): type is CanvasNode['type'] {
    return nodeTypes.some(candidate => candidate === type)
}

// A single registration combines a node's media surface and DOM content. The
// scene positions their shared content root; DOM children use local bounds.
export class WorkspaceNodeRegistry {
    readonly registry = new NodeRegistry()

    constructor(private readonly options: WorkspaceNodeRegistryOptions) {
        for (const type of nodeTypes) {
            this.registry.register<WorkspaceRegisteredNodeData>({
                type,
                geometry: options.geometry(type),
                mount: (node, context) => new WorkspaceRegisteredNodeView(node, context, options),
            })
        }
    }

    project(node: CanvasNode, framePending = false, forceOriginal = false): EngineNode<WorkspaceRegisteredNodeData> {
        if (isWorkspaceMediaNode(node)) return this.options.media.project(node, framePending, forceOriginal)
        return {
            nodeId: node.nodeId,
            type: node.type,
            parentId: node.parentId,
            position: node.position,
            dimensions: node.dimensions,
            ports: [],
            data: { node, media: null, framePending: false },
        }
    }
}

class WorkspaceRegisteredNodeView implements NodeView<WorkspaceRegisteredNodeData> {
    private readonly lifetime = new Lifetime()
    private readonly dom: WorkspaceDomNodeView
    private readonly media: NodeView<WorkspaceMediaNodeData> | undefined
    private node: CanvasNode

    constructor(node: EngineNode<WorkspaceRegisteredNodeData>, context: ComponentContext, options: WorkspaceNodeRegistryOptions) {
        this.node = node.data.node
        try {
            if (isWorkspaceMediaNode(this.node)) {
                const registration = options.media.registry.get(node.type)
                if (!registration) throw new Error(`Missing workspace media registration: ${node.type}`)
                this.media = registration.mount(node, context) as NodeView<WorkspaceMediaNodeData>
                this.lifetime.own(() => this.media!.destroy())
            }
            this.dom = options.mountDom(this.node, context)
            this.lifetime.own(() => this.dom.element.remove())
            this.lifetime.own(() => this.dom.destroy())
            context.contentRoot.appendChild(this.dom.element)
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }

    update(node: EngineNode<WorkspaceRegisteredNodeData>): void {
        if (this.lifetime.signal.aborted) return
        this.media?.update(node as EngineNode<WorkspaceMediaNodeData>)
        if (this.node !== node.data.node) {
            this.node = node.data.node
            this.dom.update(this.node)
        }
    }

    setGeometry(bounds: CanvasEngineRect, viewport: CanvasViewport): void {
        if (this.lifetime.signal.aborted) return
        this.media?.setGeometry(bounds, viewport)
        const localBounds = { x: 0, y: 0, width: bounds.width, height: bounds.height }
        applyStyle(this.dom.element, { left: '0px', top: '0px', width: `${bounds.width}px`, height: `${bounds.height}px` })
        this.dom.setGeometry?.(localBounds, viewport)
    }

    setSelected(selected: boolean): void {
        if (this.lifetime.signal.aborted) return
        this.media?.setSelected(selected)
        this.dom.element.classList.toggle('is-selected', selected)
        this.dom.setSelected?.(selected)
    }

    setVisible(visible: boolean): void {
        if (this.lifetime.signal.aborted) return
        this.media?.setVisible(visible)
        this.dom.setVisible?.(visible)
    }

    async prefetch(): Promise<void> {
        if (!this.lifetime.signal.aborted) await this.media?.prefetch?.()
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
