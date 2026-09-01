// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { GeometryOverrides } from './geometry-overrides.ts'
import { GestureController } from './gesture-controller.ts'
import { InteractionLocks } from './interaction-locks.ts'
import { NodeTransformController } from './node-transform-controller.ts'

function setup() {
    const root = document.createElement('div')
    const overrides = new GeometryOverrides()
    const gestures = new GestureController()
    const locks = new InteractionLocks()
    const controller = new NodeTransformController({ root, overrides, gestures, getViewport: () => ({ x: 0, y: 0, zoom: 2 }) })
    const callbacks = { onStart: vi.fn(), onChange: vi.fn(), onEnd: vi.fn(), onCancel: vi.fn() }
    const event = new MouseEvent('mousedown', { clientX: 10, clientY: 20 })
    return {
        controller,
        overrides,
        gestures,
        locks,
        callbacks,
        event,
        destroy: () => {
            gestures.destroy()
            overrides.destroy()
            locks.destroy()
        },
    }
}

function move(x: number, y: number) {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }))
}
function release() {
    document.dispatchEvent(new MouseEvent('mouseup'))
}

describe('NodeTransformController', () => {
    it('defers drag activation until the threshold and preserves rigid group spacing under zoom', () => {
        const f = setup()
        const projection = f.overrides.createScope()
        projection.set('a', { position: { x: 50, y: 60 } })
        const targets = [
            { nodeId: 'a', bounds: { x: 50, y: 60, width: 100, height: 100 } },
            { nodeId: 'b', bounds: { x: 250, y: 80, width: 50, height: 50 } },
        ]
        f.controller.startDrag({ ...f.callbacks, event: f.event, targets, threshold: 4, lock: () => f.locks.acquire() })
        move(11, 21)
        expect(f.callbacks.onChange).not.toHaveBeenCalled()
        move(30, 40)
        expect(f.callbacks.onStart).toHaveBeenCalledOnce()
        expect(f.overrides.get('a')?.position).toEqual({ x: 60, y: 70 })
        expect(f.overrides.get('b')?.position).toEqual({ x: 260, y: 90 })
        release()
        expect(f.callbacks.onEnd).toHaveBeenCalledWith(
            expect.any(MouseEvent),
            new Map([
                ['a', { x: 60, y: 70, width: 100, height: 100 }],
                ['b', { x: 260, y: 90, width: 50, height: 50 }],
            ]),
            true,
        )
        expect(f.overrides.get('a')?.position).toEqual({ x: 50, y: 60 })
        expect(f.overrides.get('b')).toBeUndefined()
        expect(f.locks.state.locked).toBe(false)
        expect(targets[0].bounds.x).toBe(50)
        f.destroy()
    })

    it('reports a click without publishing geometry when movement stays below the drag threshold', () => {
        const f = setup()
        f.controller.startDrag({ ...f.callbacks, event: f.event, threshold: 4, targets: [{ nodeId: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } }] })
        move(12, 21)
        release()
        expect(f.callbacks.onStart).not.toHaveBeenCalled()
        expect(f.callbacks.onChange).not.toHaveBeenCalled()
        expect(f.callbacks.onEnd.mock.lastCall?.[2]).toBe(false)
        f.destroy()
    })

    it('cancels a constrained resize without committing or releasing another interaction lock', () => {
        const f = setup()
        const releasePanel = f.locks.acquire()
        f.controller.startResize({
            ...f.callbacks,
            event: f.event,
            target: { nodeId: 'a', bounds: { x: 0, y: 0, width: 100, height: 50 } },
            handle: 'bottom-right',
            constraints: { min: { width: 50, height: 25 }, max: { width: 120, height: 60 }, preserveAspectRatio: true },
            lock: () => f.locks.acquire(),
        })
        move(210, 220)
        expect(f.overrides.get('a')?.dimensions).toEqual({ width: 120, height: 60 })
        f.gestures.cancelAll('scene-change')
        expect(f.callbacks.onCancel).toHaveBeenCalledExactlyOnceWith('scene-change')
        expect(f.callbacks.onEnd).not.toHaveBeenCalled()
        expect(f.overrides.get('a')).toBeUndefined()
        expect(f.locks.state.locked).toBe(true)
        releasePanel()
        expect(f.locks.state.locked).toBe(false)
        move(400, 400)
        release()
        expect(f.callbacks.onChange).toHaveBeenCalledOnce()
        f.destroy()
    })
})
