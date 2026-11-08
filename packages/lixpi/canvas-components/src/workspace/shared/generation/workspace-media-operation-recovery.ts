import {
    type CanvasState,
    type MediaGenerationRequest,
    type MediaGenerationRequestEvent,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import {
    applyMediaGenerationRequestEventToOperationNodes,
    applyMediaGenerationRequestToOperationNodes,
    type MediaGenerationOperationRecoveryResult,
} from './operation-recovery.ts'

export type CanvasMediaRecoveryScope = {
    workspaceId: string
    sceneKey: string
}
export type CanvasMediaRecoveryEnvelope = {
    event?: MediaGenerationRequestEvent
    streamSequence?: number
}
export type WorkspaceMediaOperationRecoveryPorts = {
    readScope: () => CanvasMediaRecoveryScope | null
    readCanvasState: () => CanvasState | null
    fetch: (request: {
        workspaceId: string
        generationRequestId: string
        includeCheckpoint: false
    }) => Promise<{
        request: MediaGenerationRequest
        liveSubject: string
    }>
    replay: (request: {
        workspaceId: string
        generationRequestId: string
        startStreamSequence?: number
    }) => Promise<{
        request: MediaGenerationRequest
        replay: {
            events: Array<{
                event: MediaGenerationRequestEvent
                streamSequence: number
            }>
            hasMore: boolean
        }
    }>
    subscribe: (
        subject: string,
        receive: (event: CanvasMediaRecoveryEnvelope) => void,
    ) => () => void
    apply: (
        result: MediaGenerationOperationRecoveryResult,
        progressOnly: boolean,
    ) => void
    reportError: (error: unknown) => void
}
type Recovery = {
    scope: CanvasMediaRecoveryScope
    requestId: string
    seenSequences: Set<number>
    revision: number
    unsubscribe?: () => void
    pending?: Promise<void>
}

export class WorkspaceMediaOperationRecovery {
    private readonly requests = new Map<string, Recovery>()
    private destroyed = false

    constructor(private readonly ports: WorkspaceMediaOperationRecoveryPorts) {}

    revision(requestId: string): number {
        return this.requests.get(requestId)?.revision ?? 0
    }

    ensure(node: OperationStatusCanvasNode): Promise<void> {
        if (
            this.destroyed
            || node.operation !== 'media-generation'
            || node.status === 'failed'
            || !node.generationRequestId
        )
            return Promise.resolve()

        const scope = this.ports.readScope()

        if (!scope)
            return Promise.resolve()

        const existing = this.requests.get(node.generationRequestId)

        if (
            existing
            && this.isCurrent(existing)
        )
            return existing.pending ?? Promise.resolve()

        if (existing)
            this.release(existing)

        const recovery: Recovery = {
            scope: { ...scope },
            requestId: node.generationRequestId,
            seenSequences: new Set(),
            revision: 0,
        }
        this.requests.set(recovery.requestId, recovery)
        recovery.pending = this.recover(recovery)

        return recovery.pending
    }

    clear(): void {
        const requests = [...this.requests.values()]
        this.requests.clear()
        const errors: unknown[] = []

        for (const request of requests) {
            try {
                request.unsubscribe?.()
            } catch (error) {
                errors.push(error)
            }

            request.unsubscribe = undefined
        }

        if (errors.length)
            throw new AggregateError(errors, 'Canvas recovery subscription cleanup failed')
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.clear()
    }

    private async recover(recovery: Recovery): Promise<void> {
        // Install the request entry before a synchronous transport or publication can reenter ensure.
        await Promise.resolve()

        try {
            if (!this.isCurrent(recovery))
                return

            const identity = {
                workspaceId: recovery.scope.workspaceId,
                generationRequestId: recovery.requestId,
            }
            const result = await this.ports.fetch({
                ...identity,
                includeCheckpoint: false,
            })

            if (!this.isCurrent(recovery))
                return

            this.applyRequest(recovery, result.request)

            if (!this.isCurrent(recovery))
                return

            const unsubscribe = this.ports.subscribe(result.liveSubject, envelope => this.applyEnvelope(recovery, envelope))

            if (!this.isCurrent(recovery)) {
                unsubscribe()

                return
            }

            recovery.unsubscribe = unsubscribe
            let startStreamSequence: number | undefined

            while (this.isCurrent(recovery)) {
                const replay = await this.ports.replay({
                    ...identity,
                    ...(startStreamSequence === undefined ? {} : { startStreamSequence }),
                })

                if (!this.isCurrent(recovery))
                    return

                this.applyRequest(recovery, replay.request)
                let maximumSequence = (startStreamSequence ?? 1) - 1

                for (const envelope of replay.replay.events) {
                    maximumSequence = Math.max(maximumSequence, envelope.streamSequence)
                    this.applyEnvelope(recovery, envelope)
                }

                if (
                    !replay.replay.hasMore
                    || !this.isCurrent(recovery)
                )
                    return

                if (maximumSequence < (startStreamSequence ?? 1))
                    throw new Error('Canvas media replay made no progress')

                startStreamSequence = maximumSequence + 1
            }
        } catch (error) {
            if (!this.isCurrent(recovery))
                return

            const errors = [error]

            try {
                this.release(recovery)
            } catch (cleanupError) {
                errors.push(cleanupError)
            }

            this.ports.reportError(errors.length === 1 ? error : new AggregateError(errors, 'Canvas media recovery failed'))
        }
    }

    private applyRequest(
        recovery: Recovery,
        request: MediaGenerationRequest,
    ): void {
        if (!this.isCurrent(recovery))
            return

        if (
            request.workspaceId !== recovery.scope.workspaceId
            || request.generationRequestId !== recovery.requestId
        )
            throw new Error('Canvas media recovery returned another workspace or request')

        if (request.revision < recovery.revision)
            return

        recovery.revision = request.revision
        const state = this.ports.readCanvasState()

        if (state)
            this.ports.apply(
                applyMediaGenerationRequestToOperationNodes(state, request),
                false,
            )
    }

    private applyEnvelope(
        recovery: Recovery,
        envelope: CanvasMediaRecoveryEnvelope,
    ): void {
        if (!this.isCurrent(recovery))
            return

        const event = envelope.event

        if (
            !event
            || event.generationRequestId !== recovery.requestId
        )
            return

        if (typeof envelope.streamSequence === 'number') {
            if (recovery.seenSequences.has(envelope.streamSequence))
                return

            recovery.seenSequences.add(envelope.streamSequence)
        }

        if (event.requestRevision < recovery.revision)
            return

        recovery.revision = event.requestRevision
        const state = this.ports.readCanvasState()

        if (state)
            this.ports.apply(
                applyMediaGenerationRequestEventToOperationNodes(state, event),
                event.status === 'MEDIA_GENERATION_PROGRESS',
            )
    }

    private isCurrent(recovery: Recovery): boolean {
        if (
            this.destroyed
            || this.requests.get(recovery.requestId) !== recovery
        )
            return false

        const scope = this.ports.readScope()

        return scope?.workspaceId === recovery.scope.workspaceId && scope.sceneKey === recovery.scope.sceneKey
    }

    private release(recovery: Recovery): void {
        if (this.requests.get(recovery.requestId) === recovery)
            this.requests.delete(recovery.requestId)

        const unsubscribe = recovery.unsubscribe
        recovery.unsubscribe = undefined
        unsubscribe?.()
    }
}
