import type { CanvasNode } from '@lixpi/constants'
import { computeDragPlan } from '@lixpi/canvas-engine/shared'
import { isBranchLineageMarkerNode } from '../branch-tree-layout/branch-lineage-state.ts'

export type WorkspaceDragPlanInput = { nodes: CanvasNode[]; primaryNodeId: string; selectedNodeIds: ReadonlySet<string> }

export function computeWorkspaceDragPlan(input: WorkspaceDragPlanInput) {
    const plan = computeDragPlan(input)
    const byId = new Map(input.nodes.map(node => [node.nodeId, node]))
    const onlyLineageMarkers = plan.draggedNodeIds.every(id => isBranchLineageMarkerNode(byId.get(id)))
    return {
        ...plan,
        allowProximityConnection: !plan.isParentContainerDrag,
        allowCollisionResolution: plan.draggedNodeIds.length === 1 || plan.isParentContainerDrag || onlyLineageMarkers,
    }
}

export type WorkspaceDragPlan = ReturnType<typeof computeWorkspaceDragPlan>
