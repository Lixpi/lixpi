import {
    type CanvasEngineRect,
    type CanvasViewport,
    type Dispose,
    type EngineNode,
} from '../../shared/index.ts'
import {
    type ComponentContext,
    type NodeRegistry,
    type NodeView,
} from './node-registry.ts'

export type NodePresentation = {
    worldBounds: CanvasEngineRect
    viewport: CanvasViewport
    selected: boolean
    visible: boolean
}

export type NodeMountScope = {
    context: ComponentContext
    destroy: Dispose
}
export type NodeViewsOptions = {
    registry: NodeRegistry
    createScope: (node: EngineNode) => NodeMountScope
    mountUnknown: (
        node: EngineNode,
        context: ComponentContext,
    ) => NodeView
    onError: (
        error: unknown,
        nodeId: string,
    ) => void
}

type MountedNode = {
    type: string
    view: NodeView
    scope: NodeMountScope
}
type SyncInput = {
    sceneKey: string
    nodes: readonly EngineNode[]
    presentation: (node: EngineNode) => NodePresentation
}

// Coordinates component lifetimes; scene geometry and user interaction remain
// the controller's responsibility. Images use this path like any other type.
export class NodeViews {
    private readonly mounted = new Map<string, MountedNode>()
    private sceneKey: string | null = null
    private syncing = false
    private next: SyncInput | null = null
    private destroyed = false

    constructor(private readonly options: NodeViewsOptions) {}

    sync(input: SyncInput): void {
        if (this.destroyed)
            return

        const ids = new Set<string>()

        for (const node of input.nodes) {
            if (ids.has(node.nodeId))
                throw new Error(`Duplicate node ID: ${node.nodeId}`)

            ids.add(node.nodeId)
        }

        this.next = input

        if (this.syncing)
            return

        this.syncing = true

        try {
            while (
                this.next
                && !this.destroyed
            ) {
                const next = this.next
                this.next = null
                this.reconcile(next)
            }
        } finally {
            this.syncing = false
        }
    }

    private reconcile(input: SyncInput): void {
        if (input.sceneKey !== this.sceneKey) {
            this.clear()
            this.sceneKey = input.sceneKey
        }

        const nodesById = new Map(
            input.nodes.map(node => [node.nodeId, node]),
        )

        for (const [id, entry] of this.mounted) {
            const node = nodesById.get(id)

            if (
                !node
                || node.type !== entry.type
            )
                this.remove(id)
        }

        for (const node of input.nodes) {
            if (this.destroyed)
                return

            let entry = this.mounted.get(node.nodeId)

            try {
                if (!entry) {
                    entry = this.mount(node)

                    if (!entry)
                        continue
                } else
                    entry.view.update(node)

                if (!this.destroyed)
                    this.present(
                        node.nodeId,
                        input.presentation(node),
                    )
            } catch (error) {
                this.remove(node.nodeId)
                this.options.onError(error, node.nodeId)
            }
        }
    }

    private mount(node: EngineNode): MountedNode | undefined {
        const scope = this.options.createScope(node)
        let view: NodeView | undefined
        let mounted = false

        try {
            if (this.destroyed)
                return undefined

            scope.context.signal.throwIfAborted()
            const registration = this.options.registry.get(node.type)
            view = registration ? registration.mount(node, scope.context) : this.options.mountUnknown(node, scope.context)

            if (
                this.destroyed
                || scope.context.signal.aborted
            )
                return undefined

            const entry = {
                type: node.type,
                view,
                scope,
            }
            this.mounted.set(node.nodeId, entry)
            mounted = true

            return entry
        } finally {
            if (!mounted) {
                try {
                    view?.destroy()
                } finally {
                    scope.destroy()
                }
            }
        }
    }

    present(
        nodeId: string,
        presentation: NodePresentation,
    ): void {
        const view = this.mounted.get(nodeId)?.view

        if (
            !view
            || this.destroyed
        )
            return

        view.setGeometry(presentation.worldBounds, presentation.viewport)

        if (
            this.destroyed
            || this.mounted.get(nodeId)?.view !== view
        )
            return

        view.setSelected(presentation.selected)

        if (
            !this.destroyed
            && this.mounted.get(nodeId)?.view === view
        )
            view.setVisible(presentation.visible)
    }

    get(nodeId: string): NodeView | undefined {
        return this.mounted.get(nodeId)?.view
    }

    remove(nodeId: string): void {
        const entry = this.mounted.get(nodeId)

        if (!entry)
            return

        this.mounted.delete(nodeId)

        try {
            try {
                entry.view.destroy()
            } finally {
                entry.scope.destroy()
            }
        } catch (error) {
            this.options.onError(error, nodeId)
        }
    }

    private clear(): void {
        for (const id of Array.from(
            this.mounted.keys(),
        ))
            this.remove(id)
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.next = null
        this.clear()
    }
}
