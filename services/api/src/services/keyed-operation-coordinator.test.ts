'use strict'

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    KeyedIdleBatchScheduler,
    KeyedOperationCoordinator,
    runOperationWithRetry,
} from './keyed-operation-coordinator.ts'

afterEach(() => {
    vi.useRealTimers()
})

describe('KeyedIdleBatchScheduler', () => {
    it('coalesces every request for one key into one idle flush with the latest value', async () => {
        vi.useFakeTimers()
        const onFlush = vi.fn(async () => undefined)
        const onError = vi.fn()
        const scheduler = new KeyedIdleBatchScheduler<number>({ delayMs: 1000, onFlush, onError })

        for (let request = 1; request <= 601; request += 1) {
            scheduler.schedule('asset-1:conversation', request)
        }

        expect(scheduler.getPendingKeyCount()).toBe(1)
        await vi.advanceTimersByTimeAsync(999)
        expect(onFlush).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(onFlush).toHaveBeenCalledOnce()
        expect(onFlush).toHaveBeenCalledWith({
            key: 'asset-1:conversation',
            value: 601,
            coalescedRequestCount: 601,
        })
        expect(onError).not.toHaveBeenCalled()
        expect(scheduler.getPendingKeyCount()).toBe(0)
    })

    it('flushes different keys independently', async () => {
        vi.useFakeTimers()
        const batches: Array<{ key: string; value: number; coalescedRequestCount: number }> = []
        const scheduler = new KeyedIdleBatchScheduler<number>({
            delayMs: 1000,
            onFlush: async (batch) => {
                batches.push(batch)
            },
            onError: vi.fn(),
        })

        scheduler.schedule('asset-1:conversation', 1)
        scheduler.schedule('asset-2:content', 2)
        await vi.advanceTimersByTimeAsync(1000)

        expect(batches).toEqual([
            { key: 'asset-1:conversation', value: 1, coalescedRequestCount: 1 },
            { key: 'asset-2:content', value: 2, coalescedRequestCount: 1 },
        ])
    })

    it('cancels a pending flush and reports how many requests it removed', async () => {
        vi.useFakeTimers()
        const onFlush = vi.fn(async () => undefined)
        const scheduler = new KeyedIdleBatchScheduler<number>({
            delayMs: 1000,
            onFlush,
            onError: vi.fn(),
        })

        scheduler.schedule('asset-1:conversation', 1)
        scheduler.schedule('asset-1:conversation', 2)

        expect(scheduler.cancel('asset-1:conversation')).toBe(2)
        expect(scheduler.cancel('asset-1:conversation')).toBe(0)
        await vi.advanceTimersByTimeAsync(1000)
        expect(onFlush).not.toHaveBeenCalled()
    })
})

describe('KeyedOperationCoordinator', () => {
    it('serializes operations sharing a key', async () => {
        const coordinator = new KeyedOperationCoordinator()
        const order: string[] = []
        let releaseFirst: () => void = () => undefined
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })

        const first = coordinator.run('asset-1:conversation', async () => {
            order.push('first:start')
            await firstGate
            order.push('first:end')
        })
        const second = coordinator.run('asset-1:conversation', async () => {
            order.push('second:start')
            order.push('second:end')
        })

        expect(order).toEqual(['first:start'])
        releaseFirst()
        await Promise.all([first, second])
        expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
    })

    it('does not let a failed operation poison the next operation', async () => {
        const coordinator = new KeyedOperationCoordinator()

        await expect(coordinator.run('asset-1:conversation', async () => {
            throw new Error('first failed')
        })).rejects.toThrow('first failed')
        await expect(coordinator.run('asset-1:conversation', async () => 'settled'))
            .resolves.toBe('settled')
    })
})

describe('runOperationWithRetry', () => {
    it('retries matching failures and returns the successful result', async () => {
        const conditionalError = new Error('conditional conflict')
        const operation = vi.fn()
            .mockRejectedValueOnce(conditionalError)
            .mockRejectedValueOnce(conditionalError)
            .mockResolvedValue('settled')

        await expect(runOperationWithRetry({
            operation,
            shouldRetry: error => error === conditionalError,
            maxAttempts: 5,
        })).resolves.toBe('settled')
        expect(operation).toHaveBeenCalledTimes(3)
    })

    it('does not retry non-matching failures', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('storage unavailable'))

        await expect(runOperationWithRetry({
            operation,
            shouldRetry: () => false,
            maxAttempts: 5,
        })).rejects.toThrow('storage unavailable')
        expect(operation).toHaveBeenCalledTimes(1)
    })
})
