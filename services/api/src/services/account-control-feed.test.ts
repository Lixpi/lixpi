import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ADMISSION_CHANGED_SUBJECT } from '@lixpi/constants'
import { AccountControlFeed, type AccountControlTransport } from './account-control-feed.ts'

class FeedTransport implements AccountControlTransport {
    readonly events: Array<{
        data: unknown
        subject: string
        seq: number
    }> = []
    readonly statuses: Array<{ type: string }> = []
    created = '2026-10-03T00:00:00Z'
    lastSequence = 0
    disconnected = false
    stopped = false
    holdAcknowledgements = false
    createdConsumers: string[] = []

    getConnection = () => ({
        isClosed: () => this.disconnected,
        isDraining: () => false,
        status: () => this.readStatuses(),
        request: async () => ({ json: () => ({
            num_pending: this.events.length,
            num_ack_pending: this.holdAcknowledgements ? 1 : 0,
        }) }),
    })

    async *readStatuses() {
        while (!this.stopped) {
            const status = this.statuses.shift()

            if (status)
                yield status
            else
                await delay(5)
        }
    }

    async getJetStreamStreamInfo() {
        if (this.disconnected)
            throw new Error('Disconnected')

        return {
            created: this.created,
            config: {
                subjects: [ACCOUNT_ADMISSION_CHANGED_SUBJECT],
                storage: 'file',
                retention: 'limits',
            },
            state: { last_seq: this.lastSequence },
        }
    }

    async ensureJetStreamConsumer(_stream: string, config: Record<string, unknown>) {
        this.createdConsumers.push(String(config.durable_name))
        expect(config.deliver_policy).toBe('all')
        expect(config.ack_policy).toBe('explicit')
        expect(config.inactive_threshold).toBeUndefined()
        expect(config.metadata).toEqual({
            'lixpi.enforcement.version': '1',
            'lixpi.enforcement.role': 'api',
            'lixpi.enforcement.deployment': JSON.stringify({
                kind: 'compose',
                container: 'a'.repeat(64),
                task: '',
            }),
        })
    }

    async processJetStreamMessages<T>(
        _stream: string,
        _consumer: string,
        handler: (message: {
            data: T
            subject: string
            seq: number
        }) => Promise<void>,
    ): Promise<number> {
        if (this.disconnected)
            throw new Error('Disconnected')

        const message = this.events.shift()

        if (!message) {
            await delay(10)

            return 0
        }

        try {
            await handler(message as {
                data: T
                subject: string
                seq: number
            })

            return 1
        } catch {
            // The shared transport catches handler failures and negatively acknowledges them.
            this.events.unshift(message)

            return 0
        }
    }

    publish(data: unknown): void {
        this.events.push({
            data,
            subject: ACCOUNT_ADMISSION_CHANGED_SUBJECT,
            seq: ++this.lastSequence,
        })
    }
}

const running: Array<{
    feed: AccountControlFeed
    transport: FeedTransport
}> = []
const fixture = () => {
    const transport = new FeedTransport()
    const scopes = {
        invalidate: vi.fn(),
        setControlAvailable: vi.fn(),
    }
    const feed = new AccountControlFeed(transport, scopes, 'ACCOUNT_ADMISSION', {
        read: async () => ({
            kind: 'compose' as const,
            container: 'a'.repeat(64),
            task: '',
        }),
    })
    running.push({
        feed,
        transport,
    })

    return {
        transport,
        scopes,
        feed,
    }
}
const change = () => ({
    version: 1,
    eventId: randomUUID(),
    identityKey: 'bound-identity',
    epoch: 2,
    state: 'blocked',
})

// =============================================================================
// DURABLE PER-INSTANCE INVALIDATION DELIVERY
// =============================================================================

describe('account admission control feed', () => {
    afterEach(async () => {
        for (const {
            feed,
            transport,
        } of running.splice(0)) {
            feed.stop()
            transport.stopped = true
        }

        await delay(15)
    })

    it('replays pending changes before admitting work and uses distinct replica consumers', async () => {
        const a = fixture()
        const b = fixture()
        const event = change()
        a.transport.publish(event)
        b.transport.publish(event)
        expect(a.feed.isReady()).toBe(false)
        await Promise.all([a.feed.start(), b.feed.start()])
        expect(a.scopes.invalidate).toHaveBeenCalledWith(event)
        expect(b.scopes.invalidate).toHaveBeenCalledWith(event)
        expect(a.feed.consumerName).not.toBe(b.feed.consumerName)
        expect(a.feed.isReady()).toBe(true)
    })

    it('closes access on disconnect and replays missed events before reopening', async () => {
        const f = fixture()
        await f.feed.start()
        f.transport.disconnected = true
        f.transport.statuses.push({ type: 'disconnect' })
        await vi.waitFor(() => expect(f.feed.isReady()).toBe(false))
        expect(f.scopes.setControlAvailable).toHaveBeenLastCalledWith(false)
        const event = change()
        f.transport.publish(event)
        f.transport.disconnected = false
        await vi.waitFor(() => expect(f.feed.isReady()).toBe(true))
        expect(f.scopes.invalidate).toHaveBeenCalledWith(event)
    })

    it('keeps a poisoned stream closed even when the shared transport catches the handler error', async () => {
        const f = fixture()
        await f.feed.start()
        f.transport.publish({
            ...change(),
            epoch: 0,
        })
        await vi.waitFor(() => expect(f.feed.isReady()).toBe(false))
        expect(f.scopes.invalidate).not.toHaveBeenCalled()
        await delay(40)
        expect(f.feed.isReady()).toBe(false)
    })

    it('refuses a replaced stream instead of trusting an empty replay', async () => {
        const f = fixture()
        await f.feed.start()
        f.transport.created = '2026-10-04T00:00:00Z'
        await vi.waitFor(() => expect(f.feed.isReady()).toBe(false))
    })

    it('waits for acknowledgements before opening admission', async () => {
        const f = fixture()
        f.transport.holdAcknowledgements = true
        const starting = f.feed.start()
        await delay(40)
        expect(f.feed.isReady()).toBe(false)
        f.transport.holdAcknowledgements = false
        await starting
        expect(f.feed.isReady()).toBe(true)
        f.feed.stop()
        expect(f.feed.isReady()).toBe(false)
    })

    it('pauses admission during healthy backlog without cancelling unrelated work', async () => {
        const f = fixture()
        await f.feed.start()
        f.scopes.setControlAvailable.mockClear()
        f.transport.holdAcknowledgements = true
        const event = change()
        f.transport.publish(event)
        await vi.waitFor(() => expect(f.feed.isReady()).toBe(false))
        expect(f.scopes.invalidate).toHaveBeenCalledWith(event)
        expect(f.scopes.setControlAvailable).not.toHaveBeenCalledWith(false)
        f.transport.holdAcknowledgements = false
        await vi.waitFor(() => expect(f.feed.isReady()).toBe(true))
    })
})
