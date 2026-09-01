import {
    describe,
    expect,
    it,
} from 'vitest'
import { CanvasSelection } from './selection.ts'

describe('CanvasSelection', () => {
    it('retains immutable prior membership and tracks marquee origin across removals', () => {
        const selection = new CanvasSelection()
        const input = new Set(['a', 'b'])
        selection.replace(input, true)
        input.clear()
        const previous = selection.nodeIds
        selection.remove('a')
        expect(Array.from(previous)).toEqual(['a', 'b'])
        expect(selection.singleNodeId).toBe('b')
        expect(selection.fromMarquee).toBe(true)
        selection.remove('b')
        expect(selection.fromMarquee).toBe(false)
        expect(selection.singleNodeId).toBeNull()
    })

    it('toggles nodes independently without carrying marquee state into click selection', () => {
        const first = new CanvasSelection()
        const second = new CanvasSelection()
        first.replace(['a'], true)
        first.toggle('b')
        expect(first.fromMarquee).toBe(false)
        expect(first.singleNodeId).toBeNull()
        first.toggle('a')
        expect(first.singleNodeId).toBe('b')
        expect(second.nodeIds.size).toBe(0)
        first.clear()
        expect(first.nodeIds.size).toBe(0)
    })
})
