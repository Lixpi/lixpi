import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { IdleTask } from './idle-task.ts'

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('IdleTask', () => {
    it('cancels pending idle callbacks on abort and ignores late callbacks', () => {
        const request = vi.fn((_callback: () => void, _options: { timeout: number }) => 7)
        const cancel = vi.fn()
        vi.stubGlobal('requestIdleCallback', request)
        vi.stubGlobal('cancelIdleCallback', cancel)
        const controller = new AbortController()
        const callback = vi.fn()
        const task = new IdleTask({ callback, signal: controller.signal, timeoutMs: 2000 })
        controller.abort()
        task.destroy()
        request.mock.calls[0][0]()
        expect(cancel).toHaveBeenCalledExactlyOnceWith(7)
        expect(callback).not.toHaveBeenCalled()
    })

    it('uses a cancellable timer when the idle API is unavailable', () => {
        vi.useFakeTimers()
        vi.stubGlobal('requestIdleCallback', undefined)
        const callback = vi.fn()
        const cancelled = new IdleTask({ callback })
        cancelled.destroy()
        const active = new IdleTask({ callback })
        vi.runAllTimers()
        active.destroy()
        expect(callback).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
    })
})
