// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const backends = vi.hoisted(() => [] as any[])
vi.mock('@xyflow/system', () => ({
    PanOnScrollMode: { Free: 'free' },
    infiniteExtent: [[-Infinity, -Infinity], [Infinity, Infinity]],
    XYPanZoom: vi.fn(() => {
        const backend = { update: vi.fn(), syncViewport: vi.fn(), setViewport: vi.fn(async () => true), destroy: vi.fn() }
        backends.push(backend)
        return backend
    }),
}))

import { ViewportController } from './viewport-controller.ts'

describe('ViewportController', () => {
    it('keeps viewport and configuration instance-local and suppresses backend motion while locked', () => {
        const onTransformChange = vi.fn()
        const options = { root: document.createElement('div'), viewport: { x: 10, y: 20, zoom: 1 }, onTransformChange }
        const first = new ViewportController(options)
        const a = backends.at(-1)
        const second = new ViewportController({ ...options, root: document.createElement('div'), config: { zoomOnScroll: true } })
        const b = backends.at(-1)
        const releasePanel = first.lock()
        const releaseDrag = first.lock()
        releasePanel()
        a.update.mock.lastCall[0].onTransformChange([90, 90, 2])
        expect(a.syncViewport).toHaveBeenLastCalledWith(options.viewport)
        expect(onTransformChange).not.toHaveBeenCalled()
        expect(b.update.mock.lastCall[0].zoomOnScroll).toBe(true)
        releaseDrag()
        a.update.mock.lastCall[0].onTransformChange([30, 40, 1.5])
        expect(first.getViewport()).toEqual({ x: 30, y: 40, zoom: 1.5 })
        expect(second.getViewport()).toEqual(options.viewport)
        expect(() => first.syncViewport({ x: NaN, y: 0, zoom: 1 })).toThrow()
        first.destroy()
        expect(b.destroy).not.toHaveBeenCalled()
        second.destroy()
    })
})
