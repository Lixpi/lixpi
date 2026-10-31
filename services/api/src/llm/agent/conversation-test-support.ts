import { createHash } from 'node:crypto'
import {
    createConversationSettings,
    type ConversationTurn,
} from '@lixpi/constants'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    ConversationRepository,
    conversationPartition,
    type ConversationMeta,
    type ConversationDispatch,
} from './conversation-repository.ts'
import {
    ConversationOwner,
    type ConversationOwnerPorts,
} from './conversation-owner.ts'
import { AgentConfiguration } from './agent-configuration.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'

export class AtomicConversationTestDatabase {
    readonly rows = new Map<string, Record<string, unknown>>()
    readonly commits: TransactOperation[][] = []
    pageSize = 2
    failAfterCommit = false
    beforeCommit?: (operations: TransactOperation[]) => void

    private key(item: Record<string, unknown>): string {
        return `${item.pk}|${item.sk}`
    }

    readonly getItem = async ({ key }: { key: Record<string, unknown> }) => structuredClone(
        this.rows.get(
            this.key(key),
        ),
    )

    readonly queryItems = async (request: {
        keyConditions: { pk: string }
        sortKeyCondition?: { value: string }
        exclusiveStartKey?: { sk: string }
        scanIndexForward: boolean
        limit: number
    }) => {
        const matching = [...this.rows.values()].filter(row => {
            if (
                row.pk !== request.keyConditions.pk
                || !String(row.sk).startsWith(request.sortKeyCondition?.value ?? '')
            )
                return false

            if (!request.exclusiveStartKey)
                return true

            return request.scanIndexForward ? String(row.sk) > request.exclusiveStartKey.sk : String(row.sk) < request.exclusiveStartKey.sk
        }).sort(
            (left, right) => Buffer.compare(
                Buffer.from(
                    String(left.sk),
                ),
                Buffer.from(
                    String(right.sk),
                ),
            ),
        )

        if (!request.scanIndexForward)
            matching.reverse()

        const items = matching.slice(
            0,
            Math.min(request.limit, this.pageSize),
        )

        return {
            items: structuredClone(items),
            ...(matching.length > items.length ? { lastEvaluatedKey: {
                pk: request.keyConditions.pk,
                sk: items.at(-1)!.sk,
            } } : {}),
        }
    }

    readonly transactWrite = async ({ operations }: { operations: TransactOperation[] }) => {
        this.beforeCommit?.(operations)
        const keys = new Set<string>()

        for (const operation of operations) {
            const key = this.key(operation.type === 'put' ? operation.item : operation.key)

            if (keys.has(key))
                throw new Error('Duplicate transaction target')

            keys.add(key)
            const existing = this.rows.get(key)

            if (!this.matches(existing, operation)) {
                const error = new Error('Conditional transaction conflict')
                error.name = 'ConditionalCheckFailedException'

                throw error
            }
        }

        for (const operation of operations) {
            if (operation.type === 'put')
                this.rows.set(
                    this.key(operation.item),
                    structuredClone(operation.item),
                )

            if (operation.type === 'delete')
                this.rows.delete(
                    this.key(operation.key),
                )
        }

        this.commits.push(
            structuredClone(operations),
        )

        if (this.failAfterCommit) {
            this.failAfterCommit = false

            throw new Error('TRANSACTION_ACKNOWLEDGEMENT_LOST')
        }
    }

    private matches(
        row: Record<string, unknown> | undefined,
        operation: TransactOperation,
    ): boolean {
        if (!operation.conditionExpression)
            return true

        const path = (name: string): unknown => name.split('.').reduce<unknown>(
            (value, part) => (value as Record<string, unknown> | undefined)?.[operation.expressionAttributeNames?.[part] ?? part],
            row,
        )

        const matches = (condition: string): boolean => {
            const alternative = /^\((.+)\s+OR\s+(.+)\)$/u.exec(condition)

            if (alternative)
                return matches(alternative[1]) || matches(alternative[2])

            const missing = /^attribute_not_exists\(([^)]+)\)$/u.exec(condition)

            if (missing)
                return path(missing[1]) === undefined

            const comparison = /^(\S+)\s+(=|<>|>=|<=|>|<)\s+(:\S+)$/u.exec(condition)

            if (!comparison)
                throw new Error(`Unsupported test condition: ${condition}`)

            const actual = path(comparison[1])
            const expected = operation.expressionAttributeValues?.[comparison[3]]

            if (comparison[2] === '=')
                return actual === expected

            if (comparison[2] === '<>')
                return actual !== expected

            if (actual === undefined)
                return false

            if (comparison[2] === '>')
                return (actual as number) > expected

            if (comparison[2] === '<')
                return (actual as number) < expected

            if (comparison[2] === '>=')
                return (actual as number) >= expected

            return (actual as number) <= expected
        }

        return operation.conditionExpression.split(/\s+AND\s+/u).every(matches)
    }
}

export class MemoryAgentPayloads implements AgentPayloadPort {
    readonly released: string[] = []

    async prepare(
        type: string,
        bytes: Uint8Array,
        _ownerKey: string,
    ): Promise<{
        payload: AgentPayload
        operations: TransactOperation[]
    }> {
        return {
            payload: {
                type,
                hash: createHash('sha256').update(bytes).digest('hex'),
                byteSize: bytes.byteLength,
                inline: Buffer.from(bytes).toString('base64'),
            },
            operations: [],
        }
    }

    async read(payload: AgentPayload): Promise<Uint8Array> {
        const bytes = Buffer.from(payload.inline ?? '', 'base64')

        if (
            bytes.byteLength !== payload.byteSize
            || createHash('sha256').update(bytes).digest('hex') !== payload.hash
        )
            throw new Error('AGENT_PAYLOAD_CORRUPT')

        return bytes
    }

    async release(
        _payload: AgentPayload,
        ownerKey: string,
    ): Promise<{
        operations: TransactOperation[]
        afterCommit: () => Promise<void>
    }> {
        return {
            operations: [],
            afterCommit: async () => void this.released.push(ownerKey),
        }
    }
}

export const createConversationExecutionFixture = async () => {
    const database = new AtomicConversationTestDatabase()
    const repository = new ConversationRepository(database as unknown as ConstructorParameters<typeof ConversationRepository>[0], 'Conversations')
    const partition = conversationPartition('org', 'conversation')
    const clock = { now: 1000 }
    const meta: ConversationMeta = {
        protocolVersion: 1,
        organizationId: 'org',
        workspaceId: 'workspace',
        conversationAssetId: 'conversation',
        ownerUserId: 'user',
        creationHash: 'creation',
        title: 'Conversation',
        activated: true,
        revision: 1,
        settings: createConversationSettings(),
        settingsRevision: 1,
        queueRevision: 1,
        queuePaused: false,
        commandSeq: 1,
        eventSeq: 0,
        projectedCommandSeq: 0,
        documentRevision: 0,
        epoch: 0,
        checkpointNamespace: 'root',
        createdAt: 1000,
        updatedAt: 1000,
    }
    const job: ConversationDispatch = {
        jobId: 'job',
        organizationId: 'org',
        workspaceId: 'workspace',
        conversationAssetId: 'conversation',
        userId: 'user',
        turnId: 'turn',
        dueAt: 1000,
    }
    const ports: ConversationOwnerPorts = {
        authorize: async (workspaceId, userId) => ({
            organizationId: 'org',
            workspaceId,
            userId,
            fences: [],
        }),
        publish: async () => {},
        now: () => clock.now,
    }
    database.rows.set(
        `${partition}|META`,
        {
            ...meta,
            pk: partition,
            sk: 'META',
        },
    )
    const turn: ConversationTurn = {
        turnId: 'turn',
        clientMessageId: 'message',
        commandSeq: 1,
        userId: 'user',
        fragment: { type: 'aiUserMessage' },
        references: [],
        settings: meta.settings,
        settingsRevision: 1,
        midRunPolicy: 'steer',
        state: 'queued',
        createdAt: 1000,
    }
    const owner = (await ConversationOwner.acquire(
        job,
        repository,
        ports,
    ))!
    await owner.start(
        turn,
        new AgentConfiguration({}),
    )

    return {
        database,
        repository,
        partition,
        clock,
        meta,
        job,
        ports,
        turn,
        owner,
        payloads: new MemoryAgentPayloads(),
    }
}
