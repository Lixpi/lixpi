import {
    type CanvasEngineRect,
} from '../geometry/index.ts'
import {
    type SceneSnapshot,
} from './types.ts'

export type CanvasDiagnostic = {
    code: 'invalid-geometry' | 'duplicate-node' | 'invalid-parent' | 'cyclic-parent' | 'invalid-port' | 'invalid-edge' | 'unknown-node-type'
    message: string
    nodeId?: string
    edgeId?: string
}

export class CanvasDiagnosticError extends Error {
    constructor(readonly diagnostic: CanvasDiagnostic) {
        super(diagnostic.message)
        this.name = 'CanvasDiagnosticError'
    }
}

export function assertCanvasBounds(bounds: CanvasEngineRect, nodeId?: string): void {
    if (
        ![bounds.x, bounds.y, bounds.width, bounds.height, bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite)
        || bounds.width < 0 || bounds.height < 0
    ) {
        throw new CanvasDiagnosticError({ code: 'invalid-geometry', nodeId, message: `Canvas bounds must be finite with nonnegative dimensions${nodeId ? `: ${nodeId}` : ''}` })
    }
}

export function validateScene(scene: SceneSnapshot): void {
    const nodes = new Map(scene.nodes.map(node => [node.nodeId, node]))
    const seen = new Set<string>()
    for (const node of scene.nodes) {
        if (!node.nodeId || seen.has(node.nodeId)) throw new CanvasDiagnosticError({ code: 'duplicate-node', nodeId: node.nodeId, message: 'Scene node IDs must be nonempty and unique' })
        seen.add(node.nodeId)
        assertCanvasBounds({ ...node.position, ...node.dimensions }, node.nodeId)
        if (node.parentId !== undefined && !nodes.has(node.parentId)) throw new CanvasDiagnosticError({ code: 'invalid-parent', nodeId: node.nodeId, message: `Missing parent ${node.parentId} for node ${node.nodeId}` })
        const ports = new Set<string>()
        for (const port of node.ports) {
            if (
                !port.id || ports.has(port.id) || ![port.anchor.x, port.anchor.y].every(Number.isFinite)
                || !['input', 'output', 'both'].includes(port.role) || !['left', 'right', 'top', 'bottom'].includes(port.direction)
            ) {
                throw new CanvasDiagnosticError({ code: 'invalid-port', nodeId: node.nodeId, message: `Invalid or duplicate port on node ${node.nodeId}` })
            }
            ports.add(port.id)
        }
    }

    const resolved = new Set<string>()
    for (const node of scene.nodes) {
        const ancestors = new Set<string>()
        let current = node
        while (!resolved.has(current.nodeId)) {
            if (ancestors.has(current.nodeId)) throw new CanvasDiagnosticError({ code: 'cyclic-parent', nodeId: node.nodeId, message: `Cyclic parenting at node ${current.nodeId}` })
            ancestors.add(current.nodeId)
            if (current.parentId === undefined) break
            current = nodes.get(current.parentId)!
        }
        for (const id of ancestors) resolved.add(id)
    }

    const edgeIds = new Set<string>()
    for (const edge of scene.edges) {
        const source = nodes.get(edge.source.nodeId)?.ports.find(port => port.id === edge.source.portId)
        const target = nodes.get(edge.target.nodeId)?.ports.find(port => port.id === edge.target.portId)
        if (!edge.edgeId || edgeIds.has(edge.edgeId) || !source || !target || source.role === 'input' || target.role === 'output') {
            throw new CanvasDiagnosticError({ code: 'invalid-edge', edgeId: edge.edgeId, message: `Invalid edge identity or endpoints: ${edge.edgeId}` })
        }
        edgeIds.add(edge.edgeId)
    }
}
