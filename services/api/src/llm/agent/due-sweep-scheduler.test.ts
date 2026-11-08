import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { DueSweepScheduler } from './due-sweep-scheduler.ts'

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
})

afterEach(() => vi.useRealTimers())

describe('DueSweepScheduler', () => {
    it('sweeps once on start and never again while idle', async () => {
        const sweep = vi.fn(async () => undefined)
        const scheduler = new DueSweepScheduler(
            sweep,
            1000,
            () => {},
        )
        scheduler.start()
        await vi.advanceTimersByTimeAsync(60_000)

        expect(sweep).toHaveBeenCalledTimes(1)
        scheduler.stop()
    })

    it('sweeps when woken and at the next due time the sweep reported', async () => {
        const sweep = vi.fn(async (): Promise<number | undefined> => undefined)
        sweep.mockResolvedValueOnce(15_000)
        const scheduler = new DueSweepScheduler(
            sweep,
            1000,
            () => {},
        )
        scheduler.start()
        await vi.advanceTimersByTimeAsync(4_999)
        expect(sweep).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(1)
        expect(sweep).toHaveBeenCalledTimes(2)

        scheduler.wake()
        await vi.advanceTimersByTimeAsync(0)
        expect(sweep).toHaveBeenCalledTimes(3)

        await vi.advanceTimersByTimeAsync(60_000)
        expect(sweep).toHaveBeenCalledTimes(3)
        scheduler.stop()
    })

    it('retries a failed sweep after the retry delay', async () => {
        const failure = new Error('UNAVAILABLE')
        const onError = vi.fn()
        const sweep = vi.fn(async (): Promise<number | undefined> => undefined)
        sweep.mockRejectedValueOnce(failure)
        const scheduler = new DueSweepScheduler(
            sweep,
            1000,
            onError,
        )
        scheduler.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(onError).toHaveBeenCalledWith(failure)

        await vi.advanceTimersByTimeAsync(1000)
        expect(sweep).toHaveBeenCalledTimes(2)

        await vi.advanceTimersByTimeAsync(60_000)
        expect(sweep).toHaveBeenCalledTimes(2)
        scheduler.stop()
    })

    it('sweeps again when woken during a sweep', async () => {
        let release: () => void
        const blocked = new Promise<void>(resolve => void (release = resolve))
        const sweep = vi.fn(async (): Promise<number | undefined> => undefined)
        sweep.mockImplementationOnce(async () => {
            await blocked

            return undefined
        })
        const scheduler = new DueSweepScheduler(
            sweep,
            1000,
            () => {},
        )
        scheduler.start()
        await vi.advanceTimersByTimeAsync(0)
        scheduler.wake()
        await vi.advanceTimersByTimeAsync(0)
        expect(sweep).toHaveBeenCalledTimes(1)

        release!()
        await vi.advanceTimersByTimeAsync(0)
        expect(sweep).toHaveBeenCalledTimes(2)
        scheduler.stop()
    })

    it('ignores wakes after stop', async () => {
        const sweep = vi.fn(async () => undefined)
        const scheduler = new DueSweepScheduler(
            sweep,
            1000,
            () => {},
        )
        scheduler.start()
        scheduler.stop()
        scheduler.wake()
        await vi.advanceTimersByTimeAsync(60_000)

        expect(sweep).not.toHaveBeenCalled()
    })
})
