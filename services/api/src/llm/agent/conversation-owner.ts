import { randomUUID } from 'node:crypto'
import {
    AGENT_OWNER_LEASE_MS,
    type ConversationEvent,
    type ConversationEventPayloads,
    type ConversationMessage,
    type ConversationRun,
    type ConversationTurn,
    type AgentOperation,
    type ConversationOperationSummary,
} from '@lixpi/constants'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    conversationPartition,
    conversationSequenceKey,
    type ConversationRepository,
    type ConversationMeta,
    type ConversationDispatch,
} from './conversation-repository.ts'
import {
    type ConversationAccess,
} from './conversation-service.ts'
import {
    type AgentConfiguration,
} from './agent-configuration.ts'

export type ConversationOwnerPorts = {
    authorize: (
        workspaceId: string,
        userId: string,
        write: boolean,
    ) => Promise<ConversationAccess>
    publish: (event: ConversationEvent) => Promise<void>
    now: () => number
}

const terminal = new Set([
    'stopped',
    'completed',
    'failed',
])

type AdmissionLease = {
    revision: number
    ownerId: string
    leaseExpiresAt: number
    expiresAt: number
}

const admissionPartition = (job: ConversationDispatch): string =>
    `ORG#${encodeURIComponent(job.organizationId)}#AGENT_ADMISSION#${encodeURIComponent(job.userId)}`

export class ConversationOwner {
    readonly partition: string
    readonly abort = new AbortController()
    private released = false

    private constructor(
        readonly job: ConversationDispatch,
        readonly ownerId: string,
        readonly epoch: number,
        private readonly admissionSlot: string,
        private readonly repository: ConversationRepository,
        private readonly ports: ConversationOwnerPorts,
    ) {
        this.partition = conversationPartition(job.organizationId, job.conversationAssetId)
    }

    static async acquire(
        job: ConversationDispatch,
        repository: ConversationRepository,
        ports: ConversationOwnerPorts,
    ): Promise<ConversationOwner | undefined> {
        const access = await ports.authorize(
            job.workspaceId,
            job.userId,
            true,
        )

        if (access.organizationId !== job.organizationId)
            throw new Error('CONVERSATION_TENANT_MISMATCH')

        const partition = conversationPartition(job.organizationId, job.conversationAssetId)
        const meta = await repository.read<ConversationMeta>(partition, 'META')
        const now = ports.now()

        if (
            !meta?.activated
            || meta.workspaceId !== job.workspaceId
        )
            throw new Error('CONVERSATION_NOT_FOUND')

        if ((meta.leaseExpiresAt ?? 0) > now)
            return undefined

        const ownerId = randomUUID()
        const next = {
            ...meta,
            epoch: meta.epoch + 1,
            revision: meta.revision + 1,
            leaseOwner: ownerId,
            leaseExpiresAt: now + AGENT_OWNER_LEASE_MS,
        }

        for (let slot = 0; slot < 2; slot++) {
            const slotKey = `SLOT#${slot}`
            const admission = await repository.read<AdmissionLease>(
                admissionPartition(job),
                slotKey,
            )

            if (
                admission
                && admission.leaseExpiresAt > now
            )
                continue

            try {
                await repository.commit([...access.fences, repository.put(
                    partition,
                    'META',
                    next,
                    meta.revision,
                ), repository.put(
                    admissionPartition(job),
                    slotKey,
                    {
                        revision: (admission?.revision ?? 0) + 1,
                        ownerId,
                        leaseExpiresAt: next.leaseExpiresAt,
                        expiresAt: Math.ceil(next.leaseExpiresAt / 1000),
                    },
                    admission?.revision,
                )])

                return new ConversationOwner(
                    job,
                    ownerId,
                    next.epoch,
                    slotKey,
                    repository,
                    ports,
                )
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error))
                    throw error
            }
        }

        return undefined
    }

    async read(): Promise<ConversationMeta> {
        const meta = await this.repository.read<ConversationMeta>(this.partition, 'META')

        if (
            this.released
            || !meta
            || meta.epoch !== this.epoch
            || meta.leaseOwner !== this.ownerId
            || (meta.leaseExpiresAt ?? 0) <= this.ports.now()
        ) {
            this.abort.abort(
                new Error('CONVERSATION_OWNER_LOST'),
            )

            throw new Error('CONVERSATION_OWNER_LOST')
        }

        return meta
    }

    async fences(expectedContinuation?: number): Promise<TransactOperation[]> {
        const meta = await this.read()
        const access = await this.ports.authorize(
            this.job.workspaceId,
            this.job.userId,
            true,
        )

        if (
            expectedContinuation !== undefined
            && (meta.run?.continuationEpoch !== expectedContinuation || !['running', 'waiting-tools'].includes(meta.run.state))
        )
            throw new Error('CONVERSATION_CONTINUATION_STOPPED')

        const fence = this.repository.ownerFence(
            meta,
            this.ports.now(),
        )

        if (expectedContinuation !== undefined) {
            fence.conditionExpression += ' AND #run.#continuation = :continuation AND #run.#state = :runState'
            fence.expressionAttributeNames = {
                ...fence.expressionAttributeNames,
                '#run': 'run',
                '#continuation': 'continuationEpoch',
                '#state': 'state',
            }
            fence.expressionAttributeValues = {
                ...fence.expressionAttributeValues,
                ':continuation': expectedContinuation,
                ':runState': meta.run!.state,
            }
        }

        return [...access.fences, fence, this.admissionFence()]
    }

    private admissionFence(): TransactOperation {
        return {
            type: 'check',
            tableName: this.repository.tableName,
            key: {
                pk: admissionPartition(this.job),
                sk: this.admissionSlot,
            },
            conditionExpression: '#owner = :owner AND #expires > :now',
            expressionAttributeNames: {
                '#owner': 'ownerId',
                '#expires': 'leaseExpiresAt',
            },
            expressionAttributeValues: {
                ':owner': this.ownerId,
                ':now': this.ports.now(),
            },
        }
    }

    private async admissionMutation(leaseExpiresAt?: number): Promise<TransactOperation> {
        const pk = admissionPartition(this.job)
        const admission = await this.repository.read<AdmissionLease>(pk, this.admissionSlot)

        if (
            !admission
            || admission.ownerId !== this.ownerId
        )
            throw new Error('CONVERSATION_OWNER_LOST')

        if (leaseExpiresAt === undefined) {
            const operation = this.repository.remove(pk, this.admissionSlot)
            operation.conditionExpression = '#owner = :owner'
            operation.expressionAttributeNames = { '#owner': 'ownerId' }
            operation.expressionAttributeValues = { ':owner': this.ownerId }

            return operation
        }

        return this.repository.put(
            pk,
            this.admissionSlot,
            {
                ...admission,
                revision: admission.revision + 1,
                leaseExpiresAt,
                expiresAt: Math.ceil(leaseExpiresAt / 1000),
            },
            admission.revision,
        )
    }

    async renew(): Promise<void> {
        await this.mutate(
            meta => ({
                ...meta,
                leaseExpiresAt: this.ports.now() + AGENT_OWNER_LEASE_MS,
            }),
        )
    }

    async release(): Promise<void> {
        try {
            await this.mutate(meta => {
                const next = { ...meta }
                delete next.leaseOwner
                delete next.leaseExpiresAt

                return next
            })
        } finally {
            this.released = true
            this.abort.abort()
        }
    }

    async start(
        turn: ConversationTurn,
        configuration: AgentConfiguration,
    ): Promise<ConversationRun> {
        const saved = await this.mutate(
            meta => {
                const recovering = meta.run && !terminal.has(meta.run.state)

                if (
                    recovering
                    && meta.run!.turnId !== turn.turnId
                )
                    throw new Error('CONVERSATION_RUN_ACTIVE')

                return {
                    ...meta,
                    run: recovering ? {
                        ...meta.run!,
                        epoch: this.epoch,
                        state: 'running',
                    } : {
                        runId: `run-${turn.turnId}`,
                        budgetAllocationId: `budget-${turn.turnId}`,
                        turnId: turn.turnId,
                        state: 'running',
                        epoch: this.epoch,
                        instructionRevision: turn.commandSeq,
                        continuationEpoch: 0,
                        budget: {
                            modelCalls: 0,
                            toolCalls: 0,
                            specialistCalls: 0,
                            maxModelCalls: configuration.maxModelCalls,
                            maxToolCalls: configuration.maxToolCalls,
                            maxSpecialistCalls: configuration.maxSpecialistCalls,
                        },
                        operationIds: [],
                        updatedAt: this.ports.now(),
                    },
                }
            },
            () => [
                this.repository.replace(
                    this.partition,
                    `TURN#${turn.turnId}`,
                    {
                        ...turn,
                        state: 'running',
                    },
                ),
                this.repository.remove(this.partition, `QUEUED#${conversationSequenceKey(turn.commandSeq)}`),
            ],
        )
        await this.event('run.state', saved.run!)

        return saved.run!
    }

    async steer(turn: ConversationTurn): Promise<ConversationRun> {
        const saved = await this.mutate(meta => {
            if (
                !meta.run
                || meta.run.state !== 'running'
            )
                throw new Error('CONVERSATION_CONTINUATION_STOPPED')

            const {
                interruptId: _interruptId,
                ...run
            } = meta.run

            return {
                ...meta,
                queueRevision: meta.queueRevision + 1,
                run: {
                    ...run,
                    turnId: turn.turnId,
                    instructionRevision: turn.commandSeq,
                    continuationEpoch: meta.run.continuationEpoch + 1,
                    updatedAt: this.ports.now(),
                },
            }
        }, async meta => {
            const current = await this.repository.read<ConversationTurn>(this.partition, `TURN#${meta.run!.turnId}`)
            const steering = await this.repository.read<ConversationTurn>(this.partition, `TURN#${turn.turnId}`)

            if (
                !current
                || steering?.state !== 'queued'
            )
                throw new Error('CONVERSATION_STEER_NO_LONGER_QUEUED')

            return [
                this.repository.replace(
                    this.partition,
                    `TURN#${current.turnId}`,
                    {
                        ...current,
                        state: 'completed',
                    },
                ),
                this.repository.replace(
                    this.partition,
                    `TURN#${turn.turnId}`,
                    {
                        ...turn,
                        state: 'running',
                    },
                ),
                this.repository.remove(this.partition, `QUEUED#${conversationSequenceKey(turn.commandSeq)}`),
            ]
        })
        await this.event('run.state', saved.run!)

        return saved.run!
    }

    async renewBudget(
        answer: ConversationTurn,
        configuration: AgentConfiguration,
        responseMessageId: string,
    ): Promise<ConversationRun> {
        const allocationId = `budget-${answer.turnId}`
        const receiptKey = `BUDGET_ANSWER#${answer.turnId}`
        const recover = async (): Promise<ConversationRun | undefined> => {
            const receipt = await this.repository.read<{
                allocationId: string
                runId: string
                interruptId: string
                userId: string
            }>(this.partition, receiptKey)

            if (!receipt)
                return undefined

            const meta = await this.read()
            await this.fences(meta.run?.continuationEpoch)

            if (
                receipt.allocationId !== allocationId
                || receipt.interruptId !== answer.interruptId
                || receipt.userId !== answer.userId
                || receipt.runId !== meta.run?.runId
            )
                throw new Error('CONVERSATION_BUDGET_IDEMPOTENCY_CONFLICT')

            return meta.run
        }
        const recovered = await recover()

        if (recovered)
            return recovered

        let saved: ConversationMeta

        try {
            saved = await this.mutate(meta => {
                if (
                    !meta.run
                    || meta.run.state !== 'running'
                    || !answer.interruptId
                    || meta.run.interruptId !== answer.interruptId
                    || answer.userId !== this.job.userId
                )
                    throw new Error('STALE_CONVERSATION_INTERRUPT')

                const run = {
                    ...meta.run,
                    budgetAllocationId: allocationId,
                    continuedFromBudgetAllocationId: meta.run.budgetAllocationId ?? `budget-${meta.run.runId}`,
                    budget: {
                        modelCalls: 0,
                        toolCalls: 0,
                        specialistCalls: 0,
                        maxModelCalls: configuration.maxModelCalls,
                        maxToolCalls: configuration.maxToolCalls,
                        maxSpecialistCalls: configuration.maxSpecialistCalls,
                    },
                    updatedAt: this.ports.now(),
                }
                delete run.interruptId

                return {
                    ...meta,
                    queueRevision: meta.queueRevision + 1,
                    run,
                }
            }, async meta => {
                const current = await this.repository.read<ConversationTurn>(this.partition, `TURN#${answer.turnId}`)

                if (
                    current?.state !== 'queued'
                    || current.interruptId !== answer.interruptId
                    || current.userId !== answer.userId
                )
                    throw new Error('CONVERSATION_INTERRUPT_ALREADY_ANSWERED')

                const previousId = meta.run!.budgetAllocationId ?? `budget-${meta.run!.runId}`
                const previous = await this.repository.read<Record<string, unknown>>(this.partition, `BUDGET_ALLOCATION#${previousId}`)

                return [
                    this.repository.replace(
                        this.partition,
                        `BUDGET_ALLOCATION#${previousId}`,
                        {
                            ...previous,
                            allocationId: previousId,
                            runId: meta.run!.runId,
                            turnId: meta.run!.turnId,
                            budget: meta.run!.budget,
                            ...(meta.run!.continuedFromBudgetAllocationId ? { previousAllocationId: meta.run!.continuedFromBudgetAllocationId } : {}),
                        },
                    ),
                    this.repository.put(
                        this.partition,
                        `BUDGET_ALLOCATION#${allocationId}`,
                        {
                            allocationId,
                            previousAllocationId: previousId,
                            runId: meta.run!.runId,
                            turnId: meta.run!.turnId,
                            acceptedAnswerTurnId: answer.turnId,
                            createdAt: this.ports.now(),
                        },
                    ),
                    this.repository.put(
                        this.partition,
                        receiptKey,
                        {
                            allocationId,
                            runId: meta.run!.runId,
                            interruptId: answer.interruptId,
                            userId: answer.userId,
                        },
                    ),
                    this.repository.remove(this.partition, `BUDGET_WAIT#${meta.run!.turnId}`),
                    this.repository.replace(
                        this.partition,
                        `INPUT_RESPONSE#${meta.run!.turnId}`,
                        { responseMessageId },
                    ),
                    this.repository.replace(
                        this.partition,
                        `TURN#${answer.turnId}`,
                        {
                            ...current,
                            state: 'completed',
                        },
                    ),
                    this.repository.remove(this.partition, `QUEUED#${conversationSequenceKey(answer.commandSeq)}`),
                ]
            })
        } catch (error) {
            const committed = await recover()

            if (!committed)
                throw error

            return committed
        }

        await this.event('run.state', saved.run!)

        return saved.run!
    }

    async consumeBudget(
        kind: 'modelCalls' | 'toolCalls' | 'specialistCalls',
        continuation: number,
    ): Promise<void> {
        const maximum = {
            modelCalls: 'maxModelCalls',
            toolCalls: 'maxToolCalls',
            specialistCalls: 'maxSpecialistCalls',
        } as const
        await this.mutate(meta => {
            const run = meta.run

            if (
                !run
                || run.state === 'stopping'
                || terminal.has(run.state)
                || run.continuationEpoch !== continuation
            )
                throw new Error('CONVERSATION_CONTINUATION_STOPPED')

            if (run.budget[kind] >= run.budget[maximum[kind]])
                throw new Error(`AGENT_BUDGET_EXHAUSTED:${kind}`)

            return {
                ...meta,
                run: {
                    ...run,
                    budget: {
                        ...run.budget,
                        [kind]: run.budget[kind] + 1,
                    },
                },
            }
        })
    }

    async finish(
        state: 'completed' | 'failed' | 'stopped',
        error?: ConversationRun['error'],
    ): Promise<void> {
        const saved = await this.mutate(meta => {
            if (!meta.run)
                throw new Error('CONVERSATION_RUN_REQUIRED')

            return {
                ...meta,
                run: {
                    ...meta.run,
                    state,
                    ...(error ? { error } : {}),
                    updatedAt: this.ports.now(),
                },
            }
        }, async meta => {
            const turn = await this.repository.read<ConversationTurn>(this.partition, `TURN#${meta.run!.turnId}`)

            return turn ? [this.repository.replace(
                this.partition,
                `TURN#${turn.turnId}`,
                {
                    ...turn,
                    state,
                },
            )] : []
        })
        await this.event('run.state', saved.run!)
    }

    async waitForTools(): Promise<void> {
        const saved = await this.mutate(meta => {
            if (
                !meta.run
                || meta.run.state !== 'running'
            )
                throw new Error('CONVERSATION_CONTINUATION_STOPPED')

            return {
                ...meta,
                run: {
                    ...meta.run,
                    state: 'waiting-tools',
                    updatedAt: this.ports.now(),
                },
            }
        })
        await this.event('run.state', saved.run!)
    }

    async waitForInput(interruptId: string): Promise<void> {
        const saved = await this.mutate(meta => {
            if (
                !meta.run
                || meta.run.state !== 'running'
            )
                throw new Error('CONVERSATION_CONTINUATION_STOPPED')

            return {
                ...meta,
                run: {
                    ...meta.run,
                    state: 'waiting-input',
                    interruptId,
                    updatedAt: this.ports.now(),
                },
            }
        })
        await this.event('run.state', saved.run!)
    }

    async completeInputAnswer(
        answer: ConversationTurn,
        operations: TransactOperation[],
    ): Promise<void> {
        const saved = await this.mutate(meta => {
            if (
                !meta.run
                || meta.run.state !== 'running'
                || meta.run.interruptId !== answer.interruptId
                || answer.userId !== this.job.userId
            )
                throw new Error('STALE_CONVERSATION_INTERRUPT')

            const run = {
                ...meta.run,
                updatedAt: this.ports.now(),
            }
            delete run.interruptId

            return {
                ...meta,
                queueRevision: meta.queueRevision + 1,
                run,
            }
        }, async () => {
            const current = await this.repository.read<ConversationTurn>(this.partition, `TURN#${answer.turnId}`)

            if (
                current?.state !== 'queued'
                || current.interruptId !== answer.interruptId
            )
                throw new Error('CONVERSATION_INTERRUPT_ALREADY_ANSWERED')

            return [
                ...operations,
                this.repository.replace(
                    this.partition,
                    `TURN#${answer.turnId}`,
                    {
                        ...current,
                        state: 'completed',
                    },
                ),
                this.repository.remove(this.partition, `QUEUED#${conversationSequenceKey(answer.commandSeq)}`),
            ]
        })
        await this.event('run.state', saved.run!)
    }

    // Bound terminal cleanup may run after account admission has cancelled the
    // request. It can revoke this owner, but cannot authorize replacement work.
    async pauseForReauthentication(): Promise<void> {
        for (let attempt = 0; attempt < 5; attempt++) {
            const meta = await this.repository.read<ConversationMeta>(this.partition, 'META')

            if (
                !meta
                || meta.epoch !== this.epoch
                || meta.leaseOwner !== this.ownerId
            )
                return

            const next = {
                ...meta,
                revision: meta.revision + 1,
                queuePaused: true,
                queueRevision: meta.queueRevision + 1,
                ...(meta.run
                    && !terminal.has(meta.run.state)
                    ? { run: {
                        ...meta.run,
                        state: 'needs-reauthentication' as const,
                        updatedAt: this.ports.now(),
                    } }
                    : {}),
            }
            delete next.leaseOwner
            delete next.leaseExpiresAt

            try {
                await this.repository.commit([this.repository.put(
                    this.partition,
                    'META',
                    next,
                    meta.revision,
                ), await this.admissionMutation()])
                this.released = true

                return
            } catch (error) {
                if (
                    !isTransactionConditionalCheckFailure(error)
                    || attempt === 4
                )
                    throw error
            }
        }
    }

    async partialMessage(
        message: ConversationMessage,
        text: string,
        offset: number,
    ): Promise<void> {
        await this.event(
            'message.delta',
            {
                messageId: message.messageId,
                text,
                offset,
            },
            () => [
                this.repository.replace(
                    this.partition,
                    `MESSAGE#${message.messageId}`,
                    message,
                ),
            ],
        )
    }

    async message(message: ConversationMessage): Promise<void> {
        const sk = `MESSAGE#${message.messageId}`

        const existing = await this.repository.read<ConversationMessage>(this.partition, sk)

        if (
            existing
            && existing.complete !== false
        )
            return

        await this.event(
            'message.completed',
            message,
            () => [this.repository.replace(
                this.partition,
                sk,
                message,
            )],
        )
    }

    async event<K extends keyof ConversationEventPayloads>(
        type: K,
        payload: K extends 'operation.status' ? AgentOperation : ConversationEventPayloads[K],
        extra: (meta: ConversationMeta) => TransactOperation[] = () => [],
    ): Promise<ConversationEvent> {
        if (type === 'operation.status') {
            const operation = payload as ConversationEventPayloads['operation.status']

            if (!(await this.repository.read(this.partition, `MESSAGE#${operation.responseMessageId}`)))
                await this.partialMessage(
                    {
                        messageId: operation.responseMessageId,
                        turnId: operation.turnId,
                        role: 'assistant',
                        text: '',
                        complete: false,
                        createdAt: operation.createdAt,
                    },
                    '',
                    0,
                )
        }

        const publicPayload = type === 'operation.status' ? this.operationSummary(payload as AgentOperation) : payload
        let event: ConversationEvent | undefined
        await this.mutate(
            meta => {
                event = {
                    protocolVersion: 1,
                    workspaceId: meta.workspaceId,
                    conversationAssetId: meta.conversationAssetId,
                    type,
                    payload: publicPayload,
                    turnId: meta.run?.turnId ?? null,
                    runId: meta.run?.runId ?? null,
                    epoch: this.epoch,
                    eventSeq: meta.eventSeq + 1,
                    createdAt: this.ports.now(),
                } as ConversationEvent

                return {
                    ...meta,
                    eventSeq: event.eventSeq,
                }
            },
            meta => [...extra(meta), ...(type === 'operation.status' ? [this.repository.replace(
                this.partition,
                `PUBLIC_OPERATION#${(payload as ConversationEventPayloads['operation.status']).responseMessageId}#${(payload as ConversationEventPayloads['operation.status']).operationId}`,
                publicPayload,
            )] : []), this.repository.put(
                this.partition,
                `EVENT#${conversationSequenceKey(event!.eventSeq)}`,
                event!,
            )],
        )
        await this.ports.publish(event!)

        return event!
    }

    private operationSummary(operation: AgentOperation): ConversationOperationSummary {
        const {
            operationId,
            turnId,
            responseMessageId,
            operationKey,
            executionId,
            stepId,
            stepLabel,
            state,
            outputAssetIds,
            error,
            createdAt,
            updatedAt,
        } = operation

        return {
            operationId,
            turnId,
            responseMessageId,
            operationKey,
            ...(executionId ? { executionId } : {}),
            ...(stepId ? { stepId } : {}),
            ...(stepLabel ? { stepLabel: stepLabel.slice(0, 160) } : {}),
            state,
            outputAssetIds: state === 'succeeded' ? outputAssetIds : {},
            ...(error ? { error } : {}),
            createdAt,
            updatedAt,
        }
    }

    async mutate(
        change: (meta: ConversationMeta) => ConversationMeta,
        extra: (meta: ConversationMeta) => TransactOperation[] | Promise<TransactOperation[]> = () => [],
    ): Promise<ConversationMeta> {
        for (let attempt = 0; attempt < 10; attempt++) {
            const meta = await this.read()
            const access = await this.ports.authorize(
                this.job.workspaceId,
                this.job.userId,
                true,
            )
            const next = {
                ...change(meta),
                revision: meta.revision + 1,
                updatedAt: this.ports.now(),
            }
            const operation = this.repository.put(
                this.partition,
                'META',
                next,
                meta.revision,
            )
            operation.conditionExpression += ' AND #epoch = :epoch AND #owner = :owner AND #expires > :now'
            operation.expressionAttributeNames = {
                ...operation.expressionAttributeNames,
                '#epoch': 'epoch',
                '#owner': 'leaseOwner',
                '#expires': 'leaseExpiresAt',
            }
            operation.expressionAttributeValues = {
                ...operation.expressionAttributeValues,
                ':epoch': this.epoch,
                ':owner': this.ownerId,
                ':now': this.ports.now(),
            }

            try {
                await this.repository.commit([
                    ...access.fences,
                    operation,
                    await this.admissionMutation(next.leaseExpiresAt),
                    ...(next.run ? [this.repository.replace(
                        this.partition,
                        `RUN#${next.run.runId}`,
                        next.run,
                    )] : []),
                    ...(await extra(meta)),
                ])

                return next
            } catch (error) {
                if (
                    !isTransactionConditionalCheckFailure(error)
                    || attempt === 9
                )
                    throw error
            }
        }

        throw new Error('CONVERSATION_CONTENTION')
    }
}
