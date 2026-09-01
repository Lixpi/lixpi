import {
    type CanvasGeometryNode,
    type NodeGeometryChange,
} from './types.ts'

export function applyNodeGeometry<Node extends CanvasGeometryNode>(
    node: Node,
    geometry: Omit<NodeGeometryChange, 'nodeId'>,
): { node: Node; changed: boolean } {
    const parentId = geometry.parentId === null ? undefined : geometry.parentId ?? node.parentId
    const changed = node.position.x !== geometry.position.x
        || node.position.y !== geometry.position.y
        || node.dimensions.width !== geometry.dimensions.width
        || node.dimensions.height !== geometry.dimensions.height
        || node.parentId !== parentId
    if (!changed) return { node, changed: false }

    const updated = {
        ...node,
        position: { ...geometry.position },
        dimensions: { ...geometry.dimensions },
    }
    if (parentId === undefined) delete updated.parentId
    else updated.parentId = parentId
    return { node: updated, changed: true }
}
