import { createHash } from 'node:crypto'
import {
    NATS_SUBJECTS,
    type AccountWorkContext,
} from '@lixpi/constants'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    type default as NatsService,
} from '@lixpi/nats-service'
import {
    defaultMediaRenderLimits,
    type MediaRenderCompilerPort,
    type MediaRenderPlan,
    type MediaRenderReadiness,
    type MediaRenderRequest,
    type MediaRenderResult,
    type MediaRenderProgress,
} from '@lixpi/capability-system/backend'
import {
    type SequenceExportHandle,
} from '@lixpi/capability-system/shared'
import { warn } from '@lixpi/debug-tools'
import { AccountRequestContext } from '../services/account-request-context.ts'
import {
    type ConversationRepository,
} from '../llm/agent/conversation-repository.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from '../llm/agent/agent-payload-store.ts'
import {
    type ArtifactStoreAccess,
} from './artifact-revision-store.ts'

export type MediaRenderConversation = {
    conversationAssetId: string
    runId: string
    turnId: string
    continuationEpoch: number
}

export type MediaRenderHandle = SequenceExportHandle

export type MediaRenderRecord = MediaRenderHandle & {
    access: ArtifactStoreAccess
    revision: number
    inputHash: string
    payload: AgentPayload
    inputs: MediaRenderPlan['inputs']
    account?: AccountWorkContext
    conversation?: MediaRenderConversation
    leaseExpiresAt: number
    createdAt: number
    durationSeconds: number
    result?: MediaRenderResult
}

type StoredRenderProgress = {
    revision: number
    attempt: number
    progress: NonNullable<MediaRenderHandle['progress']>
}

export type MediaRenderAdapterPorts = {
    nats: Pick<NatsService, 'request' | 'ensureJetStreamStream' | 'ensureJetStreamConsumer' | 'publishJetStream' | 'processJetStreamMessages' | 'getConnection' | 'onReconnect'>
    authorize: (
        access: ArtifactStoreAccess,
        inputs: MediaRenderPlan['inputs'],
        submitting: boolean,
    ) => Promise<TransactOperation[]>
    retainInputs: (
        access: ArtifactStoreAccess,
        inputs: MediaRenderPlan['inputs'],
        outputAssetId: string,
    ) => Promise<TransactOperation[]>
    retainResult: (
        record: MediaRenderRecord,
        result: MediaRenderResult,
    ) => Promise<TransactOperation[]>
    releaseInputs: (record: MediaRenderRecord) => Promise<{
        operations: TransactOperation[]
        afterCommit: () => Promise<void>
    }>
    payloads: (
        access: ArtifactStoreAccess,
        outputAssetId: string,
    ) => AgentPayloadPort
    finalize: (
        record: MediaRenderRecord,
        result: MediaRenderResult,
        commit: (operations: TransactOperation[]) => Promise<void>,
    ) => Promise<void>
    publish: (record: MediaRenderRecord) => Promise<void>
    now: () => number
}

const subjects = NATS_SUBJECTS.MEDIA_RENDER_SUBJECTS
const streamName = 'MEDIA_RENDER_JOBS'
const consumerName = 'api-media-render'
const partition = (
    organizationId: string,
    jobId: string,
): string => `ORG#${encodeURIComponent(organizationId)}#RENDER#${jobId}`
const duePartition = (jobId: string): string => `RENDER_DUE#${createHash('sha256').update(jobId).digest()[0] % 16}`
const terminal = new Set([
    'completed',
    'cancelled',
    'failed',
])

export class MediaRenderAdapter {
    private stopped = true
    private timer?: ReturnType<typeof setTimeout>
    private progressSubscription?: { unsubscribe: () => void }
    private removeReconnect?: () => void

    constructor(
        private readonly repository: ConversationRepository,
        private readonly compiler: MediaRenderCompilerPort,
        private readonly ports: MediaRenderAdapterPorts,
    ) {}

    async readiness(): Promise<MediaRenderReadiness> {
        const readiness = await this.ports.nats.request<unknown, MediaRenderReadiness>(
            subjects.READINESS,
            {},
            5000,
        )

        if (
            !readiness
            || !Array.isArray(readiness.presets)
            || !readiness.limits
        )
            throw new Error('MEDIA_RENDER_UNAVAILABLE')

        return readiness
    }

    async submit(
        access: ArtifactStoreAccess,
        request: {
            sequence: unknown
            preset: unknown
            clientMutationId: string
            conversation?: MediaRenderConversation
        },
    ): Promise<MediaRenderHandle> {
        access = { ...access }
        request = structuredClone(request)

        if (Buffer.byteLength(
            JSON.stringify(request),
        ) > 512 * 1024)
            throw new Error('MEDIA_RENDER_MANIFEST_LIMIT')

        if (!/^[A-Za-z0-9_-]{1,128}$/u.test(request.clientMutationId))
            throw new Error('MEDIA_RENDER_INVALID_MUTATION_ID')

        const identity = createHash('sha256')
            .update(
                JSON.stringify([access.organizationId, access.workspaceId, request.clientMutationId]),
            )
            .digest('hex')
        const jobId = `render-${identity}`
        const outputAssetId = `export-${identity}`
        const pk = partition(access.organizationId, jobId)
        const inputHash = createHash('sha256').update(
            JSON.stringify({
                sequence: request.sequence,
                preset: request.preset,
                conversation: request.conversation,
            }),
        ).digest('hex')
        const existing = await this.repository.read<MediaRenderRecord>(pk, 'META')

        if (existing) {
            await this.ports.authorize(
                access,
                existing.inputs,
                false,
            )

            if (
                existing.inputHash !== inputHash
                || existing.access.userId !== access.userId
            )
                throw new Error('MEDIA_RENDER_IDEMPOTENCY_CONFLICT')

            return this.handle(existing)
        }

        const ready = await this.readiness()
        const plan = this.compiler.compile(
            request.sequence,
            request.preset,
            ready.limits,
        )

        if (plan.inputs.length > 24)
            throw new Error('MEDIA_RENDER_SOURCE_LIMIT')

        const preset = ready.presets.find(preset => preset.presetId === plan.preset.presetId)

        if (!preset?.available)
            throw new Error(preset?.reason ?? 'MEDIA_RENDER_ENCODER_UNAVAILABLE')

        const frozen = structuredClone({
            sequence: request.sequence,
            preset: plan.preset,
        })
        const payloads = this.ports.payloads(access, outputAssetId)
        const prepared = await payloads.prepare(
            'json',
            Buffer.from(
                JSON.stringify(frozen),
            ),
            'render-input',
        )
        const record: MediaRenderRecord = {
            jobId,
            outputAssetId,
            sequenceId: plan.sequenceId,
            sequenceRevision: plan.sequenceRevision,
            state: 'queued',
            attempt: 0,
            revision: 1,
            inputHash,
            payload: prepared.payload,
            inputs: plan.inputs,
            access,
            account: AccountRequestContext.workContext(),
            conversation: request.conversation,
            leaseExpiresAt: 0,
            createdAt: this.ports.now(),
            durationSeconds: plan.durationSeconds,
        }

        try {
            await this.repository.commit([
                ...await this.ports.authorize(
                    access,
                    plan.inputs,
                    true,
                ),
                ...await this.ports.retainInputs(
                    access,
                    plan.inputs,
                    outputAssetId,
                ),
                ...prepared.operations,
                this.repository.put(
                    pk,
                    'META',
                    record,
                ),
                this.repository.put(
                    duePartition(jobId),
                    jobId,
                    {
                        jobId,
                        organizationId: access.organizationId,
                    },
                ),
            ])
        } catch (error) {
            const winner = await this.repository.read<MediaRenderRecord>(pk, 'META')

            if (
                !winner
                || winner.inputHash !== inputHash
                || winner.access.userId !== access.userId
            )
                throw error

            return this.handle(winner)
        }

        await this.ports.publish(record)

        return this.handle(record)
    }

    async get(
        access: ArtifactStoreAccess,
        jobId: string,
    ): Promise<MediaRenderHandle> {
        const record = await this.repository.read<MediaRenderRecord>(
            partition(access.organizationId, jobId),
            'META',
        )

        if (
            !record
            || record.access.workspaceId !== access.workspaceId
        )
            throw new Error('MEDIA_RENDER_NOT_FOUND')

        await this.ports.authorize(
            access,
            record.inputs,
            false,
        )

        return this.handle(record)
    }

    async cancel(
        access: ArtifactStoreAccess,
        jobId: string,
    ): Promise<MediaRenderHandle> {
        for (let retry = 0; retry < 5; retry++) {
            const pk = partition(access.organizationId, jobId)
            const record = await this.repository.read<MediaRenderRecord>(pk, 'META')

            if (
                !record
                || record.access.workspaceId !== access.workspaceId
                || record.access.userId !== access.userId
            )
                throw new Error('MEDIA_RENDER_NOT_FOUND')

            const fences = await this.ports.authorize(
                access,
                record.inputs,
                false,
            )

            if (terminal.has(record.state))
                return this.handle(record)

            const next: MediaRenderRecord = {
                ...record,
                revision: record.revision + 1,
                state: 'cancelled',
                leaseExpiresAt: 0,
            }
            const release = await this.ports.releaseInputs(record)

            try {
                await this.repository.commit([...fences, this.repository.put(
                    pk,
                    'META',
                    next,
                    record.revision,
                ), ...release.operations])
                await release.afterCommit()

                try {
                    await this.ports.nats.request(
                        subjects.CANCEL,
                        {
                            jobId,
                            organizationId: access.organizationId,
                            attempt: record.attempt,
                        },
                        5000,
                    )
                } catch {
                    // The durable cancelled state also fences a late worker result.
                }

                await this.ports.publish(next)

                return this.handle(next)
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error))
                    throw error
            }
        }

        throw new Error('MEDIA_RENDER_CONTENTION')
    }

    async start(): Promise<void> {
        if (!this.stopped)
            return

        await this.ports.nats.ensureJetStreamStream({
            name: streamName,
            subjects: [subjects.DISPATCH],
            retention: 'workqueue',
            storage: 'file',
            num_replicas: Number(process.env.NATS_STREAM_REPLICAS || 3),
        })
        await this.ports.nats.ensureJetStreamConsumer(
            streamName,
            {
                durable_name: consumerName,
                ack_policy: 'explicit',
                deliver_policy: 'all',
                filter_subject: subjects.DISPATCH,
                ack_wait: (defaultMediaRenderLimits.timeoutSeconds + 60) * 1000000000,
                max_deliver: -1,
            },
        )
        this.stopped = false
        this.bindProgress()
        this.removeReconnect = this.ports.nats.onReconnect(() => this.bindProgress())
        void this.publishDue()
        void this.consume()
    }

    stop(): void {
        this.stopped = true
        clearTimeout(this.timer)
        this.progressSubscription?.unsubscribe()
        this.progressSubscription = undefined
        this.removeReconnect?.()
        this.removeReconnect = undefined
    }

    async execute(job: {
        jobId: string
        organizationId: string
    }): Promise<'done' | 'defer'> {
        const pk = partition(job.organizationId, job.jobId)
        const stored = await this.repository.read<MediaRenderRecord>(pk, 'META')

        if (!stored)
            return 'done'

        if (terminal.has(stored.state)) {
            await this.ports.publish(stored)

            return 'done'
        }

        if (stored.leaseExpiresAt > this.ports.now())
            return 'defer'

        try {
            return await AccountRequestContext.resumeWork(stored.account as AccountWorkContext, async () => {
                const fences = await this.ports.authorize(
                    stored.access,
                    stored.inputs,
                    false,
                )
                const running: MediaRenderRecord = {
                    ...stored,
                    state: 'running',
                    attempt: stored.attempt + 1,
                    revision: stored.revision + 1,
                    leaseExpiresAt: this.ports.now() + 30000,
                }

                try {
                    await this.repository.commit([...fences, this.repository.put(
                        pk,
                        'META',
                        running,
                        stored.revision,
                    )])
                } catch (error) {
                    if (isTransactionConditionalCheckFailure(error))
                        return 'defer'

                    throw error
                }

                let leaseLost = false
                const renewal = setInterval(
                    async () => {
                        try {
                            const current = await this.repository.read<MediaRenderRecord>(pk, 'META')

                            if (
                                !current
                                || current.state !== 'running'
                                || current.attempt !== running.attempt
                            )
                                throw new Error('MEDIA_RENDER_ATTEMPT_LOST')

                            await this.repository.commit([
                                ...await this.ports.authorize(
                                    current.access,
                                    current.inputs,
                                    false,
                                ),
                                this.repository.put(
                                    pk,
                                    'META',
                                    {
                                        ...current,
                                        revision: current.revision + 1,
                                        leaseExpiresAt: this.ports.now() + 30000,
                                    },
                                    current.revision,
                                ),
                            ])
                        } catch {
                            leaseLost = true

                            try { await this.ports.nats.request(
                                subjects.CANCEL,
                                {
                                    jobId: running.jobId,
                                    organizationId: job.organizationId,
                                    attempt: running.attempt,
                                },
                                5000,
                            ) } catch {}
                        }
                    },
                    10000,
                )

                try {
                    const frozen = JSON.parse(
                        Buffer.from(await this.ports.payloads(stored.access, stored.outputAssetId).read(stored.payload)).toString('utf8'),
                    )
                    const limits = stored.result ? defaultMediaRenderLimits : (await this.readiness()).limits
                    const expected = this.compiler.compile(
                        frozen.sequence,
                        frozen.preset,
                        limits,
                    )
                    const result = stored.result ?? await this.ports.nats.request<MediaRenderRequest, MediaRenderResult>(
                        subjects.RENDER,
                        {
                            ...frozen,
                            jobId: running.jobId,
                            attempt: running.attempt,
                            organizationId: job.organizationId,
                            outputAssetId: running.outputAssetId,
                            accountContext: stored.account,
                        },
                        limits.timeoutSeconds * 1000 + 30000,
                    )

                    if ((result as unknown as { error?: string })?.error)
                        throw new Error(
                            String((result as unknown as { error: string }).error),
                        )

                    if (leaseLost)
                        throw new Error('MEDIA_RENDER_ATTEMPT_LOST')

                    if (
                        !result
                        || result.jobId !== running.jobId
                        || result.attempt !== (stored.result?.attempt ?? running.attempt)
                        || result.outputAssetId !== running.outputAssetId
                        || result.organizationId !== job.organizationId
                        || result.sequenceId !== running.sequenceId
                        || result.sequenceRevision !== running.sequenceRevision
                        || result.presetId !== expected.preset.presetId
                        || result.mimeType !== expected.mimeType
                        || !Number.isFinite(result.durationSeconds)
                        || Math.abs(result.durationSeconds - expected.durationSeconds) > 0.15
                        || result.width !== expected.width
                        || result.height !== expected.height
                        || result.audioSampleRate !== expected.sampleRate
                        || result.channels !== 2
                    )
                        throw new Error('MEDIA_RENDER_RESULT_MISMATCH')

                    let current = await this.repository.read<MediaRenderRecord>(pk, 'META')

                    if (
                        !current
                        || terminal.has(current.state)
                    )
                        return 'done'

                    if (
                        current.state !== 'running'
                        || current.attempt !== running.attempt
                        || current.leaseExpiresAt <= this.ports.now()
                    )
                        return 'defer'

                    clearInterval(renewal)

                    if (!current.result) {
                        const received: MediaRenderRecord = {
                            ...current,
                            result,
                            revision: current.revision + 1,
                            leaseExpiresAt: this.ports.now() + 30000,
                        }
                        await this.repository.commit([
                            ...await this.ports.authorize(
                                current.access,
                                current.inputs,
                                false,
                            ),
                            ...await this.ports.retainResult(current, result),
                            this.repository.put(
                                pk,
                                'META',
                                received,
                                current.revision,
                            ),
                        ])
                        current = received
                    }

                    const complete: MediaRenderRecord = {
                        ...current,
                        result,
                        state: 'completed',
                        revision: current.revision + 1,
                        leaseExpiresAt: 0,
                    }
                    await this.ports.finalize(
                        current,
                        result,
                        async operations => {
                            const commitRecord = this.repository.put(
                                pk,
                                'META',
                                complete,
                                current.revision,
                            )
                            commitRecord.conditionExpression += ' AND #attempt = :attempt AND #state = :running AND #expires > :now'
                            commitRecord.expressionAttributeNames = {
                                ...commitRecord.expressionAttributeNames,
                                '#attempt': 'attempt',
                                '#state': 'state',
                                '#expires': 'leaseExpiresAt',
                            }
                            commitRecord.expressionAttributeValues = {
                                ...commitRecord.expressionAttributeValues,
                                ':attempt': running.attempt,
                                ':running': 'running',
                                ':now': this.ports.now(),
                            }
                            await this.repository.commit([
                                ...await this.ports.authorize(
                                    current.access,
                                    current.inputs,
                                    false,
                                ),
                                ...operations,
                                commitRecord,
                            ])
                        },
                    )
                    await this.ports.publish(complete)

                    return 'done'
                } catch (error) {
                    const current = await this.repository.read<MediaRenderRecord>(pk, 'META')

                    if (!current)
                        return 'done'

                    if (
                        terminal.has(current.state)
                        || current.attempt !== running.attempt
                    )
                        return 'defer'

                    const message = error instanceof Error ? error.message : 'MEDIA_RENDER_FAILED'

                    if (
                        current.attempt >= 5
                        || /SOURCE_(INTEGRITY|ACCESS_DENIED|BINDING_CHANGED|UNAVAILABLE)|OUTPUT_INVALID|RESULT_MISMATCH|ACCOUNT_ADMISSION_DENIED|WORKSPACE_ACCESS_DENIED/u.test(message)
                    ) {
                        const release = await this.ports.releaseInputs(current)
                        const failed: MediaRenderRecord = {
                            ...current,
                            state: 'failed',
                            error: message.slice(0, 160),
                            revision: current.revision + 1,
                            leaseExpiresAt: 0,
                        }
                        await this.repository.commit([this.repository.put(
                            pk,
                            'META',
                            failed,
                            current.revision,
                        ), ...release.operations])
                        await release.afterCommit()
                        await this.ports.publish(failed)

                        return 'done'
                    }

                    const retry = {
                        ...current,
                        state: 'queued' as const,
                        revision: current.revision + 1,
                        leaseExpiresAt: 0,
                    }
                    await this.repository.commit([this.repository.put(
                        pk,
                        'META',
                        retry,
                        current.revision,
                    )])
                    warn('[MediaRenderAdapter] render attempt will retry', error)

                    return 'defer'
                } finally {
                    clearInterval(renewal)
                }
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'MEDIA_RENDER_FAILED'

            if (!/ACCOUNT_ADMISSION_DENIED|SOURCE_ACCESS_DENIED|WORKSPACE_ACCESS_DENIED|ORGANIZATION_ACCESS_DENIED|PERMISSION_DENIED/u.test(message))
                throw error

            const current = await this.repository.read<MediaRenderRecord>(pk, 'META')

            if (
                !current
                || terminal.has(current.state)
            )
                return 'done'

            const release = await this.ports.releaseInputs(current)
            const failed: MediaRenderRecord = {
                ...current,
                state: 'failed',
                error: message.slice(0, 160),
                revision: current.revision + 1,
                leaseExpiresAt: 0,
            }
            await this.repository.commit([this.repository.put(
                pk,
                'META',
                failed,
                current.revision,
            ), ...release.operations])
            await release.afterCommit()
            await this.ports.publish(failed)

            return 'done'
        }
    }

    async recordProgress(input: unknown): Promise<void> {
        if (
            !input
            || typeof input !== 'object'
        )
            return

        const event = input as MediaRenderProgress
        const phases = ['decode', 'compose', 'encode', 'finalize']

        if (
            typeof event.jobId !== 'string'
            || !/^render-[a-f0-9]{64}$/u.test(event.jobId)
            || typeof event.organizationId !== 'string'
            || !/^[A-Za-z0-9_-]{1,128}$/u.test(event.organizationId)
            || !Number.isSafeInteger(event.attempt)
            || event.attempt < 1
            || !phases.includes(event.phase)
            || !Number.isFinite(event.durationSeconds)
            || event.durationSeconds <= 0
            || (event.processedDurationSeconds !== undefined && (!Number.isFinite(event.processedDurationSeconds) || event.processedDurationSeconds < 0 || event.processedDurationSeconds > event.durationSeconds + 0.15))
        )
            return

        const pk = partition(event.organizationId, event.jobId)

        for (let retry = 0; retry < 3; retry++) {
            const current = await this.repository.read<MediaRenderRecord>(pk, 'META')
            const previous = await this.repository.read<StoredRenderProgress>(pk, 'PROGRESS')
            const previousProgress = previous?.attempt === event.attempt ? previous.progress : undefined

            if (
                !current
                || current.state !== 'running'
                || current.attempt !== event.attempt
                || current.leaseExpiresAt <= this.ports.now()
                || !Number.isFinite(current.durationSeconds)
                || Math.abs(current.durationSeconds - event.durationSeconds) > 0.000001
                || (previousProgress && phases.indexOf(event.phase) < phases.indexOf(previousProgress.phase))
            )
                return

            const progress: NonNullable<MediaRenderHandle['progress']> = {
                phase: event.phase,
                durationSeconds: event.durationSeconds,
                ...(event.processedDurationSeconds !== undefined
                    ? { processedDurationSeconds: Math.max(
                        previousProgress?.processedDurationSeconds ?? 0,
                        Math.min(event.durationSeconds, event.processedDurationSeconds),
                    ) }
                    : previousProgress?.processedDurationSeconds !== undefined
                        ? { processedDurationSeconds: previousProgress.processedDurationSeconds }
                        : {}),
            }

            if (JSON.stringify(previousProgress) === JSON.stringify(progress))
                return

            try {
                await AccountRequestContext.resumeWork(current.account as AccountWorkContext, async () => {
                    const fence: TransactOperation = {
                        type: 'check',
                        tableName: this.repository.tableName,
                        key: {
                            pk,
                            sk: 'META',
                        },
                        conditionExpression: '#revision = :revision AND #expires > :now',
                        expressionAttributeNames: {
                            '#revision': 'revision',
                            '#expires': 'leaseExpiresAt',
                        },
                        expressionAttributeValues: {
                            ':revision': current.revision,
                            ':now': this.ports.now(),
                        },
                    }
                    await this.repository.commit([
                        ...await this.ports.authorize(
                            current.access,
                            current.inputs,
                            false,
                        ), fence,
                        this.repository.put(
                            pk,
                            'PROGRESS',
                            {
                                attempt: event.attempt,
                                progress,
                                revision: (previous?.revision ?? 0) + 1,
                            },
                            previous?.revision,
                        ),
                    ])
                })

                return
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error))
                    throw error
            }
        }
    }

    private bindProgress(): void {
        this.progressSubscription?.unsubscribe()

        if (this.stopped)
            return

        const connection = this.ports.nats.getConnection()

        if (!connection)
            throw new Error('MEDIA_RENDER_UNAVAILABLE')

        // Only the registered renderer can publish this private subject. User
        // admission and source access are rechecked before persisting its event.
        const subscription = connection.subscribe(subjects.PROGRESS, { queue: 'api-media-render-progress' })
        this.progressSubscription = subscription
        void (async () => {
            for await (const message of subscription) {
                try {
                    await this.recordProgress(
                        JSON.parse(
                            message.string(),
                        ),
                    )
                } catch (error) {
                    warn('[MediaRenderAdapter] progress update rejected', error)
                }
            }
        })()
    }

    private async publishDue(): Promise<void> {
        try {
            for (
                let shard = 0;
                shard < 16
                && !this.stopped;
                shard++
            ) {
                const page = await this.repository.query<{
                    jobId: string
                    organizationId: string
                }>(
                    `RENDER_DUE#${shard}`,
                    '',
                    { limit: 50 },
                )

                for (const job of page.items) {
                    await this.ports.nats.publishJetStream(subjects.DISPATCH, job)
                    await this.repository.commit([this.repository.remove(`RENDER_DUE#${shard}`, job.jobId)])
                }
            }
        } catch (error) {
            warn('[MediaRenderAdapter] durable dispatch publication will retry', error)
        } finally {
            if (!this.stopped)
                this.timer = setTimeout(() => void this.publishDue(), 1000)
        }
    }

    private async consume(): Promise<void> {
        while (!this.stopped) {
            try {
                await this.ports.nats.processJetStreamMessages<{
                    jobId: string
                    organizationId: string
                }>(
                    streamName,
                    consumerName,
                    async message => {
                        if (await this.execute(message.data) === 'defer')
                            return { nakDelayMs: 5000 }
                    },
                    {
                        maxMessages: 1,
                        expiresMs: 1000,
                        nakDelayMs: 5000,
                    },
                )
            } catch (error) {
                warn('[MediaRenderAdapter] queue consumption will retry', error)
                await new Promise(resolve => setTimeout(resolve, 1000))
            }
        }
    }

    private async handle(record: MediaRenderRecord): Promise<MediaRenderHandle> {
        const progress = await this.repository.read<StoredRenderProgress>(
            partition(record.access.organizationId, record.jobId),
            'PROGRESS',
        )

        return {
            jobId: record.jobId,
            outputAssetId: record.outputAssetId,
            sequenceId: record.sequenceId,
            sequenceRevision: record.sequenceRevision,
            state: record.state,
            attempt: record.attempt,
            ...(record.error ? { error: record.error } : {}),
            ...(progress?.attempt === record.attempt ? { progress: progress.progress } : {}),
        }
    }
}
