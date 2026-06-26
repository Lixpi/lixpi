import type { CanvasNode } from '@lixpi/constants'

import { isBranchLineageMarkerNode } from '$src/infographics/workspace/branchLineageState.ts'

type WorkspaceDragPlanInput = {
    nodes: CanvasNode[]
    primaryNodeId: string
    selectedNodeIds: Set<string>
}

type WorkspaceDragPlan = {
    resolvedNodeId: string
    draggedNodeIds: string[]
    isParentContainerDrag: boolean
    allowProximityConnection: boolean
    allowCollisionResolution: boolean
}

function isParentContainerNode(_node: CanvasNode | undefined): boolean {
    // No canvas node type currently acts as a parent container (the AI chat
    // thread node, the only former container, has been removed).
    return false
}

function isGeneratedOutputImageNode(node: CanvasNode | undefined): boolean {
    return node?.type === 'image' && Boolean(node.generatedBy?.aiChatThreadId)
}

function includeParentContainerDescendants(nodeIds: string[], nodes: CanvasNode[]): string[] {
    const draggableNodeIds = new Set(nodeIds)
    const pendingParentIds = [...nodeIds]

    while (pendingParentIds.length > 0) {
        const parentId = pendingParentIds.pop()
        if (!parentId) continue

        const parentNode = nodes.find((node: CanvasNode) => node.nodeId === parentId)
        if (!isParentContainerNode(parentNode)) continue

        for (const child of nodes) {
            if (child.parentId !== parentId || draggableNodeIds.has(child.nodeId)) continue
            if (isGeneratedOutputImageNode(child)) continue
            draggableNodeIds.add(child.nodeId)
            pendingParentIds.push(child.nodeId)
        }
    }

    return [...draggableNodeIds]
}

export function computeWorkspaceDragPlan(input: WorkspaceDragPlanInput): WorkspaceDragPlan {
    const resolvedNodeId = input.primaryNodeId
    const nodesById = new Map(input.nodes.map((node: CanvasNode) => [node.nodeId, node]))
    const primaryNode = nodesById.get(resolvedNodeId)
    const isParentContainerDrag = isParentContainerNode(primaryNode)

    let baseDraggedNodeIds: string[]
    if (!input.selectedNodeIds.has(resolvedNodeId)) {
        baseDraggedNodeIds = [resolvedNodeId]
    } else {
        baseDraggedNodeIds = Array.from(input.selectedNodeIds).filter((nodeId) => {
            if (isParentContainerDrag && isGeneratedOutputImageNode(nodesById.get(nodeId))) return false
            return true
        })
        if (baseDraggedNodeIds.length === 0) baseDraggedNodeIds = [resolvedNodeId]
    }

    const draggedNodeIds = includeParentContainerDescendants(baseDraggedNodeIds, input.nodes)
    const isBranchLineageMarkerDrag = draggedNodeIds.every((nodeId: string) =>
        isBranchLineageMarkerNode(nodesById.get(nodeId))
    )

    return {
        resolvedNodeId,
        draggedNodeIds,
        isParentContainerDrag,
        allowProximityConnection: !isParentContainerDrag,
        allowCollisionResolution: draggedNodeIds.length === 1 || isParentContainerDrag || isBranchLineageMarkerDrag,
    }
}

export type { WorkspaceDragPlan, WorkspaceDragPlanInput }
