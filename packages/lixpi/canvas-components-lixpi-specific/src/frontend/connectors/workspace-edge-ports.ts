import {
    type WorkspaceEdge,
} from '@lixpi/constants'
import {
    type CanvasPort,
    type ConnectorPathType,
    type EdgeEndpoint,
    type EngineEdge,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    createWorkspaceConnectionPolicy,
    type WorkspaceConnectionNodeData,
} from './workspace-connection-manager.ts'

export type WorkspaceWireAttachment = {
    nodeId: string
    handle: 'left' | 'right'
    t: number
}
export type WorkspaceEdgeAnchorPositions = {
    sourceT?: number
    targetT?: number
}

const fraction = (value: number | undefined): number => {
    return value !== undefined
        && Number.isFinite(value)
        ? Math.max(
            0,
            Math.min(1, value),
        )
        : 0.5
}

// Each committed endpoint has its own stable port. The original wire fields
// remain opaque edge data; temporary layout anchors need not rewrite them.
export class WorkspaceEdgePorts {
    private attachments = new Map<string, Map<string, WorkspaceWireAttachment>>()
    private readonly policy = createWorkspaceConnectionPolicy()

    constructor(private readonly defaultPath: ConnectorPathType) {}

    project<Data extends WorkspaceConnectionNodeData>(
        nodes: readonly EngineNode<Data>[],
        edges: readonly WorkspaceEdge[],
        anchors: ReadonlyMap<string, WorkspaceEdgeAnchorPositions> = new Map(),
    ): {
        nodes: EngineNode<Data>[]
        edges: EngineEdge<WorkspaceEdge>[]
    } {
        const byId = new Map(
            nodes.map(node => [node.nodeId, node]),
        )
        const ports = new Map<string, CanvasPort[]>()
        const attachments = new Map<string, Map<string, WorkspaceWireAttachment>>()
        const add = (
            node: EngineNode<Data>,
            portId: string,
            handle: 'left' | 'right',
            t: number,
            role: CanvasPort['role'],
        ) => {
            const sideT = fraction(t)
            ports.get(node.nodeId)!.push({
                id: portId,
                role,
                direction: handle,
                anchor: {
                    x: handle === 'left' ? 0 : node.dimensions.width,
                    y: node.dimensions.height * sideT,
                },
            })
            attachments.get(node.nodeId)!.set(
                portId,
                {
                    nodeId: node.nodeId,
                    handle,
                    t: sideT,
                },
            )
        }

        for (const node of nodes) {
            ports.set(node.nodeId, [])
            attachments.set(
                node.nodeId,
                new Map(),
            )
            add(
                node,
                'left',
                'left',
                0.5,
                'input',
            )
            add(
                node,
                'right',
                'right',
                0.5,
                'both',
            )
        }

        const projected: EngineEdge<WorkspaceEdge>[] = []

        for (const edge of edges) {
            const source = byId.get(edge.sourceNodeId)
            const target = byId.get(edge.targetNodeId)

            if (
                !source
                || !target
            )
                throw new Error(`Cannot project edge ${edge.edgeId}: an endpoint is missing`)

            const sourcePort = `edge:${encodeURIComponent(edge.edgeId)}:source`
            const targetPort = `edge:${encodeURIComponent(edge.edgeId)}:target`
            const override = anchors.get(edge.edgeId)
            const sourceSide = edge.sourceHandle === 'left' ? 'left' : 'right'
            const targetSide = edge.targetHandle === undefined
                ? this.policy.defaultTargetHandle!(target)
                : edge.targetHandle === 'left'
                    ? 'left'
                    : 'right'
            add(
                source,
                sourcePort,
                sourceSide,
                fraction(override?.sourceT ?? edge.sourceT),
                'output',
            )
            add(
                target,
                targetPort,
                targetSide,
                fraction(override?.targetT ?? edge.targetT),
                'input',
            )
            projected.push({
                edgeId: edge.edgeId,
                source: {
                    nodeId: source.nodeId,
                    portId: sourcePort,
                },
                target: {
                    nodeId: target.nodeId,
                    portId: targetPort,
                },
                path: edge.pathType ?? this.defaultPath,
                data: edge,
            })
        }

        this.attachments = attachments

        return {
            nodes: nodes.map(
                node => ({
                    ...node,
                    ports: ports.get(node.nodeId)!,
                }),
            ),
            edges: projected,
        }
    }

    resolve(endpoint: EdgeEndpoint): WorkspaceWireAttachment | undefined {
        const attachment = this.attachments.get(endpoint.nodeId)?.get(endpoint.portId)

        return attachment ? { ...attachment } : undefined
    }

    reconnect(
        edge: WorkspaceEdge,
        source: EdgeEndpoint,
        target: EdgeEndpoint,
    ): WorkspaceEdge | undefined {
        const sourceAttachment = this.resolve(source)
        const targetAttachment = this.resolve(target)

        if (
            !sourceAttachment
            || !targetAttachment
        )
            return undefined

        const unchangedSource = source.nodeId === edge.sourceNodeId && source.portId === `edge:${encodeURIComponent(edge.edgeId)}:source`
        const unchangedTarget = target.nodeId === edge.targetNodeId && target.portId === `edge:${encodeURIComponent(edge.edgeId)}:target`

        return {
            ...edge,
            ...(!unchangedSource ? {
                sourceNodeId: sourceAttachment.nodeId,
                sourceHandle: sourceAttachment.handle,
                sourceT: sourceAttachment.t,
            } : {}),
            ...(!unchangedTarget ? {
                targetNodeId: targetAttachment.nodeId,
                targetHandle: targetAttachment.handle,
                targetT: targetAttachment.t,
            } : {}),
        }
    }

    clear(): void {
        this.attachments.clear()
    }
}
