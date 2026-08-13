'use strict'

import {
    CapabilityDagRunner,
    type CapabilityDagNode,
} from './capability-dag-runner.ts'
import type { CapabilityMediaDagOutputBinding } from '../shared/capability-media-execution-plan.ts'

export type CapabilityMediaDagEvent = {
    sequence: number
    nodeId: string
    type: 'started' | 'transport-retry' | 'completed' | 'failed' | 'blocked' | 'cancelled'
    attempt: number
}

export type CapabilityMediaDagNode = CapabilityDagNode & {
    outputBindings?: readonly CapabilityMediaDagOutputBinding[]
}

export type CapabilityMediaDagExecutionContext<Result> = {
    dependencyOutputs: ReadonlyMap<string, Result>
    boundOutputs: ReadonlyMap<string, Result>
}

export type CapabilityMediaDagBlockedNode = {
    missingBindingKeys: readonly string[]
    missingOutputNodeIds: readonly string[]
}

export type CapabilityMediaDagResult<Result> = {
    results: ReadonlyMap<string, Result>
    blockedNodes: ReadonlyMap<string, CapabilityMediaDagBlockedNode>
    events: CapabilityMediaDagEvent[]
}

export class CapabilityMediaDagRunner<Node extends CapabilityMediaDagNode, Result> {
    constructor(
        private readonly nodes: readonly Node[],
        private readonly concurrency: number,
        private readonly transportRetryLimit: number,
    ) {
        if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('CAPABILITY_MEDIA_CONCURRENCY_INVALID')
        if (!Number.isInteger(transportRetryLimit) || transportRetryLimit < 0) {
            throw new Error('CAPABILITY_MEDIA_TRANSPORT_RETRY_INVALID')
        }
        this.validateOutputBindings()
    }

    async run(args: {
        execute: (
            node: Node,
            context: CapabilityMediaDagExecutionContext<Result>,
            signal?: AbortSignal,
        ) => Promise<Result>
        initialResults?: ReadonlyMap<string, Result>
        signal?: AbortSignal
        cleanup?: () => Promise<void>
        allowTerminalFailure?: (node: Node, error: unknown) => boolean
        onNodeBlocked?: (node: Node, blocked: CapabilityMediaDagBlockedNode) => Promise<void> | void
    }): Promise<CapabilityMediaDagResult<Result>> {
        const dag = new CapabilityDagRunner(this.nodes)
        const knownNodeIds = new Set(this.nodes.map(node => node.nodeId))
        const results = new Map<string, Result>(args.initialResults)
        for (const nodeId of results.keys()) {
            if (!knownNodeIds.has(nodeId)) throw new Error(`CAPABILITY_MEDIA_INITIAL_RESULT_NODE_UNKNOWN:${nodeId}`)
            dag.setStatus(nodeId, 'completed')
        }
        const blockedNodes = new Map<string, CapabilityMediaDagBlockedNode>()
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
                        const context = this.buildExecutionContext(node, results)
                        const blocked = this.getBlockedNode(node, context)
                        if (blocked) {
                            blockedNodes.set(node.nodeId, blocked)
                            dag.setStatus(node.nodeId, 'skipped')
                            unsortedEvents.push({
                                nodeId: node.nodeId,
                                type: 'blocked',
                                attempt: 0,
                                nodeOrder: nodeOrder.get(node.nodeId)!,
                                eventOrder: 99,
                            })
                            await args.onNodeBlocked?.(node, blocked)
                            return
                        }
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
                                const result = await args.execute(node, context, args.signal)
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
        return { results, blockedNodes, events }
    }

    private buildExecutionContext(
        node: Node,
        results: ReadonlyMap<string, Result>,
    ): CapabilityMediaDagExecutionContext<Result> {
        const dependencyOutputs = new Map<string, Result>()
        for (const dependencyNodeId of node.dependsOn) {
            if (results.has(dependencyNodeId)) {
                dependencyOutputs.set(dependencyNodeId, results.get(dependencyNodeId)!)
            }
        }
        const boundOutputs = new Map<string, Result>()
        for (const binding of node.outputBindings ?? []) {
            if (results.has(binding.sourceNodeId)) {
                boundOutputs.set(binding.bindingKey, results.get(binding.sourceNodeId)!)
            }
        }
        return { dependencyOutputs, boundOutputs }
    }

    private getBlockedNode(
        node: Node,
        context: CapabilityMediaDagExecutionContext<Result>,
    ): CapabilityMediaDagBlockedNode | undefined {
        const missingBindings = (node.outputBindings ?? [])
            .filter(binding => binding.required && !context.boundOutputs.has(binding.bindingKey))
        if (missingBindings.length === 0) return undefined
        return {
            missingBindingKeys: missingBindings.map(binding => binding.bindingKey),
            missingOutputNodeIds: [...new Set(missingBindings.map(binding => binding.sourceNodeId))],
        }
    }

    private validateOutputBindings(): void {
        for (const node of this.nodes) {
            const bindingKeys = new Set<string>()
            for (const binding of node.outputBindings ?? []) {
                if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(binding.bindingKey)) {
                    throw new Error(`CAPABILITY_MEDIA_OUTPUT_BINDING_KEY_INVALID:${node.nodeId}:${binding.bindingKey}`)
                }
                if (!node.dependsOn.includes(binding.sourceNodeId)) {
                    throw new Error(`CAPABILITY_MEDIA_OUTPUT_BINDING_SOURCE_NOT_DEPENDENCY:${node.nodeId}:${binding.sourceNodeId}`)
                }
                if (bindingKeys.has(binding.bindingKey)) {
                    throw new Error(`CAPABILITY_MEDIA_OUTPUT_BINDING_DUPLICATE:${node.nodeId}:${binding.bindingKey}`)
                }
                bindingKeys.add(binding.bindingKey)
            }
        }
    }
}

const isRetryableTransportError = (error: unknown): boolean => {
    const candidate = error as { retryable?: unknown; status?: unknown; code?: unknown }
    return candidate?.retryable === true
        || candidate?.status === 429
        || (typeof candidate?.status === 'number' && candidate.status >= 500)
        || ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(String(candidate?.code ?? ''))
}
