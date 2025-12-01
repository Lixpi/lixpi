'use strict'

import c from 'chalk'
import { wsconnect } from '@nats-io/nats-core'
import { connect } from "@nats-io/transport-node"
import { fromSeed } from '@nats-io/nkeys'

import type {
    NatsConnection,
    Msg,
    Subscription,
    ConnectionOptions
} from '@nats-io/nats-core'

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
    private config: NatsServiceConfig
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
}
