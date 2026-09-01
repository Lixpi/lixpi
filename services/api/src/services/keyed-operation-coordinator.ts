'use strict'

export type KeyedIdleBatch<T> = {
    key: string
    value: T
    coalescedRequestCount: number
}

type KeyedIdleBatchEntry<T> = {
    value: T
    coalescedRequestCount: number
    timer: ReturnType<typeof setTimeout> | null
}

export class KeyedIdleBatchScheduler<T> {
    private readonly entries = new Map<string, KeyedIdleBatchEntry<T>>()

    constructor(
        private readonly config: {
            delayMs: number
            onFlush: (batch: KeyedIdleBatch<T>) => Promise<void>
            onError: (error: unknown, batch: KeyedIdleBatch<T>) => void
        },
    ) {}

    schedule(key: string, value: T): void {
        const existing = this.entries.get(key)
        if (existing) {
            if (existing.timer) clearTimeout(existing.timer)
            existing.value = value
            existing.coalescedRequestCount += 1
            existing.timer = this.armTimer(key, existing)
            return
        }

        const entry: KeyedIdleBatchEntry<T> = {
            value,
            coalescedRequestCount: 1,
            timer: null,
        }
        entry.timer = this.armTimer(key, entry)
        this.entries.set(key, entry)
    }

    cancel(key: string): number {
        const entry = this.entries.get(key)
        if (!entry) return 0
        if (entry.timer) clearTimeout(entry.timer)
        this.entries.delete(key)
        return entry.coalescedRequestCount
    }

    getPendingKeyCount(): number {
        return this.entries.size
    }

    private armTimer(key: string, entry: KeyedIdleBatchEntry<T>): ReturnType<typeof setTimeout> {
        const timer = setTimeout(() => {
            void this.flushEntry(key, entry)
        }, this.config.delayMs)
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
        return timer
    }

    private async flushEntry(key: string, entry: KeyedIdleBatchEntry<T>): Promise<void> {
        if (this.entries.get(key) !== entry) return
        this.entries.delete(key)
        const batch: KeyedIdleBatch<T> = {
            key,
            value: entry.value,
            coalescedRequestCount: entry.coalescedRequestCount,
        }
        try {
            await this.config.onFlush(batch)
        } catch (error) {
            this.config.onError(error, batch)
        }
    }
}

export class KeyedOperationCoordinator {
    private readonly tails = new Map<string, Promise<unknown>>()

    private async runAfter<T>(
        previous: Promise<unknown> | undefined,
        operation: () => Promise<T>,
    ): Promise<T> {
        if (previous) {
            try {
                await previous
            } catch {
                // A failed operation releases the key for the next operation.
            }
        }
        return await operation()
    }

    async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(key)
        const current = this.runAfter(previous, operation)
        this.tails.set(key, current)
        try {
            return await current
        } finally {
            if (this.tails.get(key) === current) this.tails.delete(key)
        }
    }
}

export async function runOperationWithRetry<T>({
    operation,
    shouldRetry,
    maxAttempts,
}: {
    operation: () => Promise<T>
    shouldRetry: (error: unknown) => boolean
    maxAttempts: number
}): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await operation()
        } catch (error) {
            if (!shouldRetry(error) || attempt === maxAttempts) throw error
        }
    }
    throw new Error('OPERATION_RETRY_EXHAUSTED')
}
