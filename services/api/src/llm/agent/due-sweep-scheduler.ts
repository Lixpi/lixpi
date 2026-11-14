import { AsyncLocalStorage } from 'node:async_hooks'

// Runs a durable outbox sweep only when there is a reason to: once on start
// to recover rows a previous process left behind, whenever this process
// commits a new due row, at the earliest future due time the last sweep saw,
// and after a failed sweep. An idle process never touches the database.
export type DueSweep = () => Promise<number | undefined>

export class DueSweepScheduler {
    private runScheduledSweep?: () => void
    private sweeping = false
    private requested = false
    private timer?: ReturnType<typeof setTimeout>
    private armedAt?: number

    constructor(
        private readonly sweep: DueSweep,
        private readonly retryMs: number,
        private readonly onError: (error: unknown) => void,
    ) {}

    start(): void {
        // A wake from an accepted request must not inherit that request's scope.
        this.runScheduledSweep = AsyncLocalStorage.bind(() => void this.run())
        this.wake()
    }

    stop(): void {
        this.runScheduledSweep = undefined
        clearTimeout(this.timer)
        this.timer = undefined
        this.armedAt = undefined
    }

    wake(dueAt = Date.now()): void {
        if (!this.runScheduledSweep)
            return

        if (
            this.timer
            && this.armedAt !== undefined
            && this.armedAt <= dueAt
        )
            return

        clearTimeout(this.timer)
        this.armedAt = dueAt
        this.timer = setTimeout(
            this.runScheduledSweep,
            Math.max(0, dueAt - Date.now()),
        )
        this.timer.unref()
    }

    private async run(): Promise<void> {
        this.timer = undefined
        this.armedAt = undefined

        // A row committed while a sweep is in progress may land in a shard
        // that sweep already passed, so it gets one more sweep afterwards.
        if (this.sweeping) {
            this.requested = true

            return
        }

        this.sweeping = true
        this.requested = false
        let next: number | undefined

        try {
            next = await this.sweep()
        } catch (error) {
            this.onError(error)
            next = Date.now() + this.retryMs
        } finally {
            this.sweeping = false
        }

        if (this.requested)
            this.wake()

        if (next !== undefined)
            this.wake(next)
    }
}
