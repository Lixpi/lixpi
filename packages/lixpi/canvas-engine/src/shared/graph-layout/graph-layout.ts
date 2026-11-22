import {
    unionRectangles,
    type CanvasEnginePoint,
    type CanvasEngineRect,
    type CanvasEngineSize,
} from '../geometry/index.ts'
import {
    type CanvasPort,
    type EngineNode,
    type SceneSnapshot,
} from '../scene/types.ts'
import {
    layoutTree,
    type TreeLayoutNode,
} from '../tree-layout/layout-tree.ts'
import { resolveCollisions } from '../collision/resolve-collisions.ts'
import {
    CanvasGraphRouting,
    type CanvasGraphRoutedEdge,
} from './graph-routing.ts'
import {
    type CanvasGraphLayoutOptions,
    type CanvasGraphSpacing,
    type CanvasGraphStage,
    type CanvasGraphTree,
} from './types.ts'

export type CanvasGraphLayout<NodeData = unknown, EdgeData = unknown> = {
    scene: SceneSnapshot<NodeData, EdgeData>
    // Nodes, ports and route points, padded by the node gap.
    bounds: CanvasEngineRect
}

type MeasuredGroup = {
    id: string
    positions: ReadonlyMap<string, CanvasEnginePoint>
    bounds: CanvasEngineRect
}

export const defaultCanvasGraphSpacing: CanvasGraphSpacing = {
    nodeGap: 64,
    siblingGap: 160,
    collisionIterations: 50,
    overlapThreshold: 0,
}

// Centered left, right, top and bottom ports, the ports a graph layout assigns.
export const createCanvasSidePorts = (size: CanvasEngineSize): CanvasPort[] => [
    {
        id: 'left',
        role: 'both',
        direction: 'left',
        anchor: {
            x: 0,
            y: size.height / 2,
        },
    },
    {
        id: 'right',
        role: 'both',
        direction: 'right',
        anchor: {
            x: size.width,
            y: size.height / 2,
        },
    },
    {
        id: 'top',
        role: 'both',
        direction: 'top',
        anchor: {
            x: size.width / 2,
            y: 0,
        },
    },
    {
        id: 'bottom',
        role: 'both',
        direction: 'bottom',
        anchor: {
            x: size.width / 2,
            y: size.height,
        },
    },
]

// Without supplied stages, every node that no forward edge enters roots a tree,
// and each node joins the first tree that reaches it.
export const inferCanvasGraphStages = (
    nodeIds: readonly string[],
    forward: ReadonlyMap<string, readonly string[]>,
): CanvasGraphStage[] => {
    const entered = new Set(
        [...forward.values()].flat(),
    )
    const assigned = new Set<string>()
    const trees: CanvasGraphTree[] = []
    const grow = (rootId: string): void => {
        const children: Record<string, string[]> = {}
        const visit = (id: string): void => {
            assigned.add(id)

            for (const childId of forward.get(id) ?? []) {
                if (assigned.has(childId))
                    continue

                children[id] = [...(children[id] ?? []), childId]
                visit(childId)
            }
        }
        visit(rootId)
        trees.push({
            rootId,
            children,
        })
    }

    for (const id of nodeIds) {
        if (!entered.has(id))
            grow(id)
    }

    for (const id of nodeIds) {
        if (!assigned.has(id))
            grow(id)
    }

    return [{ trees }]
}

class CanvasGraphLayoutPlan<NodeData, EdgeData> {
    private readonly spacing: CanvasGraphSpacing
    private readonly dimensions = new Map<string, CanvasEngineSize>()
    private readonly forward = new Map<string, string[]>()
    private readonly edges: CanvasGraphRoutedEdge<EdgeData>[]
    private readonly assigned = new Set<string>()

    constructor(
        private readonly scene: SceneSnapshot<NodeData, EdgeData>,
        private readonly options: CanvasGraphLayoutOptions<EdgeData>,
    ) {
        this.spacing = {
            ...defaultCanvasGraphSpacing,
            ...options.spacing,
        }

        if (
            !Number.isFinite(this.spacing.nodeGap)
            || !Number.isFinite(this.spacing.siblingGap)
            || this.spacing.nodeGap < 0
            || this.spacing.siblingGap < 0
        )
            throw new Error('Graph layout spacing must be finite and nonnegative')

        for (const node of scene.nodes) {
            if (node.parentId)
                throw new Error('Graph layout places top-level nodes only')

            this.dimensions.set(node.nodeId, node.dimensions)
        }

        this.edges = scene.edges.map(
            edge => ({
                edge,
                kind: options.edgeKind?.(edge) ?? 'forward',
            }),
        )

        for (const {
            edge,
            kind,
        } of this.edges) {
            if (
                !this.dimensions.has(edge.source.nodeId)
                || !this.dimensions.has(edge.target.nodeId)
            )
                throw new Error('Graph layout edges must reference existing nodes')

            if (kind === 'forward')
                this.forward.set(edge.source.nodeId, [...(this.forward.get(edge.source.nodeId) ?? []), edge.target.nodeId])
        }
    }

    layout(): CanvasGraphLayout<NodeData, EdgeData> {
        const gap = this.spacing.nodeGap

        if (!this.scene.nodes.length)
            return {
                scene: this.scene,
                bounds: {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                },
            }

        const stages = this.options.stages ?? inferCanvasGraphStages(
            this.scene.nodes.map(node => node.nodeId),
            this.forward,
        )

        if (!stages.length)
            throw new Error('Graph layout requires at least one stage')

        const positions = this.compose(
            stages.map(stage => this.measureStage(stage)),
            'columns',
        )

        if (this.assigned.size !== this.dimensions.size)
            throw new Error('Every graph layout node must belong to a stage')

        const nodes: EngineNode<NodeData>[] = this.scene.nodes.map(
            node => ({
                ...node,
                position: { ...positions.get(node.nodeId)! },
                ports: createCanvasSidePorts(node.dimensions),
            }),
        )
        const edges = new CanvasGraphRouting(
            nodes,
            this.edges,
            gap,
        ).route()
        const content = unionRectangles([
            ...nodes.map(
                node => ({
                    ...node.position,
                    ...node.dimensions,
                }),
            ),
            ...edges.flatMap(edge => edge.bendPoints ?? []).map(
                point => ({
                    ...point,
                    width: 0,
                    height: 0,
                }),
            ),
        ])!
        const offset = {
            x: gap - content.x,
            y: gap - content.y,
        }

        return {
            scene: {
                ...this.scene,
                nodes: nodes.map(
                    node => ({
                        ...node,
                        position: {
                            x: node.position.x + offset.x,
                            y: node.position.y + offset.y,
                        },
                    }),
                ),
                edges: edges.map(
                    edge => edge.bendPoints
                        ? {
                            ...edge,
                            bendPoints: edge.bendPoints.map(
                                point => ({
                                    x: point.x + offset.x,
                                    y: point.y + offset.y,
                                }),
                            ),
                        }
                        : edge,
                ),
            },
            bounds: {
                x: 0,
                y: 0,
                width: content.width + gap * 2,
                height: content.height + gap * 2,
            },
        }
    }

    private rectanglesAt(positions: ReadonlyMap<string, CanvasEnginePoint>): CanvasEngineRect[] {
        return [...positions].map(
            ([id, position]) => ({
                ...position,
                ...this.dimensions.get(id)!,
            }),
        )
    }

    private measureTree(tree: CanvasGraphTree): MeasuredGroup {
        const treeNodes: TreeLayoutNode[] = []
        const members = new Set<string>()
        const visit = (
            id: string,
            parentId: string | null,
        ): void => {
            const size = this.dimensions.get(id)

            if (!size)
                throw new Error('Graph layout trees must reference existing nodes')

            if (this.assigned.has(id))
                throw new Error('Each graph layout node must occur in exactly one tree')

            if (
                parentId
                && !this.forward.get(parentId)?.includes(id)
            )
                throw new Error('Graph layout tree relationships must be forward edges')

            this.assigned.add(id)
            members.add(id)
            treeNodes.push({
                id,
                parentId,
                ...size,
            })

            for (const childId of tree.children?.[id] ?? [])
                visit(childId, id)
        }
        visit(tree.rootId, null)

        for (const parentId of Object.keys(tree.children ?? {})) {
            if (!members.has(parentId))
                throw new Error('Graph layout tree contains an unreachable parent')
        }

        const result = layoutTree(
            treeNodes,
            {
                depthGap: this.spacing.nodeGap * 2,
                siblingGap: this.spacing.siblingGap,
            },
        )

        return {
            id: tree.rootId,
            positions: result.positions,
            bounds: unionRectangles(
                this.rectanglesAt(result.positions),
            )!,
        }
    }

    private measureStage(stage: CanvasGraphStage): MeasuredGroup {
        if (!stage.trees.length)
            throw new Error('Graph layout stages require at least one tree')

        const trees = stage.trees.map(tree => this.measureTree(tree))
        const positions = this.compose(trees, 'rows')
        let bounds = unionRectangles(
            this.rectanglesAt(positions),
        )!

        if (stage.alignNodeId !== undefined) {
            const anchor = positions.get(stage.alignNodeId)

            if (!anchor)
                throw new Error('Graph layout stage alignment must reference a node in that stage')

            const centerY = anchor.y + this.dimensions.get(stage.alignNodeId)!.height / 2
            const halfHeight = Math.max(centerY - bounds.y, bounds.y + bounds.height - centerY)

            // A symmetric envelope lets the tree and collision solvers align
            // a semantic node while preserving the stage as a rigid group.
            bounds = {
                ...bounds,
                y: centerY - halfHeight,
                height: halfHeight * 2,
            }
        }

        return {
            id: trees[0].id,
            positions,
            bounds,
        }
    }

    // The tree algorithm places invisible group envelopes; the collision
    // resolver translates each envelope rigidly, preserving its tree.
    private compose(
        groups: readonly MeasuredGroup[],
        direction: 'rows' | 'columns',
    ): Map<string, CanvasEnginePoint> {
        const gap = this.spacing.nodeGap
        const virtualRoot = {
            id: '',
            parentId: null,
            width: 0,
            height: 0,
        }
        const nodes: TreeLayoutNode[] = groups.map(
            (group, index) => ({
                id: group.id,
                parentId: direction === 'rows'
                    ? ''
                    : index
                        ? groups[index - 1].id
                        : null,
                width: group.bounds.width,
                height: group.bounds.height,
            }),
        )
        const layout = layoutTree(
            direction === 'rows' ? [virtualRoot, ...nodes] : nodes,
            {
                depthGap: direction === 'rows' ? 0 : gap * 2,
                siblingGap: this.spacing.siblingGap,
            },
        )
        const collisions = resolveCollisions(
            groups.map(
                group => ({
                    id: group.id,
                    ...layout.positions.get(group.id)!,
                    width: group.bounds.width,
                    height: group.bounds.height,
                    margin: gap,
                    overlapThreshold: this.spacing.overlapThreshold,
                }),
            ),
            {
                iterations: this.spacing.collisionIterations,
                margin: gap,
                overlapThreshold: this.spacing.overlapThreshold,
            },
        )
        const positions = new Map<string, CanvasEnginePoint>()

        for (const group of groups) {
            const groupPosition = collisions.nodes.get(group.id) ?? layout.positions.get(group.id)!

            for (const [id, position] of group.positions) {
                positions.set(
                    id,
                    {
                        x: groupPosition.x + position.x - group.bounds.x,
                        y: groupPosition.y + position.y - group.bounds.y,
                    },
                )
            }
        }

        return positions
    }
}

// Places nodes with the tidy-tree and collision solvers, then routes forward,
// relation and feedback edges. Node sizes come from the scene; positions,
// ports, edge paths and route points come from the layout.
export const layoutCanvasGraph = <NodeData, EdgeData>(
    scene: SceneSnapshot<NodeData, EdgeData>,
    options: CanvasGraphLayoutOptions<EdgeData> = {},
): CanvasGraphLayout<NodeData, EdgeData> => new CanvasGraphLayoutPlan(scene, options).layout()
