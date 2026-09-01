'use strict'

import type { Dispose } from '../../shared/index.ts'

export type IdleTaskOptions = {
    callback: () => void
    signal?: AbortSignal
    timeoutMs?: number
}

export class IdleTask {
    private cancel: Dispose = () => {}
    private finished = false

    constructor(private readonly options: IdleTaskOptions) {
        if (options.signal?.aborted) {
            this.finished = true
            return
        }
        options.signal?.addEventListener('abort', this.destroy, { once: true })
        if (typeof globalThis.requestIdleCallback === 'function') {
            const id = globalThis.requestIdleCallback(this.run, { timeout: options.timeoutMs ?? 1500 })
            this.cancel = () => globalThis.cancelIdleCallback(id)
        } else {
            const id = setTimeout(this.run, Math.min(options.timeoutMs ?? 250, 250))
            this.cancel = () => clearTimeout(id)
        }
    }

    private run = (): void => {
        if (this.finished) return
        this.finished = true
        this.cancel = () => {}
        this.options.signal?.removeEventListener('abort', this.destroy)
        this.options.callback()
    }

    destroy = (): void => {
        if (this.finished) return
        this.finished = true
        this.cancel()
        this.options.signal?.removeEventListener('abort', this.destroy)
    }
}
