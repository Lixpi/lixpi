// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { CanvasDrawingSurface } from '@lixpi/canvas-engine/frontend/rendering'
import {
    DomGlassBorder,
    type DomGlassBorderOptions,
} from './dom-glass-border.ts'

const borders = vi.hoisted(() => [] as any[])
vi.mock('./glass-border.ts', () => ({
    GlassBorder: class {
        sync = vi.fn()
        destroy = vi.fn()
        constructor() {
            borders.push(this)
        }
    },
}))

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    borders.length = 0
    document.body.replaceChildren()
})

describe('DomGlassBorder', () => {
    it('measures only supplied elements relative to its root and follows observed resizing', () => {
        const observers: Array<{ callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe = vi.fn()
                disconnect = vi.fn()
                constructor(readonly callback: () => void) {
                    observers.push(this)
                }
            },
        )
        const root = document.createElement('div')
        const target = document.createElement('div')
        const unrelated = document.createElement('div')
        unrelated.className = 'workspace-canvas-global-composer'
        root.append(target, unrelated)
        document.body.append(root)
        target.style.borderRadius = '50%'
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 400, height: 300 } as DOMRect)
        const rect = vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 30, top: 40, width: 120, height: 40 } as DOMRect)
        const invalidate = vi.fn()
        const controller = new AbortController()
        const surface = { signal: controller.signal, invalidate } as unknown as CanvasDrawingSurface
        const border = new DomGlassBorder({ root, surface } as DomGlassBorderOptions)
        border.setTargets([{ id: 'toolbar', element: target }])
        border.refresh()
        expect(borders[0].sync).toHaveBeenLastCalledWith([{ id: 'toolbar', x: 20, y: 20, width: 120, height: 40, radius: 20, visible: true }], { width: 400, height: 300 })
        expect(observers[0].observe).toHaveBeenCalledExactlyOnceWith(target)
        rect.mockReturnValue({ left: 30, top: 40, width: 180, height: 60 } as DOMRect)
        observers[0].callback()
        border.refresh()
        expect(invalidate).toHaveBeenCalledTimes(2)
        expect(borders[0].sync.mock.calls.at(-1)[0][0]).toMatchObject({ width: 180, height: 60, radius: 30 })
        target.remove()
        border.refresh()
        expect(borders[0].sync).toHaveBeenLastCalledWith([], { width: 400, height: 300 })
        controller.abort()
        border.destroy()
        expect(borders[0].destroy).toHaveBeenCalledOnce()
        expect(observers[0].disconnect).toHaveBeenCalledTimes(2)
    })
})
