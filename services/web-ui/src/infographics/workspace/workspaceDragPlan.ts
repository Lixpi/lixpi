import type { CanvasNode } from '@lixpi/constants'

import type { AnchoredImageEntry } from '$src/infographics/workspace/anchoredImageManager.ts'

type WorkspaceDragPlanInput = {
    nodes: CanvasNode[]
    primaryNodeId: string
    selectedNodeIds: Set<string>
    resolveSelectionTargetNodeId: (nodeId: string) => string
    isAnchoredImageNode: (nodeId: string) => boolean
    getAnchorsForThread: (threadNodeId: string) => AnchoredImageEntry[]
}

type WorkspaceDragPlan = {
    resolvedNodeId: string
    draggedNodeIds: string[]
    moveAnchoredImageIds: string[]
    isContextRegionDrag: boolean
    allowProximityConnection: boolean
    allowCollisionResolution: boolean
}

function isContextRegionNode(node: CanvasNode | undefined): boolean {
    return node?.type === 'contextRegion' || node?.type === 'aiChatThread'
}

function isGeneratedOutputImageNode(node: CanvasNode | undefined): boolean {
    return node?.type === 'image' && Boolean(node.generatedBy?.aiChatThreadId)
}

function includeContextRegionDescendants(nodeIds: string[], nodes: CanvasNode[]): string[] {
    const draggableNodeIds = new Set(nodeIds)
    const pendingParentIds = [...nodeIds]

    while (pendingParentIds.length > 0) {
        const parentId = pendingParentIds.pop()
        if (!parentId) continue

        const parentNode = nodes.find((node: CanvasNode) => node.nodeId === parentId)
        if (!isContextRegionNode(parentNode)) continue

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
    const resolvedNodeId = input.resolveSelectionTargetNodeId(input.primaryNodeId)
    const nodesById = new Map(input.nodes.map((node: CanvasNode) => [node.nodeId, node]))
    const primaryNode = nodesById.get(resolvedNodeId)
    const isContextRegionDrag = isContextRegionNode(primaryNode)

    let baseDraggedNodeIds: string[]
    if (!input.selectedNodeIds.has(resolvedNodeId)) {
        baseDraggedNodeIds = [resolvedNodeId]
    } else {
        baseDraggedNodeIds = Array.from(input.selectedNodeIds).filter((nodeId) => {
            if (input.isAnchoredImageNode(nodeId)) return false
            if (isContextRegionDrag && isGeneratedOutputImageNode(nodesById.get(nodeId))) return false
            return true
        })
        if (baseDraggedNodeIds.length === 0) baseDraggedNodeIds = [resolvedNodeId]
    }

    const draggedNodeIds = includeContextRegionDescendants(baseDraggedNodeIds, input.nodes)
    const draggedNodeIdSet = new Set(draggedNodeIds)
    const moveAnchoredImageIds: string[] = []

    if (!isContextRegionDrag) {
        for (const draggedNodeId of draggedNodeIds) {
            for (const anchor of input.getAnchorsForThread(draggedNodeId)) {
                if (draggedNodeIdSet.has(anchor.imageNodeId)) continue
                if (moveAnchoredImageIds.includes(anchor.imageNodeId)) continue
                moveAnchoredImageIds.push(anchor.imageNodeId)
            }
        }
    }

    return {
        resolvedNodeId,
        draggedNodeIds,
        moveAnchoredImageIds,
        isContextRegionDrag,
        allowProximityConnection: !isContextRegionDrag,
        allowCollisionResolution: draggedNodeIds.length === 1 && !isContextRegionDrag,
    }
}

export type { WorkspaceDragPlan, WorkspaceDragPlanInput }