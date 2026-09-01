import {
    type CanvasPositionedNode,
} from './types.ts'

export type DragPlanInput<Node extends CanvasPositionedNode> = {
    nodes: readonly Node[]
    primaryNodeId: string
    selectedNodeIds: ReadonlySet<string>
    isContainer?: (node: Node) => boolean
    canDrag?: (node: Node) => boolean
}

export function computeDragPlan<Node extends CanvasPositionedNode>(input: DragPlanInput<Node>): { resolvedNodeId: string; draggedNodeIds: string[]; isParentContainerDrag: boolean } {
    const byId = new Map(input.nodes.map(node => [node.nodeId, node]))
    const primary = byId.get(input.primaryNodeId)
    const isParentContainerDrag = Boolean(primary && input.isContainer?.(primary))
    const candidates = input.selectedNodeIds.has(input.primaryNodeId) ? input.selectedNodeIds : [input.primaryNodeId]
    const selected = new Set<string>()
    for (const id of candidates) {
        const node = byId.get(id)
        if (node && (input.canDrag?.(node) ?? true)) selected.add(id)
    }
    const pending = Array.from(selected)
    while (pending.length) {
        const id = pending.pop()!
        const node = byId.get(id)!
        if (!input.isContainer?.(node)) continue
        for (const child of input.nodes) {
            if (child.parentId !== id || selected.has(child.nodeId) || input.canDrag?.(child) === false) continue
            selected.add(child.nodeId)
            pending.push(child.nodeId)
        }
    }
    return { resolvedNodeId: input.primaryNodeId, draggedNodeIds: Array.from(selected), isParentContainerDrag }
}
