import {
    BaseCheckpointSaver,
    WRITES_IDX_MAP,
    type ChannelVersions,
    type Checkpoint,
    type CheckpointMetadata,
    type CheckpointListOptions,
    type CheckpointTuple,
    type PendingWrite,
    type CheckpointPendingWrite,
} from '@langchain/langgraph-checkpoint'
import {
    type RunnableConfig,
} from '@langchain/core/runnables'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'

type CheckpointRow = {
    sk: string
    threadId: string
    namespace: string
    checkpointId: string
    parentCheckpointId?: string
    payload: AgentPayload
}

type WriteRow = {
    sk: string
    taskId: string
    channel: string
    index: number
    revision: number
    payload: AgentPayload
}

export type CheckpointAuthority = {
    partition: string
    threadId: string
    assertRead: () => Promise<void>
    writeFences: () => Promise<TransactOperation[]>
}

const component = (value: string): string => {
    if (
        typeof value !== 'string'
        || value.length > 1024
        || value.includes('\0')
    )
        throw new Error('INVALID_AGENT_CHECKPOINT_KEY')

    return Buffer.from(value).toString('base64url')
}

export class ConversationCheckpointSaver extends BaseCheckpointSaver {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly payloads: AgentPayloadPort,
        private readonly authority: CheckpointAuthority,
    ) {
        super()
    }

    override async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        await this.authority.assertRead()
        const {
            namespace,
            prefix,
        } = this.keys(config)
        let checkpointId = config.configurable?.checkpoint_id as string | undefined

        if (!checkpointId) {
            const head = await this.repository.read<{ checkpointId: string }>(this.authority.partition, `HEAD#${prefix}`)
            checkpointId = head?.checkpointId
        }

        if (!checkpointId)
            return undefined

        const row = await this.repository.read<CheckpointRow>(this.authority.partition, `CHECKPOINT#${prefix}#${component(checkpointId)}`)

        if (!row)
            return undefined

        const stored = (await this.serde.loadsTyped(row.payload.type, await this.payloads.read(row.payload))) as {
            checkpoint: Checkpoint
            metadata: CheckpointMetadata
        }
        const pendingWrites: CheckpointPendingWrite[] = []
        let after: string | undefined

        do {
            const page = await this.repository.query<WriteRow>(
                this.authority.partition,
                `WRITE#${prefix}#${component(checkpointId)}#`,
                { after },
            )

            for (const write of page.items)
                pendingWrites.push(
                    [write.taskId, write.channel, await this.serde.loadsTyped(write.payload.type, await this.payloads.read(write.payload))],
                )

            after = page.cursor
        } while (after)

        return {
            config: this.config(namespace, checkpointId),
            checkpoint: stored.checkpoint,
            metadata: stored.metadata,
            pendingWrites,
            ...(row.parentCheckpointId ? { parentConfig: this.config(namespace, row.parentCheckpointId) } : {}),
        }
    }

    override async *list(
        config: RunnableConfig,
        options: CheckpointListOptions = {},
    ): AsyncGenerator<CheckpointTuple> {
        await this.authority.assertRead()
        this.keys(config)
        const namespace = config.configurable?.checkpoint_ns as string | undefined
        const threadPrefix = component(this.authority.threadId)
        const prefix = namespace === undefined ? `CHECKPOINT#${threadPrefix}#` : `CHECKPOINT#${threadPrefix}#${component(namespace)}#`
        const rows: CheckpointRow[] = []
        let after: string | undefined

        do {
            const page = await this.repository.query<CheckpointRow>(
                this.authority.partition,
                prefix,
                { after },
            )
            rows.push(...page.items)
            after = page.cursor
        } while (after)

        rows.sort((left, right) => right.checkpointId.localeCompare(left.checkpointId))
        let remaining = options.limit ?? Number.MAX_SAFE_INTEGER

        for (const row of rows) {
            if (remaining <= 0)
                return

            if (
                config.configurable?.checkpoint_id
                && row.checkpointId !== config.configurable.checkpoint_id
            )
                continue

            if (
                options.before?.configurable?.checkpoint_id
                && row.checkpointId >= options.before.configurable.checkpoint_id
            )
                continue

            const tuple = await this.getTuple(
                this.config(row.namespace, row.checkpointId),
            )

            if (!tuple)
                continue

            if (
                options.filter
                && !Object.entries(options.filter).every(([key, value]) => tuple.metadata?.[key] === value)
            )
                continue

            remaining--
            yield tuple
        }
    }

    override async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        _newVersions: ChannelVersions,
    ): Promise<RunnableConfig> {
        const {
            namespace,
            prefix,
        } = this.keys(config)
        const sk = `CHECKPOINT#${prefix}#${component(checkpoint.id)}`
        const [type, bytes] = await this.serde.dumpsTyped({
            checkpoint,
            metadata,
        })
        const existing = await this.repository.read<CheckpointRow>(this.authority.partition, sk)

        if (existing) {
            const saved = await this.payloads.read(existing.payload)

            if (!Buffer.from(saved).equals(
                Buffer.from(bytes),
            ))
                throw new Error('AGENT_CHECKPOINT_ID_CONFLICT')

            return this.config(namespace, checkpoint.id)
        }

        const prepared = await this.payloads.prepare(
            type,
            bytes,
            sk,
        )

        for (let attempt = 0; attempt < 5; attempt++) {
            const head = await this.repository.read<{
                checkpointId: string
                revision: number
            }>(this.authority.partition, `HEAD#${prefix}`)
            const row = {
                threadId: this.authority.threadId,
                namespace,
                checkpointId: checkpoint.id,
                ...(config.configurable?.checkpoint_id ? { parentCheckpointId: String(config.configurable.checkpoint_id) } : {}),
                payload: prepared.payload,
            }

            try {
                await this.repository.commit([
                    ...await this.authority.writeFences(),
                    this.repository.put(
                        this.authority.partition,
                        sk,
                        row,
                    ),
                    ...(!head
                        || checkpoint.id > head.checkpointId
                        ? [this.repository.put(
                            this.authority.partition,
                            `HEAD#${prefix}`,
                            {
                                checkpointId: checkpoint.id,
                                revision: (head?.revision ?? 0) + 1,
                            },
                            head?.revision,
                        )]
                        : []),
                    ...prepared.operations,
                ])

                return this.config(namespace, checkpoint.id)
            } catch (error) {
                if (
                    !isTransactionConditionalCheckFailure(error)
                    || attempt === 4
                )
                    throw error

                const winner = await this.repository.read<CheckpointRow>(this.authority.partition, sk)

                if (winner) {
                    if (winner.payload.hash !== prepared.payload.hash)
                        throw new Error('AGENT_CHECKPOINT_ID_CONFLICT')

                    return this.config(namespace, checkpoint.id)
                }
            }
        }

        throw new Error('AGENT_CHECKPOINT_CONTENTION')
    }

    override async putWrites(
        config: RunnableConfig,
        writes: PendingWrite[],
        taskId: string,
    ): Promise<void> {
        const { prefix } = this.keys(config)
        const checkpointId = config.configurable?.checkpoint_id

        if (
            typeof checkpointId !== 'string'
            || !checkpointId
            || !taskId
        )
            throw new Error('AGENT_CHECKPOINT_WRITE_ID_REQUIRED')

        for (const [offset, [channel, value]] of writes.entries()) {
            const index = WRITES_IDX_MAP[channel] ?? offset
            const sk = `WRITE#${prefix}#${component(checkpointId)}#${component(taskId)}#${String(index).padStart(8, '0')}`
            const existing = await this.repository.read<WriteRow>(this.authority.partition, sk)

            if (
                existing
                && index >= 0
            )
                continue

            const [type, bytes] = await this.serde.dumpsTyped(value)
            const prepared = await this.payloads.prepare(
                type,
                bytes,
                sk,
            )

            if (existing?.payload.hash === prepared.payload.hash)
                continue

            const released = existing ? await this.payloads.release(existing.payload, sk) : undefined
            await this.repository.commit([
                ...await this.authority.writeFences(),
                this.repository.put(
                    this.authority.partition,
                    sk,
                    {
                        taskId,
                        channel,
                        index,
                        revision: (existing?.revision ?? 0) + 1,
                        payload: prepared.payload,
                    },
                    existing?.revision,
                ),
                ...prepared.operations,
                ...released?.operations ?? [],
            ])
            await released?.afterCommit()
        }
    }

    override async deleteThread(threadId: string): Promise<void> {
        if (threadId !== this.authority.threadId)
            throw new Error('AGENT_CHECKPOINT_THREAD_ACCESS_DENIED')

        for (const kind of ['CHECKPOINT', 'WRITE', 'HEAD']) {
            let after: string | undefined

            do {
                const page = await this.repository.query<{
                    sk: string
                    payload?: AgentPayload
                }>(
                    this.authority.partition,
                    `${kind}#${component(threadId)}#`,
                    { after },
                )

                for (const row of page.items) {
                    const released = row.payload ? await this.payloads.release(row.payload, row.sk) : undefined
                    await this.repository.commit([
                        ...await this.authority.writeFences(),
                        this.repository.remove(this.authority.partition, row.sk),
                        ...released?.operations ?? [],
                    ])
                    await released?.afterCommit()
                }

                after = page.cursor
            } while (after)
        }
    }

    private keys(config: RunnableConfig): {
        namespace: string
        prefix: string
    } {
        if (config.configurable?.thread_id !== this.authority.threadId)
            throw new Error('AGENT_CHECKPOINT_THREAD_ACCESS_DENIED')

        const namespace = config.configurable?.checkpoint_ns ?? ''

        return {
            namespace,
            prefix: `${component(this.authority.threadId)}#${component(namespace)}`,
        }
    }

    private config(
        namespace: string,
        checkpointId: string,
    ): RunnableConfig {
        return { configurable: {
            thread_id: this.authority.threadId,
            checkpoint_ns: namespace,
            checkpoint_id: checkpointId,
        } }
    }
}
