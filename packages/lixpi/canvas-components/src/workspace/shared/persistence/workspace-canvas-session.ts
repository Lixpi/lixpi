import {
    CanvasPersistenceController,
    type CanvasPersistencePorts,
} from './canvas-persistence-controller.ts'

export class WorkspaceCanvasSession {
    readonly persistence: CanvasPersistenceController
    private views = 0
    private closing = false
    private readonly flushers = new Set<() => void | Promise<void>>()

    constructor(
        readonly workspaceId: string,
        ports: CanvasPersistencePorts,
    ) {
        this.persistence = new CanvasPersistenceController(workspaceId, ports)
    }

    acquire(): {
        session: WorkspaceCanvasSession
        release: () => void
    } {
        if (this.closing)
            throw new Error(`Canvas session ${this.workspaceId} is closing`)

        this.views += 1
        let released = false

        return {
            session: this,
            release: () => {
                if (released)
                    return

                released = true
                this.views -= 1
            },
        }
    }

    get viewCount(): number {
        return this.views
    }

    async flush(): Promise<void> {
        const results = await Promise.allSettled(
            [...this.flushers].map(async flush => await flush()),
        )
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)

        try {
            await this.persistence.flush()
        } catch (error) {
            errors.push(error)
        }

        if (errors.length > 0)
            throw new AggregateError(errors, 'Canvas view flush failed')
    }

    registerFlush(flush: () => void | Promise<void>): () => void {
        if (this.closing)
            throw new Error(`Canvas session ${this.workspaceId} is closing`)

        this.flushers.add(flush)

        return () => this.flushers.delete(flush)
    }

    async drain(): Promise<void> {
        await this.persistence.drain()
    }

    async close(): Promise<void> {
        this.closing = true
        const results = await Promise.allSettled(
            [...this.flushers].map(async flush => await flush()),
        )
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)

        try {
            await this.persistence.close()
        } catch (error) {
            errors.push(error)
        }

        if (errors.length > 0)
            throw new AggregateError(errors, 'Canvas view close failed')

        this.flushers.clear()
    }
}

export class WorkspaceCanvasSessionHub {
    private readonly sessions = new Map<string, WorkspaceCanvasSession>()
    private closing = false

    constructor(private readonly createPorts: (workspaceId: string) => CanvasPersistencePorts) {}

    get(workspaceId: string): WorkspaceCanvasSession {
        if (this.closing)
            throw new Error('Workspace canvas sessions are closing')

        let session = this.sessions.get(workspaceId)

        if (!session) {
            session = new WorkspaceCanvasSession(
                workspaceId,
                this.createPorts(workspaceId),
            )
            this.sessions.set(workspaceId, session)
        }

        return session
    }

    acquire(workspaceId: string): ReturnType<WorkspaceCanvasSession['acquire']> {
        return this.get(workspaceId).acquire()
    }

    async flush(): Promise<void> {
        await this.settle('flush')
    }

    async drain(): Promise<void> {
        await this.settle('drain')
    }

    async close(): Promise<void> {
        this.closing = true
        await this.settle('close')
        this.sessions.clear()
    }

    private async settle(operation: 'flush' | 'drain' | 'close'): Promise<void> {
        const results = await Promise.allSettled(
            [...this.sessions.values()].map(async session => await session[operation]()),
        )
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)

        if (errors.length > 0)
            throw new AggregateError(errors, `Canvas session ${operation} failed`)
    }
}
