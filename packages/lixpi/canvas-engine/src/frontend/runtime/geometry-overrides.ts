import {
    assertCanvasBounds,
    computeWorldPosition,
    type CanvasEnginePoint,
    type CanvasEngineSize,
    type CanvasEngineRect,
    type CanvasGeometryNode,
    type CanvasPositionedNode,
} from '../../shared/index.ts'

export type NodeGeometryOverride = {
    position?: CanvasEnginePoint
    dimensions?: CanvasEngineSize
}

export class GeometryOverrideScope {
    private readonly values = new Map<string, NodeGeometryOverride>()
    private destroyed = false

    constructor(
        readonly priority: number,
        private readonly release: () => void,
    ) {}

    set(
        nodeId: string,
        value: NodeGeometryOverride,
    ): void {
        if (this.destroyed)
            return

        assertCanvasBounds(
            {
                x: value.position?.x ?? 0,
                y: value.position?.y ?? 0,
                width: value.dimensions?.width ?? 0,
                height: value.dimensions?.height ?? 0,
            },
            nodeId,
        )
        this.values.set(
            nodeId,
            {
                ...(value.position ? { position: { ...value.position } } : {}),
                ...(value.dimensions ? { dimensions: { ...value.dimensions } } : {}),
            },
        )
    }

    get(nodeId: string): NodeGeometryOverride | undefined {
        const value = this.values.get(nodeId)

        return value ? structuredClone(value) : undefined
    }

    delete(nodeId: string): void {
        this.values.delete(nodeId)
    }
    clear(): void {
        this.values.clear()
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.values.clear()
        this.release()
    }
}

export class GeometryOverrides {
    private readonly scopes = new Set<GeometryOverrideScope>()
    private destroyed = false

    createScope(priority = 0): GeometryOverrideScope {
        if (this.destroyed)
            throw new Error('Geometry overrides are disposed')

        if (!Number.isFinite(priority))
            throw new Error('Geometry override priority must be finite')

        const scope = new GeometryOverrideScope(priority, () => this.scopes.delete(scope))
        this.scopes.add(scope)

        return scope
    }

    get(
        nodeId: string,
        except?: GeometryOverrideScope,
    ): NodeGeometryOverride | undefined {
        let resolved: NodeGeometryOverride | undefined

        for (const scope of Array.from(this.scopes).sort((a, b) => a.priority - b.priority)) {
            if (scope === except)
                continue

            const value = scope.get(nodeId)

            if (value)
                resolved = {
                    ...resolved,
                    ...value,
                }
        }

        return resolved
    }

    worldPosition<Node extends CanvasPositionedNode>(
        node: Node,
        nodes: ReadonlyMap<string, Node>,
    ): CanvasEnginePoint {
        return computeWorldPosition(
            node,
            nodes,
            id => this.get(id)?.position,
        )
    }

    worldBounds<Node extends CanvasGeometryNode>(
        node: Node,
        nodes: ReadonlyMap<string, Node>,
    ): CanvasEngineRect {
        return {
            ...this.worldPosition(node, nodes),
            ...(this.get(node.nodeId)?.dimensions ?? node.dimensions),
        }
    }

    // A scene switch expires old writers, including delayed gesture callbacks.
    clear(): void {
        for (const scope of Array.from(this.scopes))
            scope.destroy()
    }

    destroy(): void {
        this.destroyed = true
        this.clear()
    }
}
