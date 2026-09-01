import {
    describe,
    expect,
    it,
} from 'vitest'
import type {
    CanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'
import type { EngineNode } from '@lixpi/canvas-engine/shared'
import { WorkspaceEdgePorts } from './workspace-edge-ports.ts'
import type { WorkspaceConnectionNodeData } from './workspace-connection-manager.ts'

function node(nodeId: string, type: CanvasNode['type'] = 'document'): EngineNode<WorkspaceConnectionNodeData> {
    const wire = { type, nodeId, position: { x: 10, y: 20 }, dimensions: { width: 100, height: 200 } } as CanvasNode
    return { ...wire, ports: [], data: { node: wire } }
}

const nodes = [node('source'), node('target'), node('other', 'image')]
const edge: WorkspaceEdge = { edgeId: 'edge/a:b', sourceNodeId: 'source', targetNodeId: 'target', sourceHandle: 'right', targetHandle: 'left', sourceT: 0.2, targetT: 0.8, sourceMessageId: 'message', pathType: 'orthogonal' }

describe('WorkspaceEdgePorts', () => {
    it('keeps distinct stored attachments on the same node and stable IDs across layout changes', () => {
        const ports = new WorkspaceEdgePorts('straight')
        const second = { ...edge, edgeId: 'second', sourceT: 0.7, targetT: 0.3 }
        const first = ports.project(nodes, [edge, second])
        const sourcePorts = first.nodes[0]!.ports.filter(port => port.id.startsWith('edge:'))
        expect(sourcePorts.map(port => port.anchor.y)).toEqual([40, 140])
        expect(first.edges.map(edge => edge.source.portId)[0]).not.toBe(first.edges[1]!.source.portId)
        expect(first.edges[0]!.data).toBe(edge)
        expect(first.edges[0]!.path).toBe('orthogonal')
        const moved = ports.project(nodes.map(node => ({ ...node, dimensions: { width: 200, height: 400 } })), [edge, second])
        expect(moved.edges[0]!.source).toEqual(first.edges[0]!.source)
        expect(moved.nodes[0]!.ports.find(port => port.id === moved.edges[0]!.source.portId)?.anchor).toEqual({ x: 200, y: 80 })
    })

    it('accepts live message/layout anchors without rewriting untouched persisted attachments', () => {
        const ports = new WorkspaceEdgePorts('straight')
        const graph = ports.project(nodes, [edge], new Map([[edge.edgeId, { sourceT: 0.9, targetT: 0.1 }]]))
        const projected = graph.edges[0]!
        expect(ports.resolve(projected.source)?.t).toBe(0.9)
        expect(ports.reconnect(edge, projected.source, projected.target)).toEqual(edge)
        const changed = ports.reconnect(edge, projected.source, { nodeId: 'other', portId: 'left' })!
        expect(changed).toEqual({ ...edge, targetNodeId: 'other', targetHandle: 'left', targetT: 0.5 })
        expect(changed.sourceMessageId).toBe('message')
    })

    it('uses product defaults for unstated handles and does not accept ports belonging to another node', () => {
        const ports = new WorkspaceEdgePorts('horizontal-bezier')
        const graph = ports.project(nodes, [{ edgeId: 'defaults', sourceNodeId: 'source', targetNodeId: 'other' }])
        expect(ports.resolve(graph.edges[0]!.target)).toEqual({ nodeId: 'other', handle: 'left', t: 0.5 })
        expect(ports.resolve({ nodeId: 'source', portId: graph.edges[0]!.target.portId })).toBeUndefined()
        expect(graph.edges[0]!.path).toBe('horizontal-bezier')
    })

    it('leaves valid bindings intact after rejected projection and clears only its own instance', () => {
        const a = new WorkspaceEdgePorts('straight'), b = new WorkspaceEdgePorts('straight')
        const graph = a.project(nodes, [edge])
        b.project(nodes, [edge])
        expect(() => a.project(nodes, [{ ...edge, targetNodeId: 'missing' }])).toThrow('an endpoint is missing')
        expect(a.resolve(graph.edges[0]!.source)?.t).toBe(0.2)
        a.clear()
        expect(a.resolve(graph.edges[0]!.source)).toBeUndefined()
        expect(b.resolve(graph.edges[0]!.source)?.t).toBe(0.2)
    })
})
