import {
    type CanvasEngineRect,
    type CanvasEngineSize,
} from '../geometry/index.ts'
import { assertCanvasBounds } from '../scene/validation.ts'
import { topoSortByParent } from '../scene/parent-order.ts'
import {
    type ConnectionGeometryNode,
    type LocalPort,
    type ProjectedConnectionNode,
} from './geometry-types.ts'

export type NodeMeasurement = {
    dimensions: CanvasEngineSize
    ports: readonly LocalPort[]
}

export const projectPorts = (node: ConnectionGeometryNode): LocalPort[] => {
    if (node.ports !== undefined)
        return node.ports.flatMap(
            port => (port.role === 'both' ? ['source', 'target'] as const : [port.role === 'input' ? 'target' : 'source'] as const).map(
                type => ({
                    nodeId: node.nodeId,
                    id: port.id,
                    type,
                    position: port.direction,
                    x: port.anchor.x - 5,
                    y: port.anchor.y - 5,
                    width: 10,
                    height: 10,
                }),
            ),
        )

    return [
        {
            nodeId: node.nodeId,
            id: 'left',
            type: 'target',
            position: 'left',
            x: 0,
            y: node.dimensions.height / 2,
            width: 10,
            height: 10,
        },
        {
            nodeId: node.nodeId,
            id: 'right',
            type: 'source',
            position: 'right',
            x: node.dimensions.width,
            y: node.dimensions.height / 2,
            width: 10,
            height: 10,
        },
    ]
}

const clampBounds = (
    bounds: CanvasEngineRect,
    extent: [[number, number], [number, number]],
): CanvasEngineRect => ({
    ...bounds,
    x: Math.min(
        Math.max(bounds.x, extent[0][0]),
        extent[1][0] - bounds.width,
    ),
    y: Math.min(
        Math.max(bounds.y, extent[0][1]),
        extent[1][1] - bounds.height,
    ),
})

export const projectConnectionNodes = (
    nodes: readonly ConnectionGeometryNode[],
    measurements: ReadonlyMap<string, NodeMeasurement> = new Map(),
): Map<string, ProjectedConnectionNode> => {
    const ids = new Set<string>()

    for (const node of nodes) {
        if (
            !node.nodeId
            || ids.has(node.nodeId)
        )
            throw new Error('Connection node IDs must be nonempty and unique')

        ids.add(node.nodeId)
        assertCanvasBounds(
            {
                ...node.position,
                ...node.dimensions,
            },
            node.nodeId,
        )

        if (
            Array.isArray(node.extent)
            && (!node.extent.flat().every(value => typeof value === 'number' && !Number.isNaN(value)) || node.extent[0][0] > node.extent[1][0] || node.extent[0][1] > node.extent[1][1])
        )
            throw new Error(`Invalid connection extent: ${node.nodeId}`)

        const ports = new Set<string>()

        for (const port of node.ports ?? []) {
            if (
                !port.id
                || ports.has(port.id)
                || ![port.anchor.x, port.anchor.y].every(Number.isFinite)
                || !['input', 'output', 'both'].includes(port.role)
                || !['left', 'right', 'top', 'bottom'].includes(port.direction)
            )
                throw new Error(`Invalid connection port: ${node.nodeId}`)

            ports.add(port.id)
        }
    }

    const result = new Map<string, ProjectedConnectionNode>()

    for (const node of topoSortByParent(nodes)) {
        const measurement = node.ports === undefined ? measurements.get(node.nodeId) : undefined
        let bounds = {
            ...node.position,
            ...(measurement?.dimensions ?? node.dimensions),
        }

        if (Array.isArray(node.extent))
            bounds = clampBounds(bounds, node.extent)

        if (node.parentId !== undefined) {
            const parent = result.get(node.parentId)

            if (!parent)
                throw new Error(`Missing connection parent: ${node.parentId}`)

            bounds.x += parent.bounds.x
            bounds.y += parent.bounds.y

            if (node.extent === 'parent')
                bounds = clampBounds(
                    bounds,
                    [
                        [parent.bounds.x, parent.bounds.y],
                        [parent.bounds.x + parent.bounds.width, parent.bounds.y + parent.bounds.height],
                    ],
                )
        }

        assertCanvasBounds(bounds, node.nodeId)
        result.set(
            node.nodeId,
            {
                nodeId: node.nodeId,
                bounds,
                ports: (measurement?.ports ?? projectPorts(node)).toSorted(
                    (a, b) => a.type === b.type
                        ? 0
                        : a.type === 'source'
                            ? -1
                            : 1,
                ),
            },
        )
    }

    return result
}
