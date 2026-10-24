import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ACCOUNT_ADMISSION_CHANGED_SUBJECT } from '@lixpi/constants'
import {
    type AccountRequestScopes,
    type AccountInvalidation,
} from './account-request-scopes.ts'
import { AccountProcessIdentity } from './account-process-identity.ts'

type Change = AccountInvalidation & {
    version: 1
    eventId: string
}

type ConsumerInfo = {
    num_pending: number
    num_ack_pending: number
    error?: unknown
}

export type AccountControlTransport = {
    getConnection: () => {
        isClosed: () => boolean
        isDraining: () => boolean
        status: () => AsyncIterable<{ type: string }>
        request: (
            subject: string,
            data: string,
            options: { timeout: number },
        ) => Promise<{ json: () => ConsumerInfo }>
    } | null
    getJetStreamStreamInfo: (name: string) => Promise<{
        created: string
        config: {
            subjects: string[]
            storage: string
            retention: string
        }
        state: { last_seq: number }
    }>
    ensureJetStreamConsumer: (
        stream: string,
        config: Record<string, unknown>,
    ) => Promise<unknown>
    processJetStreamMessages: <T>(
        stream: string,
        consumer: string,
        handler: (message: {
            data: T
            subject: string
            seq: number
        }) => Promise<void>,
        options: {
            maxMessages: number
            expiresMs: number
        },
    ) => Promise<number>
}

// Each API process gets its own durable consumer. Sharing one queue would let
// one replica acknowledge a disable event before the other replicas see it.
export class AccountControlFeed {
    readonly consumerName = `admission_api_${randomUUID().replaceAll('-', '')}`
    private readonly stopping = new AbortController()
    private available = false
    private streamCreated?: string
    private lastSequence = 0
    private task?: Promise<void>
    private statusTask?: Promise<void>
    private poisoned = false
    private connectionGeneration = 0

    constructor(
        private readonly transport: AccountControlTransport,
        private readonly scopes: Pick<AccountRequestScopes, 'invalidate' | 'setControlAvailable'>,
        private readonly stream: string,
        private readonly processIdentity: Pick<AccountProcessIdentity, 'read'> = new AccountProcessIdentity(),
    ) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(stream))
            throw new Error('Invalid admission control stream')
    }

    isReady(): boolean {
        return this.available && !this.stopping.signal.aborted && !this.poisoned
    }

    async start(): Promise<void> {
        if (this.task)
            throw new Error('Admission control feed already started')

        await this.verifyStream()
        const deployment = await this.processIdentity.read(this.consumerName)
        await this.transport.ensureJetStreamConsumer(
            this.stream,
            {
                durable_name: this.consumerName,
                metadata: {
                    'lixpi.enforcement.version': '1',
                    'lixpi.enforcement.role': 'api',
                    'lixpi.enforcement.deployment': JSON.stringify(deployment),
                },
                deliver_policy: 'all',
                ack_policy: 'explicit',
                filter_subject: ACCOUNT_ADMISSION_CHANGED_SUBJECT,
                max_ack_pending: 128,
                ack_wait: 10_000_000_000,
            },
        )
        this.statusTask = this.watchConnection()
        this.task = this.consume()
        const deadline = Date.now() + 15000

        while (!this.isReady()) {
            if (
                Date.now() >= deadline
                || this.poisoned
                || this.stopping.signal.aborted
            ) {
                this.stop()

                throw new Error('Account admission control feed is unavailable')
            }

            await delay(25)
        }
    }

    stop(): void {
        this.setAvailable(false)
        this.stopping.abort()
    }

    private setAvailable(value: boolean): void {
        this.available = value
        this.scopes.setControlAvailable(value)
    }

    private async watchConnection(): Promise<void> {
        const connection = this.transport.getConnection()

        if (!connection) {
            this.setAvailable(false)

            return
        }

        try {
            for await (const status of connection.status()) {
                if (this.stopping.signal.aborted)
                    return

                if (['disconnect', 'reconnecting', 'error', 'close'].includes(status.type)) {
                    this.connectionGeneration++
                    this.setAvailable(false)
                }
            }
        } catch {
            this.poisoned = true
        } finally {
            this.connectionGeneration++
            this.setAvailable(false)
        }
    }

    private async verifyStream(): Promise<void> {
        const info = await this.transport.getJetStreamStreamInfo(this.stream)

        if (
            !info.created
            || info.config.storage !== 'file'
            || info.config.retention !== 'limits'
            || info.config.subjects.length !== 1
            || info.config.subjects[0] !== ACCOUNT_ADMISSION_CHANGED_SUBJECT
            || (this.streamCreated && this.streamCreated !== info.created)
            || !Number.isSafeInteger(info.state.last_seq)
            || info.state.last_seq < this.lastSequence
        ) {
            this.poisoned = true

            throw new Error('Invalid admission control stream')
        }

        this.streamCreated = info.created
    }

    private async consume(): Promise<void> {
        while (
            !this.stopping.signal.aborted
            && !this.poisoned
        ) {
            try {
                const generation = this.connectionGeneration
                await this.transport.processJetStreamMessages<Change>(
                    this.stream,
                    this.consumerName,
                    async message => {
                        const event = message.data

                        if (
                            message.subject !== ACCOUNT_ADMISSION_CHANGED_SUBJECT
                            || !Number.isSafeInteger(message.seq)
                            || message.seq < 1
                            || !event
                            || event.version !== 1
                            || typeof event.eventId !== 'string'
                            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.eventId)
                            || typeof event.identityKey !== 'string'
                            || !event.identityKey
                            || new TextEncoder().encode(event.identityKey).length > 2048
                            || !Number.isSafeInteger(event.epoch)
                            || event.epoch < 1
                            || !['active', 'blocked', 'reconciling', 'superseded'].includes(event.state)
                        ) {
                            this.poisoned = true
                            this.setAvailable(false)

                            throw new Error('Invalid admission control event')
                        }

                        this.scopes.invalidate(event)
                        this.lastSequence = Math.max(this.lastSequence, message.seq)
                    },
                    {
                        maxMessages: 128,
                        expiresMs: 1000,
                    },
                )

                if (
                    this.poisoned
                    || this.stopping.signal.aborted
                )
                    break

                await this.verifyStream()
                const connection = this.transport.getConnection()

                if (
                    !connection
                    || connection.isClosed()
                    || connection.isDraining()
                )
                    throw new Error('Admission transport unavailable')

                const response = await connection.request(
                    `$JS.API.CONSUMER.INFO.${this.stream}.${this.consumerName}`,
                    '{}',
                    { timeout: 1000 },
                )
                const info = response.json()

                if (
                    info.error
                    || !Number.isSafeInteger(info.num_pending)
                    || !Number.isSafeInteger(info.num_ack_pending)
                )
                    throw new Error('Admission consumer unavailable')

                if (
                    generation === this.connectionGeneration
                    && !this.stopping.signal.aborted
                    && !this.poisoned
                ) {
                    this.available = info.num_pending === 0 && info.num_ack_pending === 0

                    // A healthy backlog pauses new admission. Only the changed
                    // identities are cancelled; transport failure cancels all.
                    if (this.available)
                        this.scopes.setControlAvailable(true)
                }
            } catch {
                this.setAvailable(false)

                if (!this.stopping.signal.aborted)
                    await delay(250)
            }
        }

        this.setAvailable(false)
    }
}
