import c from 'chalk'
import {
    wsconnect,
    tokenAuthenticator,
    type NatsConnection,
    type Msg,
    type Subscription,
    type ConnectionOptions,
} from '@nats-io/nats-core'
import { connect } from '@nats-io/transport-node'
import { fromSeed } from '@nats-io/nkeys'
import {
    jetstream,
    jetstreamManager,
    type JetStreamClient,
    type JetStreamManager,
} from '@nats-io/jetstream'
import {
    Objm,
    type ObjectStore,
    type ObjectStoreOptions,
    type ObjectInfo,
} from '@nats-io/obj'

// Default JetStream replication factor for all stores we create. The cluster
// runs 3 nodes, so R3 keeps a quorum copy on every node: a single node lagging
// or being briefly deemed unhealthy can no longer lose the only copy of data.
// Never default to 1 in a cluster — an R1 asset has no redundancy and can be
// silently lost when the meta-layer reassigns it during a health blip.
const DEFAULT_STREAM_REPLICAS = 3

// How many attempts init()'s first connect makes before it gives up and rejects.
// The waits between attempts use the same exponential backoff as reconnect
// (0.5s, 1s, 2s, 4s, 8s, then 16s), so nine attempts spend ~63s waiting and,
// with each attempt's own 2s connect timeout, cover roughly 80s of wall clock.
// That window is sized for a Docker Desktop cold boot, where a service can start
// before Docker DNS can resolve the NATS hostnames and every attempt fails with
// EAI_AGAIN. Only the first connect is bounded: once a connection has been
// established, reconnects retry forever.
const DEFAULT_INITIAL_CONNECT_MAX_ATTEMPTS = 9

import {
    log,
    info,
    infoStr,
    warn,
    err,
} from '@lixpi/debug-tools'

export type NatsMiddleware<T = any> = (data: T, msg: Msg) => Promise<{ data: T; msg: Msg }> | { data: T; msg: Msg }

export type ReplyMiddleware<T = any, R = any> = (data: T, msg: Msg) => Promise<{ data: T; msg: Msg }> | { data: T; msg: Msg }

export type NatsServiceConfig = {
    servers?: string[]
    webSocket?: boolean
    name?: string
    token?: string
    user?: string
    pass?: string
    nkeySeed?: string // Optional NKey seed for self-issued JWT
    userId?: string // Optional user ID for JWT subject (used with nkeySeed)
    // Optional async provider used to (re)fetch a fresh auth token before every
    // connect/reconnect attempt. When supplied it takes precedence over the
    // static `token` and lets the connection recover from token expiry or
    // signing-key rotation without a page reload.
    getToken?: () => Promise<string | false>
    // Invoked when the server rejects our credentials (AuthorizationError) so the
    // caller can invalidate any cached token before `getToken` is called again.
    onAuthError?: (error: unknown) => void | Promise<void>
    subscriptions?: NatsSubjectSubscription[]
    middleware?: NatsMiddleware[] // Middleware for all subscriptions
    replyMiddleware?: ReplyMiddleware[] // Middleware specifically for replies
    streamReplicas?: number // Replication factor for created stores (defaults to DEFAULT_STREAM_REPLICAS)
    // How many attempts init()'s first connect makes before rejecting (defaults to
    // DEFAULT_INITIAL_CONNECT_MAX_ATTEMPTS). Raise it for a caller that starts
    // alongside a slow cluster, lower it for one that would rather fail quickly.
    // It does not affect reconnects, which always retry forever.
    initialConnectMaxAttempts?: number
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

export type JetStreamPublishOptions = {
    msgID?: string
    expect?: Record<string, string | number>
    headers?: any
}

export type JetStreamConsumeOptions = {
    maxMessages?: number
    expiresMs?: number
    nakDelayMs?: number
}

export type JetStreamMessageDisposition = {
    nakDelayMs: number
}

const encode = (value: any, type: 'json' | 'buffer'): any => {
    if (type === 'json') {
        return JSON.stringify(value)
    }

    if (type === 'buffer') {
        return Buffer.from(value)
    }
}

type ReplyErrorPayload = { error: string } | string

const getReplyErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === 'string' && error) return error
    if (error && typeof error === 'object' && 'error' in error) {
        const message = (error as { error?: unknown }).error
        if (typeof message === 'string' && message) return message
    }

    const message = String(error)
    return message && message !== '[object Object]' ? message : 'UNKNOWN_NATS_REPLY_ERROR'
}

const getReplyErrorPayload = (error: unknown, type: 'json' | 'buffer'): ReplyErrorPayload => {
    const message = getReplyErrorMessage(error)
    return type === 'json' ? { error: message } : message
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
        sub: userId, // Subject: service identity
        iss: publicKey, // Issuer: our public key
        iat: now, // Issued at
        exp: now + (expiryHours * 3600), // Expiry
    }

    // Create JWT header
    const header = {
        typ: 'JWT',
        alg: 'EdDSA', // Ed25519 signature algorithm
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
    private static instance: NatsService | null = null
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
    // Latest token handed to the NATS authenticator. Kept in sync so the client's
    // own internal reconnect loop always presents fresh credentials rather than a
    // stale token that was captured once at connect time.
    private currentToken: string | null = null
    // Set during graceful disconnect()/drain() so the status monitor does not try
    // to reconnect after an intentional close.
    private intentionalClose = false
    // Consecutive failed connect attempts, used for exponential backoff so a
    // persistent auth failure does not flood the auth callout / JWKS endpoint.
    private reconnectAttempts = 0
    // Timeout (ms) applied to each connect attempt; captured from connect().
    private connectTimeout = 2000

    static getInstance(): NatsService | null {
        return NatsService.instance || null
    }

    // Resolves only once the connection is real, and rejects when the first
    // connect never succeeds. Returning a service whose `nc` is still null used to
    // look like success and then blew up much later, in whatever startup code made
    // the first JetStream call.
    static async init(config: NatsServiceConfig = {}): Promise<NatsService> {
        if (NatsService.instance)
            return NatsService.instance

        const instance = new NatsService(config)
        // Published before connecting so subscription handlers that run while the
        // connection is being established can still reach it through getInstance().
        NatsService.instance = instance

        try {
            await instance.connectOrThrow()
        } catch (error) {
            // Drop the dead singleton so a caller that catches this and calls init()
            // again builds a fresh instance instead of reusing the failed one.
            NatsService.instance = null

            throw error
        }

        return instance
    }

    private constructor(config: NatsServiceConfig) {
        this.config = config
        this.streamReplicas = config.streamReplicas ?? DEFAULT_STREAM_REPLICAS
    }

    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, capped at 16s. Prevents a stale
    // token or a down server from hammering the auth callout / JWKS endpoint
    // (which is itself rate-limited) tens of times per second. Both the reconnect
    // timer and the first-connect retry loop take their delay from here so the two
    // paths cannot drift apart.
    private nextBackoffDelay(delay?: number): number {
        const backoff = delay ?? Math.min(500 * (2 ** this.reconnectAttempts), 16000)
        this.reconnectAttempts++

        return backoff
    }

    private scheduleReconnect(delay?: number) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

        this.reconnectTimer = setTimeout(() => this.connect(this.connectTimeout), this.nextBackoffDelay(delay))
    }

    private async waitBeforeRetry(): Promise<void> {
        const backoff = this.nextBackoffDelay()
        await new Promise<void>(resolve => setTimeout(resolve, backoff))
    }

    private monitorStatus(): void {
        if (!this.nc || this.isMonitoring) return
        this.isMonitoring = true
        ;(async () => {
            for await (const status of this.nc.status()) {
                switch (status.type) {
                    case 'disconnect':
                        err('NATS -> disconnected:', status)
                        break
                    case 'reconnecting':
                        warn('NATS -> reconnecting:', status)
                        break
                    case 'reconnect':
                        info('NATS -> reconnected:', status)
                        // Check if subscriptions need to be initialized after reconnect
                        if (!this.subscriptionsInitialized) {
                            await this.initSubscriptions()
                        }
                        break
                    case 'error':
                        err('NATS -> connection error:', status)
                        // The client keeps retrying internally (maxReconnectAttempts: -1),
                        // but with the credentials captured at connect time. If the server
                        // rejected our token (expired or signing key rotated), refresh it so
                        // the next internal reconnect presents valid credentials.
                        if (this.isAuthError((status as any).error ?? status)) {
                            await this.handleAuthError((status as any).error ?? status)
                            await this.refreshToken()
                        }
                        break
                    case 'close':
                        warn('NATS -> connection closed:', status)
                        // Reset the initialized flag on close so we can reconnect properly
                        this.subscriptionsInitialized = false
                        // Reconnect unless we intentionally closed the connection.
                        if (!this.intentionalClose) {
                            this.scheduleReconnect()
                        }
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

        for (const listener of subs) {
            try {
                const subscriptionType = listener.type ?? 'subscribe'

                let subscription: Subscription
                if (subscriptionType === 'reply') {
                    subscription = this.reply(
                        listener.subject,
                        listener.handler as ReplyHandler,
                        { queue: listener.queue },
                        listener.payloadType,
                    )
                } else {
                    subscription = this.subscribe(
                        listener.subject,
                        listener.handler as MessageHandler,
                        { queue: listener.queue },
                        listener.payloadType,
                    )
                }

                if (subscription) {
                    infoStr([
                        c.green('NATS -> '),
                        c.grey.italic('register:'),
                        c.white.italic(subscriptionType.padEnd(10, ' ')),
                        c.grey(': '),
                        c.green(listener.subject),
                        listener.queue ? `${c.white(' with queue:')} ${c.green(listener.queue)}` : '',
                    ])
                }
            } catch (error) {
                err(`Failed to subscribe to NATS subject ${listener.subject}`, error)
            }
        }

        this.subscriptionsInitialized = true
    }

    private async applyMiddleware<T = any>(
        data: T,
        msg: Msg,
        handlers: Array<NatsMiddleware<T> | ReplyMiddleware<T>>,
    ): Promise<{ data: T; msg: Msg }> {
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

    // A single connect attempt. Throws on failure so the caller chooses between
    // retrying forever (reconnect) and giving up (first connect).
    private async attemptConnect(): Promise<void> {
        // Fetch a fresh token before every attempt so a reload/reconnect after a
        // token expiry or signing-key rotation does not keep replaying stale creds.
        await this.refreshToken()

        // Options are rebuilt for every attempt and the client resolves the server
        // hostnames when it opens the socket, so a DNS soft failure (EAI_AGAIN,
        // which is what a Docker cold boot produces) is re-resolved on the next
        // attempt instead of replaying a cached failed lookup.
        const options = this.buildConnectionOptions()
        // The client honours `options.timeout` and rejects on failure (see
        // waitOnFirstConnect: false), so there is no need for a Promise.race
        // timeout that would leave a background client retrying forever.
        this.nc = await (this.config.webSocket ? wsconnect(options) : connect(options))
        // Connected: reset the reconnect backoff.
        this.reconnectAttempts = 0
        infoStr([
            c.green('NATS -> listening on: '),
            c.blue(`${this.config.webSocket ? 'wss://' : 'nats://'}${this.nc.getServer()}`),
        ])
        this.monitorStatus()
        await this.initSubscriptions()
    }

    private async reportConnectError(error: unknown): Promise<void> {
        if (this.isAuthError(error)) {
            // Server rejected our credentials. Let the caller invalidate its cached
            // token so the next refreshToken() obtains a valid one instead of looping
            // forever on the same rejected token.
            err('NATS -> authorization failed, refreshing credentials', error)
            await this.handleAuthError(error)

            return
        }

        err('NATS -> connection error or timeout', error)
    }

    // The reconnect path. It never throws: a NATS blip after startup must not take
    // the process down, so a failed attempt schedules the next one and returns.
    // scheduleReconnect() and monitorStatus()'s close handler both land here.
    async connect(initialConnectTimeout = 2000): Promise<void> {
        if (this.isConnecting || this.isConnected()) return
        this.isConnecting = true
        this.intentionalClose = false
        this.connectTimeout = initialConnectTimeout

        try {
            await this.attemptConnect()
        } catch (error) {
            await this.reportConnectError(error)
            this.scheduleReconnect()
        } finally {
            this.isConnecting = false
        }
    }

    // The first-connect path. It retries on the same backoff as reconnect and then
    // throws, so init() rejects instead of handing back a service that never
    // connected. Once this returns, every later failure goes through connect().
    private async connectOrThrow(initialConnectTimeout = 2000): Promise<void> {
        if (this.isConnected())
            return

        this.isConnecting = true
        this.intentionalClose = false
        this.connectTimeout = initialConnectTimeout

        const maxAttempts = this.config.initialConnectMaxAttempts ?? DEFAULT_INITIAL_CONNECT_MAX_ATTEMPTS

        try {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    await this.attemptConnect()

                    return
                } catch (error) {
                    await this.reportConnectError(error)

                    if (attempt === maxAttempts) {
                        throw new Error(
                            `NATS -> first connect failed after ${maxAttempts} attempts`,
                            { cause: error },
                        )
                    }

                    await this.waitBeforeRetry()
                }
            }
        } finally {
            this.isConnecting = false
        }
    }

    // Refresh the token used by the authenticator. Prefers the async provider so
    // credentials can be regenerated on demand; falls back to the static token.
    private async refreshToken(): Promise<void> {
        if (this.config.getToken) {
            try {
                const fresh = await this.config.getToken()
                if (fresh) this.currentToken = fresh
            } catch (error) {
                err('NATS -> failed to refresh auth token', error)
            }
        } else if (this.config.token) {
            this.currentToken = this.config.token
        }
    }

    // Notify the caller that the server rejected our credentials so it can clear
    // any cached token before the next refreshToken() call.
    private async handleAuthError(error: unknown): Promise<void> {
        try {
            await this.config.onAuthError?.(error)
        } catch (cbError) {
            err('NATS -> onAuthError handler failed', cbError)
        }
    }

    // Detect authorization/authentication failures across the various error shapes
    // the client surfaces them in (thrown errors and status events).
    private isAuthError(error: unknown): boolean {
        const name = (error as any)?.name
        const message = String((error as any)?.message ?? error ?? '')
        return name === 'AuthorizationError' || /authoriz|authentic/i.test(message)
    }

    private buildConnectionOptions(): ConnectionOptions {
        const { servers = ['nats://localhost:4222'], name = 'default' } = this.config

        const options: ConnectionOptions = {
            servers,
            name,
            maxReconnectAttempts: -1,
            reconnectTimeWait: 500,
            // Reject the initial connect on failure instead of retrying silently in
            // the background. With `waitOnFirstConnect: true` an auth failure never
            // surfaced to our catch block: the client kept retrying forever with the
            // rejected token, our own connect timeout fired, and we spawned yet
            // another background client that also retried forever — flooding the
            // auth callout / JWKS endpoint. Failing fast lets us detect the auth
            // error, refresh the token, and back off.
            waitOnFirstConnect: false,
            // Let the client enforce the connect timeout so a slow/hanging attempt
            // is torn down cleanly rather than leaked behind a Promise.race.
            timeout: this.connectTimeout,
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
        } else if (this.config.getToken || token || this.currentToken) {
            // Priority 2: Pre-generated / provider-supplied JWT token.
            // Use a token authenticator that reads `currentToken` on every (re)connect
            // so the client's internal reconnect loop always presents the freshest
            // token instead of the one captured when the connection was first opened.
            if (!this.currentToken && token) this.currentToken = token
            options.authenticator = tokenAuthenticator(() => this.currentToken ?? '')
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
            this.intentionalClose = true
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
            await this.nc.close()
            info('NATS disconnected gracefully.')
        }
    }

    async drain(): Promise<void> {
        if (this.nc && !this.nc.isClosed()) {
            this.intentionalClose = true
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
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

    // Publish JSON data to a subject.
    publish<T = any>(subject: string, data: T): void {
        if (!this.nc) {
            err('NATS client is not connected.')
            return
        }
        this.nc.publish(subject, JSON.stringify(data))
    }

    // Subscribe to a subject.
    subscribe<T = any>(
        subject: string,
        handler: (data: T, msg: Msg) => void | Promise<void>,
        options: SubscriptionOptions = {},
        payloadType: 'json' | 'buffer' = 'json',
    ): Subscription | null {
        if (!this.nc) {
            err('NATS client is not connected.')
            return null
        }

        const subOptions = options.queue ? { queue: options.queue } : {}
        const subscription = this.nc.subscribe(subject, subOptions)

        // Apply middleware
        // TODO it hould use both middleware types
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
                        payloadType,
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
        payloadType: 'json' | 'buffer' = 'json',
    ): Subscription | null {
        if (!this.nc) {
            err('NATS client is not connected.')
            return null
        }

        const subOptions = options.queue ? { queue: options.queue } : {}
        const subscription = this.nc.subscribe(subject, subOptions)

        // Apply middleware
        // TODO it hould use both middleware types
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
                    msg.respond(encode(getReplyErrorPayload(error, payloadType), payloadType))
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

    async ensureJetStreamStream(config: Record<string, any>): Promise<any> {
        const jsm = await this.getJetStreamManager()
        try {
            const streamInfo = await jsm.streams.info(config.name)
            const existingSubjects = streamInfo.config.subjects ?? []
            const nextSubjects = Array.from(new Set([...existingSubjects, ...(config.subjects ?? [])]))
            const requestedConfig = {
                ...config,
                subjects: nextSubjects,
            }
            const requestedEntries = Object.entries(requestedConfig)
            const isCurrent = requestedEntries.every(([key, value]) => {
                if (key === 'subjects') {
                    return JSON.stringify(streamInfo.config.subjects ?? []) === JSON.stringify(value)
                }
                return streamInfo.config[key] === value
            })
            if (isCurrent) return streamInfo
            await jsm.streams.update(config.name, {
                ...streamInfo.config,
                ...requestedConfig,
            })
            return await jsm.streams.info(config.name)
        } catch (e: any) {
            if (!this.isStreamNotFoundError(e)) throw e
            return await jsm.streams.add(config)
        }
    }

    async getJetStreamStreamInfo(streamName: string, options: Record<string, any> = {}): Promise<any> {
        const jsm = await this.getJetStreamManager()
        return await (jsm.streams as any).info(streamName, options)
    }

    async getJetStreamStreamInfoOrNull(streamName: string, options: Record<string, any> = {}): Promise<any | null> {
        try {
            return await this.getJetStreamStreamInfo(streamName, options)
        } catch (e: any) {
            if (this.isStreamNotFoundError(e)) return null
            throw e
        }
    }

    async getJetStreamMessage<T = any>(streamName: string, request: Record<string, any>): Promise<{ data: T; subject: string; seq: number } | null> {
        const jsm = await this.getJetStreamManager()
        try {
            const message = await (jsm.streams as any).getMessage(streamName, request)
            if (!message) return null
            return {
                data: JSON.parse(new TextDecoder().decode(message.data)) as T,
                subject: message.subject,
                seq: message.seq,
            }
        } catch (e: any) {
            if (this.isStreamNotFoundError(e)) return null
            throw e
        }
    }

    async publishJetStream<T = any>(
        subject: string,
        data: T | Uint8Array,
        options: JetStreamPublishOptions = {},
    ): Promise<any> {
        const payload = data instanceof Uint8Array
            ? data
            : new TextEncoder().encode(JSON.stringify(data))
        return await (this.getJetStream() as any).publish(subject, payload, options)
    }

    async ensureJetStreamConsumer(streamName: string, config: Record<string, any>): Promise<any> {
        const jsm = await this.getJetStreamManager()
        try {
            const consumerInfo = await (jsm.consumers as any).info(streamName, config.durable_name)
            return await (jsm.consumers as any).update(streamName, config.durable_name, {
                ...consumerInfo.config,
                ...config,
            })
        } catch (e: any) {
            if (!this.isStreamNotFoundError(e)) throw e
            return await (jsm.consumers as any).add(streamName, config)
        }
    }

    async consumeJetStreamMessages<T = any>(
        streamName: string,
        consumerName: string,
        options: JetStreamConsumeOptions = {},
    ): Promise<Array<{ data: T; subject: string; seq: number }>> {
        const consumer = await (this.getJetStream() as any).consumers.get(streamName, consumerName)
        const messages = await consumer.consume({
            max_messages: options.maxMessages ?? 100,
            expires: options.expiresMs ?? 1000,
        })
        const decodedMessages: Array<{ data: T; subject: string; seq: number }> = []

        for await (const message of messages) {
            decodedMessages.push({
                data: JSON.parse(message.string()) as T,
                subject: message.subject,
                seq: message.seq,
            })
            message.ack()
        }

        return decodedMessages
    }

    async processJetStreamMessages<T = any>(
        streamName: string,
        consumerName: string,
        handler: (message: { data: T; subject: string; seq: number }) => Promise<void | JetStreamMessageDisposition>,
        options: JetStreamConsumeOptions = {},
    ): Promise<number> {
        const consumer = await (this.getJetStream() as any).consumers.get(streamName, consumerName)
        const messages = await consumer.consume({
            max_messages: options.maxMessages ?? 100,
            expires: options.expiresMs ?? 1000,
        })
        let processed = 0
        for await (const message of messages) {
            try {
                const disposition = await handler({
                    data: JSON.parse(message.string()) as T,
                    subject: message.subject,
                    seq: message.seq,
                })
                if (disposition) {
                    message.nak(disposition.nakDelayMs)
                    continue
                }
                message.ack()
                processed += 1
            } catch (error) {
                // One poisoned message must not abandon the rest of the fetched batch:
                // nak it for redelivery and keep draining what the consumer handed us.
                message.nak(options.nakDelayMs)
                err(`Error processing JetStream message on subject ${message.subject}`, error)
            }
        }
        return processed
    }

    async purgeJetStreamSubject(
        streamName: string,
        subject: string,
        options: { throughSequence?: number } = {},
    ): Promise<void> {
        const jsm = await this.getJetStreamManager()
        await jsm.streams.purge(streamName, {
            filter: subject,
            ...(typeof options.throughSequence === 'number'
                ? { seq: options.throughSequence + 1 }
                : {}),
        })
    }

    // Helper to convert Uint8Array to ReadableStream (required by @nats-io/obj)
    private readableStreamFrom(data: Uint8Array): ReadableStream<Uint8Array> {
        return new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(data)
                controller.close()
            },
        })
    }

    async putObject(bucketName: string, name: string, data: Uint8Array, meta?: Partial<ObjectInfo>): Promise<ObjectInfo> {
        const os = await this.getObjectStore(bucketName)
        const stream = this.readableStreamFrom(data)
        const result = await os.put({ name, ...meta }, stream)
        info(`Object stored: ${bucketName}/${name} (${data.length} bytes)`)
        return result
    }

    async putObjectFromReadable(bucketName: string, name: string, readable: ReadableStream<Uint8Array>, meta?: Partial<ObjectInfo>): Promise<ObjectInfo> {
        const os = await this.getObjectStore(bucketName)
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
