'use strict'

import {
    CapabilityDagRunner,
    type CapabilityDagNode,
} from './capability-dag-runner.ts'

export type CapabilityMediaDagEvent = {
    sequence: number
    nodeId: string
    type: 'started' | 'transport-retry' | 'completed' | 'failed' | 'cancelled'
    attempt: number
}

export type CapabilityMediaDagResult<Result> = {
    results: ReadonlyMap<string, Result>
    events: CapabilityMediaDagEvent[]
}

export class CapabilityMediaDagRunner<Node extends CapabilityDagNode, Result> {
    constructor(
        private readonly nodes: readonly Node[],
        private readonly concurrency: number,
        private readonly transportRetryLimit: number,
    ) {
        if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('CAPABILITY_MEDIA_CONCURRENCY_INVALID')
        if (!Number.isInteger(transportRetryLimit) || transportRetryLimit < 0) {
            throw new Error('CAPABILITY_MEDIA_TRANSPORT_RETRY_INVALID')
        }
    }

    async run(args: {
        execute: (node: Node, signal?: AbortSignal) => Promise<Result>
        signal?: AbortSignal
        cleanup?: () => Promise<void>
        allowTerminalFailure?: (node: Node, error: unknown) => boolean
    }): Promise<CapabilityMediaDagResult<Result>> {
        const dag = new CapabilityDagRunner(this.nodes)
        const results = new Map<string, Result>()
        const unsortedEvents: Array<Omit<CapabilityMediaDagEvent, 'sequence'> & { nodeOrder: number; eventOrder: number }> = []
        const nodeOrder = new Map(this.nodes.map((node, index) => [node.nodeId, index]))
        let terminalError: unknown

        try {
            while (dag.hasPending()) {
                if (args.signal?.aborted) throw args.signal.reason ?? new DOMException('Aborted', 'AbortError')
                const ready = dag.getReadyNodes()
                if (ready.length === 0) throw new Error('CAPABILITY_MEDIA_DAG_STALLED')

                for (let offset = 0; offset < ready.length; offset += this.concurrency) {
                    const batch = ready.slice(offset, offset + this.concurrency)
                    const settled = await Promise.allSettled(batch.map(async node => {
                        dag.setStatus(node.nodeId, 'running')
                        unsortedEvents.push({
                            nodeId: node.nodeId,
                            type: 'started',
                            attempt: 1,
                            nodeOrder: nodeOrder.get(node.nodeId)!,
                            eventOrder: 0,
                        })
                        for (let attempt = 1; attempt <= this.transportRetryLimit + 1; attempt += 1) {
                            try {
                                const result = await args.execute(node, args.signal)
                                results.set(node.nodeId, result)
                                dag.setStatus(node.nodeId, 'completed')
                                unsortedEvents.push({
                                    nodeId: node.nodeId,
                                    type: 'completed',
                                    attempt,
                                    nodeOrder: nodeOrder.get(node.nodeId)!,
                                    eventOrder: 2 + attempt,
                                })
                                return
                            } catch (error) {
                                if (args.signal?.aborted || attempt > this.transportRetryLimit || !isRetryableTransportError(error)) {
                                    const allowed = !args.signal?.aborted && args.allowTerminalFailure?.(node, error) === true
                                    dag.setStatus(node.nodeId, allowed ? 'completed' : args.signal?.aborted ? 'cancelled' : 'failed')
                                    unsortedEvents.push({
                                        nodeId: node.nodeId,
                                        type: args.signal?.aborted ? 'cancelled' : 'failed',
                                        attempt,
                                        nodeOrder: nodeOrder.get(node.nodeId)!,
                                        eventOrder: 100,
                                    })
                                    if (allowed) return
                                    throw error
                                }
                                unsortedEvents.push({
                                    nodeId: node.nodeId,
                                    type: 'transport-retry',
                                    attempt: attempt + 1,
                                    nodeOrder: nodeOrder.get(node.nodeId)!,
                                    eventOrder: 1 + attempt,
                                })
                            }
                        }
                    }))
                    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
                    if (rejected) throw rejected.reason
                }
            }
        } catch (error) {
            terminalError = error
            for (const node of dag.cancelPending()) {
                unsortedEvents.push({
                    nodeId: node.nodeId,
                    type: 'cancelled',
                    attempt: 0,
                    nodeOrder: nodeOrder.get(node.nodeId)!,
                    eventOrder: 101,
                })
            }
        } finally {
            await args.cleanup?.()
        }

        const events = unsortedEvents
            .sort((left, right) => left.nodeOrder - right.nodeOrder || left.eventOrder - right.eventOrder)
            .map(({ nodeOrder: _nodeOrder, eventOrder: _eventOrder, ...event }, sequence) => ({
                ...event,
                sequence: sequence + 1,
            }))
        if (terminalError) throw terminalError
        return { results, events }
    }
}

const isRetryableTransportError = (error: unknown): boolean => {
    const candidate = error as { retryable?: unknown; status?: unknown; code?: unknown }
    return candidate?.retryable === true
        || candidate?.status === 429
        || (typeof candidate?.status === 'number' && candidate.status >= 500)
        || ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(String(candidate?.code ?? ''))
}
