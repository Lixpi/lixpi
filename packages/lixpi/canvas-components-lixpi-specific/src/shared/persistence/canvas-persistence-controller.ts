import {
    type CanvasState,
} from '@lixpi/constants'

export type CanvasVersion = {
    updatedAt?: number
    canvasStateUpdatedAt?: number
}

export type WorkspaceCanvasSnapshot = {
    canvasState: CanvasState
    version: CanvasVersion
}

export type CanvasWriteResult =
    | {
        status: 'saved'
        workspaceId: string
        version: CanvasVersion
    }
    | {
        status: 'stale'
        workspaceId: string
        current: CanvasVersion
    }
    | {
        status: 'error'
        workspaceId: string
        error: Error
    }

export type CanvasPersistencePublication = {
    workspaceId: string
    canvasState?: CanvasState
    version?: CanvasVersion
    requiresSave: boolean
    origin: 'local-intent' | 'authoritative' | 'save-status'
}

export type CanvasPersistencePorts = {
    read: (workspaceId: string) => WorkspaceCanvasSnapshot | null
    save: (request: {
        workspaceId: string
        canvasState: CanvasState
        expectedCanvasStateUpdatedAt?: number
        persistViewport: boolean
    }) => Promise<CanvasWriteResult>
    fetch: (workspaceId: string) => Promise<WorkspaceCanvasSnapshot>
    publish: (publication: CanvasPersistencePublication) => void
    reportError: (error: Error) => void
}

type SaveRequest = {
    canvasState: CanvasState
    persistViewport: boolean
    sequence: number
}

class CanvasWriteLock {
    private locked = false
    private readonly waiters: Array<() => void> = []

    async run<Result>(operation: () => Promise<Result>): Promise<Result> {
        if (this.locked)
            await new Promise<void>(resolve => this.waiters.push(resolve))
        else
            this.locked = true

        try {
            return await operation()
        } finally {
            const next = this.waiters.shift()

            if (next)
                next()
            else
                this.locked = false
        }
    }
}

const versionToken = (version: CanvasVersion): number | undefined => {
    if (Number.isFinite(version.canvasStateUpdatedAt))
        return version.canvasStateUpdatedAt

    if (Number.isFinite(version.updatedAt))
        return version.updatedAt

    return undefined
}

const asError = (error: unknown): Error => {
    return error instanceof Error ? error : new Error(
        String(error),
    )
}

export class CanvasPersistenceController {
    private readonly lock = new CanvasWriteLock()
    private readonly mutations = new Set<Promise<unknown>>()
    private snapshot: WorkspaceCanvasSnapshot | null
    private pending: SaveRequest | null = null
    private active: SaveRequest | null = null
    private pumping: Promise<void> | null = null
    private sequence = 0
    private epoch = 0
    private staleRetryCount = 0
    private failure: Error | null = null
    private closing = false

    constructor(
        readonly workspaceId: string,
        private readonly ports: CanvasPersistencePorts,
    ) {
        const initial = ports.read(workspaceId)
        this.snapshot = initial ? structuredClone(initial) : null
    }

    update(
        canvasState: CanvasState,
        persistViewport = false,
    ): void {
        this.assertOpen()
        this.pending = {
            canvasState: structuredClone(canvasState),
            persistViewport: persistViewport || this.pending?.persistViewport === true,
            sequence: ++this.sequence,
        }
        this.staleRetryCount = 0
        this.failure = null
        this.publish({
            canvasState: this.pending.canvasState,
            requiresSave: true,
            origin: 'local-intent',
        })
        this.startPump()
    }

    async runMembershipMutation<Result>(mutation: () => Promise<Result>): Promise<Result> {
        this.assertOpen()
        const task = this.lock.run(async () => {
            const includedSequence = this.sequence
            const result = await mutation()

            if (
                this.pending
                && this.pending.sequence <= includedSequence
            )
                this.pending = null

            this.failure = null
            this.staleRetryCount = 0
            this.refreshVersion()
            this.publish({
                requiresSave: Boolean(this.pending),
                origin: 'save-status',
            })

            return result
        })
        this.mutations.add(task)

        try {
            return await task
        } catch (error) {
            this.recordFailure(error)

            throw error
        } finally {
            this.mutations.delete(task)
        }
    }

    adoptAuthoritative(snapshot: WorkspaceCanvasSnapshot): boolean {
        this.refreshVersion()
        const currentToken = versionToken(this.snapshot?.version ?? {})
        const incomingToken = versionToken(snapshot.version)

        if (
            currentToken !== undefined
            && incomingToken !== undefined
            && currentToken > incomingToken
        )
            return false

        const viewportRequest = this.pending?.persistViewport
            ? this.pending
            : this.active?.persistViewport
                ? this.active
                : null
        const viewport = viewportRequest?.canvasState.viewport
        this.epoch += 1
        this.staleRetryCount = 0
        this.failure = null
        this.snapshot = structuredClone(snapshot)
        this.pending = viewport
            ? {
                canvasState: {
                    ...structuredClone(snapshot.canvasState),
                    viewport: structuredClone(viewport),
                },
                persistViewport: true,
                sequence: ++this.sequence,
            }
            : null
        this.publish({
            canvasState: this.pending?.canvasState ?? this.snapshot.canvasState,
            version: this.snapshot.version,
            requiresSave: Boolean(this.pending),
            origin: 'authoritative',
        })
        this.startPump()

        return true
    }

    async flush(): Promise<void> {
        this.failure = null
        this.startPump()
        await this.drain()
    }

    async drain(): Promise<void> {
        while (
            this.pumping
            || this.mutations.size > 0
        ) {
            await Promise.allSettled([
                ...(this.pumping ? [this.pumping] : []),
                ...this.mutations,
            ])
        }

        if (this.failure)
            throw this.failure
    }

    async close(): Promise<void> {
        this.closing = true
        await this.drain()
    }

    read(): WorkspaceCanvasSnapshot | null {
        return this.snapshot ? structuredClone(this.snapshot) : null
    }

    readCurrent(): WorkspaceCanvasSnapshot | null {
        this.refreshVersion()

        return this.read()
    }

    getPendingViewport(): CanvasState['viewport'] | null {
        const request = this.pending?.persistViewport
            ? this.pending
            : this.active?.persistViewport
                ? this.active
                : null

        return request ? structuredClone(request.canvasState.viewport) : null
    }

    private assertOpen(): void {
        if (this.closing)
            throw new Error(`Canvas persistence for ${this.workspaceId} is closing`)
    }

    private publish(publication: Omit<CanvasPersistencePublication, 'workspaceId'>): void {
        this.ports.publish({
            ...publication,
            workspaceId: this.workspaceId,
        })
    }

    private refreshVersion(): CanvasVersion {
        const supplied = this.ports.read(this.workspaceId)

        if (supplied) {
            const suppliedToken = versionToken(supplied.version)
            const localToken = versionToken(this.snapshot?.version ?? {})

            if (
                !this.snapshot
                || localToken === undefined
                || (suppliedToken !== undefined && suppliedToken >= localToken)
            )
                this.snapshot = structuredClone(supplied)
        }

        return this.snapshot?.version ?? {}
    }

    private startPump(): void {
        if (
            !this.pumping
            && this.pending
            && !this.failure
        )
            this.pumping = this.pump()
    }

    private async pump(): Promise<void> {
        try {
            await this.lock.run(async () => await this.savePending())
        } catch (error) {
            this.recordFailure(error)
        } finally {
            this.pumping = null
            this.startPump()
        }
    }

    private readPending(): SaveRequest | null {
        return this.pending
    }

    private async savePending(): Promise<void> {
        let refetchedViewport = false

        while (this.pending) {
            const request = this.pending
            this.pending = null
            this.active = request
            const epoch = this.epoch

            try {
                const result = await this.ports.save({
                    workspaceId: this.workspaceId,
                    canvasState: request.canvasState,
                    expectedCanvasStateUpdatedAt: versionToken(
                        this.refreshVersion(),
                    ),
                    persistViewport: request.persistViewport,
                })

                if (epoch !== this.epoch)
                    continue

                if (result.workspaceId !== this.workspaceId)
                    throw new Error('Canvas save response belongs to another workspace')

                if (result.status === 'error')
                    throw result.error

                if (result.status === 'stale') {
                    if (
                        Number.isFinite(result.current.canvasStateUpdatedAt)
                        && this.staleRetryCount < 3
                    ) {
                        this.staleRetryCount += 1
                        this.setVersion(result.current, request.canvasState)
                        const pending = this.readPending()
                        this.pending = pending
                            ? {
                                ...pending,
                                persistViewport: pending.persistViewport || request.persistViewport,
                            }
                            : request

                        continue
                    }

                    const fresh = await this.ports.fetch(this.workspaceId)

                    if (epoch !== this.epoch)
                        continue

                    const latest = this.pending ?? request
                    const persistViewport = latest.persistViewport || request.persistViewport
                    this.snapshot = structuredClone(fresh)
                    this.staleRetryCount = 0
                    this.pending = null

                    if (
                        persistViewport
                        && !refetchedViewport
                    ) {
                        refetchedViewport = true
                        this.pending = {
                            canvasState: {
                                ...structuredClone(fresh.canvasState),
                                viewport: structuredClone(latest.canvasState.viewport),
                            },
                            persistViewport: true,
                            sequence: ++this.sequence,
                        }
                    }

                    this.publish({
                        canvasState: this.pending?.canvasState ?? fresh.canvasState,
                        version: fresh.version,
                        requiresSave: Boolean(this.pending),
                        origin: 'authoritative',
                    })

                    if (
                        persistViewport
                        && !this.pending
                    )
                        throw new Error('Canvas viewport save remained stale after refreshing the workspace')

                    continue
                }

                this.setVersion(result.version, request.canvasState)
                this.staleRetryCount = 0
                this.failure = null
                this.publish({
                    requiresSave: Boolean(this.pending),
                    origin: 'save-status',
                })
            } catch (error) {
                if (epoch !== this.epoch)
                    continue

                if (this.pending) {
                    this.recordFailure(error)

                    continue
                }

                this.pending = request
                this.recordFailure(error)

                return
            } finally {
                if (this.active === request)
                    this.active = null
            }
        }
    }

    private setVersion(
        version: CanvasVersion,
        canvasState: CanvasState,
    ): void {
        this.snapshot = {
            canvasState: structuredClone(canvasState),
            version: {
                ...this.snapshot?.version,
                ...version,
            },
        }
        this.publish({
            version,
            requiresSave: Boolean(this.pending),
            origin: 'save-status',
        })
    }

    private recordFailure(error: unknown): void {
        this.failure = asError(error)
        this.publish({
            requiresSave: true,
            origin: 'save-status',
        })
        this.ports.reportError(this.failure)
    }
}
