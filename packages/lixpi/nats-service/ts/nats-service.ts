'use strict'

import c from 'chalk'
import { wsconnect } from '@nats-io/nats-core'
import { connect } from "@nats-io/transport-node"
import { fromSeed } from '@nats-io/nkeys'
import { jetstream, jetstreamManager } from '@nats-io/jetstream'
import { Objm } from '@nats-io/obj'

import type {
    NatsConnection,
    Msg,
    Subscription,
    ConnectionOptions
} from '@nats-io/nats-core'
import type { JetStreamClient, JetStreamManager } from '@nats-io/jetstream'
import type { ObjectStore, ObjectStoreOptions, ObjectInfo } from '@nats-io/obj'

// Default JetStream replication factor for all stores we create. The cluster
// runs 3 nodes, so R3 keeps a quorum copy on every node: a single node lagging
// or being briefly deemed unhealthy can no longer lose the only copy of data.
// Never default to 1 in a cluster — an R1 asset has no redundancy and can be
// silently lost when the meta-layer reassigns it during a health blip.
const DEFAULT_STREAM_REPLICAS = 3

import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

export type NatsMiddleware<T = any> = (data: T, msg: Msg) =>
    Promise<{ data: T, msg: Msg }> | { data: T, msg: Msg }

export type ReplyMiddleware<T = any, R = any> = (data: T, msg: Msg) =>
    Promise<{ data: T, msg: Msg }> | { data: T, msg: Msg }

export type NatsServiceConfig = {
    servers?: string[]
    webSocket?: boolean
    name?: string
    token?: string
    user?: string
    pass?: string
    nkeySeed?: string       // Optional NKey seed for self-issued JWT
    userId?: string         // Optional user ID for JWT subject (used with nkeySeed)
    subscriptions?: NatsSubjectSubscription[]
    middleware?: NatsMiddleware[]              // Middleware for all subscriptions
    replyMiddleware?: ReplyMiddleware[]        // Middleware specifically for replies
    streamReplicas?: number                    // Replication factor for created stores (defaults to DEFAULT_STREAM_REPLICAS)
}

export type NatsSubjectSubscription<T = any> = {
    subject: string
    queue?: string
    type?: 'subscribe' | 'reply'
    payloadType: 'json' | 'buffer'
    permissions?: {
        pub?: { allow: string[] }
        sub?: { allow: string[] }
    }
    handler: (data: T, msg: Msg) => Promise<void> | void
}

export type RequestOptions = {
    timeout?: number
}

export type SubscriptionOptions = {
    queue?: string
}

export type MessageHandler = (data: any, msg: Msg) => void | Promise<void>
export type ReplyHandler<T = any, R = any> = (data: T, msg: Msg) => Promise<R> | R

const encode = (value: any, type: 'json' | 'buffer'): any => {
    if (type === 'json') {
        return JSON.stringify(value)
    }

    if (type === 'buffer') {
        return Buffer.from(value)
    }
}

const decode = (value: any, type: 'json' | 'buffer'): any => {
    if (type === 'json') {
        return JSON.parse(value.string())
    }

    if (type === 'buffer') {
        return value.string()
    }
}

// Generate a self-issued JWT signed with NKey (Ed25519).
// This is optional and only used by services that require self-issued JWT authentication.
export function generateSelfIssuedJWT(nkeySeed: string, userId: string, expiryHours: number = 1): string {
    // Create NKey pair from seed
    const kp = fromSeed(Buffer.from(nkeySeed))

    // Get public key for issuer field
    const publicKey = Buffer.from(kp.getPublicKey()).toString('utf-8')

    // Create JWT claims
    const now = Math.floor(Date.now() / 1000)
    const claims = {
        sub: userId,           // Subject: service identity
        iss: publicKey,        // Issuer: our public key
        iat: now,              // Issued at
        exp: now + (expiryHours * 3600)  // Expiry
    }

    // Create JWT header
    const header = {
        typ: 'JWT',
        alg: 'EdDSA'  // Ed25519 signature algorithm
    }

    // Encode header and claims as base64url
    const base64urlEncode = (data: object): string => {
        const jsonStr = JSON.stringify(data)
        return Buffer.from(jsonStr)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '')
    }

    const headerB64 = base64urlEncode(header)
    const claimsB64 = base64urlEncode(claims)

    // Create signing input
    const message = `${headerB64}.${claimsB64}`

    // Sign with NKey
    const signature = kp.sign(Buffer.from(message))
    const signatureB64 = Buffer.from(signature)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')

    // Construct final JWT
    const jwtToken = `${message}.${signatureB64}`

    log(`Generated self-issued JWT for ${userId}, expires in ${expiryHours}h`)

    return jwtToken
}

export default class NatsService {
    private static instance: NatsService
    private nc: NatsConnection | null = null
    private js: JetStreamClient | null = null
    private jsm: JetStreamManager | null = null
    private objm: Objm | null = null
    private config: NatsServiceConfig
    private streamReplicas: number
    private isMonitoring = false
    private isConnecting = false
    private reconnectTimer: NodeJS.Timeout | null = null
    private subscriptionsInitialized = false

    static getInstance(): NatsService | null {
        return NatsService.instance || null
    }

    static async init(config: NatsServiceConfig = {}): Promise<NatsService> {
        if (!NatsService.instance) {
            NatsService.instance = new NatsService(config)
            await NatsService.instance.connect()
        }
        return NatsService.instance
    }

    private constructor(config: NatsServiceConfig) {
        this.config = config
        this.streamReplicas = config.streamReplicas ?? DEFAULT_STREAM_REPLICAS
    }

    private scheduleReconnect(delay = 500) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = setTimeout(() => this.connect(), delay)
    }

    private monitorStatus(): void {
        if (!this.nc || this.isMonitoring) return
        this.isMonitoring = true

        ;(async () => {
            for await (const status of this.nc.status()) {
                switch (status.type) {
                    case "disconnect":
                        err('NATS -> disconnected:', status)
                        break
                    case "reconnecting":
                        warn('NATS -> reconnecting:', status)
                        break
                    case "reconnect":
                        info('NATS -> reconnected:', status)
                        // Check if subscriptions need to be initialized after reconnect
                        if (!this.subscriptionsInitialized) {
                            await this.initSubscriptions()
                        }
                        break
                    case "error":
                        err('NATS -> connection error:', status)
                        break
                    case "close":
                        warn('NATS -> connection closed:', status)
                        // Reset the initialized flag on close so we can reconnect properly
                        this.subscriptionsInitialized = false
                        break
                }
            }
        })()
    }

    private async initSubscriptions(): Promise<void> {
        if (!this.nc || this.subscriptionsInitialized) return

        const subs = this.config.subscriptions || []
        if (subs.length === 0) {
            this.subscriptionsInitialized = true
            return
        }

        subs.forEach(listener => {
            try {
                const subscriptionType = listener.type ?? 'subscribe'

                let subscription: Subscription
                if (subscriptionType === 'reply') {
                    subscription = this.reply(
                        listener.subject,
                        listener.handler as ReplyHandler,
                        { queue: listener.queue },
                        listener.payloadType
                    )
                } else {
                    subscription = this.subscribe(
                        listener.subject,
                        listener.handler as MessageHandler,
                        { queue: listener.queue },
                        listener.payloadType
                    )
                }

                if (subscription) {
                    infoStr([
                        c.green('NATS -> '),
                        c.grey.italic('register:'),
                        c.white.italic(subscriptionType.padEnd(10, ' ')),
                        c.grey(': '),
                        c.green(listener.subject),
                        listener.queue ? `${c.white(' with queue:')} ${c.green(listener.queue)}` : ''
                    ])
                }
            } catch (error) {
                err(`Failed to subscribe to NATS subject ${listener.subject}`, error)
            }
        })

        this.subscriptionsInitialized = true
    }

    private async applyMiddleware<T = any>(
        data: T,
        msg: Msg,
        handlers: Array<NatsMiddleware<T> | ReplyMiddleware<T>>
    ): Promise<{ data: T, msg: Msg }> {
        let currentData = { data, msg }
        for (const middlewareFunc of handlers) {
            currentData = await Promise.resolve(middlewareFunc(currentData.data, currentData.msg))
        }
        return currentData
    }

    async unsubscribeAll(): Promise<void> {
        if (!this.nc || this.nc.isClosed()) return
        const subs = (this.nc as any).protocol.subscriptions.subs
        for (const [, sub] of subs) {
            sub.unsubscribe()
        }
        log('All NATS subscriptions cancelled via built-in tracking.')
    }

    public getSubscriptions(subjectOrSubjects: string | string[] = []): Map<string, Subscription> {
        const matchFilter = (value: string, filter: string) => {
            const idx = filter.indexOf('*')
            if (idx < 0) return value === filter
            if (filter.indexOf('*', idx + 1) !== -1) return false // multiple '*' => fallback
            const prefix = filter.slice(0, idx)
            const suffix = filter.slice(idx + 1)
            return value.startsWith(prefix) && value.endsWith(suffix)
        }

        const subjects = Array.isArray(subjectOrSubjects) ? subjectOrSubjects : [subjectOrSubjects]
        const result = new Map<string, Subscription>()
        if (!this.nc || this.nc.isClosed()) return result

        const subs = (this.nc as any).protocol.subscriptions.subs
        for (const [, sub] of subs) {
            if (!subjects.length || subjects.some(f => matchFilter(sub.subject, f))) {
                result.set(sub.subject, sub)
            }
        }
        return result
    }

    async connect(initialConnectTimeout = 2000): Promise<void> {
        if (this.isConnecting || this.isConnected()) return
        this.isConnecting = true

        try {
            const options = this.buildConnectionOptions()
            this.nc = await Promise.race([
                this.config.webSocket ? wsconnect(options) : connect(options),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Initial connect timeout')), initialConnectTimeout)
                )
            ])
            infoStr([
                c.green('NATS -> listening on: '),
                c.blue(`${this.config.webSocket ? 'wss://' : 'nats://'}${this.nc.getServer()}`)
            ])
            this.monitorStatus()
            await this.initSubscriptions()
        } catch (error) {
            err('NATS -> connection error or timeout', error)
            this.scheduleReconnect()
        } finally {
            this.isConnecting = false
        }
    }

    private buildConnectionOptions(): ConnectionOptions {
        const { servers = ['nats://localhost:4222'], name = 'default' } = this.config

        const options: ConnectionOptions = {
            servers,
            name,
            maxReconnectAttempts: -1,
            reconnectTimeWait: 500,
            waitOnFirstConnect: true,
        }

        this.applyAuthentication(options)
        return options
    }

    private applyAuthentication(options: ConnectionOptions): void {
        const { nkeySeed, userId, token, user, pass } = this.config

        if (nkeySeed && userId) {
            // Priority 1: Self-issued JWT using NKey seed (Ed25519 signing)
            // Used by services that need cryptographically signed authentication
            options.token = generateSelfIssuedJWT(nkeySeed, userId, 1)
        } else if (token) {
            // Priority 2: Pre-generated JWT token
            // Used when token is already available from external source
            options.token = token
        } else if (user && pass) {
            // Priority 3: Basic username/password authentication
            // Legacy auth method, less secure than JWT
            options.user = user
            options.pass = pass
        }
        // If none provided, connection will be attempted without authentication
    }

    async disconnect(): Promise<void> {
        if (this.nc && !this.nc.isClosed()) {
            await this.nc.close()
            info('NATS disconnected gracefully.')
        }
    }

    async drain(): Promise<void> {
        if (this.nc && !this.nc.isClosed()) {
            await this.nc.drain()
            info('NATS drained all subscriptions and disconnected.')
        }
    }

    isConnected(): boolean {
        return !!this.nc && !this.nc.isClosed()
    }

    getConnection(): NatsConnection | null {
        return this.nc
    }

    /**
     * Publish JSON data to a subject
     */
    publish<T = any>(subject: string, data: T): void {
        if (!this.nc) {
            err('NATS client is not connected.')
            return
        }
        this.nc.publish(subject, JSON.stringify(data))
    }

    /**
     * Subscribe to a subject
     */
    subscribe<T = any>(
        subject: string,
        handler: (data: T, msg: Msg) => void | Promise<void>,
        options: SubscriptionOptions = {},
        payloadType: 'json' | 'buffer' = 'json'
    ): Subscription | null {
        if (!this.nc) {
            err('NATS client is not connected.')
            return null
        }

        const subOptions = options.queue ? { queue: options.queue } : {}
        const subscription = this.nc.subscribe(subject, subOptions)

        // Apply middleware
        //TODO it hould use both middleware types
        const middlewareChain = this.config.replyMiddleware || this.config.middleware || []

        ;(async () => {
            for await (const msg of subscription) {
                try {
                    let data = decode(msg, payloadType) as T
                    if (middlewareChain.length) {
                        const result = await this.applyMiddleware(data, msg, middlewareChain)
                        data = result.data
                    }
                    await handler(data, msg)
                } catch (error) {
                    err(`Error processing message on subject ${subject}`, {
                        error,
                        messageData: msg.data ? new TextDecoder().decode(msg.data) : 'no data',
                        messageHeaders: msg.headers ? Object.fromEntries(msg.headers) : 'no headers',
                        subject: msg.subject,
                        payloadType
                    })
                }
            }
        })()

        return subscription
    }

    // Request data
    async request<T = any, R = any>(subject: string, data: T, timeout = 3000): Promise<R> {
        if (!this.nc) {
            err('NATS client is not connected.')
            return null as unknown as R
        }
        const response = await this.nc.request(subject, JSON.stringify(data), { timeout })
        return JSON.parse(response.string()) as R
    }





    // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    // TODO: vefify that subscribe works as expected, specially that it creates queue groups automatically
    // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

    // Reply to requests
    reply<T = any, R = any>(
        subject: string,
        handler: ReplyHandler<T, R>,
        options: SubscriptionOptions = {},
        payloadType: 'json' | 'buffer' = 'json'
    ): Subscription | null {
        if (!this.nc) {
            err('NATS client is not connected.')
            return null
        }

        const subOptions = options.queue ? { queue: options.queue } : {}
        const subscription = this.nc.subscribe(subject, subOptions)

        // Apply middleware
        //TODO it hould use both middleware types
        const middlewareChain = this.config.replyMiddleware || this.config.middleware || []

        ;(async () => {
            for await (const msg of subscription) {
                try {

                    // let data: T = payloadType === 'json' ? JSON.parse(msg.string()) as T : msg.string() as T
                    let data = decode(msg, payloadType)

                    if (middlewareChain.length) {
                        const result = await this.applyMiddleware(data, msg, middlewareChain)
                        data = result.data
                    }
                    const result = await handler(data, msg)
                    // msg.respond(JSON.stringify(result))

                    msg.respond(encode(result, payloadType))
                } catch (error) {
                    err(`Reply error on subject ${subject}`, error)
                    // msg.respond(JSON.stringify({ error: (error as Error).message }))
                    msg.respond(encode(error, payloadType))
                }
            }
        })()

        return subscription
    }

    // ===========================================
    // JetStream Object Store Methods
    // ===========================================

    private getJetStream(): JetStreamClient {
        if (!this.nc) {
            throw new Error('NATS client is not connected.')
        }
        if (!this.js) {
            this.js = jetstream(this.nc)
        }
        return this.js
    }

    private getObjectStoreManager(): Objm {
        if (!this.objm) {
            this.objm = new Objm(this.getJetStream())
        }
        return this.objm
    }

    private async getJetStreamManager(): Promise<JetStreamManager> {
        if (!this.nc) {
            throw new Error('NATS client is not connected.')
        }
        if (!this.jsm) {
            this.jsm = await jetstreamManager(this.nc)
        }
        return this.jsm
    }

    // Distinguishes "the stream genuinely does not exist" (safe to create) from
    // transient/cluster errors like "no responders" or request timeouts (which
    // must NOT be treated as missing — creating a fresh empty bucket on a
    // transient error is how data loss was previously masked).
    private isStreamNotFoundError(e: any): boolean {
        const msg = (e?.message ?? String(e ?? '')).toLowerCase()
        const code = e?.code ?? e?.api_error?.err_code ?? e?.jsError?.code
        if (msg.includes('no responders') || msg.includes('timeout') || msg.includes('503')) return false
        return code === 404 || code === 10059 || msg.includes('stream not found') || msg.includes('no stream') || msg.includes('not found')
    }

    // Open a bucket read-only. Returns null when the bucket genuinely does not
    // exist; rethrows on transient/cluster errors so callers never mistake an
    // unreachable store for an empty one.
    private async openObjectStoreOrNull(bucketName: string): Promise<ObjectStore | null> {
        try {
            return await this.getObjectStoreManager().open(bucketName)
        } catch (e: any) {
            if (this.isStreamNotFoundError(e)) return null
            throw e
        }
    }

    async createObjectStore(bucketName: string, options?: Partial<ObjectStoreOptions>): Promise<ObjectStore> {
        const objm = this.getObjectStoreManager()
        // Default to the configured replication factor; callers may override.
        const os = await objm.create(bucketName, { replicas: this.streamReplicas, ...options })
        info(`Object Store bucket created: ${bucketName} (replicas=${(options?.replicas ?? this.streamReplicas)})`)
        return os
    }

    async getObjectStore(bucketName: string): Promise<ObjectStore> {
        const objm = this.getObjectStoreManager()
        return objm.open(bucketName)
    }

    // Open a bucket for WRITES, creating it only if it genuinely does not exist.
    // A transient open failure is rethrown rather than masked by creating an
    // empty replacement bucket. New buckets are created replicated (R3).
    async ensureObjectStore(bucketName: string): Promise<ObjectStore> {
        const objm = this.getObjectStoreManager()
        try {
            return await objm.open(bucketName)
        } catch (e: any) {
            if (!this.isStreamNotFoundError(e)) {
                err(`Object Store open failed for ${bucketName} (NOT auto-creating — transient/cluster error):`, e)
                throw e
            }
            warn(`Object Store bucket does not exist, creating (replicas=${this.streamReplicas}): ${bucketName}`)
            return await objm.create(bucketName, { replicas: this.streamReplicas })
        }
    }

    async deleteObjectStore(bucketName: string): Promise<boolean> {
        const objm = this.getObjectStoreManager()
        const result = await objm.destroy(bucketName)
        info(`Object Store bucket deleted: ${bucketName}`)
        return result
    }

    // List all stream names visible to this connection's account.
    async listStreamNames(): Promise<string[]> {
        const jsm = await this.getJetStreamManager()
        const names: string[] = []
        for await (const si of jsm.streams.list()) {
            names.push(si.config.name)
        }
        return names
    }

    // Scale a stream up to at least `replicas`. No-op when already at/above it.
    // Used to migrate legacy R1 stores to replicated storage. NATS adds the new
    // replicas and syncs them from the current leader (additive, non-destructive).
    async ensureStreamReplicas(streamName: string, replicas: number = this.streamReplicas): Promise<{ name: string; from: number; to: number; changed: boolean }> {
        const jsm = await this.getJetStreamManager()
        const si = await jsm.streams.info(streamName)
        const from = si.config.num_replicas ?? 1
        if (from >= replicas) {
            return { name: streamName, from, to: from, changed: false }
        }
        await jsm.streams.update(streamName, { num_replicas: replicas })
        return { name: streamName, from, to: replicas, changed: true }
    }

    // Helper to convert Uint8Array to ReadableStream (required by @nats-io/obj)
    private readableStreamFrom(data: Uint8Array): ReadableStream<Uint8Array> {
        return new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(data)
                controller.close()
            }
        })
    }

    async putObject(bucketName: string, name: string, data: Uint8Array, meta?: Partial<ObjectInfo>): Promise<ObjectInfo> {
        const os = await this.ensureObjectStore(bucketName)
        const stream = this.readableStreamFrom(data)
        const result = await os.put({ name, ...meta }, stream)
        info(`Object stored: ${bucketName}/${name} (${data.length} bytes)`)
        return result
    }

    async putObjectFromReadable(bucketName: string, name: string, readable: ReadableStream<Uint8Array>, meta?: Partial<ObjectInfo>): Promise<ObjectInfo> {
        const os = await this.ensureObjectStore(bucketName)
        const result = await os.put({ name, ...meta }, readable)
        info(`Object stored from stream: ${bucketName}/${name}`)
        return result
    }

    async getObject(bucketName: string, name: string): Promise<Uint8Array | null> {
        const os = await this.openObjectStoreOrNull(bucketName)
        if (!os) {
            return null
        }
        const result = await os.get(name)
        if (!result) {
            return null
        }
        // Read the data from the result
        const chunks: Uint8Array[] = []
        const reader = result.data.getReader()
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) chunks.push(value)
        }
        // Combine chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
            combined.set(chunk, offset)
            offset += chunk.length
        }
        return combined
    }

    async getObjectStream(bucketName: string, name: string): Promise<ReadableStream<Uint8Array> | null> {
        const os = await this.openObjectStoreOrNull(bucketName)
        if (!os) {
            return null
        }
        const result = await os.get(name)
        if (!result) {
            return null
        }
        return result.data
    }

    async getObjectInfo(bucketName: string, name: string): Promise<ObjectInfo | null> {
        const os = await this.openObjectStoreOrNull(bucketName)
        if (!os) {
            return null
        }
        return os.info(name)
    }

    async deleteObject(bucketName: string, name: string): Promise<void> {
        const os = await this.openObjectStoreOrNull(bucketName)
        if (!os) {
            warn(`Object Store bucket missing on delete, nothing to do: ${bucketName}/${name}`)
            return
        }
        await os.delete(name)
        info(`Object deleted: ${bucketName}/${name}`)
    }

    async listObjects(bucketName: string): Promise<ObjectInfo[]> {
        const os = await this.openObjectStoreOrNull(bucketName)
        if (!os) {
            return []
        }
        const objects: ObjectInfo[] = []
        const list = await os.list()
        for await (const obj of list) {
            objects.push(obj)
        }
        return objects
    }
}
