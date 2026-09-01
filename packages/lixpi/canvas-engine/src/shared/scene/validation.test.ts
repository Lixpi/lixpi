import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    CanvasDiagnosticError,
    validateScene,
} from './validation.ts'
import type {
    EngineNode,
    SceneSnapshot,
} from './types.ts'

function node(nodeId: string, parentId?: string): EngineNode {
    return { nodeId, parentId, type: 'custom', data: null, position: { x: 10, y: 20 }, dimensions: { width: 50, height: 30 }, ports: [{ id: 'port', role: 'both', direction: 'right', anchor: { x: 50, y: 15 } }] }
}

function scene(nodes: EngineNode[]): SceneSnapshot {
    return { sceneKey: 'one', revision: '1', nodes, edges: [] }
}

describe('Scene validation', () => {
    it('accepts empty scenes, parent-relative nodes and arbitrary component data', () => {
        expect(() => validateScene(scene([]))).not.toThrow()
        expect(() => validateScene(scene([node('child', 'parent'), node('parent')]))).not.toThrow()
    })

    it.each([
        { nodes: [node('a'), node('a')], code: 'duplicate-node' },
        { nodes: [node('a', 'missing')], code: 'invalid-parent' },
        { nodes: [node('a', 'b'), node('b', 'a')], code: 'cyclic-parent' },
        { nodes: [{ ...node('a'), position: { x: Infinity, y: 0 } }], code: 'invalid-geometry' },
        { nodes: [{ ...node('a'), dimensions: { width: -1, height: 1 } }], code: 'invalid-geometry' },
        { nodes: [{ ...node('a'), ports: [...node('a').ports, ...node('a').ports] }], code: 'invalid-port' },
    ])('reports $code without modifying input', ({ nodes, code }) => {
        const input = scene(nodes)
        const before = structuredClone(input)
        expect(() => validateScene(input)).toThrow(CanvasDiagnosticError)
        try {
            validateScene(input)
        } catch (error) {
            expect((error as CanvasDiagnosticError).diagnostic.code).toBe(code)
        }
        expect(input).toEqual(before)
    })

    it('checks edge endpoints against declared port identities and roles', () => {
        const input = scene([node('a'), node('b')])
        const edge = { edgeId: 'ab', source: { nodeId: 'a', portId: 'port' }, target: { nodeId: 'b', portId: 'port' }, path: 'straight' as const, data: null }
        expect(() => validateScene({ ...input, edges: [edge] })).not.toThrow()
        expect(() => validateScene({ ...input, edges: [{ ...edge, target: { nodeId: 'b', portId: 'missing' } }] })).toThrow(CanvasDiagnosticError)
    })
})
