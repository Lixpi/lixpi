'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NatsService, { generateSelfIssuedJWT } from './nats-service.ts'

const {
    connectMock,
    wsConnectMock,
    tokenAuthenticatorMock,
    fromSeedMock,
    jetstreamMock,
    jetstreamManagerMock,
    objmConstructorMock,
    logMock,
    infoMock,
    infoStrMock,
    warnMock,
    errorMock,
} = vi.hoisted(() => ({
    connectMock: vi.fn(),
    wsConnectMock: vi.fn(),
    tokenAuthenticatorMock: vi.fn(),
    fromSeedMock: vi.fn(),
    jetstreamMock: vi.fn(),
    jetstreamManagerMock: vi.fn(),
    objmConstructorMock: vi.fn(),
    logMock: vi.fn(),
    infoMock: vi.fn(),
    infoStrMock: vi.fn(),
    warnMock: vi.fn(),
    errorMock: vi.fn(),
}))

vi.mock('@nats-io/transport-node', () => ({
    connect: (...args: any[]) => connectMock(...args),
}))

vi.mock('@nats-io/nats-core', () => ({
    wsconnect: (...args: any[]) => wsConnectMock(...args),
    tokenAuthenticator: (...args: any[]) => tokenAuthenticatorMock(...args),
}))

vi.mock('@nats-io/nkeys', () => ({
    fromSeed: (...args: any[]) => fromSeedMock(...args),
}))

vi.mock('@nats-io/jetstream', () => ({
    jetstream: (...args: any[]) => jetstreamMock(...args),
    jetstreamManager: (...args: any[]) => jetstreamManagerMock(...args),
}))

vi.mock('@nats-io/obj', () => ({
    Objm: function (this: any) {
        return objmConstructorMock(...arguments)
    },
}))

vi.mock('@lixpi/debug-tools', () => ({
    log: (...args: any[]) => logMock(...args),
    info: (...args: any[]) => infoMock(...args),
    infoStr: (...args: any[]) => infoStrMock(...args),
    warn: (...args: any[]) => warnMock(...args),
    err: (...args: any[]) => errorMock(...args),
}))

type MockSubscription = {
    [Symbol.asyncIterator]: () => AsyncIterator<any>
}

const createAsyncIterable = <T>(items: T[]): MockSubscription => ({
    [Symbol.asyncIterator]: async function* () {
        for (const item of items) {
            yield item
        }
    },
})

const createMockConnection = (overrides: Record<string, any> = {}) => {
    const protocolSubs = new Map(overrides.protocolSubs ?? [
        ['noop', { subject: 'noop' }],
    ])
    return {
        getServer: vi.fn().mockReturnValue('nats://localhost:4222'),
        isClosed: vi.fn().mockReturnValue(overrides.isClosed ?? false),
        publish: vi.fn(),
        subscribe: vi.fn().mockReturnValue(createAsyncIterable([])),
        request: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
        drain: vi.fn().mockResolvedValue(undefined),
        status: vi.fn().mockReturnValue(createAsyncIterable([])),
        protocol: { subscriptions: { subs: protocolSubs } },
        ...overrides,
    } as any
}

const decodeJwtLikePayload = (token: string) => {
    const parts = token.split('.')
    const decodePart = (part: string) => {
        const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
        return JSON.parse(Buffer.from(padded, 'base64').toString())
    }
    return {
        header: decodePart(parts[0]),
        claims: decodePart(parts[1]),
    }
}

describe('NatsService', () => {
    let seedKeyPair: { getPublicKey: ReturnType<typeof vi.fn>, sign: ReturnType<typeof vi.fn> }
    let objmMock: any
    let jetstreamClientMock: any
    let jetstreamManagerMockInstance: any
    let connectionMock: ReturnType<typeof createMockConnection>

    const resetSingleton = () => {
        ;(NatsService as any).instance = null
    }

    const flushPending = () => new Promise((resolve) => setTimeout(resolve, 0))

    beforeEach(() => {
        vi.clearAllMocks()
        resetSingleton()
        vi.useRealTimers()

        seedKeyPair = {
            getPublicKey: vi.fn().mockReturnValue('NKEY-TEST-CLIENT'),
            sign: vi.fn().mockReturnValue(Buffer.from('signature')),
        }
        fromSeedMock.mockReturnValue(seedKeyPair)

        objmMock = {
            create: vi.fn(),
            open: vi.fn(),
            destroy: vi.fn(),
        }
        objmConstructorMock.mockReturnValue(objmMock)

        jetstreamClientMock = {
            publish: vi.fn(),
            consumers: {
                get: vi.fn(),
            },
        }
        jetstreamMock.mockReturnValue(jetstreamClientMock)

        jetstreamManagerMockInstance = {
            streams: {
                list: vi.fn(),
                info: vi.fn(),
                update: vi.fn(),
                add: vi.fn(),
                purge: vi.fn(),
            },
            consumers: {
                info: vi.fn(),
                add: vi.fn(),
                update: vi.fn(),
            },
        }
        jetstreamManagerMock.mockResolvedValue(jetstreamManagerMockInstance)

        connectionMock = createMockConnection()
        connectMock.mockResolvedValue(connectionMock)
        wsConnectMock.mockResolvedValue(connectionMock)
        tokenAuthenticatorMock.mockImplementation((valueGetter: () => string | undefined) => {
            return () => valueGetter()
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.clearAllTimers()
    })

    // =============================================================================
    // generateSelfIssuedJWT
    // =============================================================================

    describe('generateSelfIssuedJWT', () => {
        it('encodes a parsable token with expected claims and algorithm', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

            const token = generateSelfIssuedJWT('seed', 'svc:test', 2)
            const { claims, header } = decodeJwtLikePayload(token)
            expect(token.split('.')).toHaveLength(3)
            expect(header).toEqual({ typ: 'JWT', alg: 'EdDSA' })
            expect(claims.sub).toBe('svc:test')
            expect(claims.iss).toBe('NKEY-TEST-CLIENT')
            expect(claims.iat).toBe(Math.floor(Date.now() / 1000))
            expect(claims.exp).toBe(claims.iat + 7200)
            expect(seedKeyPair.sign).toHaveBeenCalledTimes(1)
            vi.useRealTimers()
        })
    })

    // =============================================================================
    // Initialization and connection configuration
    // =============================================================================

    describe('init and connect', () => {
        it('throws only when connection path is configured wrongly and keeps auth retries isolated', async () => {
            const onAuthError = vi.fn()
            const authError: any = new Error('authorization failed')
            authError.name = 'AuthorizationError'
            const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

            const service = new (NatsService as any)({ onAuthError })
            connectMock.mockRejectedValueOnce(authError)

            await service.connect()

            expect(onAuthError).toHaveBeenCalledWith(authError)
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500)
        })

        it('only connects once through static init and reuses existing instance', async () => {
            const config = {}
            const service = await NatsService.init(config)
            const secondCall = await NatsService.init(config)

            expect(service).toBe(secondCall)
            expect(connectMock).toHaveBeenCalledTimes(1)
        })

        it('uses wsconnect when webSocket config is enabled', async () => {
            const service = new (NatsService as any)({ webSocket: true })
            await service.connect()

            expect(wsConnectMock).toHaveBeenCalledTimes(1)
            expect(connectMock).not.toHaveBeenCalled()
            expect((service as any).isConnected()).toBe(true)
        })

        it('uses token authenticator flow when token getter is configured', async () => {
            const config = {
                getToken: vi.fn()
                    .mockResolvedValueOnce('first-token')
                    .mockResolvedValueOnce('second-token'),
            }

            const service = new (NatsService as any)(config)
            await service.connect()

            const optionsFirst = connectMock.mock.calls[0][0] as { authenticator: () => string }
            expect(typeof optionsFirst.authenticator).toBe('function')
            expect(await optionsFirst.authenticator()).toBe('first-token')
            expect((config as any).getToken).toHaveBeenCalledTimes(1)

            service['nc'] = { isClosed: vi.fn().mockReturnValue(true), status: () => createAsyncIterable([]), protocol: { subscriptions: { subs: new Map() } } } as any
            await service.connect()

            const optionsSecond = connectMock.mock.calls[1][0] as { authenticator: () => string }
            expect(await optionsSecond.authenticator()).toBe('second-token')
            expect((config as any).getToken).toHaveBeenCalledTimes(2)
        })

        it('uses self-issued JWT when nkey seed + userId are configured', async () => {
            const nkeySeed = 'nkey-seed'
            const userId = 'svc:nats'
            const service = new (NatsService as any)({ nkeySeed, userId })
            await service.connect()

            const options = connectMock.mock.calls[0][0] as { token?: string; authenticator?: unknown }
            expect(options.token?.split('.')).toHaveLength(3)
            const decodedClaims = decodeJwtLikePayload(options.token || '').claims
            expect(decodedClaims.sub).toBe(userId)
            expect(options.authenticator).toBeUndefined()
        })
    })

    // =============================================================================
    // Pub/Sub and request primitives
    // =============================================================================

    describe('pub/sub and request behavior', () => {
        it('keeps subscriptions initialized using configured subscription metadata', async () => {
            connectionMock = createMockConnection()
            connectionMock.subscribe = vi.fn().mockReturnValue(createAsyncIterable([]))
            const service = new (NatsService as any)({
                subscriptions: [
                    { subject: 'alpha', payloadType: 'json', handler: vi.fn(), type: 'subscribe', queue: 'q1' },
                    { subject: 'beta', payloadType: 'buffer', handler: vi.fn(), type: 'reply' },
                ],
            })
            service['nc'] = connectionMock

            await service['initSubscriptions']()
            expect(service.isConnected()).toBe(true)
            expect(connectionMock.subscribe).toHaveBeenCalledWith('alpha', { queue: 'q1' })
            expect(connectionMock.subscribe).toHaveBeenCalledWith('beta', {})
        })

        it('logs and ignores publish/subscribe/request when disconnected', async () => {
            const service = new (NatsService as any)({})

            expect(service.publish('subject', { payload: 1 })).toBeUndefined()
            expect(service.subscribe('subject', vi.fn(), {})).toBeNull()
            const requestResult = await service.request('subject', { payload: 1 })
            expect(requestResult).toBeNull()

            expect(errorMock).toHaveBeenCalledWith('NATS client is not connected.')
        })

        it('routes subscribe payload through middleware and calls handler', async () => {
            const handler = vi.fn()
            const middleware = [
                vi.fn(async (data: any) => ({
                    data: { ...data, transformed: true },
                    msg: data.msg,
                })),
            ]
            const msg = {
                string: vi.fn().mockReturnValue(JSON.stringify({ raw: true })),
            }
            connectionMock.subscribe = vi.fn().mockReturnValue(createAsyncIterable([msg]))
            const service = new (NatsService as any)({
                middleware: middleware,
            })
            service['nc'] = connectionMock

            service.subscribe('topic', handler, {}, 'json')
            await flushPending()

            expect(middleware[0]).toHaveBeenCalledTimes(1)
            expect(handler).toHaveBeenCalledWith({ raw: true, transformed: true }, msg)
        })

        it('replies with encoded payload from handler result', async () => {
            const msg = {
                string: vi.fn().mockReturnValue('{"ping":"ok"}'),
                respond: vi.fn(),
            }
            connectionMock.subscribe = vi.fn().mockReturnValue(createAsyncIterable([msg]))
            const service = new (NatsService as any)({})
            service['nc'] = connectionMock

            service.reply('inbox', async (_data: any) => ({ pong: 'ok' }))
            await flushPending()

            expect(msg.respond).toHaveBeenCalledWith(JSON.stringify({ pong: 'ok' }))
        })

        it('replies with a JSON error payload when a reply handler throws', async () => {
            const msg = {
                string: vi.fn().mockReturnValue('{"ping":"ok"}'),
                respond: vi.fn(),
            }
            connectionMock.subscribe = vi.fn().mockReturnValue(createAsyncIterable([msg]))
            const service = new (NatsService as any)({})
            service['nc'] = connectionMock

            service.reply('inbox', async () => {
                throw new Error('CANVAS_ASSET_MEMBERSHIP_MUTATION_REJECTED')
            })
            await flushPending()

            expect(msg.respond).toHaveBeenCalledWith(JSON.stringify({
                error: 'CANVAS_ASSET_MEMBERSHIP_MUTATION_REJECTED',
            }))
            expect(msg.respond).not.toHaveBeenCalledWith('{}')
        })

        it('replies with a buffer error message when a buffer reply handler throws', async () => {
            const msg = {
                string: vi.fn().mockReturnValue('ping'),
                respond: vi.fn(),
            }
            connectionMock.subscribe = vi.fn().mockReturnValue(createAsyncIterable([msg]))
            const service = new (NatsService as any)({})
            service['nc'] = connectionMock

            service.reply('inbox', async () => {
                throw new Error('BUFFER_REPLY_FAILED')
            }, {}, 'buffer')
            await flushPending()

            const response = msg.respond.mock.calls[0]?.[0]
            expect(Buffer.isBuffer(response)).toBe(true)
            expect(response.toString()).toBe('BUFFER_REPLY_FAILED')
        })

        it('returns parsed response from request and respects request timeout', async () => {
            connectionMock.request = vi.fn().mockResolvedValue({
                string: vi.fn().mockReturnValue(JSON.stringify({ ok: true })),
            })
            const service = new (NatsService as any)({})
            service['nc'] = connectionMock

            const response = await service.request('topic', { request: true }, 1000)
            expect(response).toEqual({ ok: true })
            expect(connectionMock.request).toHaveBeenCalledWith(
                'topic',
                JSON.stringify({ request: true }),
                { timeout: 1000 }
            )
        })
    })

    // =============================================================================
    // Monitoring, status and lifecycle control
    // =============================================================================

    describe('lifecycle and status hooks', () => {
        it('updates connection visibility state after disconnect', async () => {
            const closeSpy = vi.fn().mockResolvedValue(undefined)
            const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
            const service = new (NatsService as any)({})
            service['nc'] = createMockConnection({ close: closeSpy, isClosed: vi.fn().mockReturnValue(false) })
            const timer = setTimeout(() => {
                // placeholder
            }, 10000)

            service['reconnectTimer'] = timer as any
            await service.disconnect()

            expect(closeSpy).toHaveBeenCalledTimes(1)
            expect((service as any).intentionalClose).toBe(true)
            expect(clearTimeoutSpy).toHaveBeenCalledWith(timer)
            clearTimeout(timer)
        })

        it('closes with drain and keeps intention-to-close flag', async () => {
            const drainSpy = vi.fn().mockResolvedValue(undefined)
            const service = new (NatsService as any)({})
            service['nc'] = createMockConnection({ drain: drainSpy, isClosed: vi.fn().mockReturnValue(false) })

            await service.drain()

            expect(drainSpy).toHaveBeenCalledTimes(1)
            expect((service as any).intentionalClose).toBe(true)
        })

        it('maps subscription wildcards when querying active subscriptions', () => {
            const matching = {
                subject: 'workspace.work-1.event',
                unsubscribe: vi.fn(),
            }
            const ignored = {
                subject: 'chat.direct',
                unsubscribe: vi.fn(),
            }
            const service = new (NatsService as any)({})
            service['nc'] = createMockConnection({
                protocolSubs: [
                    ['a', matching],
                    ['b', ignored],
                ],
                isClosed: vi.fn().mockReturnValue(false),
            })

            const subscriptions = service.getSubscriptions(['workspace.*'])
            expect(subscriptions.get('workspace.work-1.event')).toBe(matching)
            expect(subscriptions.get('chat.direct')).toBeUndefined()
        })

        it('unsubscribes every active subscription when requested', async () => {
            const first = { subject: 'a', unsubscribe: vi.fn() }
            const second = { subject: 'b', unsubscribe: vi.fn() }
            const service = new (NatsService as any)({})
            service['nc'] = createMockConnection({
                protocolSubs: [['a', first], ['b', second]],
            })

            await service.unsubscribeAll()

            expect(first.unsubscribe).toHaveBeenCalledTimes(1)
            expect(second.unsubscribe).toHaveBeenCalledTimes(1)
        })
    })

    // =============================================================================
    // JetStream and Object Store wrappers
    // =============================================================================

    describe('JetStream and object store wrappers', () => {
        it('creates object store with default replica factor unless overridden', async () => {
            const objectStore = { meta: true }
            objmMock.create.mockResolvedValue(objectStore)

            const service = new (NatsService as any)({ streamReplicas: 5 })
            service['nc'] = connectionMock
            const result = await service.createObjectStore('bucket', {
                description: 'test',
            })

            expect(result).toBe(objectStore)
            expect(objmMock.create).toHaveBeenCalledWith('bucket', { replicas: 5, description: 'test' })
        })

        it('returns null when opening missing object stores or streams', async () => {
            objmMock.open.mockRejectedValue({ code: 404 })
            const service = new (NatsService as any)({})
            service['nc'] = connectionMock

            const streamMissing = await service.getObject('bucket', 'missing')
            const streamMissingInfo = await service.getObjectStream('bucket', 'missing')
            const infoMissing = await service.getObjectInfo('bucket', 'missing')

            expect(streamMissing).toBeNull()
            expect(streamMissingInfo).toBeNull()
            expect(infoMissing).toBeNull()
        })

        it('concatenates chunks from object data stream', async () => {
            const objectStore = {
                get: vi.fn().mockResolvedValue({
                    data: {
                        getReader: () => {
                            let chunks = [new Uint8Array([1, 2]), new Uint8Array([3])]
                            return {
                                read: vi.fn().mockImplementation(async () => {
                                    const value = chunks.shift()
                                    if (value) return { done: false, value }
                                    return { done: true, value: undefined }
                                }),
                            }
                        },
                    },
                }),
            }
            objmMock.open.mockResolvedValue(objectStore)
            const service = new (NatsService as any)({})
            service['nc'] = connectionMock
            const result = await service.getObject('bucket', 'name')

            expect(result).toEqual(new Uint8Array([1, 2, 3]))
            expect(result?.length).toBe(3)
        })

        it('returns null for stream message when stream does not exist and throws on other errors', async () => {
            jetstreamManagerMockInstance.streams.list.mockReturnValue(createAsyncIterable([
                { config: { name: 'A' } },
                { config: { name: 'B' } },
            ]))
            jetstreamManagerMockInstance.streams.getMessage = vi.fn().mockRejectedValue({ code: 404 })
            jetstreamManagerMockInstance.streams.info = vi.fn().mockRejectedValue({ code: 404 })
            jetstreamManagerMockInstance.streams.update.mockResolvedValue(undefined)
            jetstreamManagerMockInstance.streams.add.mockResolvedValue({ name: 'stream-1' })

            const service = new (NatsService as any)({})
            service['nc'] = connectionMock
            const names = await service.listStreamNames()
            expect(names).toEqual(['A', 'B'])

            jetstreamManagerMockInstance.streams.purge.mockResolvedValue(undefined)
            await expect(service.purgeJetStreamSubject('stream', 'subject')).resolves.toBeUndefined()

            const messageResult = await service.getJetStreamMessage('stream', { last_by_subj: 'x' })
            expect(messageResult).toBeNull()

            await expect(service.getJetStreamStreamInfoOrNull('missing')).resolves.toBeNull()
            jetstreamManagerMockInstance.streams.info
                .mockRejectedValueOnce({ code: 500, message: 'server unavailable' })
            await expect(service.getJetStreamStreamInfoOrNull('missing')).rejects.toEqual({
                code: 500,
                message: 'server unavailable',
            })
        })

        it('merges subjects and scales stream replicas when ensuring stream config', async () => {
            jetstreamManagerMockInstance.streams.info.mockResolvedValueOnce({
                config: { name: 'stream-x', subjects: ['a', 'b'], num_replicas: 1 },
            })
            jetstreamManagerMockInstance.streams.update.mockResolvedValue(undefined)
            jetstreamManagerMockInstance.streams.info.mockResolvedValueOnce({
                name: 'stream-x',
                config: { name: 'stream-x', subjects: ['a', 'b', 'c'], num_replicas: 1 },
            })

            const service = new (NatsService as any)({})
            service['nc'] = connectionMock
            const streamInfo = await service.ensureJetStreamStream({
                name: 'stream-x',
                subjects: ['b', 'c'],
            })

            expect(jetstreamManagerMockInstance.streams.update).toHaveBeenCalledWith(
                'stream-x',
                expect.objectContaining({
                    name: 'stream-x',
                    subjects: ['a', 'b', 'c'],
                    num_replicas: 1,
                })
            )
            expect(streamInfo.config.subjects).toEqual(['a', 'b', 'c'])
        })

        it('does not mutate an existing stream when the requested config is already current', async () => {
            const streamInfo = {
                config: {
                    name: 'stream-x',
                    subjects: ['a', 'b'],
                    retention: 'workqueue',
                    storage: 'file',
                    max_age: 100,
                },
            }
            jetstreamManagerMockInstance.streams.info.mockResolvedValue(streamInfo)

            const service = new (NatsService as any)({})
            service['nc'] = connectionMock
            const result = await service.ensureJetStreamStream({
                name: 'stream-x',
                subjects: ['a', 'b'],
                retention: 'workqueue',
                storage: 'file',
                max_age: 100,
            })

            expect(result).toBe(streamInfo)
            expect(jetstreamManagerMockInstance.streams.update).not.toHaveBeenCalled()
        })

        it('supports consumeJetStreamMessages with ack and parsing', async () => {
            jetstreamClientMock.consumers.get.mockResolvedValue({
                consume: vi.fn().mockResolvedValue(createAsyncIterable([
                    {
                        string: vi.fn().mockReturnValue(JSON.stringify({ kind: 'first' })),
                        subject: 'subject.a',
                        seq: 1,
                        ack: vi.fn(),
                    },
                    {
                        string: vi.fn().mockReturnValue(JSON.stringify({ kind: 'second' })),
                        subject: 'subject.b',
                        seq: 2,
                        ack: vi.fn(),
                    },
                ])),
            })

            const service = new (NatsService as any)({})
            service['nc'] = connectionMock
            const messages = await service.consumeJetStreamMessages('stream', 'consumer', { maxMessages: 2 })

            expect(messages).toEqual([
                { data: { kind: 'first' }, subject: 'subject.a', seq: 1 },
                { data: { kind: 'second' }, subject: 'subject.b', seq: 2 },
            ])
        })

        it('creates or updates stream consumers and object info entries as expected', async () => {
            const infoObject = { name: 'consumer.1' }
            jetstreamManagerMockInstance.consumers.info.mockResolvedValue(infoObject)
            jetstreamManagerMockInstance.consumers.update.mockResolvedValue(infoObject)
            const service = new (NatsService as any)({})
            service['nc'] = connectionMock

            const existing = await service.ensureJetStreamConsumer('stream', { durable_name: 'c1' })
            expect(existing).toEqual(infoObject)
            expect(jetstreamManagerMockInstance.consumers.update).toHaveBeenCalledWith(
                'stream',
                'c1',
                { durable_name: 'c1' },
            )
            expect(jetstreamManagerMockInstance.consumers.add).not.toHaveBeenCalled()

            jetstreamManagerMockInstance.consumers.info.mockRejectedValueOnce({ code: 10059 })
            const created = await service.ensureJetStreamConsumer('stream', { durable_name: 'c2' })
            expect(jetstreamManagerMockInstance.consumers.add).toHaveBeenCalledWith('stream', { durable_name: 'c2' })
            expect(created).toBeUndefined()
        })

        it('publishes JSON and buffers to JetStream publish API', async () => {
            jetstreamClientMock.publish.mockResolvedValue({ seq: 4 })
            const service = new (NatsService as any)({})
            service['nc'] = connectionMock

            const jsonResult = await service.publishJetStream('subject', { done: true }, { msgID: 'm1' })
            const bufferResult = await service.publishJetStream('subject', new Uint8Array([1, 2]), { msgID: 'm2' })

            expect(jetstreamClientMock.publish).toHaveBeenCalledWith(
                'subject',
                new TextEncoder().encode(JSON.stringify({ done: true })),
                { msgID: 'm1' }
            )
            expect(jetstreamClientMock.publish).toHaveBeenCalledWith('subject', new Uint8Array([1, 2]), { msgID: 'm2' })
            expect(jsonResult).toEqual({ seq: 4 })
            expect(bufferResult).toEqual({ seq: 4 })
        })
    })
})
