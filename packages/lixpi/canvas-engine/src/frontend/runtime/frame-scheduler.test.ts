'use strict'

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { FrameScheduler } from './frame-scheduler.ts'

afterEach(() => vi.unstubAllGlobals())

function schedulerFixture() {
    const queued = new Map<number, FrameRequestCallback>()
    let nextId = 0
    const render = vi.fn()
    const onError = vi.fn()
    const scheduler = new FrameScheduler({
        render,
        onError,
        request: callback => {
            queued.set(++nextId, callback)
            return nextId
        },
        cancel: id => {
            queued.delete(id)
        },
    })
    return {
        scheduler,
        queued,
        render,
        onError,
        frame: (time: number) => {
            const pending = Array.from(queued.values())
            queued.clear()
            for (const callback of pending) callback(time)
        },
    }
}

describe('FrameScheduler', () => {
    it('invokes the default browser frame methods with the global receiver', () => {
        const request = vi.fn(function(this: typeof globalThis) {
            if (this !== globalThis) throw new TypeError('Illegal invocation')
            return 42
        })
        const cancel = vi.fn(function(this: typeof globalThis) {
            if (this !== globalThis) throw new TypeError('Illegal invocation')
        })
        vi.stubGlobal('requestAnimationFrame', request)
        vi.stubGlobal('cancelAnimationFrame', cancel)
        const scheduler = new FrameScheduler({
            render: vi.fn(),
            onError: vi.fn(),
        })

        scheduler.invalidate()
        scheduler.destroy()

        expect(request).toHaveBeenCalledOnce()
        expect(cancel).toHaveBeenCalledWith(42)
    })

    it('coalesces dirty bounds into one frame and preserves caller rectangles', () => {
        const fixture = schedulerFixture()
        const bounds = { x: 1, y: 2, width: 3, height: 4 }
        fixture.scheduler.invalidate(bounds)
        bounds.x = 100
        fixture.scheduler.invalidate({ x: 5, y: 6, width: 7, height: 8 })
        expect(fixture.queued.size).toBe(1)
        fixture.frame(10)
        expect(fixture.render).toHaveBeenCalledOnce()
        expect(fixture.render.mock.calls[0][0]).toEqual({ full: false, bounds: [{ x: 1, y: 2, width: 3, height: 4 }, { x: 5, y: 6, width: 7, height: 8 }] })
        expect(fixture.queued.size).toBe(0)
    })

    it('runs animation before drawing and stops when its lease is released', () => {
        const fixture = schedulerFixture()
        const elapsed: number[] = []
        const release = fixture.scheduler.animate(time => {
            elapsed.push(time)
            fixture.scheduler.invalidate()
        })
        fixture.frame(10)
        fixture.frame(26)
        expect(elapsed).toEqual([0, 16])
        expect(fixture.render).toHaveBeenCalledTimes(2)
        release()
        expect(fixture.queued.size).toBe(0)
    })

    it('keeps invalidation requested during rendering for another frame', () => {
        const fixture = schedulerFixture()
        fixture.render.mockImplementationOnce(() => fixture.scheduler.invalidate())
        fixture.scheduler.invalidate()
        fixture.frame(10)
        expect(fixture.queued.size).toBe(1)
        fixture.frame(20)
        expect(fixture.render).toHaveBeenCalledTimes(2)
        expect(fixture.queued.size).toBe(0)
    })

    it('does not queue an empty frame when an animation invalidates and releases itself', () => {
        const fixture = schedulerFixture()
        const release = fixture.scheduler.animate(() => {
            fixture.scheduler.invalidate()
            release()
        })
        fixture.frame(10)
        expect(fixture.render).toHaveBeenCalledOnce()
        expect(fixture.queued.size).toBe(0)
    })

    it('removes a failed animation while allowing another one to continue', () => {
        const fixture = schedulerFixture()
        const failure = new Error('animation failed')
        const broken = vi.fn(() => {
            throw failure
        })
        const active = vi.fn()
        fixture.scheduler.animate(broken)
        fixture.scheduler.animate(active)
        fixture.frame(10)
        fixture.frame(20)
        expect(broken).toHaveBeenCalledOnce()
        expect(active).toHaveBeenCalledTimes(2)
        expect(fixture.onError).toHaveBeenCalledWith(failure)
        fixture.scheduler.destroy()
    })

    it('cancels pending work and ignores late callbacks after disposal', () => {
        const fixture = schedulerFixture()
        const callback = vi.fn()
        fixture.scheduler.animate(callback)
        fixture.scheduler.invalidate()
        const late = Array.from(fixture.queued.values())[0]
        fixture.scheduler.destroy()
        late(10)
        fixture.scheduler.invalidate()
        expect(callback).not.toHaveBeenCalled()
        expect(fixture.render).not.toHaveBeenCalled()
        expect(fixture.queued.size).toBe(0)
    })
})
