import {
    type CanvasNode,
    type WorkspaceEdge,
} from '@lixpi/constants'
import {
    buildNodesById,
    computeWorldPosition,
    type CanvasEngineRect,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    type ConnectionEdge,
    type ConnectionSettings,
} from '@lixpi/canvas-engine/frontend/connectors'
import {
    computeSpreadTValues,
    type WorkspaceConnectionNodeData,
} from './workspace-connection-manager.ts'
import { WorkspaceEdgePorts } from './workspace-edge-ports.ts'

export type WorkspaceConnectionProjectionOptions<Data extends WorkspaceConnectionNodeData> = {
    settings: ConnectionSettings
    connectorBounds: (worldNode: EngineNode<Data>) => CanvasEngineRect
}

const fraction = (
    value: number | undefined,
    fallback: number,
): number => {
    return value !== undefined
        && Number.isFinite(value)
        ? Math.max(
            0,
            Math.min(1, value),
        )
        : fallback
}

// Projects logical attachments onto each node's connector footprint. Port
// coordinates remain local to the visual node in the published engine scene.
export class WorkspaceConnectionProjection<Data extends WorkspaceConnectionNodeData> {
    private readonly ports: WorkspaceEdgePorts
    private edgeIds = new Set<string>()

    constructor(private readonly options: WorkspaceConnectionProjectionOptions<Data>) {
        this.ports = new WorkspaceEdgePorts(options.settings.lineCurve)
    }

    project(
        nodes: readonly EngineNode<Data>[],
        edges: readonly WorkspaceEdge[],
    ) {
        const byId = buildNodesById(nodes)
        const worlds = new Map(
            nodes.map(node => [node.nodeId, computeWorldPosition(node, byId)]),
        )
        const connectionNodes = nodes.map(node => {
            const worldNode = {
                ...node,
                parentId: undefined,
                position: worlds.get(node.nodeId)!,
            }
            const bounds = this.options.connectorBounds(worldNode)

            return {
                ...worldNode,
                position: {
                    x: bounds.x,
                    y: bounds.y,
                },
                dimensions: {
                    width: bounds.width,
                    height: bounds.height,
                },
            }
        })
        const wireNodes = connectionNodes.map(
            node => ({
                ...node.data.node,
                parentId: undefined,
                position: node.position,
                dimensions: node.dimensions,
            } as CanvasNode),
        )
        const spread = computeSpreadTValues(
            [...edges],
            wireNodes,
            this.options.settings,
        )
        const projected = this.ports.project(
            connectionNodes,
            edges,
            spread,
        )
        const connectionById = buildNodesById(projected.nodes)
        this.edgeIds = new Set(
            edges.map(edge => edge.edgeId),
        )

        return {
            nodes: nodes.map(node => {
                const connection = connectionById.get(node.nodeId)!
                const world = worlds.get(node.nodeId)!

                return {
                    ...node,
                    ports: connection.ports.map(
                        port => ({
                            ...port,
                            anchor: {
                                x: port.anchor.x + connection.position.x - world.x,
                                y: port.anchor.y + connection.position.y - world.y,
                            },
                        }),
                    ),
                }
            }),
            edges: projected.edges,
        }
    }

    applyChanges(
        allEdges: readonly WorkspaceEdge[],
        changes: readonly ConnectionEdge[],
    ): WorkspaceEdge[] {
        const previous = new Map(
            allEdges.map(edge => [edge.edgeId, edge]),
        )
        const updated = allEdges.filter(edge => !this.edgeIds.has(edge.edgeId))
        const seen = new Set<string>()

        for (const change of changes) {
            if (seen.has(change.edgeId))
                throw new Error(`Duplicate connection change: ${change.edgeId}`)

            seen.add(change.edgeId)
            const source = {
                nodeId: change.sourceNodeId,
                portId: change.sourceHandle ?? 'right',
            }
            const target = {
                nodeId: change.targetNodeId,
                portId: change.targetHandle ?? 'left',
            }
            const sourceAttachment = this.ports.resolve(source)
            const targetAttachment = this.ports.resolve(target)

            if (
                !sourceAttachment
                || !targetAttachment
            )
                throw new Error(`Unknown connection endpoint: ${change.edgeId}`)

            const existing = previous.get(change.edgeId)

            if (
                !existing
                && this.edgeIds.has(change.edgeId)
            )
                continue

            const sourceUnchanged = existing
                && source.nodeId === existing.sourceNodeId
                && source.portId === `edge:${encodeURIComponent(existing.edgeId)}:source`
            const targetUnchanged = existing
                && target.nodeId === existing.targetNodeId
                && target.portId === `edge:${encodeURIComponent(existing.edgeId)}:target`
            updated.push({
                ...existing,
                edgeId: change.edgeId,
                sourceNodeId: source.nodeId,
                targetNodeId: target.nodeId,
                sourceHandle: sourceUnchanged ? existing.sourceHandle : sourceAttachment.handle,
                targetHandle: targetUnchanged ? existing.targetHandle : targetAttachment.handle,
                sourceT: sourceUnchanged ? existing.sourceT : fraction(change.sourceT, sourceAttachment.t),
                targetT: targetUnchanged ? existing.targetT : fraction(change.targetT, targetAttachment.t),
                pathType: change.pathType ?? existing?.pathType,
            })
        }

        return updated
    }

    clear(): void {
        this.ports.clear()
        this.edgeIds.clear()
    }
}
