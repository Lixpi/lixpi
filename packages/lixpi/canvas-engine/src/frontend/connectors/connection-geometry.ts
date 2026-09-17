import {
    projectConnectionNodes,
    type NodeMeasurement,
} from '../../shared/connectors/node-projection.ts'
import {
    type ConnectionGeometryNode,
    type ProjectedConnectionNode,
    type ResolvedPort,
} from '../../shared/connectors/geometry-types.ts'

// Publishes complete graph snapshots and caches world port centers between input events.
export class ConnectionGeometry {
    private inputs: readonly ConnectionGeometryNode[] = []
    private measurements = new Map<string, NodeMeasurement>()
    private nodes = new Map<string, ProjectedConnectionNode>()
    private resolvedPorts: readonly ResolvedPort[] = []

    replace(nodes: readonly ConnectionGeometryNode[]): void {
        const inputs = nodes.map(
            node => ({
                ...node,
                position: { ...node.position },
                dimensions: { ...node.dimensions },
                ports: node.ports?.map(
                    port => ({
                        ...port,
                        anchor: { ...port.anchor },
                    }),
                ),
                extent: Array.isArray(node.extent) ? [[...node.extent[0]], [...node.extent[1]]] as [[number, number], [number, number]] : node.extent,
            }),
        )
        const snapshot = projectConnectionNodes(inputs)
        this.inputs = inputs
        this.measurements.clear()
        this.publish(snapshot)
    }

    measure(
        nodeId: string,
        measurement: NodeMeasurement,
    ): void {
        const measurements = new Map(this.measurements)
        measurements.set(nodeId, measurement)
        const snapshot = projectConnectionNodes(this.inputs, measurements)
        this.measurements = measurements
        this.publish(snapshot)
    }

    private publish(nodes: Map<string, ProjectedConnectionNode>): void {
        this.nodes = nodes
        this.resolvedPorts = [...nodes.values()].flatMap(
            node => node.ports.map(
                port => ({
                    nodeId: node.nodeId,
                    id: port.id,
                    type: port.type,
                    position: port.position,
                    x: node.bounds.x + port.x + port.width / 2,
                    y: node.bounds.y + port.y + port.height / 2,
                }),
            ),
        )
    }

    get(nodeId: string): ProjectedConnectionNode | undefined {
        return this.nodes.get(nodeId)
    }

    entries(): IterableIterator<[string, ProjectedConnectionNode]> {
        return this.nodes.entries()
    }

    get ports(): readonly ResolvedPort[] {
        return this.resolvedPorts
    }

    clear(): void {
        this.inputs = []
        this.measurements.clear()
        this.nodes.clear()
        this.resolvedPorts = []
    }
}
