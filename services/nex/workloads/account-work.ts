import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import {
    ACCOUNT_ADMISSION_CHANGED_SUBJECT,
    ACCOUNT_WORK_ADMISSION_SUBJECT,
    getAccountIdentityKey,
    type AccountWorkContext,
} from '@lixpi/constants'
import type NatsService from '@lixpi/nats-service'

const denied = (): Error => new Error('ACCOUNT_ADMISSION_DENIED')
const execution = new AsyncLocalStorage<AccountWorkScope>()

export class AccountWorkScope {
    private readonly controller = new AbortController()
    private expiresAt = 0
    private checking?: Promise<void>
    private leaseTimer?: ReturnType<typeof setTimeout>
    readonly signal = this.controller.signal

    constructor(
        readonly account: AccountWorkContext,
        private readonly service: NatsService,
    ) {}

    static signal(): AbortSignal | undefined {
        return execution.getStore()?.signal
    }

    static assertActive(): void {
        execution.getStore()?.assertActive()
    }

    static async check(): Promise<void> {
        await execution.getStore()?.check()
    }

    assertActive(): void {
        if (
            this.signal.aborted
            || Date.now() >= this.expiresAt
            || Date.now() >= this.account.tokenExpiresAt
        )
            throw denied()
    }

    cancel(): void {
        clearTimeout(this.leaseTimer)
        this.controller.abort(
            denied(),
        )
    }

    async check(): Promise<void> {
        this.signal.throwIfAborted()
        this.checking ??= this.refresh()

        try {
            await this.checking
            this.assertActive()
        } finally {
            this.checking = undefined
        }
    }

    private async refresh(): Promise<void> {
        const nonce = randomUUID()

        try {
            const reply = await this.service.request<{
                version: number
                nonce: string
                accountContext: AccountWorkContext
            }, {
                version: number
                nonce: string
                accountContext: AccountWorkContext
                expiresAt: number
            }>(
                ACCOUNT_WORK_ADMISSION_SUBJECT,
                {
                    version: 1,
                    nonce,
                    accountContext: this.account,
                },
                3000,
            )
            const confirmed = reply?.accountContext

            if (
                !reply
                || reply.version !== 1
                || reply.nonce !== nonce
                || !confirmed
                || confirmed.identityKey !== this.account.identityKey
                || confirmed.subject !== this.account.subject
                || confirmed.issuer !== this.account.issuer
                || confirmed.epoch !== this.account.epoch
                || confirmed.personalOrganizationId !== this.account.personalOrganizationId
                || confirmed.tokenExpiresAt !== this.account.tokenExpiresAt
                || !Number.isSafeInteger(reply.expiresAt)
                || reply.expiresAt <= Date.now()
                || reply.expiresAt > Date.now() + 30_000
                || reply.expiresAt > this.account.tokenExpiresAt
            )
                throw denied()

            this.signal.throwIfAborted()
            this.expiresAt = reply.expiresAt
            clearTimeout(this.leaseTimer)
            this.leaseTimer = setTimeout(
                () => this.cancel(),
                Math.max(0, this.expiresAt - Date.now()),
            )
            this.leaseTimer.unref?.()
        } catch {
            this.cancel()

            throw denied()
        }
    }
}

// Jobs arrive only on API-published service subjects. Every start, storage
// boundary and subprocess start rechecks the original account epoch through the
// private API policy. Disconnect cancels active work, so a missed live event
// cannot survive a reconnect. The finite lease bounds an undetected outage.
export class AccountWorkScopes {
    private service?: NatsService
    private available = false
    private stopped = false
    private connectionGeneration = 0
    private connection?: ReturnType<NatsService['getConnection']>
    private subscription?: { unsubscribe(): void }
    private removeReconnect?: () => void
    private readonly active = new Set<AccountWorkScope>()
    private readonly changed = new Map<string, {
        epoch: number
        state: string
    }>()

    constructor(private readonly enabled: boolean) {}

    start(service: NatsService): void {
        this.service = service

        if (!this.enabled)
            return

        this.removeReconnect = service.onReconnect(() => this.attach(service))
        this.attach(service)
    }

    private attach(service: NatsService): void {
        if (this.stopped)
            return

        const connection = service.getConnection()

        if (!connection)
            throw denied()

        if (connection === this.connection)
            return

        this.unavailable()
        this.subscription?.unsubscribe()
        this.connection = connection
        const generation = ++this.connectionGeneration

        this.subscription = connection.subscribe(
            ACCOUNT_ADMISSION_CHANGED_SUBJECT,
            {
                callback: (error, message) => {
                    if (
                        generation !== this.connectionGeneration
                        || this.stopped
                    )
                        return

                    try {
                        if (
                            error
                            || message.data.byteLength > 4096
                        )
                            throw denied()

                        const event = message.json<{
                            version: number
                            identityKey: string
                            epoch: number
                            state: string
                        }>()

                        if (
                            event.version !== 1
                            || typeof event.identityKey !== 'string'
                            || !event.identityKey
                            || !Number.isSafeInteger(event.epoch)
                            || event.epoch < 1
                            || !['active', 'blocked', 'reconciling', 'superseded'].includes(event.state)
                        )
                            throw denied()

                        const previous = this.changed.get(event.identityKey)

                        if (
                            previous
                            && previous.epoch > event.epoch
                        )
                            return

                        const next = previous?.epoch === event.epoch
                            && previous.state !== event.state
                            ? {
                                ...event,
                                state: 'blocked',
                            }
                            : event
                        this.changed.set(event.identityKey, next)

                        for (const scope of this.active)
                            if (!this.current(scope.account))
                                scope.cancel()
                    } catch {
                        this.stop()
                    }
                },
            },
        )
        this.available = true
        void this.watch(connection, generation)
    }

    stop(): void {
        this.stopped = true
        this.unavailable()
        this.subscription?.unsubscribe()
        this.removeReconnect?.()
    }

    private unavailable(): void {
        this.available = false

        for (const scope of this.active)
            scope.cancel()
    }

    private async watch(
        connection: NonNullable<ReturnType<NatsService['getConnection']>>,
        generation: number,
    ): Promise<void> {
        try {
            for await (const status of connection.status()) {
                if (
                    generation !== this.connectionGeneration
                    || this.stopped
                )
                    return

                if (['disconnect', 'reconnecting', 'error', 'close'].includes(status.type))
                    this.unavailable()
                else if (status.type === 'reconnect')
                    this.available = true
            }
        } catch {
            if (generation === this.connectionGeneration)
                this.unavailable()
        } finally {
            if (generation === this.connectionGeneration)
                this.unavailable()
        }
    }

    private current(account: AccountWorkContext): boolean {
        const changed = this.changed.get(account.identityKey)

        return this.available && (!changed || changed.epoch < account.epoch || (changed.epoch === account.epoch && changed.state === 'active'))
    }

    async run<T>(
        payload: unknown,
        operation: (assertActive: () => void) => Promise<T>,
    ): Promise<T> {
        if (!this.enabled)
            return await operation(() => {})

        const account = (payload as { accountContext?: AccountWorkContext })?.accountContext

        if (
            !account
            || !this.service
            || !this.current(account)
            || account.identityKey !== getAccountIdentityKey(account.issuer, account.subject)
            || !Number.isSafeInteger(account.epoch)
            || account.epoch < 1
            || !Number.isSafeInteger(account.tokenExpiresAt)
            || account.tokenExpiresAt <= Date.now()
        )
            throw denied()

        if (this.active.size >= 128)
            throw denied()

        const scope = new AccountWorkScope(
            Object.freeze({ ...account }),
            this.service,
        )
        this.active.add(scope)
        const stopped = Promise.withResolvers<never>()
        const abort = (): void => void stopped.reject(
            denied(),
        )
        scope.signal.addEventListener(
            'abort',
            abort,
            { once: true },
        )
        const renewal = setInterval(async () => {
            try {
                await scope.check()
            } catch {
                scope.cancel()
            }
        }, 10_000)
        renewal.unref?.()

        try {
            return await Promise.race([stopped.promise, execution.run(scope, async () => {
                await scope.check()

                if (!this.current(scope.account))
                    throw denied()

                const result = await operation(() => scope.assertActive())
                await scope.check()

                return result
            })])
        } finally {
            clearInterval(renewal)
            scope.signal.removeEventListener('abort', abort)
            scope.cancel()
            this.active.delete(scope)
        }
    }
}

export class AccountWorkStorage {
    constructor(private readonly service: Pick<NatsService, 'getObject' | 'putObject'>) {}

    async getObject(...args: Parameters<NatsService['getObject']>): ReturnType<NatsService['getObject']> {
        await AccountWorkScope.check()
        const [bucket, key, options] = args
        const accountSignal = AccountWorkScope.signal()
        const signal = options?.signal
            && accountSignal
            ? AbortSignal.any([options.signal, accountSignal])
            : options?.signal ?? accountSignal
        const result = await this.service.getObject(
            bucket,
            key,
            {
                ...options,
                ...(signal ? { signal } : {}),
            },
        )
        AccountWorkScope.assertActive()

        return result
    }

    async putObject(...args: Parameters<NatsService['putObject']>): ReturnType<NatsService['putObject']> {
        await AccountWorkScope.check()
        const result = await this.service.putObject(...args)
        AccountWorkScope.assertActive()

        return result
    }
}
