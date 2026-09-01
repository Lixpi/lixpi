// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { GestureController } from './gesture-controller.ts'
import { InteractionLocks } from './interaction-locks.ts'
import { MarqueeController } from './marquee-controller.ts'

function setup() {
    const root = document.createElement('div')
    const gestures = new GestureController()
    const locks = new InteractionLocks()
    const callbacks = { onStart: vi.fn(), onChange: vi.fn(), onEnd: vi.fn(), onCancel: vi.fn() }
    const marquee = new MarqueeController({ root, gestures, getWorldPoint: (x, y) => ({ x: (x - 100) / 2, y: (y - 50) / 2 }), lock: () => locks.acquire({ selection: true }), ...callbacks })
    return {
        gestures,
        locks,
        callbacks,
        marquee,
        destroy: () => {
            marquee.destroy()
            gestures.destroy()
            locks.destroy()
        },
    }
}

describe('MarqueeController', () => {
    it('preserves a click until the axis threshold is crossed, then publishes normalized world bounds', () => {
        const f = setup()
        f.marquee.start(new MouseEvent('mousedown', { clientX: 200, clientY: 150 }))
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 203, clientY: 153 }))
        expect(f.marquee.active).toBe(false)
        expect(f.callbacks.onStart).not.toHaveBeenCalled()
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, clientY: 130 }))
        expect(f.callbacks.onStart).toHaveBeenCalledOnce()
        expect(f.callbacks.onChange).toHaveBeenLastCalledWith({ x: 40, y: 40, width: 10, height: 10 })
        const bounds = f.marquee.bounds!
        bounds.width = 900
        expect(f.marquee.bounds?.width).toBe(10)
        document.dispatchEvent(new MouseEvent('mouseup'))
        expect(f.callbacks.onEnd).toHaveBeenCalledExactlyOnceWith(true)
        expect(f.marquee.active).toBe(false)
        expect(f.locks.state.locked).toBe(false)
        f.destroy()
    })

    it('reports an empty click without clearing selection through a start callback', () => {
        const f = setup()
        f.marquee.start(new MouseEvent('mousedown'))
        document.dispatchEvent(new MouseEvent('mouseup'))
        expect(f.callbacks.onStart).not.toHaveBeenCalled()
        expect(f.callbacks.onChange).not.toHaveBeenCalled()
        expect(f.callbacks.onEnd).toHaveBeenCalledExactlyOnceWith(false)
        f.destroy()
    })

    it('cancels scene work without a completion callback or releasing another owner', () => {
        const f = setup()
        const releasePanel = f.locks.acquire()
        f.marquee.start(new MouseEvent('mousedown'))
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 }))
        f.gestures.cancelAll('scene-change')
        expect(f.marquee.bounds).toBeNull()
        expect(f.callbacks.onCancel).toHaveBeenCalledExactlyOnceWith('scene-change')
        expect(f.callbacks.onEnd).not.toHaveBeenCalled()
        expect(f.locks.state.locked).toBe(true)
        releasePanel()
        document.dispatchEvent(new MouseEvent('mouseup'))
        expect(f.callbacks.onEnd).not.toHaveBeenCalled()
        f.destroy()
    })
})
