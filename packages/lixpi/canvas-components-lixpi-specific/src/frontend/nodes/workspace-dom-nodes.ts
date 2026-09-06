import {
    type CanvasNode,
    type DocumentCanvasNode,
    type CapabilityArtifactCanvasNode,
    type OperationStatusCanvasNode,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
} from '@lixpi/constants'
import {
    type WorkspaceNodeShells,
} from './workspace-node-shells.ts'
import {
    type WorkspaceDomNodeView,
} from './workspace-node-registry.ts'

type BranchMarker = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
export type WorkspaceDomNodesOptions = {
    shells: WorkspaceNodeShells
    document: (node: DocumentCanvasNode) => HTMLElement
    capability: (node: CapabilityArtifactCanvasNode) => HTMLElement
    operation: (node: OperationStatusCanvasNode) => HTMLElement
    branch: (node: BranchMarker) => HTMLElement
    updateBranch: (
        node: BranchMarker,
        element: HTMLElement,
    ) => void
}

// DOM factories supply content; the scene owns insertion, geometry and removal.
// Retaining document and Capability views keeps their editor leases alive.
export class WorkspaceDomNodes {
    constructor(private readonly options: WorkspaceDomNodesOptions) {}

    mount(node: CanvasNode): WorkspaceDomNodeView {
        return new WorkspaceDomNode(node, this.options)
    }
}

class WorkspaceDomNode implements WorkspaceDomNodeView {
    element: HTMLElement
    private destroyed = false

    constructor(
        private node: CanvasNode,
        private readonly options: WorkspaceDomNodesOptions,
    ) {
        try {
            this.element = this.create(node)
        } catch (error) {
            options.shells.remove(node.nodeId)

            throw error
        }
    }

    private create(node: CanvasNode): HTMLElement {
        if (node.type === 'document')
            return this.options.document(node)

        if (node.type === 'capabilityArtifact')
            return this.options.capability(node)

        if (node.type === 'operationStatus')
            return this.options.operation(node)

        if (
            node.type === 'branchOrigin'
            || node.type === 'branchFork'
            || node.type === 'branchLine'
        )
            return this.options.branch(node)

        return this.options.shells.createMedia(node)
    }

    update(node: CanvasNode): void {
        if (this.destroyed)
            return

        const previous = this.node
        this.node = node

        if (
            node.type === 'branchOrigin'
            || node.type === 'branchFork'
            || node.type === 'branchLine'
        )
            this.options.updateBranch(node, this.element)
        else if (this.needsReplacement(previous, node))
            this.element = this.options.shells.replace(node.nodeId, () => this.create(node))
        else if ('assetId' in node)
            this.element.dataset.assetId = node.assetId
    }

    private needsReplacement(
        previous: CanvasNode,
        node: CanvasNode,
    ): boolean {
        if (
            node.type === 'document'
            || node.type === 'capabilityArtifact'
        )
            return !('assetId' in previous) || previous.assetId !== node.assetId

        if (node.type !== 'operationStatus')
            return false

        const {
            position: _position,
            dimensions: _dimensions,
            parentId: _parentId,
            ...content
        } = node
        const {
            position: _previousPosition,
            dimensions: _previousDimensions,
            parentId: _previousParentId,
            ...previousContent
        } = previous

        return JSON.stringify(content) !== JSON.stringify(previousContent)
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.options.shells.remove(this.node.nodeId)
    }
}
