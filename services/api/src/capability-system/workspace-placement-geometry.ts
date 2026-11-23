import {
    mediaGenerationLayoutSettings,
    workspaceCollisionSettings,
    type CanvasNode,
    type CanvasNodePosition,
    type CanvasState,
} from '@lixpi/constants'
import {
    computeWorldPosition,
    resolveCollisions,
} from '@lixpi/canvas-engine/shared'
import { WorkspaceGeometry } from '@lixpi/canvas-components/workspace/shared'

export const resolveCanvasPlacement = (
    state: CanvasState,
    node: CanvasNode,
): CanvasNodePosition => {
    const { viewport } = state
    const layout = mediaGenerationLayoutSettings
    const geo = new WorkspaceGeometry({
        workspaceId: '',
        settings: {
            workspaceCollision: workspaceCollisionSettings,
            mediaNode: { inProgressOutlineAnimation: { preFrameCircleScale: layout.preFrameCircleScale } },
            mediaBranchLineage: layout,
        },
        getViewport: () => viewport,
        getPaneSize: () => ({
            width: 0,
            height: 0,
        }),
        getWorldPosition: computeWorldPosition,
        getWorldRect: (item, nodesById) => ({
            ...computeWorldPosition(item, nodesById),
            ...item.dimensions,
        }),
        getLiveDimensions: () => undefined,
        isPending: () => false,
    })
    const plan = geo.createCollisionPlan(
        [...state.nodes, node].filter(item => item.parentId === node.parentId),
        false,
        workspaceCollisionSettings.insertion,
    )
    const result = resolveCollisions(
        plan.nodeBoxes.map(
            box => ({
                ...box,
                fixed: box.id !== node.nodeId,
            }),
        ),
        {
            iterations: plan.iterations,
            margin: 0,
            shouldResolvePair: plan.shouldResolvePair,
        },
    )
    const position = result.nodes.get(node.nodeId)

    return position ? geo.getResolvedNodePositionFromCollisionBox(
        node,
        position,
        plan.entries,
    ) : node.position
}
