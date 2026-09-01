import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    getIntersectingNodeIds,
    rectangleContainsPoint,
    rectangleFromPoints,
    unionRectangles,
} from './rectangles.ts'

describe('Selection geometry', () => {
    it('handles a reversed marquee and caller-defined node footprints', () => {
        const rectangle = rectangleFromPoints({ x: 100, y: 100 }, { x: 10, y: 20 })
        expect(rectangle).toEqual({ x: 10, y: 20, width: 90, height: 80 })
        const nodes = [
            { nodeId: 'small', bounds: { x: 15, y: 25, width: 10, height: 10 } },
            { nodeId: 'edge', bounds: { x: 100, y: 100, width: 10, height: 10 } },
        ]
        expect(getIntersectingNodeIds(nodes, rectangle, node => node.bounds)).toEqual(['small'])
        expect(rectangleContainsPoint(rectangle, { x: 100, y: 100 })).toBe(true)
    })

    it('unions measured bounds with explicit padding and handles an empty selection', () => {
        expect(unionRectangles([])).toBeNull()
        expect(unionRectangles([{ x: -20, y: 10, width: 30, height: 20 }, { x: 20, y: -10, width: 20, height: 30 }], 5)).toEqual({ x: -25, y: -15, width: 70, height: 50 })
    })
})
