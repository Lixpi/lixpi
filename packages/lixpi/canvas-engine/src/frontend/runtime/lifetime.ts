import {
    type Dispose,
} from '../../shared/scene/types.ts'

// A lifetime owns listeners, leases and pending work, including partial mounts.
export class Lifetime {
    private readonly abortController = new AbortController()
    private readonly cleanups = new Set<Dispose>()
    private disposed = false

    get signal(): AbortSignal {
        return this.abortController.signal
    }

    own(cleanup: Dispose): Dispose {
        let released = false
        const release = () => {
            if (released)
                return

            released = true
            this.cleanups.delete(release)
            cleanup()
        }

        if (this.disposed)
            release()
        else
            this.cleanups.add(release)

        return release
    }

    child(): Lifetime {
        const child = new Lifetime()
        const release = this.own(() => child.destroy())
        child.signal.addEventListener(
            'abort',
            () => this.cleanups.delete(release),
            { once: true },
        )

        return child
    }

    destroy(): void {
        if (this.disposed)
            return

        this.disposed = true
        this.abortController.abort()
        const errors: unknown[] = []

        for (const cleanup of Array.from(this.cleanups).reverse()) {
            try {
                cleanup()
            } catch (error) {
                errors.push(error)
            }
        }

        this.cleanups.clear()

        if (errors.length > 0)
            throw new AggregateError(errors, 'Canvas lifetime cleanup failed')
    }
}
