import {
    describe,
    expect,
    it,
} from 'vitest'
import { computeDragPlan } from './drag-plan.ts'

describe('Drag plans', () => {
    it('moves selected nodes as a group and includes eligible container descendants once', () => {
        const nodes = [
            { nodeId: 'a', position: { x: 0, y: 0 }, container: true },
            { nodeId: 'b', parentId: 'a', position: { x: 10, y: 10 } },
            { nodeId: 'fixed', parentId: 'a', position: { x: 20, y: 20 } },
            { nodeId: 'other', position: { x: 50, y: 50 } },
        ]
        const plan = computeDragPlan({ nodes, primaryNodeId: 'a', selectedNodeIds: new Set(['a', 'b', 'other']), isContainer: node => Boolean(node.container), canDrag: node => node.nodeId !== 'fixed' })
        expect(plan.draggedNodeIds).toEqual(['a', 'b', 'other'])
        expect(plan.isParentContainerDrag).toBe(true)
        expect(computeDragPlan({ nodes, primaryNodeId: 'b', selectedNodeIds: new Set(['other']) }).draggedNodeIds).toEqual(['b'])
    })
})
