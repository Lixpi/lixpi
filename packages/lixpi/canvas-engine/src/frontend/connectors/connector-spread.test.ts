import {
    describe,
    expect,
    it,
} from 'vitest'
import { computeConnectorSpread } from './connector-spread.ts'

describe('Connector spreading', () => {
    const nodes = [
        { nodeId: 'source', position: { x: 0, y: 100 }, dimensions: { width: 100, height: 100 } },
        { nodeId: 'top', position: { x: 300, y: 0 }, dimensions: { width: 100, height: 300 } },
        { nodeId: 'bottom', position: { x: 300, y: 300 }, dimensions: { width: 100, height: 300 } },
    ]
    const edges = [
        { edgeId: 'b', sourceNodeId: 'source', targetNodeId: 'bottom' },
        { edgeId: 'a', sourceNodeId: 'source', targetNodeId: 'top' },
    ]

    it('orders source anchors by target height and clamps sliding anchors to the configured margin', () => {
        const result = computeConnectorSpread(edges, nodes, { isCentered: () => false, minSlideHeight: 50, edgeMargin: 0.1 })
        expect(result.get('a')?.sourceT).toBe(0.35)
        expect(result.get('b')?.sourceT).toBe(0.65)
        expect(result.get('a')?.targetT).toBe(0.5)
        expect(result.get('b')?.targetT).toBe(0.1)
        expect(edges.map(edge => edge.edgeId)).toEqual(['b', 'a'])
    })

    it('honors caller-defined centered anchors without inspecting a product node type', () => {
        const result = computeConnectorSpread(edges, nodes, { isCentered: () => true, minSlideHeight: 50, edgeMargin: 0.1 })
        expect(Array.from(result.values()).every(value => value.sourceT === 0.5 && value.targetT === 0.5)).toBe(true)
    })
})
