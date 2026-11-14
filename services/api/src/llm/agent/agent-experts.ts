import { createHash } from 'node:crypto'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'
import {
    validateJsonSchemaValue,
    type CapabilityAgentExpert,
} from '@lixpi/capability-system/backend'
import {
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'
import {
    AgentExecutionScope,
    type AgentExecution,
    type AgentExecutionPermissions,
} from './agent-execution-scope.ts'
import {
    AgentToolsPending,
    type ConversationMediaOperations,
} from './agent-pending-tools.ts'
import { conversationPayloadHash } from './conversation-protocol.ts'
import {
    type ConversationOwner,
} from './conversation-owner.ts'

export type AgentExpertRequest = {
    expertName: string
    task: string
    sourceAssetIds: string[]
    arguments?: Readonly<Record<string, unknown>>
}

export type AgentExpertInvocation = AgentExpertRequest & {
    operationId: string
    revision: number
    inputHash: string
    definitionHash: string
    runId: string
    continuationEpoch: number
    permissions: AgentExecutionPermissions
    state: 'prepared' | 'submitted' | 'waiting' | 'completed' | 'failed' | 'cancelled'
    operationIds: string[]
    createdAssetIds: string[]
    payload?: AgentPayload
    acknowledged: boolean
}

export type AgentExpertRun = {
    invocation: AgentExpertInvocation
    expert: CapabilityAgentExpert & { runtime: { kind: 'agent' } }
    execution: AgentExecution
    signal: AbortSignal
    retainOperations: (operationIds: string[]) => Promise<void>
}

export type AgentWorkflowExpertRun = Omit<AgentExpertRun, 'expert'> & {
    expert: CapabilityAgentExpert & { runtime: { kind: 'workflow' } }
}

// A workflow binding separates submission from reconciliation. Recovery calls
// resume with the original invocation identity and must never submit it again.
export type AgentWorkflowExpertExecutor = {
    start: (request: AgentWorkflowExpertRun) => Promise<unknown>
    resume: (request: AgentWorkflowExpertRun) => Promise<unknown>
}

export type AgentExpertsOptions = {
    repository: ConversationRepository
    payloads: AgentPayloadPort
    execution: AgentExecution
    resolve: (name: string) => Promise<CapabilityAgentExpert | undefined>
    run: (request: AgentExpertRun) => Promise<unknown>
    workflow?: AgentWorkflowExpertExecutor
    operations: ConversationMediaOperations
}

// A specialist reuses the calling run's budget and lease. Its own checkpoint and
// model-call namespace survive pending media work without replaying completed tools.
export class AgentExperts {
    private readonly controllers = new Map<string, AbortController>()
    private readonly active = new Map<string, Promise<unknown>>()

    constructor(private readonly options: AgentExpertsOptions) {}

    static async cancelForRun(
        repository: ConversationRepository,
        owner: ConversationOwner,
    ): Promise<void> {
        const run = (await owner.read()).run

        if (!run)
            return

        let after: string | undefined

        do {
            const page = await repository.query<AgentExpertInvocation>(
                owner.partition,
                'EXPERT#',
                { after },
            )

            for (const invocation of page.items.filter(item => item.runId === run.runId && ['prepared', 'submitted', 'waiting'].includes(item.state))) {
                const key = `EXPERT#${invocation.operationId}`

                for (let attempt = 0; attempt < 10; attempt++) {
                    const current = await repository.read<AgentExpertInvocation>(owner.partition, key)

                    if (
                        !current
                        || !['prepared', 'submitted', 'waiting'].includes(current.state)
                    )
                        break

                    try {
                        await repository.commit([
                            ...await owner.fences(),
                            repository.put(
                                owner.partition,
                                key,
                                {
                                    ...current,
                                    revision: current.revision + 1,
                                    state: 'cancelled',
                                },
                                current.revision,
                            ),
                        ])

                        break
                    } catch (error) {
                        if (
                            !isTransactionConditionalCheckFailure(error)
                            || attempt === 9
                        )
                            throw error
                    }
                }
            }

            after = page.cursor
        } while (after)
    }

    async delegate(
        request: AgentExpertRequest,
        callId: string,
    ): Promise<unknown> {
        if (!callId)
            throw new Error('AGENT_EXPERT_CALL_ID_REQUIRED')

        const execution = this.options.execution
        await execution.owner.fences(execution.continuationEpoch)
        const run = (await execution.owner.read()).run!
        const expert = await this.resolve(request.expertName)

        if (
            expert.runtime.kind === 'workflow'
            && !validateJsonSchemaValue(expert.runtime.schema, request.arguments ?? {}).valid
        )
            throw new Error('AGENT_EXPERT_INPUT_INVALID')

        await AgentExecutionScope.assertReadTargets(request.sourceAssetIds)
        const operationId = `expert:${createHash('sha256').update(`${run.runId}:${execution.continuationEpoch}:${callId}`).digest('hex')}`
        const inputHash = conversationPayloadHash(request)
        let invocation = await this.options.repository.read<AgentExpertInvocation>(
            execution.owner.partition,
            this.key(operationId),
        )

        if (
            invocation
            && invocation.inputHash !== inputHash
        )
            throw new Error('AGENT_EXPERT_IDEMPOTENCY_CONFLICT')

        if (!invocation) {
            const allowed = execution.permissions.allowedOperationFamilies.filter(family => expert.operationFamilies.includes(family))
            invocation = {
                ...request,
                operationId,
                revision: 1,
                inputHash,
                definitionHash: conversationPayloadHash(expert),
                runId: run.runId,
                continuationEpoch: execution.continuationEpoch,
                permissions: {
                    ...execution.permissions,
                    allowedOperationFamilies: allowed,
                },
                state: 'prepared',
                operationIds: [],
                createdAssetIds: [],
                acknowledged: false,
            }

            try {
                await execution.owner.mutate(
                    meta => {
                        const current = meta.run

                        if (
                            !current
                            || current.continuationEpoch !== execution.continuationEpoch
                            || !['running', 'waiting-tools'].includes(current.state)
                        )
                            throw new Error('CONVERSATION_CONTINUATION_STOPPED')

                        if (current.budget.specialistCalls >= current.budget.maxSpecialistCalls)
                            throw new Error('AGENT_BUDGET_EXHAUSTED:specialistCalls')

                        return {
                            ...meta,
                            run: {
                                ...current,
                                budget: {
                                    ...current.budget,
                                    specialistCalls: current.budget.specialistCalls + 1,
                                },
                            },
                        }
                    },
                    () => [this.options.repository.put(
                        execution.owner.partition,
                        this.key(operationId),
                        invocation!,
                    )],
                )
            } catch (error) {
                const saved = await this.options.repository.read<AgentExpertInvocation>(
                    execution.owner.partition,
                    this.key(operationId),
                )

                if (saved?.inputHash !== inputHash)
                    throw error

                invocation = saved
            }
        }

        return await this.advanceOne(invocation)
    }

    operations(): ConversationMediaOperations {
        return {
            get: async (_owner, operationId) => await this.read(operationId),
            cancelOperation: async (_owner, operationId) => await this.cancelOne(await this.read(operationId)),
            advance: async () => {
                const completed: Array<{
                    operationId: string
                    result: unknown
                }> = []
                let pending = false

                for (const invocation of await this.invocations()) {
                    const result = await this.advanceOne(invocation)

                    if (this.isPending(result))
                        pending = true
                    else
                        completed.push({
                            operationId: invocation.operationId,
                            result,
                        })
                }

                return {
                    pending,
                    completed,
                }
            },
            acknowledge: async (_owner, operationId) => {
                const invocation = await this.read(operationId)
                await this.save({
                    ...invocation,
                    acknowledged: true,
                })
            },
            cancel: async () => {
                for (const invocation of await this.invocations())
                    await this.cancelOne(invocation)
            },
        }
    }

    owns(operationId: string): boolean {
        return operationId.startsWith('expert:')
    }

    private async advanceOne(invocation: AgentExpertInvocation): Promise<unknown> {
        const running = this.active.get(invocation.operationId)

        if (running)
            return await running

        const operation = this.executeOne(invocation)
        this.active.set(invocation.operationId, operation)

        try {
            return await operation
        } finally {
            this.active.delete(invocation.operationId)
        }
    }

    private async executeOne(invocation: AgentExpertInvocation): Promise<unknown> {
        const execution = this.options.execution
        await execution.owner.fences(execution.continuationEpoch)
        invocation = await this.read(invocation.operationId)

        const expert = await this.resolve(invocation.expertName)

        if (invocation.definitionHash !== conversationPayloadHash(expert))
            throw new Error('AGENT_EXPERT_DEFINITION_CHANGED')

        await AgentExecutionScope.assertReadTargets(invocation.sourceAssetIds)

        if (invocation.payload)
            return JSON.parse(
                Buffer.from(await this.options.payloads.read(invocation.payload)).toString('utf8'),
            )

        if (invocation.state === 'cancelled')
            return {
                status: 'error',
                error: {
                    code: 'AGENT_EXPERT_CANCELLED',
                    recoverable: false,
                },
            }

        const controller = new AbortController()
        this.controllers.set(invocation.operationId, controller)
        const permissions = {
            ...invocation.permissions,
            readOnly: invocation.permissions.readOnly || execution.permissions.readOnly,
            allowedOperationFamilies: invocation.permissions.allowedOperationFamilies.filter(
                family => execution.permissions.allowedOperationFamilies.includes(family)
                    && expert.operationFamilies.includes(family),
            ),
        }
        const child: AgentExecution = {
            ...execution,
            invocationId: invocation.operationId,
            permissions,
            createdAssetIds: new Set([
                ...invocation.createdAssetIds,
                ...invocation.sourceAssetIds.filter(id => execution.createdAssetIds.has(id)),
            ]),
            assertReadTarget: async assetId => {
                if (!invocation.sourceAssetIds.includes(assetId))
                    throw new Error('AGENT_EXPERT_SOURCE_NOT_DELEGATED')

                await execution.assertReadTarget?.(assetId)
            },
        }

        try {
            const details = {
                invocation,
                execution: child,
                signal: AbortSignal.any([execution.owner.abort.signal, controller.signal]),
                retainOperations: async (operationIds: string[]) => {
                    invocation = {
                        ...invocation,
                        operationIds: [...new Set(operationIds)],
                        createdAssetIds: [...child.createdAssetIds],
                    }
                    await this.save(invocation)
                },
            }
            const result = await AgentExecutionScope.run(child, async () => {
                if (expert.runtime.kind === 'agent')
                    return await this.options.run({
                        ...details,
                        expert: expert as AgentExpertRun['expert'],
                    })

                const initial = invocation.state === 'prepared'

                if (initial) {
                    invocation = {
                        ...invocation,
                        state: 'submitted',
                    }
                    await this.save(invocation)
                }

                const work = {
                    ...details,
                    invocation,
                    expert: expert as AgentWorkflowExpertRun['expert'],
                }

                return initial ? await this.options.workflow!.start(work) : await this.options.workflow!.resume(work)
            })

            if (this.isPending(result)) {
                invocation = {
                    ...invocation,
                    operationIds: [...new Set([
                        ...invocation.operationIds,
                        result.operationId,
                    ])],
                }

                return await this.wait(invocation, child.createdAssetIds)
            }

            invocation = {
                ...invocation,
                createdAssetIds: [...child.createdAssetIds],
            }

            return await this.finish(
                invocation,
                'completed',
                {
                    status: 'completed',
                    data: result,
                },
            )
        } catch (caught) {
            const error = unwrapExpertError(caught)

            if (error instanceof AgentToolsPending)
                return await this.wait(invocation, child.createdAssetIds)

            if (
                error instanceof Error
                && (error.message.startsWith('AGENT_BUDGET') || error.message.startsWith('CONVERSATION_') || error.message === 'AGENT_CONTEXT_CHANGED')
            )
                throw error

            execution.owner.abort.signal.throwIfAborted()

            return await this.finish(
                invocation,
                'failed',
                {
                    status: 'error',
                    error: {
                        code: error instanceof Error ? error.message.slice(0, 200) : 'AGENT_EXPERT_FAILED',
                        message: 'The delegated task could not finish. Completed work is retained; an uncertain provider call is not repeated.',
                        recoverable: false,
                    },
                },
            )
        } finally {
            for (const assetId of child.createdAssetIds)
                execution.createdAssetIds.add(assetId)

            this.controllers.delete(invocation.operationId)
        }
    }

    private async resolve(name: string): Promise<CapabilityAgentExpert> {
        const expert = await this.options.resolve(name)

        if (
            !expert
            || (expert.runtime.kind === 'workflow' && !this.options.workflow)
        )
            throw new Error('AGENT_EXPERT_UNAVAILABLE')

        return expert
    }

    private async read(operationId: string): Promise<AgentExpertInvocation> {
        const invocation = await this.options.repository.read<AgentExpertInvocation>(
            this.options.execution.owner.partition,
            this.key(operationId),
        )
        const run = (await this.options.execution.owner.read()).run

        if (
            !invocation
            || invocation.runId !== run?.runId
            || invocation.continuationEpoch !== this.options.execution.continuationEpoch
        )
            throw new Error('AGENT_EXPERT_OPERATION_UNAVAILABLE')

        return invocation
    }

    private async invocations(): Promise<AgentExpertInvocation[]> {
        const entries: AgentExpertInvocation[] = []
        let after: string | undefined
        const execution = this.options.execution
        const run = (await execution.owner.read()).run

        do {
            const page = await this.options.repository.query<AgentExpertInvocation>(
                execution.owner.partition,
                'EXPERT#',
                { after },
            )
            entries.push(
                ...page.items.filter(
                    entry => entry.runId === run?.runId && entry.continuationEpoch === execution.continuationEpoch && !entry.acknowledged,
                ),
            )
            after = page.cursor
        } while (after)

        return entries
    }

    private async cancelOne(invocation: AgentExpertInvocation): Promise<unknown> {
        if (invocation.payload)
            return await this.advanceOne(invocation)

        const result = await this.finish(
            invocation,
            'cancelled',
            {
                status: 'error',
                error: {
                    code: 'AGENT_EXPERT_CANCELLED',
                    recoverable: false,
                },
            },
        )
        this.controllers.get(invocation.operationId)?.abort(
            new Error('AGENT_EXPERT_CANCELLED'),
        )

        for (const operationId of invocation.operationIds)
            await this.options.operations.cancelOperation?.(this.options.execution.owner, operationId)

        return result
    }

    private async wait(
        invocation: AgentExpertInvocation,
        createdAssetIds: ReadonlySet<string>,
    ): Promise<unknown> {
        try {
            await this.save({
                ...invocation,
                state: 'waiting',
                createdAssetIds: [...createdAssetIds],
            })

            return {
                status: 'pending',
                operationId: invocation.operationId,
            }
        } catch (error) {
            if (
                error instanceof Error
                && error.message === 'AGENT_EXPERT_CANCELLED'
            )
                return {
                    status: 'error',
                    error: {
                        code: 'AGENT_EXPERT_CANCELLED',
                        recoverable: false,
                    },
                }

            throw error
        }
    }

    private async finish(
        invocation: AgentExpertInvocation,
        state: AgentExpertInvocation['state'],
        result: unknown,
    ): Promise<unknown> {
        const prepared = await this.options.payloads.prepare(
            'json',
            Buffer.from(
                JSON.stringify(result),
            ),
            this.key(invocation.operationId),
        )
        const execution = this.options.execution

        for (let attempt = 0; attempt < 10; attempt++) {
            const current = await this.read(invocation.operationId)

            if (current.payload)
                return JSON.parse(
                    Buffer.from(await this.options.payloads.read(current.payload)).toString('utf8'),
                )

            if (current.state === 'cancelled')
                return {
                    status: 'error',
                    error: {
                        code: 'AGENT_EXPERT_CANCELLED',
                        recoverable: false,
                    },
                }

            try {
                await this.options.repository.commit([
                    ...await execution.owner.fences(execution.continuationEpoch),
                    this.options.repository.put(
                        execution.owner.partition,
                        this.key(invocation.operationId),
                        {
                            ...invocation,
                            revision: current.revision + 1,
                            state,
                            payload: prepared.payload,
                        },
                        current.revision,
                    ),
                    ...prepared.operations,
                ])

                return result
            } catch (error) {
                const saved = await this.read(invocation.operationId)

                if (saved.payload?.hash === prepared.payload.hash)
                    return result

                if (!isTransactionConditionalCheckFailure(error))
                    throw error
            }
        }

        throw new Error('AGENT_EXPERT_STATE_CONFLICT')
    }

    private async save(invocation: AgentExpertInvocation): Promise<void> {
        const execution = this.options.execution

        for (let attempt = 0; attempt < 10; attempt++) {
            const current = await this.read(invocation.operationId)

            if (
                current.state === 'cancelled'
                && !invocation.acknowledged
            )
                throw new Error('AGENT_EXPERT_CANCELLED')

            if (
                current.payload
                && !invocation.acknowledged
            )
                return

            const next = current.payload
                || current.state === 'cancelled'
                ? {
                    ...current,
                    acknowledged: true,
                    revision: current.revision + 1,
                }
                : {
                    ...invocation,
                    revision: current.revision + 1,
                }

            try {
                await this.options.repository.commit([
                    ...await execution.owner.fences(execution.continuationEpoch),
                    this.options.repository.put(
                        execution.owner.partition,
                        this.key(invocation.operationId),
                        next,
                        current.revision,
                    ),
                ])

                return
            } catch (error) {
                const saved = await this.read(invocation.operationId)

                if (conversationPayloadHash(saved) ===
                    conversationPayloadHash({
                        ...next,
                        pk: execution.owner.partition,
                        sk: this.key(invocation.operationId),
                    }))
                    return

                if (!isTransactionConditionalCheckFailure(error))
                    throw error
            }
        }

        throw new Error('AGENT_EXPERT_STATE_CONFLICT')
    }

    private key(operationId: string): string {
        return `EXPERT#${operationId}`
    }

    private isPending(result: unknown): result is {
        status: 'pending'
        operationId: string
    } {
        return Boolean(
            result && typeof result === 'object' && 'status' in result && result.status === 'pending'
                && 'operationId' in result && typeof result.operationId === 'string',
        )
    }
}

export const combineExpertOperations = (
    experts: AgentExperts,
    base: ConversationMediaOperations,
): ConversationMediaOperations => {
    const delegated = experts.operations()

    return {
        get: (owner, operationId) => experts.owns(operationId) ? delegated.get!(owner, operationId) : base.get!(owner, operationId),
        cancelOperation: (owner, operationId) => experts.owns(operationId) ? delegated.cancelOperation!(owner, operationId) : base.cancelOperation!(
            owner,
            operationId,
        ),
        advance: async owner => {
            const child = await delegated.advance(owner)
            const media = await base.advance(owner)

            return {
                pending: child.pending || media.pending,
                completed: [...child.completed, ...media.completed],
            }
        },
        acknowledge: (owner, operationId) => experts.owns(operationId) ? delegated.acknowledge(owner, operationId) : base.acknowledge(
            owner,
            operationId,
        ),
        cancel: async owner => {
            await delegated.cancel(owner)
            await base.cancel(owner)
        },
    }
}

const unwrapExpertError = (caught: unknown): unknown => {
    let cause = caught
    let result = caught

    for (
        let depth = 0;
        depth < 12
        && cause instanceof Error;
        depth++
    ) {
        if (
            cause instanceof AgentToolsPending
            || cause.message.startsWith('AGENT_BUDGET')
            || cause.message.startsWith('CONVERSATION_')
            || cause.message === 'AGENT_CONTEXT_CHANGED'
        )
            return cause

        if (cause.message.startsWith('AGENT_'))
            result = cause

        cause = cause.cause
    }

    return result
}
