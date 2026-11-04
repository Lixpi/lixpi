import {
    layoutTree,
    resolveCollisions,
    type CanvasEnginePoint,
    type CanvasEngineRect,
    type EngineNode,
    type SceneSnapshot,
    type TreeLayoutNode,
} from '@lixpi/canvas-engine/shared'
import {
    mediaGenerationLayoutSettings,
    workspaceCollisionSettings,
} from '@lixpi/constants'
import { WorkspaceDiagramRouting } from './workspace-diagram-routing.ts'
import { estimateBranchMarkerDimensions } from '../branch-tree-layout/marker-dimensions.ts'

export type WorkspaceDiagramRole = 'origin' | 'fork' | 'continuation'

export type WorkspaceDiagramNode = {
    id: string
    prompt: string
    response?: string
    role: WorkspaceDiagramRole
}

export type WorkspaceDiagramEdge = {
    id: string
    source: string
    target: string
    kind?: 'forward' | 'relation' | 'feedback'
}

// Trees express actual fan-out relationships. Joins and feedback remain edges;
// they never assign a shared result to an arbitrary primary parent.
export type WorkspaceDiagramTree = {
    rootId: string
    children?: Readonly<Record<string, readonly string[]>>
}

export type WorkspaceDiagramStage = {
    trees: readonly WorkspaceDiagramTree[]
    alignNodeId?: string
}

export type WorkspaceDiagram = {
    revision: string
    nodes: readonly WorkspaceDiagramNode[]
    stages: readonly WorkspaceDiagramStage[]
    edges: readonly WorkspaceDiagramEdge[]
}

export type WorkspaceDiagramLayout = {
    scene: SceneSnapshot<WorkspaceDiagramNode, WorkspaceDiagramEdge>
    size: {
        width: number
        height: number
    }
}

type MeasuredGroup = {
    id: string
    positions: ReadonlyMap<string, CanvasEnginePoint>
    bounds: CanvasEngineRect
}

export const WORKSPACE_DIAGRAM_NODE_TYPE = 'workspace-diagram-branch'

const boundsOf = (rectangles: readonly CanvasEngineRect[]): CanvasEngineRect => {
    const left = Math.min(...rectangles.map(rectangle => rectangle.x))
    const top = Math.min(...rectangles.map(rectangle => rectangle.y))
    const right = Math.max(...rectangles.map(rectangle => rectangle.x + rectangle.width))
    const bottom = Math.max(...rectangles.map(rectangle => rectangle.y + rectangle.height))

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    }
}

const markerGap = mediaGenerationLayoutSettings.nodeGap
const collisionSettings = workspaceCollisionSettings.branchTree.nodeTypes.branchOrigin

// The native tree algorithm places invisible group envelopes; the native
// collision resolver translates each envelope rigidly, preserving its tree.
const composeGroups = (
    groups: readonly MeasuredGroup[],
    direction: 'rows' | 'columns',
): Map<string, CanvasEnginePoint> => {
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
            depthGap: direction === 'rows' ? 0 : markerGap * 2,
            siblingGap: mediaGenerationLayoutSettings.branchRowGap,
        },
    )
    const collisions = resolveCollisions(
        groups.map(
            group => ({
                id: group.id,
                ...layout.positions.get(group.id)!,
                width: group.bounds.width,
                height: group.bounds.height,
                margin: markerGap,
                overlapThreshold: collisionSettings.overlapThreshold,
            }),
        ),
        {
            iterations: collisionSettings.iterations,
            margin: markerGap,
            overlapThreshold: collisionSettings.overlapThreshold,
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

// The same geometry estimator, tidy tree and collision resolver as the
// workspace operate on native marker footprints, without product state.
export const layoutWorkspaceDiagram = (
    diagram: WorkspaceDiagram,
    sceneKey: string,
): WorkspaceDiagramLayout => {
    if (
        !diagram.nodes.length
        || !diagram.stages.length
    )
        throw new Error('A workspace diagram requires nodes and layout stages')

    const byId = new Map<string, WorkspaceDiagramNode>()
    const dimensions = new Map<string, {
        width: number
        height: number
    }>()

    for (const node of diagram.nodes) {
        if (
            !node.id.trim()
            || byId.has(node.id)
        )
            throw new Error('Workspace diagram node IDs must be nonempty and unique')

        byId.set(node.id, node)
        dimensions.set(
            node.id,
            estimateBranchMarkerDimensions(
                node.prompt,
                {
                    responseLine: Boolean(node.response),
                    responseText: node.response,
                },
            ),
        )
    }

    const edgeIds = new Set<string>()
    const forwardRelations = new Map<string, Set<string>>()

    for (const edge of diagram.edges) {
        if (
            !edge.id.trim()
            || edgeIds.has(edge.id)
        )
            throw new Error('Workspace diagram edge IDs must be nonempty and unique')

        if (
            !byId.has(edge.source)
            || !byId.has(edge.target)
        )
            throw new Error('Workspace diagram edges must reference existing nodes')

        edgeIds.add(edge.id)

        if (
            !edge.kind
            || edge.kind === 'forward'
        ) {
            const targets = forwardRelations.get(edge.source) ?? new Set<string>()
            targets.add(edge.target)
            forwardRelations.set(edge.source, targets)
        }
    }

    const assigned = new Set<string>()
    const rectanglesAt = (positions: ReadonlyMap<string, CanvasEnginePoint>): CanvasEngineRect[] =>
        [...positions].map(
            ([id, position]) => ({
                ...position,
                ...dimensions.get(id)!,
            }),
        )
    const measureTree = (tree: WorkspaceDiagramTree): MeasuredGroup => {
        const treeNodes: TreeLayoutNode[] = []
        const members = new Set<string>()
        const visit = (
            id: string,
            parentId: string | null,
        ): void => {
            const size = dimensions.get(id)

            if (!size)
                throw new Error('Workspace diagram trees must reference existing nodes')

            if (assigned.has(id))
                throw new Error('Each workspace diagram node must occur in exactly one layout tree')

            if (
                parentId
                && !forwardRelations.get(parentId)?.has(id)
            )
                throw new Error('Layout tree relationships must be declared forward edges')

            assigned.add(id)
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
                throw new Error('Workspace diagram tree contains an unreachable parent')
        }

        const result = layoutTree(
            treeNodes,
            {
                // Media-to-media gaps reserve large output artifacts. Marker-only
                // trees use each marker's native clearance and the branch row gap.
                depthGap: markerGap * 2,
                siblingGap: mediaGenerationLayoutSettings.branchRowGap,
            },
        )

        return {
            id: tree.rootId,
            positions: result.positions,
            bounds: boundsOf(
                rectanglesAt(result.positions),
            ),
        }
    }
    const stages = diagram.stages.map(stage => {
        if (!stage.trees.length)
            throw new Error('Workspace diagram stages require at least one tree')

        const trees = stage.trees.map(measureTree)
        const positions = composeGroups(trees, 'rows')
        let bounds = boundsOf(
            rectanglesAt(positions),
        )

        if (stage.alignNodeId !== undefined) {
            const anchor = positions.get(stage.alignNodeId)

            if (!anchor)
                throw new Error('Workspace diagram stage alignment must reference a node in that stage')

            const centerY = anchor.y + dimensions.get(stage.alignNodeId)!.height / 2
            const halfHeight = Math.max(centerY - bounds.y, bounds.y + bounds.height - centerY)

            // A symmetric envelope lets the native tree and collision solvers
            // align a semantic node while preserving the stage as a rigid group.
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
    })

    if (assigned.size !== byId.size)
        throw new Error('Every workspace diagram node must belong to a layout stage')

    const positions = composeGroups(stages, 'columns')
    const bounds = boundsOf(
        rectanglesAt(positions),
    )
    const nodes: EngineNode<WorkspaceDiagramNode>[] = diagram.nodes.map(node => {
        const position = positions.get(node.id)!
        const size = dimensions.get(node.id)!

        return {
            nodeId: node.id,
            type: WORKSPACE_DIAGRAM_NODE_TYPE,
            position: {
                x: position.x - bounds.x + markerGap,
                y: position.y - bounds.y + markerGap,
            },
            dimensions: size,
            data: node,
            ports: [
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
            ],
        }
    })
    const edges = new WorkspaceDiagramRouting(
        nodes,
        diagram.edges,
        markerGap,
    ).route()
    const routePoints = edges.flatMap(edge => edge.bendPoints ?? [])
    const routedBounds = boundsOf([
        ...nodes.map(
            node => ({
                ...node.position,
                ...node.dimensions,
            }),
        ),
        ...routePoints.map(
            point => ({
                ...point,
                width: 0,
                height: 0,
            }),
        ),
    ])
    const offset = {
        x: markerGap - routedBounds.x,
        y: markerGap - routedBounds.y,
    }

    for (const node of nodes) {
        node.position = {
            x: node.position.x + offset.x,
            y: node.position.y + offset.y,
        }
    }

    for (const edge of edges) {
        if (edge.bendPoints)
            edge.bendPoints = edge.bendPoints.map(
                point => ({
                    x: point.x + offset.x,
                    y: point.y + offset.y,
                }),
            )
    }

    return {
        scene: {
            sceneKey,
            revision: diagram.revision,
            nodes,
            edges,
        },
        size: {
            width: routedBounds.width + markerGap * 2,
            height: routedBounds.height + markerGap * 2,
        },
    }
}
