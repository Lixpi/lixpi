import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { CanvasDrawingSurface } from './drawing-scope.ts'
import { RectangleOverlay } from './rectangle-overlay.ts'

describe('RectangleOverlay', () => {
    it('retains screen-sized corners and stroke while toggling selection fill', () => {
        const controller = new AbortController()
        const group = { id: 'group' }
        const path = { id: 'path' }
        const resources = { createGroup: vi.fn(() => group), createPath: vi.fn(() => path), updatePath: vi.fn(), setVisible: vi.fn(), release: vi.fn() }
        const surface = { resources, signal: controller.signal, layers: { foreground: {} } } as unknown as CanvasDrawingSurface
        const overlay = new RectangleOverlay({ surface, stroke: '#222222', fill: '#eeeeee', radius: 8 })
        overlay.setZoom(2)
        overlay.setBounds({ x: 0, y: 0, width: 100, height: 50 }, false)
        const outline = resources.updatePath.mock.calls.at(-1)![1][0]
        expect(outline.fill).toBeUndefined()
        expect(outline.stroke).toEqual({ color: '#222222', width: 0.5 })
        expect(outline.path.startsWith('M4 0')).toBe(true)
        overlay.setBounds({ x: 0, y: 0, width: 100, height: 50 })
        expect(resources.updatePath.mock.calls.at(-1)![1][0].fill).toEqual({ color: '#eeeeee' })
        overlay.setBounds(null)
        expect(resources.setVisible).toHaveBeenLastCalledWith(group, false)
        controller.abort()
        overlay.destroy()
        expect(resources.release).toHaveBeenCalledOnce()
    })
})
