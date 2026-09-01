import {
    describe,
    expect,
    it,
} from 'vitest'
import { topoSortByParent } from './parent-order.ts'

describe('Parent ordering', () => {
    it('places parents before children without mutating caller nodes', () => {
        const input = [{ nodeId: 'child', parentId: 'parent' }, { nodeId: 'other' }, { nodeId: 'parent' }]
        expect(topoSortByParent(input).map(node => node.nodeId)).toEqual(['parent', 'child', 'other'])
        expect(input[0].nodeId).toBe('child')
        expect(() => topoSortByParent([{ nodeId: 'a', parentId: 'b' }, { nodeId: 'b', parentId: 'a' }])).toThrow('Cyclic parenting')
    })
})
