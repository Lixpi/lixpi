import { randomUUID } from 'node:crypto'
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import NatsService from '@lixpi/nats-service'
import {
    getContentAddressedBlob,
    putContentAddressedBlob,
} from './blob-storage.ts'
import { ACCOUNT_ADMISSION_CHANGED_SUBJECT } from '@lixpi/constants'
import { AccountControlFeed } from './account-control-feed.ts'
import { AccountRequestScopes } from './account-request-scopes.ts'
import { AccountProcessIdentity } from './account-process-identity.ts'
import { DurableProviderUsageOutbox, PROVIDER_USAGE_OUTBOX_STREAM } from './provider-usage-outbox.ts'
import { type ProviderUsageRecordRequest, type ProviderUsageTransport } from '@lixpi/usage-reporter'

vi.mock('@lixpi/debug-tools', () => ({
    log: vi.fn(),
    info: vi.fn(),
    infoStr: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

const server = process.env.NATIVE_NATS_TEST_SERVER

describe.runIf(Boolean(server))('API storage on a disposable native NATS server', () => {
    const id = randomUUID().replaceAll('-', '')
    const organizationId = `native-${id}`
    const bucket = `blobs-${organizationId}-files`
    const events = `NATIVE_EVENTS_${id}`
    const work = `NATIVE_WORK_${id}`
    const control = `NATIVE_ADMISSION_${id}`
    let service: NatsService

    beforeAll(async () => {
        if (
            !server
            || new URL(server).hostname !== 'lixpi-nats-native-storage-test'
        )
            throw new Error('Native storage tests require their disposable NATS server')

        service = await NatsService.init({
            servers: [server],
            name: 'native-storage-test',
            streamReplicas: 1,
            initialConnectMaxAttempts: 1,
        })
    })

    afterAll(async () => {
        if (!service)
            return

        try {
            const manager = await service.getJetStreamManager()

            for (const name of [`OBJ_${bucket}`, events, work, control, PROVIDER_USAGE_OUTBOX_STREAM]) {
                if (await service.getJetStreamStreamInfoOrNull(name))
                    await manager.streams.delete(name)
            }
        } finally {
            await service.disconnect()
        }
    })

    it('stores permanent API Blob bytes in a native Object Store stream', async () => {
        const bytes = new TextEncoder().encode('native organization content')
        const stored = await putContentAddressedBlob({
            organizationId,
            bytes,
            mimeType: 'text/plain',
        })

        expect(stored.bucketName).toBe(bucket)
        const info = await service.getJetStreamStreamInfo(`OBJ_${bucket}`)
        expect(info.config.storage).toBe('file')
        expect(info.state.messages).toBeGreaterThan(0)
        const nativeObject = await (await service.getObjectStore(bucket)).get(stored.objectKey)
        expect(new Uint8Array(await new Response(nativeObject!.data).arrayBuffer())).toEqual(bytes)
        expect(await getContentAddressedBlob({
            organizationId,
            blobHash: stored.blobHash,
        })).toEqual(bytes)
    })

    it('retains usage through responder outages and worker restart, including a lost reply after posting', async () => {
        const committed = new Set<string>()
        let available = false
        let loseReply = true
        const transport: ProviderUsageTransport = { request: vi.fn(async (_subject, data) => {
            if (!available)
                throw new Error('metrics offline')

            committed.add((data as ProviderUsageRecordRequest).providerRequestId)

            if (loseReply)
                throw new Error('reply lost after commit')

            return { recorded: true } as never
        }) }
        const original = new DurableProviderUsageOutbox(service, transport, 1, 1)
        await original.prepare()
        await original.enqueueUsage({
            providerRequestId: 'outbox-restart-usage',
            authorizationId: 'authorization',
            orgId: organizationId,
            userId: 'owner',
            workflowId: 'workflow',
            workflowSeq: 1,
            model: 'synthetic',
            modality: 'tokens',
            measuringUnit: 'tokens',
            usage: {
                promptTokens: 100,
                completionTokens: 50,
            },
            occurredAt: new Date().toISOString(),
        })
        expect(await original.deliverPending()).toBe(0)
        expect((await service.getJetStreamStreamInfo(PROVIDER_USAGE_OUTBOX_STREAM)).state.messages).toBe(1)
        const restarted = new DurableProviderUsageOutbox(service, transport, 1, 1)
        await restarted.prepare()
        available = true
        expect(await restarted.deliverPending()).toBe(0)
        expect(committed.size).toBe(1)
        loseReply = false
        expect(await restarted.deliverPending()).toBe(1)
        await vi.waitFor(async () => expect((await service.getJetStreamStreamInfo(PROVIDER_USAGE_OUTBOX_STREAM)).state.messages).toBe(0))
        expect(committed.size).toBe(1)
    }, 10000)

    it('fans a durable account-disable event out to two API consumers and cancels both active requests', async () => {
        await service.ensureJetStreamStream({
            name: control,
            subjects: [ACCOUNT_ADMISSION_CHANGED_SUBJECT],
            storage: 'file',
            retention: 'limits',
            num_replicas: 1,
        })
        const admission = { admitVerifiedToken: vi.fn(async () => ({
            identityKey: 'identity',
            issuer: 'https://auth.example.com/',
            subject: 'user',
            epoch: 1,
            personalOrganizationId: 'org',
            tokenExpiresAt: Date.now() + 60000,
        })) }
        const first = new AccountRequestScopes(admission)
        const second = new AccountRequestScopes(admission)
        const firstFeed = new AccountControlFeed(service, first, control,
            new AccountProcessIdentity({ ENVIRONMENT: 'local' }, () => 'a'.repeat(12), fetch, { title: '' }))
        const secondFeed = new AccountControlFeed(service, second, control,
            new AccountProcessIdentity({ ENVIRONMENT: 'local' }, () => 'b'.repeat(12), fetch, { title: '' }))

        try {
            await Promise.all([firstFeed.start(), secondFeed.start()])
            const accepted: AbortSignal[] = []
            const pending = [first, second].map(scopes => scopes.run({}, async scope => {
                accepted.push(scope.signal)
                await new Promise<void>(resolve => scope.signal.addEventListener('abort', () => resolve(), { once: true }))
            }))
            const denied = Promise.all(pending.map(request => expect(request).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')))
            await vi.waitFor(() => expect(accepted).toHaveLength(2))
            await service.publishJetStream(ACCOUNT_ADMISSION_CHANGED_SUBJECT, {
                version: 1,
                eventId: randomUUID(),
                identityKey: 'identity',
                epoch: 2,
                state: 'blocked',
            }, { expect: { streamName: control } })
            await denied
            expect(accepted.every(signal => signal.aborted)).toBe(true)
            await expect(first.run({}, async () => 'unexpected')).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
            await expect(second.run({}, async () => 'unexpected')).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        } finally {
            firstFeed.stop()
            secondFeed.stop()
        }
    }, 15000)

    it('uses native event sequences, message-ID deduplication and replay', async () => {
        const subject = `${events}.event`
        await service.ensureJetStreamStream({
            name: events,
            subjects: [subject],
            num_replicas: 1,
        })
        const options = {
            msgID: 'event-1',
            expect: { streamName: events },
        }
        const first = await service.publishJetStream(subject, { event: 'created' }, options)
        const duplicate = await service.publishJetStream(subject, { event: 'created' }, options)

        expect(first).toMatchObject({
            stream: events,
            seq: 1,
        })
        expect(duplicate).toMatchObject({
            seq: 1,
            duplicate: true,
        })
        expect((await service.getJetStreamStreamInfo(events)).state.messages).toBe(1)
        expect(await service.getJetStreamMessage(events, { seq: 1 })).toEqual({
            subject,
            seq: 1,
            data: { event: 'created' },
        })
        await expect(service.publishJetStream(subject, { event: 'stale' }, {
            expect: {
                streamName: events,
                lastSubjectSequence: 0,
            },
        })).rejects.toThrow()
        await service.purgeJetStreamSubject(events, subject, { throughSequence: 1 })
        expect((await service.getJetStreamStreamInfo(events)).state.messages).toBe(0)
    })

    it('processes and acknowledges a finite native workqueue batch', async () => {
        const subject = `${work}.job`
        await service.ensureJetStreamStream({
            name: work,
            subjects: [subject],
            retention: 'workqueue' as any,
            num_replicas: 1,
        })
        await service.ensureJetStreamConsumer(work, {
            durable_name: 'worker',
            ack_policy: 'explicit',
            filter_subject: subject,
        })
        await service.publishJetStream(subject, { job: 'repair' })
        const handler = vi.fn().mockResolvedValue(undefined)

        expect(await service.processJetStreamMessages(work, 'worker', handler, {
            maxMessages: 1,
            expiresMs: 1000,
        })).toBe(1)
        expect(handler).toHaveBeenCalledWith({
            subject,
            seq: 1,
            data: { job: 'repair' },
        })
        await vi.waitFor(async () => expect((await service.getJetStreamStreamInfo(work)).state.messages).toBe(0))
    }, 5000)
})
