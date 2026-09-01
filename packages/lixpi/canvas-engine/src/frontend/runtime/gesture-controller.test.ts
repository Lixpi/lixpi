// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { GestureController } from './gesture-controller.ts'

afterEach(() => document.body.replaceChildren())

describe('GestureController', () => {
    it('ends a gesture once and removes movement listeners before calling completion', () => {
        const controller = new GestureController()
        const onMove = vi.fn()
        const onEnd = vi.fn(() => document.dispatchEvent(new MouseEvent('mousemove')))
        const onCancel = vi.fn()
        controller.start({ root: document.body, event: new MouseEvent('mousedown'), onMove, onEnd, onCancel })
        document.dispatchEvent(new MouseEvent('mousemove'))
        document.dispatchEvent(new MouseEvent('mouseup'))
        document.dispatchEvent(new MouseEvent('mouseup'))
        expect(onMove).toHaveBeenCalledOnce()
        expect(onEnd).toHaveBeenCalledOnce()
        controller.destroy()
        expect(onCancel).not.toHaveBeenCalled()
    })

    it('cancels scene work without committing and preserves another instance cursor lease', () => {
        const first = new GestureController()
        const second = new GestureController()
        const root = document.createElement('div')
        const onEnd = vi.fn()
        const onCancel = vi.fn()
        const config = { root, event: new MouseEvent('mousedown'), onMove: vi.fn(), onEnd, onCancel }
        first.start({ ...config, cursor: 'ew-resize' })
        second.start({ ...config, cursor: 'ns-resize' })
        first.cancelAll('scene-change')
        expect(document.body.style.cursor).toBe('ns-resize')
        expect(onCancel).toHaveBeenCalledWith('scene-change')
        expect(onEnd).not.toHaveBeenCalled()
        second.destroy()
        expect(document.body.style.cursor).toBe('')
        first.destroy()
    })

    it('filters pointer identity and cancels on Escape, blur and disposal', () => {
        for (const reason of ['escape', 'blur', 'destroyed'] as const) {
            const controller = new GestureController()
            const onMove = vi.fn()
            const onCancel = vi.fn()
            controller.start({ root: document.body, event: new PointerEvent('pointerdown', { pointerId: 1 }), onMove, onEnd: vi.fn(), onCancel })
            document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2 }))
            expect(onMove).not.toHaveBeenCalled()
            document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1 }))
            expect(onMove).toHaveBeenCalledOnce()
            if (reason === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
            else if (reason === 'blur') window.dispatchEvent(new Event('blur'))
            else controller.destroy()
            expect(onCancel).toHaveBeenCalledExactlyOnceWith(reason)
            controller.destroy()
        }
    })
})
