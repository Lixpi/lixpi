import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    type CanvasNode,
    type WorkspaceEdge,
} from '@lixpi/constants'
import {
    type EngineEdge,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    type ConnectionEdge,
} from '@lixpi/canvas-engine/frontend/connectors'
import { WorkspaceConnectionProjection } from './workspace-connection-projection.ts'
import { createWorkspaceConnectorSettings } from './workspace-connector-settings.ts'
import {
    type WorkspaceConnectionNodeData,
} from './workspace-connection-manager.ts'

function node(nodeId: string, type: CanvasNode['type'] = 'document'): EngineNode<WorkspaceConnectionNodeData> {
    const data = { node: { nodeId, type, position: { x: 100, y: 200 }, dimensions: { width: 300, height: 300 } } as CanvasNode }
    return { ...data.node, ports: [], data }
}

const wire: WorkspaceEdge = { edgeId: 'edge', sourceNodeId: 'source', targetNodeId: 'target', sourceHandle: 'right', targetHandle: 'left', sourceT: 0.2, targetT: 0.8, sourceMessageId: 'message', pathType: 'orthogonal' }
function change(edge: EngineEdge<WorkspaceEdge>): ConnectionEdge {
    return { edgeId: edge.edgeId, sourceNodeId: edge.source.nodeId, sourceHandle: edge.source.portId, targetNodeId: edge.target.nodeId, targetHandle: edge.target.portId, pathType: edge.path, data: edge.data }
}
function projection(compact = false) {
    return new WorkspaceConnectionProjection<WorkspaceConnectionNodeData>({
        settings: createWorkspaceConnectorSettings({ lineDefaultColor: '#000000' }),
        connectorBounds: node =>
            compact && node.type === 'image'
                ? { x: node.position.x + 100, y: node.position.y + 100, width: 100, height: 100 }
                : { ...node.position, ...node.dimensions },
    })
}

describe('WorkspaceConnectionProjection', () => {
    it('places ports on compact connector bounds without moving the visual node or losing its parent', () => {
        const adapter = projection(true)
        const parent = node('parent')
        const source = { ...node('source', 'image'), parentId: 'parent', position: { x: 10, y: 20 } }
        const target = node('target')
        const graph = adapter.project([parent, source, target], [wire])
        const projected = graph.nodes[1]!
        expect(projected.parentId).toBe('parent')
        expect(projected.position).toEqual({ x: 10, y: 20 })
        expect(projected.dimensions).toEqual({ width: 300, height: 300 })
        expect(projected.ports.find(port => port.id === graph.edges[0]!.source.portId)?.anchor).toEqual({ x: 200, y: 150 })
        expect(graph.edges[0]!.data).toBe(wire)
        expect(source.ports).toEqual([])
        const resized = adapter.project([parent, { ...source, dimensions: { width: 600, height: 600 } }, target], [wire])
        expect(resized.edges[0]!.source).toEqual(graph.edges[0]!.source)
    })

    it('keeps hidden edges and wire metadata while applying changed endpoint positions', () => {
        const adapter = projection()
        const graph = adapter.project([node('source'), node('target'), node('other')], [wire])
        const hidden: WorkspaceEdge = { edgeId: 'hidden', sourceNodeId: 'hidden-source', targetNodeId: 'hidden-target' }
        expect(adapter.applyChanges([wire, hidden], [change(graph.edges[0]!)])).toEqual([hidden, wire])
        const reconnected = { ...change(graph.edges[0]!), targetNodeId: 'other', targetHandle: 'left', targetT: 0.3, sourceT: 0.5 }
        expect(adapter.applyChanges([wire, hidden], [reconnected])).toEqual([hidden, { ...wire, targetNodeId: 'other', targetT: 0.3 }])
        expect(adapter.applyChanges([wire, hidden], [])).toEqual([hidden])
    })

    it('preserves menu/proximity fractions for new edges and rejects unknown endpoints', () => {
        const adapter = projection()
        adapter.project([node('source'), node('target')], [])
        const created: ConnectionEdge = { edgeId: 'new', sourceNodeId: 'source', targetNodeId: 'target', sourceHandle: 'right', targetHandle: 'left', sourceT: 0.35, targetT: 0.65 }
        expect(adapter.applyChanges([], [created])).toEqual([created])
        expect(() => adapter.applyChanges([], [{ ...created, targetHandle: 'missing' }])).toThrow('Unknown connection endpoint')
        expect(() => adapter.applyChanges([], [created, created])).toThrow('Duplicate connection change')
        expect(adapter.applyChanges([], [created])).toEqual([created])
        adapter.clear()
        expect(() => adapter.applyChanges([], [created])).toThrow('Unknown connection endpoint')
    })

    it('does not restore an edge removed from authoritative state before the callback arrives', () => {
        const adapter = projection()
        const graph = adapter.project([node('source'), node('target')], [wire])
        expect(adapter.applyChanges([], [change(graph.edges[0]!)])).toEqual([])
    })
})
